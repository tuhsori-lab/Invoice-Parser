"""
Deterministic checks, and the acceptance policy that turns them into a status.

A field is "valid" only when something checks it: a total that reconciles with
its parts, a date that parses one way only, a label it sat next to. Being found
is not enough. All arithmetic is Decimal.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

from .config import Policy
from .extraction import Extraction
from .parse import money
from .schema import AMOUNT_FIELDS, FIELD_NAMES, Field, Invoice, Issue


def _dec(f: Field) -> Decimal | None:
    return Decimal(f.value) if f.value is not None else None


def _vendor_key(name: str | None) -> str | None:
    return re.sub(r"[^a-z0-9]", "", name.lower()) or None if name else None


def _squash(text: str) -> str:
    return re.sub(r"\s+", "", text or "").lower()


def evidence_holds(f: Field) -> bool:
    """The value was really read from the page: its source text is where it says it is."""
    if f.value is None or f.status == "corrected":
        return True
    if f.note and f.note.startswith("sum of"):
        return True  # each tax line it adds up is checked on its own
    if f.evidence is None or f.raw is None:
        return False
    return _squash(f.raw) in _squash(f.evidence.text)


def components(invoice: Invoice) -> dict[str, Decimal]:
    """The amounts a total is made of, with the subtotal taken from the lines when not printed."""
    parts = {name: _dec(getattr(invoice, name)) for name in AMOUNT_FIELDS}
    if parts["subtotal"] is None and invoice.line_items:
        totals = [_dec(item.line_total) for item in invoice.line_items]
        if all(t is not None for t in totals):
            parts["subtotal_from_lines"] = sum(totals, Decimal(0))
    return parts


def reconcile(invoice: Invoice, total: Decimal, tolerance: Decimal) -> str | None:
    """
    How the parts add up to `total`, or None if they do not. Invoices differ: tax
    may be added or already included, and a discount may be printed negative.
    """
    p = components(invoice)
    base = p.get("subtotal") if p.get("subtotal") is not None else p.get("subtotal_from_lines")
    if base is None:
        return None
    discount = abs(p["discount"] or 0)
    extras = (p["shipping"] or 0) + (p["fees"] or 0)
    withholding = abs(p["withholding"] or 0)
    tax = p["tax_total"] or 0
    if abs(base - discount + extras + tax - withholding - total) <= tolerance:
        return "tax_added"
    if p["tax_total"] is not None and abs(base - discount + extras - withholding - total) <= tolerance:
        return "tax_included"
    return None


def check(extraction: Extraction, policy: Policy, duplicate_of: str | None = None,
          today: date | None = None, known_vendors: set[str] | None = None) -> tuple[str, list[Issue]]:
    invoice = extraction.invoice
    issues: list[Issue] = []
    today = today or date.today()

    def issue(code, message, field=None, severity="error"):
        issues.append(Issue(code=code, severity=severity, message=message, field=field))

    # Checks run again after every correction, so start from what was read, not what was decided.
    every = [getattr(invoice, n) for n in FIELD_NAMES]
    every += [getattr(i, n) for i in invoice.line_items for n in ("description", "quantity", "unit_price",
                                                                   "tax_rate", "line_total")]
    every += [f for t in invoice.taxes for f in (t.rate, t.amount)]
    for f in every:
        if f.status in ("valid", "invalid", "missing") and f.note != "ambiguous date":
            f.status = "unverified"

    for code, message, field in extraction.notes:
        if field is None or getattr(invoice, field).status != "corrected":
            issue(code, message, field)

    def confident(f: Field) -> bool:
        return f.confidence is None or f.confidence >= policy.min_field_confidence

    def settle(name: str, ok: bool):
        f: Field = getattr(invoice, name)
        if f.value is None or f.status in ("corrected", "invalid"):
            return
        f.status = "valid" if ok and confident(f) and evidence_holds(f) else "unverified"

    # Every value must point at the words it came from.
    for name in FIELD_NAMES:
        f = getattr(invoice, name)
        if not evidence_holds(f):
            f.status = "invalid"
            issue("no_evidence", "This value is not in the text it claims to come from.", name)
    for row, tax in enumerate(invoice.taxes):
        if not evidence_holds(tax.amount):
            tax.amount.status = "invalid"
            issue("no_evidence", "This value is not in the text it claims to come from.", f"taxes.{row}.amount")
    for row, item in enumerate(invoice.line_items):
        for name in ("description", "quantity", "unit_price", "tax_rate", "line_total"):
            f = getattr(item, name)
            if not evidence_holds(f):
                f.status = "invalid"
                issue("no_evidence", "This value is not in the text it claims to come from.",
                      f"line_items.{row}.{name}")

    # Two labels for the same field that disagree: neither can be trusted.
    for name, candidates in extraction.candidates.items():
        best = [c for c in candidates if c.priority == candidates[0].priority]
        values = {c.field.value for c in best if c.field.value is not None}
        if len(values) > 1 and name in FIELD_NAMES and getattr(invoice, name).status != "corrected":
            getattr(invoice, name).status = "invalid"
            issue("conflicting_values", f"The document gives different values: {', '.join(sorted(values))}.", name)

    labelled = {name for name, cands in extraction.candidates.items() if cands and cands[0].how == "label"}

    # Identifiers.
    for name in ("invoice_number", "purchase_order", "vendor_tax_id"):
        settle(name, name in labelled)
    if (invoice.invoice_number.value and invoice.purchase_order.value
            and invoice.invoice_number.value == invoice.purchase_order.value):
        invoice.purchase_order.status = "invalid"
        issue("po_equals_invoice", "The PO number is the same as the invoice number.", "purchase_order")

    # Dates.
    issued, due = invoice.invoice_date, invoice.due_date
    for name in ("invoice_date", "due_date"):
        f = getattr(invoice, name)
        if f.value is None:
            continue
        when = date.fromisoformat(f.value)
        plausible = date(2000, 1, 1) <= when <= today + timedelta(days=366)
        if not plausible:
            f.status = "invalid"
            issue("implausible_date", f"{f.value} is not a plausible date for an invoice.", name)
        settle(name, plausible and name in labelled)
    if issued.value and due.value and date.fromisoformat(due.value) < date.fromisoformat(issued.value):
        due.status = "invalid"
        issue("due_before_issue", "The due date is before the invoice date.", "due_date")

    # Currency.
    real = extraction.currencies - {"$"}
    if len(real) > 1:
        invoice.currency.status = "invalid"
        issue("mixed_currency", f"More than one currency appears: {', '.join(sorted(real))}.", "currency")
    elif invoice.currency.value is None and "$" in extraction.currencies:
        issue("currency_ambiguous",
              'Only "$" is printed, which could be several currencies. Set dollar_currency in the policy '
              "if all your invoices use one.", "currency")
    settle("currency", len(real) <= 1)

    # Line items: quantity times price, and the lines against the subtotal.
    for row, item in enumerate(invoice.line_items):
        qty, price, line_total = _dec(item.quantity), _dec(item.unit_price), _dec(item.line_total)
        if qty is not None and price is not None and line_total is not None:
            ok = abs(money(qty * price) - line_total) <= policy.rounding_tolerance
            for f in (item.quantity, item.unit_price, item.line_total):
                if f.status != "invalid":
                    f.status = "valid" if ok and confident(f) else "unverified"
            if not ok:
                issue("line_mismatch", f"{qty} × {price} is {money(qty * price)}, not {line_total}.",
                      f"line_items.{row}.line_total")
        if item.description.value and item.description.status != "invalid":
            item.description.status = "valid" if confident(item.description) else "unverified"
    line_totals = [_dec(i.line_total) for i in invoice.line_items]
    subtotal = _dec(invoice.subtotal)
    if invoice.line_items and subtotal is not None and all(t is not None for t in line_totals):
        if abs(sum(line_totals, Decimal(0)) - subtotal) > policy.rounding_tolerance * len(line_totals):
            issue("lines_dont_add_up", f"The lines add up to {sum(line_totals, Decimal(0))}, "
                  f"but the subtotal is {subtotal}.", "line_items")

    # The total, from its parts.
    total = _dec(invoice.total_due)
    if total is not None:
        how = reconcile(invoice, total, policy.rounding_tolerance)
        if how:
            for name in ("total_due", "subtotal", "discount", "shipping", "fees", "withholding",
                         *(("tax_total",) if how == "tax_added" or invoice.tax_total.value else ())):
                settle(name, True)
            if how == "tax_included":
                issue("tax_included", "Tax is already included in the subtotal.", "tax_total", "warning")
        else:
            parts = components(invoice)
            if parts.get("subtotal") is None and parts.get("subtotal_from_lines") is None:
                issue("total_unverifiable", "There is no subtotal or line items to check the total against.",
                      "total_due", "warning")
            else:
                issue("total_mismatch", "The subtotal, discounts, charges and tax do not add up to the total.",
                      "total_due")
            for name in ("total_due", "subtotal", "tax_total"):
                settle(name, False)

    # Tax lines: rate times base. A warning only: what tax is charged on varies.
    parts = components(invoice)
    subtotal = parts.get("subtotal") if parts.get("subtotal") is not None else parts.get("subtotal_from_lines")
    if subtotal is not None:
        after_discount = subtotal - abs(parts["discount"] or 0)
        bases = {subtotal, after_discount, after_discount + (parts["shipping"] or 0) + (parts["fees"] or 0)}
        for t in invoice.taxes:
            rate, amount = _dec(t.rate), _dec(t.amount)
            if rate is not None and amount is not None and not any(
                    abs(money(base * rate / 100) - amount) <= policy.rounding_tolerance for base in bases):
                issue("tax_rate_mismatch", f"{amount} is not {rate}% of the subtotal, with or without discounts "
                      "and charges.", "taxes", "warning")

    # The vendor: valid when a label named it, or a reviewer has approved this vendor before.
    known = bool(known_vendors) and _vendor_key(invoice.vendor_name.value) in known_vendors
    settle("vendor_name", "vendor_name" in labelled or known)

    if duplicate_of:
        issue("possible_duplicate", f"The same vendor, number and total were already uploaded ({duplicate_of}).",
              "invoice_number")

    for name in policy.required:
        if getattr(invoice, name).value is None:
            issue("missing_field", "This field is required but was not found.", name)
    for name in policy.must_verify:
        f = getattr(invoice, name)
        if f.value is not None and f.status not in ("valid", "corrected"):
            if not any(i.field == name and i.severity == "error" for i in issues):
                issue("unverified_field", "Found, but nothing on the invoice confirms it.", name)

    for name in FIELD_NAMES:
        f = getattr(invoice, name)
        if f.value is None and f.status not in ("invalid",):
            f.status = "missing"

    status = "needs_review" if any(i.severity == "error" for i in issues) else "accepted"
    return status, issues
