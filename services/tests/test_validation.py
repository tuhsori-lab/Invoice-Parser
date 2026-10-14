from datetime import date
from decimal import Decimal

from invoice_service.config import Policy
from invoice_service.extraction import Candidate, Extraction
from invoice_service.schema import Evidence, Field, Invoice, LineItem, TaxLine
from invoice_service.validation import check, reconcile

TODAY = date(2026, 10, 14)


def found(value, raw=None, conf=None):
    raw = raw if raw is not None else str(value)
    return Field(value=str(value), raw=raw, evidence=Evidence(page=1, bbox=(0, 0, 10, 10), source="pdf_text",
                                                              text=f"label {raw}"),
                 confidence=conf, status="unverified")


def labelled(invoice: Invoice, currencies=("USD",)) -> Extraction:
    candidates = {name: [Candidate(getattr(invoice, name), 0, "label")]
                  for name in ("invoice_number", "invoice_date", "due_date", "vendor_name", "total_due")
                  if getattr(invoice, name).value is not None}
    return Extraction(invoice=invoice, candidates=candidates, currencies=set(currencies))


def good_invoice(**changes) -> Invoice:
    invoice = Invoice(
        vendor_name=found("Bluewater Print Works"), invoice_number=found("INV-1001"),
        invoice_date=found("2026-10-01", "Oct 1, 2026"), due_date=found("2026-10-31", "Oct 31, 2026"),
        currency=found("USD"), subtotal=found("100.00"), tax_total=found("8.25"), total_due=found("108.25"),
        line_items=[LineItem(description=found("Paper"), quantity=found("2"), unit_price=found("50.00"),
                             line_total=found("100.00"))],
        taxes=[TaxLine(label="Tax", rate=found("8.25", "8.25%"), amount=found("8.25"))],
    )
    return invoice.model_copy(update=changes)


def test_a_consistent_invoice_is_accepted_with_its_fields_verified():
    status, issues = check(labelled(good_invoice()), Policy(), today=TODAY)
    assert status == "accepted", issues
    assert not [i for i in issues if i.severity == "error"]


def test_a_total_that_does_not_add_up_goes_to_review():
    extraction = labelled(good_invoice(total_due=found("118.25")))
    status, issues = check(extraction, Policy(), today=TODAY)
    assert status == "needs_review"
    assert "total_mismatch" in [i.code for i in issues]
    assert extraction.invoice.total_due.status == "unverified"


def test_tax_already_included_in_the_subtotal_reconciles():
    invoice = good_invoice(total_due=found("100.00"))
    assert reconcile(invoice, Decimal("100.00"), Policy().rounding_tolerance) == "tax_included"


def test_discounts_shipping_fees_and_withholding_all_count():
    invoice = good_invoice(discount=found("10.00", "-10.00"), shipping=found("5.00"), fees=found("2.00"),
                           withholding=found("3.00"), tax_total=found("8.00"), total_due=found("102.00"))
    status, issues = check(labelled(invoice), Policy(), today=TODAY)
    assert "total_mismatch" not in [i.code for i in issues], issues


def test_rounding_tolerance_is_a_policy_setting():
    invoice = good_invoice(total_due=found("108.27"))
    assert check(labelled(invoice), Policy(), today=TODAY)[0] == "needs_review"
    assert check(labelled(good_invoice(total_due=found("108.27"))),
                 Policy(rounding_tolerance=Decimal("0.02")), today=TODAY)[0] == "accepted"


def test_quantity_times_price_must_match_the_line():
    invoice = good_invoice()
    invoice.line_items[0].unit_price = found("40.00")
    status, issues = check(labelled(invoice), Policy(), today=TODAY)
    assert "line_mismatch" in [i.code for i in issues]


def test_lines_that_do_not_add_up_to_the_subtotal():
    invoice = good_invoice(subtotal=found("90.00"), total_due=found("98.25"))
    status, issues = check(labelled(invoice), Policy(), today=TODAY)
    assert "lines_dont_add_up" in [i.code for i in issues]


def test_a_value_not_in_its_evidence_is_rejected():
    invoice = good_invoice()
    invoice.invoice_number = Field(value="INV-9999", raw="INV-9999",
                                   evidence=Evidence(page=1, bbox=(0, 0, 1, 1), source="ocr", text="INV-1001"),
                                   status="unverified")
    status, issues = check(labelled(invoice), Policy(), today=TODAY)
    assert status == "needs_review"
    assert ("no_evidence", "invoice_number") in [(i.code, i.field) for i in issues]


def test_missing_and_unverified_required_fields():
    invoice = good_invoice(invoice_number=Field())
    status, issues = check(labelled(invoice), Policy(), today=TODAY)
    assert ("missing_field", "invoice_number") in [(i.code, i.field) for i in issues]


def test_low_ocr_confidence_blocks_acceptance():
    invoice = good_invoice(invoice_number=found("INV-1001", conf=0.42))
    status, issues = check(labelled(invoice), Policy(), today=TODAY)
    assert status == "needs_review"
    assert ("unverified_field", "invoice_number") in [(i.code, i.field) for i in issues]


def test_due_before_issue_and_implausible_dates():
    status, issues = check(labelled(good_invoice(due_date=found("2026-09-01"))), Policy(), today=TODAY)
    assert "due_before_issue" in [i.code for i in issues]
    status, issues = check(labelled(good_invoice(invoice_date=found("1999-01-01"))), Policy(), today=TODAY)
    assert "implausible_date" in [i.code for i in issues]


def test_more_than_one_currency():
    status, issues = check(labelled(good_invoice(), currencies=("USD", "EUR")), Policy(), today=TODAY)
    assert "mixed_currency" in [i.code for i in issues]


def test_a_bare_dollar_sign_needs_review_unless_the_policy_says_what_it_means():
    extraction = labelled(good_invoice(currency=Field()), currencies=("$",))
    status, issues = check(extraction, Policy(), today=TODAY)
    assert "currency_ambiguous" in [i.code for i in issues]


def test_two_labels_that_disagree():
    invoice = good_invoice()
    extraction = labelled(invoice)
    extraction.candidates["invoice_number"] = [Candidate(found("INV-1001"), 0, "label"),
                                               Candidate(found("INV-2002"), 0, "label")]
    status, issues = check(extraction, Policy(), today=TODAY)
    assert "conflicting_values" in [i.code for i in issues]


def test_a_possible_duplicate_goes_to_review():
    status, issues = check(labelled(good_invoice()), Policy(), duplicate_of="earlier-id", today=TODAY)
    assert status == "needs_review"
    assert "possible_duplicate" in [i.code for i in issues]
