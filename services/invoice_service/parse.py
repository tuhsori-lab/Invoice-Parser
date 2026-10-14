"""Turning the text on an invoice into amounts, dates, currencies and identifiers.

Every parser returns None rather than guess. Amounts are Decimal, never float.
"""

from __future__ import annotations

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

CENT = Decimal("0.01")

CURRENCY_CODES = {
    "USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY", "CHF", "SEK", "NOK", "DKK", "PLN",
    "CZK", "HUF", "INR", "CNY", "HKD", "SGD", "ZAR", "MXN", "BRL", "AED", "SAR", "ILS",
}
# "$" is not here on purpose: it is USD, CAD, AUD and more. See dollar_currency in the policy.
CURRENCY_SYMBOLS = {"€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₩": "KRW", "₪": "ILS", "zł": "PLN"}

_CODE = re.compile(r"\b(" + "|".join(sorted(CURRENCY_CODES)) + r")\b")
_AMOUNT = re.compile(r"[-−(]?[$€£¥₹₩₪]?\s?\d[\d.,']*\)?")


def currencies_in(text: str) -> set[str]:
    """Every currency named or symbolised in a piece of text. "$" is reported as "$"."""
    found = set(_CODE.findall(text.upper()))
    found.update(code for symbol, code in CURRENCY_SYMBOLS.items() if symbol in text)
    prefixed = {"US": "USD", "C": "CAD", "CA": "CAD", "A": "AUD", "AU": "AUD", "NZ": "NZD",
                "S": "SGD", "HK": "HKD", "MX": "MXN"}
    for match in re.finditer(r"(?<![A-Za-z])([A-Z]{0,2})\$", text):
        found.add(prefixed.get(match.group(1), "$"))
    return found


def decimal_separator_hint(texts: list[str]) -> str | None:
    """Which character the document uses before cents, judged from amounts that end in two digits."""
    dot = comma = 0
    for text in texts:
        for match in re.finditer(r"\d([.,])\d{2}(?!\d)", text):
            if match.group(1) == ".":
                dot += 1
            else:
                comma += 1
    if dot and not comma:
        return "."
    if comma and not dot:
        return ","
    if dot or comma:
        return "." if dot > comma * 3 else "," if comma > dot * 3 else None
    return None


def parse_amount(text: str, decimal_sep: str | None = None) -> Decimal | None:
    """
    An amount as written on an invoice: "1,234.56", "1.234,56", "1 234,56", "(12.00)", "$-5", "12.00 CR".

    Returns None when the text is not an amount, or when it cannot be told whether
    "1,234" means one thousand or one point two (and no decimal_sep hint settles it).
    """
    raw = text.strip()
    if not raw or not re.search(r"\d", raw):
        return None
    if re.search(r"\d\s*[-−]\s*\d", raw):
        return None  # 12-34-56: a reference or a date, not an amount
    lead = re.split(r"\d", raw, maxsplit=1)[0]
    negative = any(sign in lead for sign in "-−(") or raw.endswith((")", "CR", "-"))
    body = re.sub(r"(?i)\b(?:CR|DR)\b", "", raw)
    body = _CODE.sub("", body.upper())
    body = re.sub(r"[$€£¥₹₩₪()\-−\s  ']", "", body)
    body = body.replace("ZŁ", "")
    if not re.fullmatch(r"\d[\d.,]*", body):
        return None
    dots, commas = body.count("."), body.count(",")
    if dots and commas:
        decimal = "." if body.rfind(".") > body.rfind(",") else ","
    elif dots + commas == 0:
        decimal = None
    else:
        sep = "." if dots else ","
        tail = body.rsplit(sep, 1)[1]
        if dots + commas > 1:
            decimal = None  # 1.234.567 or 1,234,567: grouping only
        elif len(tail) == 3:
            # "1,234" is ambiguous on its own; the document's other amounts decide.
            if decimal_sep is None:
                return None
            decimal = sep if sep == decimal_sep else None
        else:
            decimal = sep
    group = {".", ","} - {decimal} if decimal else {".", ","}
    for char in group:
        body = body.replace(char, "")
    if decimal == ",":
        body = body.replace(",", ".")
    if body.count(".") > 1:
        return None
    try:
        value = Decimal(body)
    except InvalidOperation:
        return None
    return -value if negative else value


def find_amounts(text: str, decimal_sep: str | None = None) -> list[tuple[Decimal, str]]:
    """Every amount in a line of text, with the exact characters it came from."""
    out = []
    for match in _AMOUNT.finditer(text):
        piece = match.group(0).strip().rstrip(".,")
        if re.fullmatch(r"\d{1,4}[.]\d{1,2}[.]\d{2,4}", piece) or text[match.end():].lstrip().startswith("%"):
            continue  # a date written with dots, or a percentage
        value = parse_amount(piece, decimal_sep)
        if value is not None:
            out.append((value, piece))
    return out


def money(value: Decimal) -> Decimal:
    """Rounded to the cent, half up, as invoices round."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def parse_percent(text: str) -> Decimal | None:
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*%", text)
    return Decimal(match.group(1).replace(",", ".")) if match else None


_MONTHS = {
    name: number
    for number, names in enumerate(
        [("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"), ("may",),
         ("jun", "june"), ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"),
         ("oct", "october"), ("nov", "november"), ("dec", "december")],
        start=1,
    )
    for name in names
}
_MONTH = r"(" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\.?"
_DATE_PATTERNS = [
    ("ymd", re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b")),
    ("numeric", re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b")),
    ("d_mon_y", re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+" + _MONTH + r"[\s,-]+(\d{4})\b", re.I)),
    ("mon_d_y", re.compile(r"\b" + _MONTH + r"\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", re.I)),
]


def _year(text: str) -> int:
    year = int(text)
    return 2000 + year if year < 100 else year


def _make(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def find_date(text: str, order: str | None = None) -> tuple[date | None, str | None, bool]:
    """
    The first date in a piece of text.

    Returns (date, the characters it came from, ambiguous). A numeric date such as
    03/04/2026 is ambiguous unless `order` ("DMY" or "MDY") says which comes first;
    an ambiguous date comes back as (None, raw, True) rather than as a guess.
    """
    for kind, pattern in _DATE_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        raw = match.group(0)
        if kind == "ymd":
            return _make(int(match[1]), int(match[2]), int(match[3])), raw, False
        if kind == "d_mon_y":
            return _make(int(match[3]), _MONTHS[match[2].lower()], int(match[1])), raw, False
        if kind == "mon_d_y":
            return _make(int(match[3]), _MONTHS[match[1].lower()], int(match[2])), raw, False
        first, second, year = int(match[1]), int(match[2]), _year(match[3])
        if first > 12 and second <= 12:
            return _make(year, second, first), raw, False
        if second > 12 and first <= 12:
            return _make(year, first, second), raw, False
        if first == second:
            return _make(year, first, second), raw, False
        if order == "DMY":
            return _make(year, second, first), raw, False
        if order == "MDY":
            return _make(year, first, second), raw, False
        return None, raw, True
    return None, None, False


def date_order_hint(texts: list[str]) -> str | None:
    """DMY or MDY, if some numeric date in the document can only be read one way."""
    votes = set()
    for text in texts:
        for match in _DATE_PATTERNS[1][1].finditer(text):
            first, second = int(match[1]), int(match[2])
            if first > 12 >= second:
                votes.add("DMY")
            elif second > 12 >= first:
                votes.add("MDY")
    return votes.pop() if len(votes) == 1 else None


_ID = re.compile(r"^[A-Z0-9][A-Z0-9\-/_.#]{1,38}[A-Z0-9]$", re.I)


def looks_like_identifier(text: str) -> bool:
    """An invoice or PO number: has a digit, no spaces, and is neither a date nor an amount."""
    text = text.strip().lstrip("#:").strip()
    if not _ID.match(text) or not re.search(r"\d", text):
        return False
    if find_date(text)[1] == text:
        return False
    return not re.fullmatch(r"\d{1,3}(?:[.,]\d{3})*[.,]\d{2}", text)


def clean_identifier(text: str) -> str:
    return text.strip().lstrip("#:").strip().rstrip(".,;")
