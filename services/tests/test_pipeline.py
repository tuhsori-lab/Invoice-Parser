import random
from dataclasses import replace
from decimal import Decimal

import pytest

from invoice_service.config import Policy
from invoice_service.pipeline import run
from invoice_service.synth import scan

from .conftest import FakeEngine, invoice


def test_a_native_pdf_is_read_from_its_own_text(settings):
    inv, pdf = invoice(seed=4)
    engine = FakeEngine()
    result = run(pdf, engine, settings, Policy())
    assert engine.calls == 0
    assert result.invoice.invoice_number.value == inv["invoice_number"]
    assert Decimal(result.invoice.total_due.value) == inv["total"]
    assert result.invoice.total_due.status == "valid"
    assert result.pages[0].source == "pdf_text"
    assert len(result.invoice.line_items) == len(inv["lines"])
    # Every value points back to where it was read.
    evidence = result.invoice.invoice_number.evidence
    assert evidence.page == 1 and inv["invoice_number"] in evidence.text


def test_the_po_number_is_never_taken_for_the_invoice_number(settings):
    inv, pdf = invoice(seed=4, purchase_order="PO-4512345")
    result = run(pdf, FakeEngine(), settings, Policy())
    assert result.invoice.purchase_order.value == "PO-4512345"
    assert result.invoice.invoice_number.value == inv["invoice_number"]


def test_a_bad_file_fails_cleanly(settings):
    result = run(b"%PDF-1.4 broken", FakeEngine(), settings, Policy())
    assert result.status == "failed" and result.issues[0].code == "malformed"


def test_a_page_with_no_text_is_read_by_ocr_and_retried_sharper_when_unsure(settings):
    blurry = [("lnvoice", 0.41, (100, 100, 300, 130))]
    sharp = [("Invoice", 0.97, (150, 150, 450, 195))]
    engine = FakeEngine([blurry, sharp])
    result = run(blank_pdf_with_ink(), engine, replace(settings, ocr_dpi_ladder=(200, 300)), Policy())
    rerender = [r for r in result.retries if r.kind == "rerender_ocr"]
    assert rerender and rerender[0].helped
    assert result.pages[0].dpi == 300
    assert result.status == "needs_review"  # nothing on that page is an invoice


def test_a_retry_that_does_not_help_keeps_the_first_reading(settings):
    engine = FakeEngine([[("lnvoice", 0.60, (100, 100, 300, 130))], [("|nv", 0.30, (150, 150, 450, 195))]])
    result = run(blank_pdf_with_ink(), engine, replace(settings, ocr_dpi_ladder=(200, 300)), Policy())
    assert result.pages[0].dpi == 200
    assert not result.retries[0].helped


def test_retries_are_bounded_by_the_ladder(settings):
    engine = FakeEngine([[("x", 0.1, (0, 0, 10, 10))]] * 10)
    run(blank_pdf_with_ink(), engine, replace(settings, ocr_dpi_ladder=(150, 200, 300)), Policy())
    assert engine.calls == 3


def test_a_slow_document_fails_with_a_timeout_instead_of_hanging(settings):
    result = run(blank_pdf_with_ink(), FakeEngine(), replace(settings, job_seconds=-1), Policy())
    assert result.status == "failed" and result.issues[0].code == "timeout"


def test_an_ambiguous_total_is_settled_by_the_one_that_reconciles(settings):
    pdf = text_pdf([
        (50, 60, "Bluewater Print Works"), (360, 60, "Invoice No: INV-77"), (360, 75, "Invoice Date: 2026-10-01"),
        (380, 300, "Subtotal"), (500, 300, "100.00"), (380, 316, "Tax"), (500, 316, "8.25"),
        (380, 332, "Amount Due"), (500, 332, "999.99"), (380, 348, "Total"), (500, 348, "USD 108.25"),
    ])
    result = run(pdf, FakeEngine(), settings, Policy())
    assert result.invoice.total_due.value == "108.25"
    assert result.invoice.total_due.status == "valid"
    assert [r.kind for r in result.retries] == ["total_candidates"]


def blank_pdf_with_ink() -> bytes:
    """A page that is only a picture, so OCR has to read it."""
    import io

    import pymupdf
    from PIL import Image, ImageDraw

    image = Image.new("L", (1275, 1650), 255)
    ImageDraw.Draw(image).rectangle((100, 100, 600, 160), fill=0)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    doc = pymupdf.open()
    doc.new_page().insert_image(doc[0].rect, stream=buffer.getvalue())
    return doc.tobytes()


@pytest.mark.slow
@pytest.mark.parametrize("turn", [0, 90])
def test_a_scanned_invoice_end_to_end_with_paddleocr(settings, turn):
    from invoice_service.ocr import PaddleEngine

    inv, pdf = invoice(seed=11)
    scanned = scan(pdf, random.Random(1), turn)
    result = run(scanned, PaddleEngine(settings), settings, Policy())
    assert result.pages[0].source == "ocr" and result.pages[0].rotation == turn
    assert result.invoice.invoice_number.value == inv["invoice_number"]
    assert Decimal(result.invoice.total_due.value) == inv["total"]
    # On a page scanned sideways, evidence points at the page as stored.
    x0, y0, x1, y1 = result.invoice.total_due.evidence.bbox
    width, height = (792, 612) if turn else (612, 792)
    assert 0 <= x0 < x1 <= width and 0 <= y0 < y1 <= height


def text_pdf(lines) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    for x, y, text in lines:
        page.insert_text((x, y), text, fontsize=10)
    return doc.tobytes()
