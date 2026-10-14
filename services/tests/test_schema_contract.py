"""
Keeps the browser's Zod schema and this service's Pydantic schema in step.

This writes a real API response to packages/invoice-schema/fixtures/, and the
frontend's unit tests parse that file with the Zod schema. If either side
changes shape, one of the two test suites fails.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from invoice_service.api import create_app

from .conftest import invoice
from .test_api import auth, upload, work

FIXTURE = Path(__file__).resolve().parents[2] / "packages" / "invoice-schema" / "fixtures" / "sample-result.json"


def test_writes_a_real_response_for_the_frontend_contract_test(settings, redis):
    app = create_app(settings, redis)
    client = TestClient(app)
    token = app.state.store.create_user("contract")
    _, pdf = invoice(seed=4)
    doc_id = upload(client, token, pdf).json()["id"]
    work(app)
    client.patch(f"/api/invoices/{doc_id}/corrections", headers=auth(token),
                 json={"corrections": {"purchase_order": "PO-1", "line_items.0.quantity": "3"}})
    body = client.get(f"/api/invoices/{doc_id}/result", headers=auth(token)).json()
    # Fixed values where a run would otherwise differ, so the file only changes when the shape does.
    for key in ("id",):
        body[key] = "00000000-0000-4000-8000-000000000000"
    for key in ("created", "updated"):
        body[key] = "2026-10-14T00:00:00+00:00"
    body["result"]["seconds"] = 0.01
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(json.dumps(body, indent=2, sort_keys=True) + "\n")
