import io
from dataclasses import replace

import pymupdf
import pytest
from fastapi.testclient import TestClient

from invoice_service import jobs
from invoice_service.api import create_app
from invoice_service.config import Policy
from invoice_service.worker import process, sweep

from .conftest import FakeEngine, invoice


@pytest.fixture
def app(settings, redis):
    return create_app(settings, redis)


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def tokens(app):
    store = app.state.store
    return {"alice": store.create_user("alice"), "bob": store.create_user("bob")}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def upload(client, token, data, name="invoice.pdf"):
    return client.post("/api/invoices", headers=auth(token), files={"file": (name, data, "application/pdf")})


def work(app, engine=None):
    """Run the worker over everything queued, as the real worker would."""
    statuses = []
    while (doc_id := jobs.next_job(app.state.redis, timeout=0.01)) is not None:
        statuses.append(process(doc_id, app.state.store, engine or FakeEngine(), app.state.settings, Policy(),
                                app.state.redis))
    return statuses


def test_upload_to_result(app, client, tokens):
    inv, pdf = invoice(seed=4)
    response = upload(client, tokens["alice"], pdf)
    assert response.status_code == 202
    doc_id = response.json()["id"]
    assert client.get(f"/api/invoices/{doc_id}/status", headers=auth(tokens["alice"])).json()["status"] == "queued"

    # A vendor nobody has approved yet: read correctly, but a person looks first.
    assert work(app) == ["needs_review"]
    body = client.get(f"/api/invoices/{doc_id}/result", headers=auth(tokens["alice"])).json()
    assert body["status"] == "needs_review"
    assert [(i["code"], i["field"]) for i in body["result"]["issues"] if i["severity"] == "error"] == [
        ("unverified_field", "vendor_name")]
    assert body["result"]["invoice"]["invoice_number"]["value"] == inv["invoice_number"]
    assert body["result"]["schema_version"] == 1
    assert "_context" not in body["result"]

    listed = client.get("/api/invoices", headers=auth(tokens["alice"])).json()["invoices"]
    assert [d["id"] for d in listed] == [doc_id]
    original = client.get(f"/api/invoices/{doc_id}/file", headers=auth(tokens["alice"]))
    assert original.content == pdf and original.headers["content-type"] == "application/pdf"


def test_an_approved_vendor_is_trusted_next_time(app, client, tokens):
    _, first = invoice(seed=4)
    doc_id = upload(client, tokens["alice"], first).json()["id"]
    assert work(app) == ["needs_review"]
    approved = client.patch(f"/api/invoices/{doc_id}/corrections", headers=auth(tokens["alice"]),
                            json={"corrections": {}, "approve": True}).json()
    assert approved["status"] == "accepted" and approved["reviewed_by"] == "alice"

    # Another invoice from the same vendor now checks out on its own.
    _, pdf = invoice(seed=4, invoice_number="INV-80002")
    upload(client, tokens["alice"], pdf)
    assert work(app) == ["accepted"]
    # Only for the user who approved it.
    upload(client, tokens["bob"], pdf)
    assert work(app) == ["needs_review"]


def test_every_route_needs_a_valid_token(client, tokens):
    assert client.get("/api/invoices").status_code == 401
    assert client.get("/api/invoices", headers=auth("not-a-real-token")).status_code == 401
    assert client.get("/api/health").status_code == 200


def test_nobody_sees_anyone_elses_invoices(app, client, tokens):
    _, pdf = invoice(seed=4)
    doc_id = upload(client, tokens["alice"], pdf).json()["id"]
    work(app)
    for path in ("", "/status", "/result", "/file"):
        assert client.get(f"/api/invoices/{doc_id}{path}", headers=auth(tokens["bob"])).status_code == 404
    patch = client.patch(f"/api/invoices/{doc_id}/corrections", headers=auth(tokens["bob"]),
                         json={"corrections": {"invoice_number": "X"}})
    assert patch.status_code == 404
    assert client.get("/api/invoices", headers=auth(tokens["bob"])).json()["invoices"] == []


def test_corrections_are_checked_and_need_approval(app, client, tokens):
    inv, pdf = invoice(seed=4)
    doc_id = upload(client, tokens["alice"], pdf).json()["id"]
    work(app)
    url = f"/api/invoices/{doc_id}/corrections"

    bad = client.patch(url, headers=auth(tokens["alice"]), json={"corrections": {"total_due": "lots"}})
    assert bad.status_code == 422
    unknown = client.patch(url, headers=auth(tokens["alice"]), json={"corrections": {"password": "x"}})
    assert unknown.status_code == 422

    fixed = client.patch(url, headers=auth(tokens["alice"]), json={"corrections": {"purchase_order": "PO-1"}})
    assert fixed.status_code == 200
    body = fixed.json()
    assert body["status"] == "needs_review"
    assert body["result"]["invoice"]["purchase_order"] == {**body["result"]["invoice"]["purchase_order"],
                                                           "value": "PO-1", "status": "corrected"}

    # A wrong total is checked like any other value: the parts no longer add up to it.
    wrong = client.patch(url, headers=auth(tokens["alice"]), json={"corrections": {"total_due": "1.00"}}).json()
    assert "total_mismatch" in [i["code"] for i in wrong["result"]["issues"]]
    right = client.patch(url, headers=auth(tokens["alice"]),
                         json={"corrections": {"total_due": str(inv["total"])}, "approve": True}).json()
    assert right["status"] == "accepted" and right["reviewed_by"] == "alice"
    # The original reading is kept; corrections sit on top of it.
    again = client.get(f"/api/invoices/{doc_id}/result", headers=auth(tokens["alice"])).json()
    assert again["corrections"] == {"purchase_order": "PO-1", "total_due": str(inv["total"])}


def test_rejects_bad_uploads_before_queueing(client, tokens, app):
    assert upload(client, tokens["alice"], b"MZ\x90\x00 an exe").status_code == 415
    assert upload(client, tokens["alice"], b"%PDF-1.4 broken").status_code == 422
    doc = pymupdf.open()
    doc.new_page()
    locked = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="o", user_pw="u")
    assert upload(client, tokens["alice"], locked).status_code == 422
    assert upload(client, tokens["alice"], b"%PDF-" + b"0" * (3 * 1024 * 1024)).status_code == 413
    assert jobs.next_job(app.state.redis, timeout=0.01) is None


def test_failed_documents_can_be_retried(app, client, tokens):
    _, pdf = invoice(seed=4)
    doc_id = upload(client, tokens["alice"], pdf).json()["id"]

    class Broken(FakeEngine):
        def versions(self):
            raise RuntimeError("engine crashed")

    app.state.settings = replace(app.state.settings, max_attempts=1)
    while (job := jobs.next_job(app.state.redis, timeout=0.01)) is not None:
        process(job, app.state.store, Broken(), app.state.settings, Policy(), app.state.redis)
    assert client.get(f"/api/invoices/{doc_id}/status", headers=auth(tokens["alice"])).json()["status"] == "failed"

    assert client.post(f"/api/invoices/{doc_id}/retry", headers=auth(tokens["alice"])).status_code == 202
    assert work(app) == ["needs_review"]
    assert client.post(f"/api/invoices/{doc_id}/retry", headers=auth(tokens["alice"])).status_code == 409


def test_a_job_delivered_twice_is_processed_once(app, client, tokens):
    _, pdf = invoice(seed=4)
    doc_id = upload(client, tokens["alice"], pdf).json()["id"]
    jobs.enqueue(app.state.redis, doc_id)
    assert work(app) == ["needs_review", None]


def test_a_stuck_job_is_put_back_by_the_sweep(app, client, tokens):
    _, pdf = invoice(seed=4)
    doc_id = upload(client, tokens["alice"], pdf).json()["id"]
    jobs.next_job(app.state.redis, timeout=0.01)  # a worker took it, then died
    app.state.store.claim(doc_id, 3)
    sweep(app.state.store, replace(app.state.settings, job_seconds=-10), app.state.redis)
    assert work(app) == ["needs_review"]


def test_the_same_invoice_twice_is_flagged(app, client, tokens):
    _, pdf = invoice(seed=4)
    upload(client, tokens["alice"], pdf)
    second = upload(client, tokens["alice"], pdf).json()["id"]
    assert work(app) == ["needs_review", "needs_review"]
    issues = client.get(f"/api/invoices/{second}/result", headers=auth(tokens["alice"])).json()["result"]["issues"]
    assert "possible_duplicate" in [i["code"] for i in issues]


def test_rate_limits(app, client, tokens):
    app_settings = app.state.settings
    limited = create_app(replace(app_settings, requests_per_minute=3), app.state.redis)
    limited_client = TestClient(limited)
    token = limited.state.store.create_user("carol")
    codes = [limited_client.get("/api/invoices", headers=auth(token)).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    bad = [client.get("/api/invoices", headers=auth("wrong")).status_code for _ in range(22)]
    assert bad[-1] == 429


def test_cors_allows_only_the_configured_origin(client):
    allowed = client.options("/api/invoices", headers={"Origin": "https://example-user.github.io",
                                                       "Access-Control-Request-Method": "POST"})
    assert allowed.headers.get("access-control-allow-origin") == "https://example-user.github.io"
    other = client.options("/api/invoices", headers={"Origin": "https://evil.example",
                                                     "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in other.headers


def test_an_image_upload_is_accepted(client, tokens):
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (900, 1200), "white").save(buffer, format="PNG")
    response = client.post("/api/invoices", headers=auth(tokens["alice"]),
                           files={"file": ("scan.pdf", buffer.getvalue(), "application/pdf")})
    assert response.status_code == 202  # the bytes say PNG, whatever the name and type say


def ocr_worker(app, engine, count=1):
    """A worker in the background, answering `count` page-reading requests."""
    import threading

    from invoice_service import page_ocr

    def serve():
        for _ in range(count):
            work = jobs.next_work(app.state.redis, timeout=5)
            if work and work[0] == "ocr":
                page_ocr.answer(app.state.redis, work[1], engine, 40_000_000)

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    return thread


def png(width=1000, height=1300) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def test_split_can_have_a_page_read_and_nothing_is_kept(app, client, tokens):
    engine = FakeEngine([[("Invoice No: 7730501", 0.98, (100.0, 50.0, 400.0, 80.0))]])
    ocr_worker(app, engine)
    response = client.post("/api/ocr", headers=auth(tokens["alice"]),
                           files={"image": ("page.png", png(), "image/png")})
    assert response.status_code == 200
    line = response.json()["lines"][0]
    # In the shape Split already reads from Tesseract: boxes in pixels, confidence 0-100.
    assert line["confidence"] == 98.0 and line["bbox"] == {"x0": 100, "y0": 50, "x1": 400, "y1": 80}
    assert [w["text"] for w in line["words"]] == ["Invoice", "No:", "7730501"]
    assert line["words"][-1]["bbox"]["x1"] == 400
    assert [k for k in app.state.redis.keys("ocr:*")] == []  # the picture is gone


def test_a_sideways_page_is_turned_before_it_is_read(app, client, tokens):
    engine = FakeEngine([[("Total 108.25", 0.9, (10.0, 10.0, 200.0, 40.0))]], turn=90)
    ocr_worker(app, engine)
    body = client.post("/api/ocr", headers=auth(tokens["alice"]),
                       files={"image": ("page.png", png(), "image/png")}).json()
    assert body["rotation"] == 90


def test_page_reading_needs_a_token_and_a_picture(app, client, tokens):
    assert client.post("/api/ocr", files={"image": ("p.png", png(), "image/png")}).status_code == 401
    pdf = client.post("/api/ocr", headers=auth(tokens["alice"]),
                      files={"image": ("p.png", b"%PDF-1.7 not a picture", "image/png")})
    assert pdf.status_code == 415


def test_page_reading_says_so_when_no_worker_answers(app, client, tokens, monkeypatch):
    from invoice_service import page_ocr

    monkeypatch.setattr(page_ocr, "ask", lambda redis, data, timeout: None)
    response = client.post("/api/ocr", headers=auth(tokens["alice"]),
                           files={"image": ("page.png", png(), "image/png")})
    assert response.status_code == 504
