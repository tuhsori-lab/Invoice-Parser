from datetime import date
from decimal import Decimal

import pytest

from invoice_service.parse import (
    currencies_in, date_order_hint, decimal_separator_hint, find_amounts, find_date, looks_like_identifier,
    money, parse_amount,
)


@pytest.mark.parametrize("text, expected", [
    ("1,234.56", "1234.56"), ("1.234,56", "1234.56"), ("1 234,56", "1234.56"), ("1'234.56", "1234.56"),
    ("(12.00)", "-12.00"), ("$-5", "-5"), ("-€5.10", "-5.10"), ("12.00 CR", "-12.00"),
    ("USD 1,000.00", "1000.00"), ("0.10", "0.10"), ("1,000,000", "1000000"),
])
def test_amounts_in_every_common_format(text, expected):
    assert parse_amount(text) == Decimal(expected)


def test_a_lone_three_digit_group_is_ambiguous_without_a_hint():
    assert parse_amount("1,234") is None
    assert parse_amount("1,234", ".") == Decimal("1234")
    assert parse_amount("1,234", ",") == Decimal("1.234")


def test_not_amounts():
    assert parse_amount("Invoice") is None
    assert parse_amount("12-34-56") is None


def test_the_document_decides_the_decimal_separator():
    assert decimal_separator_hint(["Total 1.234,56", "Tax 12,00"]) == ","
    assert decimal_separator_hint(["Total 1,234.56"]) == "."
    assert decimal_separator_hint(["no amounts"]) is None


def test_amounts_in_a_line_skip_percentages_and_dotted_dates():
    found = find_amounts("Tax 20% on 12.10.2026: 40.00")
    assert [value for value, _ in found] == [Decimal("40.00")]


def test_money_rounds_half_up_like_invoices():
    assert money(Decimal("2.005")) == Decimal("2.01")
    assert money(Decimal("2.004")) == Decimal("2.00")


@pytest.mark.parametrize("text, expected", [
    ("2026-10-01", date(2026, 10, 1)), ("Oct 1, 2026", date(2026, 10, 1)), ("1st October 2026", date(2026, 10, 1)),
    ("25/12/2026", date(2026, 12, 25)), ("12/25/2026", date(2026, 12, 25)), ("07/07/26", date(2026, 7, 7)),
])
def test_dates(text, expected):
    assert find_date(text)[0] == expected


def test_a_date_that_reads_both_ways_is_never_guessed():
    value, raw, ambiguous = find_date("Date: 03/04/2026")
    assert value is None and ambiguous and raw == "03/04/2026"
    assert find_date("03/04/2026", "DMY")[0] == date(2026, 4, 3)
    assert find_date("03/04/2026", "MDY")[0] == date(2026, 3, 4)


def test_one_unambiguous_date_settles_the_order_for_the_document():
    assert date_order_hint(["Date 03/04/2026", "Due 25/04/2026"]) == "DMY"
    assert date_order_hint(["03/04/2026", "25/04/2026", "04/25/2026"]) is None


def test_a_bare_dollar_sign_is_not_a_currency():
    assert currencies_in("Total $5") == {"$"}
    assert currencies_in("Total US$ 5") == {"USD"}
    assert currencies_in("C$ 5") == {"CAD"}
    assert currencies_in("EUR 5 and €3") == {"EUR"}


def test_identifiers():
    assert looks_like_identifier("INV-0042")
    assert looks_like_identifier("7730501")
    assert not looks_like_identifier("2026-10-01")
    assert not looks_like_identifier("1,234.00")
    assert not looks_like_identifier("Invoice")
