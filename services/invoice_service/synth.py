"""
Made-up invoices with known answers, to test and benchmark the pipeline.

    python -m invoice_service.synth OUT_DIR --count 60 --seed 7

Writes OUT_DIR/*.pdf and OUT_DIR/labels.json. Every company and number is
invented. Scores on these say the pipeline works; only your own labelled
invoices can say how accurate it is on your documents.
"""

from __future__ import annotations

import argparse
import io
import json
import random
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageFilter

from .parse import money

VENDORS = [
    ("Copperfield Office Goods", "14 Tanner Row", "Leeds LS1 4AB"),
    ("Bluewater Print Works", "220 Harbor Blvd", "Tacoma, WA 98402"),
    ("Aldermoor Logistics Ltd", "Unit 9, Mill Lane", "Bristol BS3 2QT"),
    ("Kestrel & Finch Design", "88 Orchard Street", "Portland, OR 97205"),
    ("Granite Peak Tools Inc.", "5100 Quarry Road", "Boulder, CO 80301"),
    ("Saltmarsh Coffee Roasters", "3 Wharf Approach", "Hull HU1 1TU"),
    ("Orchard Row Electrical", "61 Station Parade", "Cardiff CF10 1EP"),
    ("Lumen Street Studio", "402 Lumen Street", "Austin, TX 78701"),
]
ITEMS = ["Printer paper A4, 5 reams", "Toner cartridge, black", "Site survey, half day", "Pallet delivery",
         "Design consultation (hours)", "Cable tray 3m", "Espresso beans 1kg", "Safety gloves, box of 50",
         "Annual software licence", "Ladder hire, weekly", "LED panel 600x600", "Courier, same day"]


def _fmt(value: Decimal, style: str) -> str:
    text = f"{value:,.2f}"
    return text.replace(",", "X").replace(".", ",").replace("X", ".") if style == "eu" else text


def _date(day: date, style: str) -> str:
    return {"iso": day.isoformat(), "us": f"{day:%b} {day.day}, {day.year}",
            "long": f"{day.day} {day:%B %Y}", "dmy": f"{day:%d/%m/%Y}"}[style]


def make_invoice(rng: random.Random, index: int) -> dict:
    vendor, street, city = rng.choice(VENDORS)
    currency = rng.choice(["USD", "EUR", "GBP"])
    style = "eu" if currency == "EUR" and rng.random() < 0.5 else "us"
    issued = date(2026, 1, 1) + timedelta(days=rng.randrange(280))
    due = issued + timedelta(days=rng.choice([14, 30, 45]))
    lines = []
    for _ in range(rng.randint(1, 6)):
        qty = Decimal(rng.choice([1, 2, 3, 5, 10, 12]))
        price = Decimal(rng.randrange(150, 90000)) / 100
        lines.append({"description": rng.choice(ITEMS), "quantity": qty, "unit_price": price,
                      "line_total": money(qty * price)})
    subtotal = sum((line["line_total"] for line in lines), Decimal(0))
    discount = money(subtotal * Decimal("0.05")) if rng.random() < 0.25 else None
    shipping = Decimal(rng.choice(["9.50", "25.00", "48.00"])) if rng.random() < 0.35 else None
    tax_rate = Decimal(rng.choice(["5", "8.25", "10", "20"]))
    taxable = subtotal - (discount or 0) + (shipping or 0)
    tax = money(taxable * tax_rate / 100)
    withholding = money(subtotal * Decimal("0.02")) if rng.random() < 0.1 else None
    total = subtotal - (discount or 0) + (shipping or 0) + tax - (withholding or 0)
    prefix = rng.choice(["INV-", "", "SI", "A-2026-"])
    return {
        "vendor_name": vendor, "address": [street, city], "currency": currency, "style": style,
        "invoice_number": f"{prefix}{rng.randrange(1000, 99999)}",
        "purchase_order": f"PO-{rng.randrange(4500000, 4599999)}" if rng.random() < 0.6 else None,
        "vendor_tax_id": f"GB{rng.randrange(100000000, 999999999)}" if rng.random() < 0.4 else None,
        "invoice_date": issued, "due_date": due if rng.random() < 0.8 else None,
        "date_style": rng.choice(["iso", "us", "long"]),
        "lines": lines, "subtotal": subtotal, "discount": discount, "shipping": shipping,
        "tax_rate": tax_rate, "tax": tax, "withholding": withholding, "total": total,
        "layout": rng.choice(["inline", "grid"]),
    }


def draw(inv: dict) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    sym = {"USD": "$", "EUR": "€", "GBP": "£"}[inv["currency"]]
    fmt = lambda v: _fmt(v, inv["style"])  # noqa: E731
    put = lambda x, y, text, size=10, bold=False: page.insert_text(  # noqa: E731
        (x, y), text, fontsize=size, fontname="hebo" if bold else "helv")
    right = lambda x, y, text, size=10, bold=False: put(  # noqa: E731
        x - pymupdf.get_text_length(text, "hebo" if bold else "helv", size), y, text, size, bold)

    put(50, 70, inv["vendor_name"], 18, True)
    put(50, 90, inv["address"][0])
    put(50, 104, inv["address"][1])
    if inv["vendor_tax_id"]:
        put(50, 118, f"VAT No: {inv['vendor_tax_id']}")
    right(562, 72, "INVOICE", 20, True)

    meta = [("Invoice No:", inv["invoice_number"]),
            ("Invoice Date:", _date(inv["invoice_date"], inv["date_style"]))]
    if inv["due_date"]:
        meta.append(("Due Date:", _date(inv["due_date"], inv["date_style"])))
    if inv["purchase_order"]:
        meta.append(("PO Number:", inv["purchase_order"]))
    if inv["layout"] == "inline":
        for row, (label, value) in enumerate(meta):
            put(360, 100 + row * 15, label)
            right(562, 100 + row * 15, value)
    else:
        for col, (label, value) in enumerate(meta):
            put(50 + col * 130, 175, label, 9, True)
            put(50 + col * 130, 190, value)

    put(50, 150 if inv["layout"] == "inline" else 220, "Bill to:", 10, True)
    put(50, (164 if inv["layout"] == "inline" else 234), "Lakeside Clinic Group")
    put(50, (178 if inv["layout"] == "inline" else 248), "9 Shore Road, Kingsport")

    y = 280
    put(50, y, "Description", 10, True)
    right(380, y, "Qty", 10, True)
    right(470, y, "Unit Price", 10, True)
    right(562, y, "Amount", 10, True)
    page.draw_line((50, y + 6), (562, y + 6), width=0.5)
    for line in inv["lines"]:
        y += 18
        put(50, y, line["description"])
        right(380, y, str(line["quantity"]))
        right(470, y, fmt(line["unit_price"]))
        right(562, y, fmt(line["line_total"]))
    y += 30
    rows = [("Subtotal", inv["subtotal"])]
    if inv["discount"]:
        rows.append(("Discount", -inv["discount"]))
    if inv["shipping"]:
        rows.append(("Shipping", inv["shipping"]))
    rows.append((f"Tax ({inv['tax_rate']}%)", inv["tax"]))
    if inv["withholding"]:
        rows.append(("Withholding tax", -inv["withholding"]))
    for label, value in rows:
        put(380, y, label)
        right(562, y, fmt(value))
        y += 16
    put(380, y + 4, f"Total Due ({inv['currency']})", 11, True)
    right(562, y + 4, f"{sym}{fmt(inv['total'])}", 11, True)
    put(50, 740, "Thank you for your business. Payment by bank transfer.", 8)
    data = doc.tobytes()
    doc.close()
    return data


def scan(pdf: bytes, rng: random.Random, turn: int = 0) -> bytes:
    """The same invoice printed and scanned: grey, noisy, a little crooked, maybe sideways."""
    src = pymupdf.open(stream=pdf, filetype="pdf")
    pix = src[0].get_pixmap(dpi=150, colorspace=pymupdf.csGRAY)
    image = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    image = image.rotate(rng.uniform(-0.8, 0.8), fillcolor=255, expand=False).filter(ImageFilter.GaussianBlur(0.6))
    noisy = np.asarray(image, dtype=np.int16) + np.random.default_rng(rng.randrange(1 << 30)).normal(0, 9, (pix.height, pix.width)).astype(np.int16)
    image = Image.fromarray(np.clip(noisy, 0, 255).astype(np.uint8))
    if turn:
        image = image.rotate(-turn, expand=True)  # clockwise, as a page fed in sideways
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=60)
    out = pymupdf.open()
    width, height = (792, 612) if turn in (90, 270) else (612, 792)
    out.new_page(width=width, height=height).insert_image(pymupdf.Rect(0, 0, width, height), stream=buffer.getvalue())
    data = out.tobytes()
    out.close()
    src.close()
    return data


def labels_of(inv: dict) -> dict:
    s = lambda v: None if v is None else str(v)  # noqa: E731
    return {
        "vendor_name": inv["vendor_name"], "invoice_number": inv["invoice_number"],
        "purchase_order": inv["purchase_order"], "vendor_tax_id": inv["vendor_tax_id"],
        "invoice_date": inv["invoice_date"].isoformat(), "due_date": s(inv["due_date"] and inv["due_date"].isoformat()),
        "currency": inv["currency"], "subtotal": s(inv["subtotal"]), "discount": s(inv["discount"]),
        "shipping": s(inv["shipping"]), "tax_total": s(inv["tax"]), "withholding": s(inv["withholding"]),
        "total_due": s(inv["total"]),
        "line_items": [{k: s(v) for k, v in line.items()} for line in inv["lines"]],
    }


def generate(out: Path, count: int, seed: int, scanned_share: float = 0.4) -> list[dict]:
    rng = random.Random(seed)
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for index in range(count):
        inv = make_invoice(rng, index)
        pdf = draw(inv)
        kind = "native"
        if rng.random() < scanned_share:
            turn = rng.choice([0, 0, 0, 90, 180])
            pdf = scan(pdf, rng, turn)
            kind = f"scan{'-turned' if turn else ''}"
        name = f"synthetic-{index:03d}-{kind}.pdf"
        (out / name).write_bytes(pdf)
        # A fixed split: tune thresholds on "tune", report on "test" only.
        manifest.append({"file": name, "split": "test" if index % 3 == 0 else "tune", "kind": kind,
                         "labels": labels_of(inv)})
    (out / "labels.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out", type=Path)
    parser.add_argument("--count", type=int, default=60)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--scanned-share", type=float, default=0.4)
    args = parser.parse_args()
    manifest = generate(args.out, args.count, args.seed, args.scanned_share)
    print(f"Wrote {len(manifest)} invoices and labels.json to {args.out}")


if __name__ == "__main__":
    main()
