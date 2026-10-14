"""
Reviewer corrections: applied over the extracted invoice, never instead of it,
and checked again with the same validation as everything else.
"""

from __future__ import annotations

import re
from datetime import date

from .config import Policy
from .extraction import Candidate, Extraction
from .parse import parse_amount
from .schema import AMOUNT_FIELDS, DATE_FIELDS, FIELD_NAMES, Field, Invoice, LineItem, Result
from .validation import check

LINE_FIELDS = ("description", "quantity", "unit_price", "tax_rate", "line_total")
_LINE_PATH = re.compile(r"^line_items\.(\d{1,3})(?:\.(" + "|".join(LINE_FIELDS) + r"))?$")


class BadCorrection(ValueError):
    pass


def context_of(extraction: Extraction) -> dict:
    """What validation needs besides the invoice itself, kept so corrections can be checked again."""
    return {
        "candidates": {name: [[c.field.value, c.priority, c.how] for c in cands]
                       for name, cands in extraction.candidates.items()},
        "currencies": sorted(extraction.currencies),
        "notes": [list(n) for n in extraction.notes],
        "decimal_sep": extraction.decimal_sep,
        "date_order": extraction.date_order,
    }


def extraction_from(invoice: Invoice, context: dict) -> Extraction:
    candidates = {
        name: [Candidate(Field(value=value), priority, how) for value, priority, how in cands]
        for name, cands in context.get("candidates", {}).items()
    }
    return Extraction(invoice=invoice, candidates=candidates, currencies=set(context.get("currencies", [])),
                      decimal_sep=context.get("decimal_sep"), date_order=context.get("date_order"),
                      notes=[tuple(n) for n in context.get("notes", [])])


def normalize(name: str, value: str | None) -> str | None:
    """A reviewer's typed value, normalized the same way extracted values are, or BadCorrection."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise BadCorrection(f"{name}: expected text.")
    value = value.strip()
    if not value:
        return None
    if len(value) > 500:
        raise BadCorrection(f"{name}: too long.")
    if name in AMOUNT_FIELDS or name in ("quantity", "unit_price", "line_total", "tax_rate"):
        amount = parse_amount(value.rstrip("%"), ".")
        if amount is None:
            raise BadCorrection(f"{name}: “{value}” is not a number. Use a dot for decimals, e.g. 1234.50.")
        return str(amount)
    if name in DATE_FIELDS:
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError as error:
            raise BadCorrection(f"{name}: dates are written YYYY-MM-DD.") from error
    if name == "currency":
        if not re.fullmatch(r"[A-Za-z]{3}", value):
            raise BadCorrection("currency: use a three-letter code such as USD or EUR.")
        return value.upper()
    return value


def _corrected(value: str | None, before: Field) -> Field:
    return Field(value=value, raw=before.raw, evidence=before.evidence, confidence=None,
                 status="corrected" if value is not None else "missing", note="corrected by a reviewer")


def apply(original: Result, context: dict, corrections: dict, policy: Policy,
          known_vendors: set[str] | None = None) -> Result:
    """The original result with every correction laid over it, then checked again."""
    if original.invoice is None:
        raise BadCorrection("There is nothing to correct: this document was not read.")
    invoice = original.invoice.model_copy(deep=True)
    removed = set()
    for path, raw_value in corrections.items():
        if path in FIELD_NAMES:
            setattr(invoice, path, _corrected(normalize(path, raw_value), getattr(invoice, path)))
            continue
        match = _LINE_PATH.match(path)
        if not match:
            raise BadCorrection(f"Unknown field: {path}")
        row, name = int(match[1]), match[2]
        if name is None:
            if raw_value is not None:
                raise BadCorrection(f"{path}: a whole line can only be removed (set to null).")
            removed.add(row)
            continue
        while row >= len(invoice.line_items):
            if row > len(invoice.line_items) + 50:
                raise BadCorrection(f"{path}: too many new lines.")
            invoice.line_items.append(LineItem())
        item = invoice.line_items[row]
        setattr(item, name, _corrected(normalize(name, raw_value), getattr(item, name)))
    invoice.line_items = [item for row, item in enumerate(invoice.line_items) if row not in removed]

    extraction = extraction_from(invoice, context)
    _, issues = check(extraction, policy, known_vendors=known_vendors)
    return original.model_copy(update={"invoice": extraction.invoice, "issues": issues}, deep=True)


def vendor_key(name: str | None) -> str | None:
    """A vendor name compared without case, spacing or punctuation."""
    return re.sub(r"[^a-z0-9]", "", name.lower()) or None if name else None


def fingerprint(invoice: Invoice) -> str | None:
    """Vendor, number and total: enough to call two uploads the same invoice."""
    parts = [invoice.vendor_name.value, invoice.invoice_number.value, invoice.total_due.value]
    if any(p is None for p in parts):
        return None
    return "|".join(re.sub(r"[^a-z0-9.]", "", p.lower()) for p in parts)
