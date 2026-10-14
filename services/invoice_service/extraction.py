"""
Stage E: the invoice's fields, each with the words it was read from.

Everything is found next to a label, under a table heading, or not at all. A
value with no evidence on the page is never produced: what cannot be found is
left null, and validation sends it to review.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from statistics import median

from .config import Policy
from .layout import Line, Segment, Table, assign_cells, find_tables, union
from .parse import (
    clean_identifier, currencies_in, date_order_hint, decimal_separator_hint, find_amounts,
    find_date, looks_like_identifier, parse_amount, parse_percent,
)
from .schema import Evidence, Field, Invoice, LineItem, TaxLine

# Label wording per field, in order of preference. Matching is whole-word and
# case-blind, longest label first, so "Total Tax" is tax and "Due Date" a date.
LABELS: dict[str, tuple[str, ...]] = {
    "invoice_number": ("invoice number", "invoice no", "invoice #", "invoice num", "invoice nr", "invoice id",
                       "inv no", "inv #", "inv number", "bill number", "bill no", "document number",
                       "document no", "invoice"),
    "purchase_order": ("purchase order number", "purchase order no", "purchase order", "customer po",
                       "po number", "po no", "po #", "p o number", "p o", "po", "order number", "order no"),
    "invoice_date": ("invoice date", "date of invoice", "date of issue", "issue date", "issued on",
                     "billing date", "tax point", "date"),
    "due_date": ("payment due date", "due date", "payment due", "due by", "due on", "pay by", "due"),
    "total_due": ("total amount due", "total due", "amount due", "balance due", "amount payable",
                  "total payable", "please pay", "grand total", "invoice total", "total amount", "total"),
    "subtotal": ("subtotal", "sub total", "net total", "total net", "net amount", "total before tax",
                 "total excl tax", "total excl vat", "total excluding tax", "amount before tax", "taxable amount"),
    "discount": ("less discount", "discount amount", "discount", "rebate"),
    "shipping": ("shipping and handling", "shipping & handling", "shipping", "freight", "delivery",
                 "postage", "carriage", "s&h"),
    "fees": ("fuel surcharge", "handling fee", "service fee", "other charges", "surcharge", "fees", "fee",
             "handling"),
    "withholding": ("withholding tax", "tax withheld", "withholding", "wht", "tds", "retention"),
    "tax_total": ("total tax", "tax total", "total vat", "vat total", "tax amount", "total gst"),
    "tax_line": ("sales tax", "vat", "gst", "hst", "pst", "qst", "tax"),
    "vendor_tax_id": ("vat registration number", "vat reg no", "vat number", "vat no", "vat id",
                      "tax identification number", "tax id", "tin", "ein", "abn", "gstin", "gst number",
                      "gst no", "gst reg no", "uid", "siret", "nif", "cif"),
    "vendor_name": ("bill from", "sold by", "issued by", "remit to", "payable to", "vendor", "supplier",
                    "seller", "from"),
    "currency": ("currency",),
    "customer": ("bill to", "billed to", "ship to", "sold to", "invoice to", "customer", "client", "deliver to"),
}
KINDS = {
    "invoice_number": "id", "purchase_order": "id", "invoice_date": "date", "due_date": "date",
    "vendor_tax_id": "taxid", "vendor_name": "text", "currency": "currency", "customer": "block",
    **{name: "amount" for name in ("total_due", "subtotal", "discount", "shipping", "fees", "withholding",
                                   "tax_total", "tax_line")},
}
AMOUNT_LABELS = {"total_due", "subtotal", "discount", "shipping", "fees", "withholding", "tax_total", "tax_line"}
_PATTERNS = sorted(
    ((name, label, re.compile(r"^\W*" + r"\W*".join(map(re.escape, label.split())) + r"(?![a-z0-9])(?![-/]\d)\W*", re.I))
     for name, labels in LABELS.items() for label in labels),
    key=lambda item: -len(item[1]),
)


@dataclass
class Candidate:
    field: Field
    priority: int
    how: str  # "label", "table", "inferred"


@dataclass
class Extraction:
    invoice: Invoice
    candidates: dict[str, list[Candidate]] = field(default_factory=dict)
    currencies: set[str] = field(default_factory=set)
    decimal_sep: str | None = None
    date_order: str | None = None
    notes: list[tuple[str, str, str | None]] = field(default_factory=list)  # (code, message, field)


def evidence_of(segments: Segment | list[Segment], text: str | None = None) -> Evidence:
    """Where some segments are on the page as stored, which is where a reviewer will look."""
    segments = segments if isinstance(segments, list) else [segments]
    return Evidence(page=segments[0].page, bbox=tuple(round(v, 1) for v in union(s.evidence_bbox for s in segments)),
                    source=segments[0].source, text=text or " ".join(s.text for s in segments))


def make_field(value, raw: str, segment: Segment) -> Field:
    return Field(value=None if value is None else str(value), raw=raw, evidence=evidence_of(segment),
                 confidence=segment.conf, status="unverified")


def match_label(text: str):
    """(field name, label priority, the text after the label) for the longest label a segment starts with."""
    for name, label, pattern in _PATTERNS:
        found = pattern.match(text)
        if found:
            return name, LABELS[name].index(label), text[found.end():]
    return None


class Reader:
    def __init__(self, lines: list[Line], policy: Policy):
        self.lines = lines
        self.policy = policy
        texts = [line.text for line in lines]
        self.decimal_sep = decimal_separator_hint(texts)
        self.date_order = policy.date_order or date_order_hint(texts)
        self.claimed: set[int] = set()

    def parse(self, kind: str, text: str):
        """(normalized value, the characters it came from), or None."""
        text = text.strip()
        if not text:
            return None
        if kind == "id":
            token = clean_identifier(text.split()[0]) if text.split() else ""
            return (token, token) if looks_like_identifier(token) else None
        if kind == "date":
            value, raw, ambiguous = find_date(text, self.date_order)
            if ambiguous:
                return ("AMBIGUOUS", raw)
            return (value.isoformat(), raw) if value else None
        if kind == "amount":
            amounts = find_amounts(text, self.decimal_sep)
            return (amounts[-1][0], amounts[-1][1]) if amounts else None
        if kind == "taxid":
            found = re.search(r"\b[A-Z]{0,3}[ -]?\d[\dA-Z -]{3,20}[\dA-Z]\b", text)
            return (re.sub(r"[ -]", "", found.group(0)), found.group(0)) if found else None
        if kind == "currency":
            codes = currencies_in(text) - {"$"}
            return (codes.pop(), text) if len(codes) == 1 else None
        if kind == "text":
            return (text, text) if re.search(r"[A-Za-z]{2,}", text) and not match_label(text) else None
        return None

    def value_near(self, kind: str, line_index: int, seg_index: int, rest: str):
        """A label's value: after it in the same cell, in the next cell, or in the cell under it."""
        line = self.lines[line_index]
        label = line.segments[seg_index]
        if rest.strip():
            parsed = self.parse(kind, rest)
            if parsed:
                return parsed, label
            # "Total Due (USD)" or "Tax (8.25%)": the value is in the next cell.
            if not re.fullmatch(r"[\s:#.\-()%\d,/A-Z$€£¥]{0,16}", rest):
                return None
        for right in line.segments[seg_index + 1:]:
            parsed = self.parse(kind, right.text)
            if parsed:
                return parsed, right
            if match_label(right.text):
                break
        x0, _, x1, y1 = label.bbox
        for below_line in self.lines[line_index + 1:line_index + 3]:
            if below_line.page != line.page or below_line.y0 - y1 > 2.5 * max(line.height, 1):
                break
            for below in below_line.segments:
                bx0, _, bx1, _ = below.bbox
                if min(x1, bx1) - max(x0, bx0) > 0 or abs(bx0 - x0) < 6:
                    parsed = self.parse(kind, below.text)
                    return (parsed, below) if parsed and not match_label(below.text) else None
        return None


def _claim_block(reader: Reader, line_index: int, segment: Segment, depth: int = 5):
    """The segments under a "Bill to" heading belong to the customer, never the vendor."""
    x0, _, x1, _ = segment.bbox
    page = segment.page
    reader.claimed.add(id(segment))
    for line in reader.lines[line_index + 1:line_index + 1 + depth]:
        if line.page != page:
            break
        for other in line.segments:
            ox0, _, ox1, _ = other.bbox
            if min(x1 + 150, ox1) - max(x0 - 5, ox0) > 0 and not match_label(other.text):
                reader.claimed.add(id(other))


def _line_items(reader: Reader, table: Table, strategy: str) -> list[LineItem]:
    items: list[LineItem] = []
    for row in table.rows:
        cells = assign_cells(table, row, strategy)
        numbers = {name: segs for name, segs in cells.items() if name != "description"}
        description = cells.get("description", [])
        if not numbers:
            # A description running onto a second line belongs to the item above it.
            if items and description:
                previous = items[-1].description
                text = " ".join(s.text for s in description)
                if previous.value and previous.evidence and previous.evidence.page == row.page:
                    previous.value = f"{previous.value} {text}"
                    previous.raw = previous.value
                    previous.evidence.bbox = tuple(round(v, 1) for v in union(
                        [previous.evidence.bbox, *(s.evidence_bbox for s in description)]))
                    previous.evidence.text = f"{previous.evidence.text} {text}"
            continue
        item = LineItem()
        if description:
            text = " ".join(s.text for s in description)
            item.description = Field(value=text, raw=text, evidence=evidence_of(description),
                                     confidence=min((s.conf for s in description if s.conf is not None),
                                                    default=None),
                                     status="unverified")
        for name in ("quantity", "unit_price", "line_total"):
            if name in numbers:
                segment = numbers[name][-1]
                value = parse_amount(segment.text, reader.decimal_sep)
                if value is not None:
                    setattr(item, name, make_field(value, segment.text, segment))
        if "tax_rate" in numbers:
            segment = numbers["tax_rate"][-1]
            rate = parse_percent(segment.text)
            if rate is None:
                rate = parse_amount(segment.text.rstrip("%"), reader.decimal_sep)
            if rate is not None:
                item.tax_rate = make_field(rate, segment.text, segment)
        for segs in (*numbers.values(), description):
            reader.claimed.update(id(s) for s in segs)
        if item.line_total.value is not None or item.unit_price.value is not None:
            items.append(item)
    return items


def _vendor_by_position(reader: Reader) -> tuple[Segment, Line] | None:
    """With no "From" label, the vendor is usually the biggest name at the top of page one."""
    first_page = [line for line in reader.lines if line.page == reader.lines[0].page] if reader.lines else []
    if not first_page:
        return None
    page_top = first_page[0].y0
    page_bottom = max(line.y1 for line in first_page)
    choices = []
    for line in first_page:
        if line.y0 > page_top + 0.3 * (page_bottom - page_top):
            break
        for segment in line.segments:
            text = segment.text.strip()
            if id(segment) in reader.claimed or match_label(text):
                continue
            if re.fullmatch(r"(?i)(tax\s+)?invoice|statement|receipt|page\s*\d.*|original|copy", text):
                continue
            if not re.search(r"[A-Za-z]{2,}", text) or len(text) > 60 or find_date(text)[1]:
                continue
            # "Tacoma, WA 98402 VAT No: GB655590371" is an address and a tax id, not a name.
            if any(match_label(text[m.start():]) for m in re.finditer(r"\b\w", text)):
                continue
            choices.append((segment, line))
        if len(choices) >= 6:
            break
    if not choices:
        return None
    # Names are set large: the tallest type near the top, by its typical word, not the segment's height.
    size = lambda segment: median(w.y1 - w.y0 for w in segment.words)  # noqa: E731
    return max(choices, key=lambda pair: (round(size(pair[0])), -pair[0].bbox[1]))


def _address_under(reader: Reader, vendor: Segment) -> Field:
    x0 = vendor.bbox[0]
    parts, under_segments = [], []
    last_bottom = vendor.bbox[3]
    height = vendor.bbox[3] - vendor.bbox[1]
    for line in reader.lines:
        if line.page != vendor.page or line.y0 < vendor.bbox[3] - 1:
            continue
        if line.y0 - last_bottom > 1.6 * max(height, 8) or len(parts) >= 4:
            break
        under = [s for s in line.segments if abs(s.bbox[0] - x0) < 15 and id(s) not in reader.claimed]
        if not under or match_label(under[0].text):
            break
        parts.append(under[0].text)
        under_segments.append(under[0])
        last_bottom = line.y1
    if not parts:
        return Field()
    text = ", ".join(parts)
    return Field(value=text, raw=text, evidence=evidence_of(under_segments, text), status="unverified")


def is_totals_line(line: Line) -> bool:
    return any((m := match_label(s.text)) and m[0] in AMOUNT_LABELS for s in line.segments[:2])


def extract(lines: list[Line], policy: Policy, table_strategy: str = "overlap") -> Extraction:
    reader = Reader(lines, policy)
    invoice = Invoice()
    result = Extraction(invoice, decimal_sep=reader.decimal_sep, date_order=reader.date_order)

    # Line items first, so their cells are never mistaken for labelled values.
    for table in find_tables(lines, is_totals_line):
        reader.claimed.update(id(s) for s in table.header.segments)
        invoice.line_items.extend(_line_items(reader, table, table_strategy))

    for index, line in enumerate(lines):
        for seg_index, segment in enumerate(line.segments):
            if id(segment) in reader.claimed:
                continue
            found = match_label(segment.text)
            if not found:
                continue
            name, priority, rest = found
            if name == "customer":
                _claim_block(reader, index, segment)
                continue
            near = reader.value_near(KINDS[name], index, seg_index, rest)
            if not near:
                continue
            (value, raw), source = near
            if value == "AMBIGUOUS":
                result.notes.append(("ambiguous_date", f"“{raw}” could be read either way round.", name))
                field_ = Field(value=None, raw=raw, evidence=evidence_of(source), confidence=source.conf,
                               status="invalid", note="ambiguous date")
            else:
                field_ = make_field(value, raw, source)
            if name == "tax_line":
                rate = parse_percent(line.text)
                invoice.taxes.append(TaxLine(
                    label=segment.text.split(":")[0].strip()[:40],
                    rate=make_field(rate, f"{rate}%", segment) if rate is not None else Field(),
                    amount=field_,
                ))
            else:
                result.candidates.setdefault(name, []).append(Candidate(field_, priority, "label"))
            reader.claimed.add(id(source))

    for name in ("discount", "withholding"):
        # Deductions, whichever sign they are printed with; the printed text stays in raw.
        for candidate in result.candidates.get(name, []):
            if candidate.field.value is not None:
                candidate.field.value = str(abs(Decimal(candidate.field.value)))

    for name, candidates in result.candidates.items():
        candidates.sort(key=lambda c: c.priority)
        if name in invoice.model_fields:
            setattr(invoice, name, candidates[0].field.model_copy(deep=True))

    # Tax: an explicit total, or the one tax line, or the sum of several.
    if invoice.tax_total.value is None and invoice.taxes:
        amounts = [Decimal(t.amount.value) for t in invoice.taxes if t.amount.value is not None]
        if len(amounts) == 1:
            invoice.tax_total = invoice.taxes[0].amount.model_copy(deep=True)
        elif amounts:
            first = invoice.taxes[0].amount
            invoice.tax_total = Field(value=str(sum(amounts)), raw=" + ".join(t.amount.raw or "" for t in invoice.taxes),
                                      evidence=first.evidence, confidence=first.confidence, status="unverified",
                                      note=f"sum of {len(amounts)} tax lines")

    # Vendor: from a label if there is one, otherwise by position.
    if invoice.vendor_name.value is None:
        found = _vendor_by_position(reader)
        if found:
            segment, _ = found
            invoice.vendor_name = make_field(segment.text, segment.text, segment)
            invoice.vendor_name.note = "found by position, not by a label"
            result.candidates.setdefault("vendor_name", []).append(Candidate(invoice.vendor_name, 99, "inferred"))
    vendor = result.candidates.get("vendor_name")
    if vendor and invoice.vendor_name.evidence:
        source = next((s for line in lines for s in line.segments
                       if s.page == invoice.vendor_name.evidence.page and s.text == invoice.vendor_name.evidence.text),
                      None)
        if source:
            invoice.vendor_address = _address_under(reader, source)

    # Currency: named outright, or the one currency the document's amounts are in.
    all_text = "\n".join(line.text for line in lines)
    result.currencies = currencies_in(all_text)
    if invoice.currency.value is None:
        codes = result.currencies - {"$"}
        if "$" in result.currencies and policy.dollar_currency:
            codes.add(policy.dollar_currency)
        if len(codes) == 1:
            code = next(iter(codes))
            symbol_for = {"EUR": "€", "GBP": "£", "JPY": "¥", "INR": "₹"}.get(code, "$")
            source = next((s for line in lines for s in line.segments
                           if code in s.text.upper() or symbol_for in s.text), None)
            if source:
                invoice.currency = make_field(code, source.text, source)
                if code not in source.text.upper():
                    invoice.currency.note = f"“{symbol_for}” read as {code}"
    return result


def relaxed_search(lines: list[Line], invoice: Invoice, reader_policy: Policy) -> list[str]:
    """
    The alternate strategy for critical fields no label led to. Anything found
    this way is marked as such and is never accepted without review.
    """
    reader = Reader(lines, reader_policy)
    found = []
    if invoice.invoice_number.value is None:
        for line in lines[:40]:
            for segment in line.segments:
                match = re.search(r"\b(?:INV|INVOICE)[-#: ]?\s?(\d[\w\-/]{2,})\b", segment.text, re.I)
                if match and looks_like_identifier(match.group(0).replace(" ", "")):
                    token = clean_identifier(match.group(0).replace(" ", ""))
                    invoice.invoice_number = make_field(token, match.group(0), segment)
                    invoice.invoice_number.note = "found without a label"
                    found.append("invoice_number")
                    break
            if "invoice_number" in found:
                break
    if invoice.total_due.value is None:
        best = None
        for line in lines:
            if re.search(r"(?i)\btotal\b", line.text):
                for segment in line.segments:
                    for value, raw in find_amounts(segment.text, reader.decimal_sep):
                        if best is None or value > best[0]:
                            best = (value, raw, segment)
        if best:
            invoice.total_due = make_field(best[0], best[1], best[2])
            invoice.total_due.note = "largest amount on a line mentioning a total"
            found.append("total_due")
    return found
