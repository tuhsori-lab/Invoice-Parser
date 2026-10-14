"""
The shape of a processed invoice. packages/invoice-schema/index.ts mirrors this
for the browser; tests/test_schema_contract.py keeps the two in step.

Amounts are decimal strings ("1234.50"), dates ISO strings ("2026-10-01"):
never floats, so nothing is lost on the way to the browser.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field as PydField, PrivateAttr

from . import SCHEMA_VERSION

FieldStatus = Literal["valid", "unverified", "invalid", "missing", "corrected"]
DocStatus = Literal["accepted", "needs_review", "failed"]


class Evidence(BaseModel):
    """Where on the page a value was read. bbox is in PDF points from the top-left corner."""

    page: int
    bbox: tuple[float, float, float, float]
    source: Literal["pdf_text", "ocr"]
    text: str


class Field(BaseModel):
    value: str | None = None
    raw: str | None = None
    evidence: Evidence | None = None
    confidence: float | None = None
    status: FieldStatus = "missing"
    note: str | None = None


class TaxLine(BaseModel):
    label: str | None = None
    rate: Field = PydField(default_factory=Field)
    amount: Field = PydField(default_factory=Field)


class LineItem(BaseModel):
    description: Field = PydField(default_factory=Field)
    quantity: Field = PydField(default_factory=Field)
    unit_price: Field = PydField(default_factory=Field)
    tax_rate: Field = PydField(default_factory=Field)
    line_total: Field = PydField(default_factory=Field)


FIELD_NAMES = (
    "vendor_name", "vendor_address", "vendor_tax_id", "invoice_number", "purchase_order",
    "invoice_date", "due_date", "currency", "subtotal", "discount", "shipping", "fees",
    "tax_total", "withholding", "total_due",
)
AMOUNT_FIELDS = ("subtotal", "discount", "shipping", "fees", "tax_total", "withholding", "total_due")
DATE_FIELDS = ("invoice_date", "due_date")


class Invoice(BaseModel):
    vendor_name: Field = PydField(default_factory=Field)
    vendor_address: Field = PydField(default_factory=Field)
    vendor_tax_id: Field = PydField(default_factory=Field)
    invoice_number: Field = PydField(default_factory=Field)
    purchase_order: Field = PydField(default_factory=Field)
    invoice_date: Field = PydField(default_factory=Field)
    due_date: Field = PydField(default_factory=Field)
    currency: Field = PydField(default_factory=Field)
    subtotal: Field = PydField(default_factory=Field)
    discount: Field = PydField(default_factory=Field)
    shipping: Field = PydField(default_factory=Field)
    fees: Field = PydField(default_factory=Field)
    tax_total: Field = PydField(default_factory=Field)
    withholding: Field = PydField(default_factory=Field)
    total_due: Field = PydField(default_factory=Field)
    taxes: list[TaxLine] = PydField(default_factory=list)
    line_items: list[LineItem] = PydField(default_factory=list)


class Issue(BaseModel):
    code: str
    severity: Literal["error", "warning"]
    message: str
    field: str | None = None


class PageInfo(BaseModel):
    number: int
    width: float
    height: float
    source: Literal["pdf_text", "ocr"]
    dpi: int | None = None
    rotation: int = 0
    mean_confidence: float | None = None
    text_check: str | None = None


class Retry(BaseModel):
    kind: str
    target: str
    reason: str
    helped: bool


class Result(BaseModel):
    schema_version: Literal[1] = SCHEMA_VERSION
    status: DocStatus
    invoice: Invoice | None = None
    issues: list[Issue] = PydField(default_factory=list)
    pages: list[PageInfo] = PydField(default_factory=list)
    retries: list[Retry] = PydField(default_factory=list)
    engine: dict[str, str] = PydField(default_factory=dict)
    seconds: float | None = None
    # What re-checking after a correction needs; stored beside the result, never sent out.
    _context: dict = PrivateAttr(default_factory=dict)
