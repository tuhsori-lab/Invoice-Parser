"""
Measuring the pipeline against labelled invoices.

    python -m invoice_service.benchmark DATA_DIR                 # scores the "test" split
    python -m invoice_service.benchmark DATA_DIR --calibrate     # tunes on "tune", writes a policy

DATA_DIR holds the files and a labels.json: a list of
{"file", "split": "tune"|"test", "labels": {field: value, ..., "line_items": [...]}}.
`python -m invoice_service.synth` writes one; for real accuracy, label your own.

Thresholds are only ever tuned on "tune". "test" is held out, and scores on it
are the ones to quote. Every precision comes with a 95% lower bound, because
40 correct out of 40 does not show 99.5%.
"""

from __future__ import annotations

import argparse
import json
import math
import resource
import statistics
import sys
import time
from dataclasses import replace
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .config import Policy, load_policy, load_settings
from .corrections import extraction_from, vendor_key
from .ocr import PaddleEngine
from .pipeline import run
from .schema import AMOUNT_FIELDS, Result
from .validation import check

SCORED = ("vendor_name", "invoice_number", "purchase_order", "vendor_tax_id", "invoice_date", "due_date",
          "currency", "subtotal", "discount", "shipping", "tax_total", "withholding", "total_due")


def same(name: str, got: str | None, want: str | None) -> bool:
    if got is None or want is None:
        return got is None and want is None
    if name in AMOUNT_FIELDS:
        try:
            return Decimal(got) == Decimal(want)
        except InvalidOperation:
            return False
    return " ".join(got.split()).casefold() == " ".join(want.split()).casefold()


def wilson_lower(correct: int, total: int, z: float = 1.96) -> float:
    if total == 0:
        return 0.0
    p = correct / total
    centre = p + z * z / (2 * total)
    spread = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return (centre - spread) / (1 + z * z / total)


def needed_for(target: float) -> int:
    """How many correct, consecutive acceptances it takes before the lower bound reaches `target`."""
    n = 1
    while wilson_lower(n, n) < target and n < 10**6:
        n = math.ceil(n * 1.2) + 1
    return n


def score(item: dict, result: Result, critical: tuple[str, ...]) -> dict:
    labels = item["labels"]
    invoice = result.invoice
    fields = {}
    for name in SCORED:
        if name not in labels:
            continue
        got = getattr(invoice, name).value if invoice else None
        fields[name] = same(name, got, labels[name])
    want_lines = [(" ".join((l.get("description") or "").split()).casefold(), Decimal(l["line_total"]))
                  for l in labels.get("line_items", []) if l.get("line_total") is not None]
    got_lines = [(" ".join((i.description.value or "").split()).casefold(), Decimal(i.line_total.value))
                 for i in (invoice.line_items if invoice else []) if i.line_total.value is not None]
    remaining = list(want_lines)
    matched = 0
    for line in got_lines:
        if line in remaining:
            remaining.remove(line)
            matched += 1
    return {
        "file": item["file"], "split": item.get("split"), "status": result.status, "seconds": result.seconds,
        "fields": fields,
        "critical_correct": all(fields.get(name, True) for name in critical),
        "reconciled": bool(invoice and invoice.total_due.status == "valid"),
        "lines": {"matched": matched, "got": len(got_lines), "want": len(want_lines)},
        "retries": [r.model_dump() for r in result.retries],
        "issues": [i.code for i in result.issues],
    }


def summarize(rows: list[dict], target: float) -> dict:
    n = len(rows)
    accepted = [r for r in rows if r["status"] == "accepted"]
    good = sum(r["critical_correct"] for r in accepted)
    field_scores = {}
    for name in SCORED:
        marks = [r["fields"][name] for r in rows if name in r["fields"]]
        if marks:
            field_scores[name] = {"correct": sum(marks), "total": len(marks), "rate": round(sum(marks) / len(marks), 4)}
    matched = sum(r["lines"]["matched"] for r in rows)
    got = sum(r["lines"]["got"] for r in rows)
    want = sum(r["lines"]["want"] for r in rows)
    retries = [t for r in rows for t in r["retries"]]
    seconds = sorted(r["seconds"] or 0 for r in rows)
    return {
        "documents": n,
        "fields": field_scores,
        "line_items": {"precision": round(matched / got, 4) if got else None,
                       "recall": round(matched / want, 4) if want else None},
        "reconciled_rate": round(sum(r["reconciled"] for r in rows) / n, 4) if n else None,
        "auto_accepted": len(accepted),
        "auto_accept_precision": round(good / len(accepted), 4) if accepted else None,
        "auto_accept_precision_95_lower_bound": round(wilson_lower(good, len(accepted)), 4),
        "acceptances_needed_to_show_target": needed_for(target),
        "review_rate": round(sum(r["status"] == "needs_review" for r in rows) / n, 4) if n else None,
        "failed_rate": round(sum(r["status"] == "failed" for r in rows) / n, 4) if n else None,
        "seconds": {"p50": statistics.median(seconds) if seconds else None,
                    "p95": seconds[min(len(seconds) - 1, int(0.95 * len(seconds)))] if seconds else None,
                    "max": seconds[-1] if seconds else None},
        "retry_recovery": {kind: {"tried": sum(t["kind"] == kind for t in retries),
                                  "helped": sum(t["kind"] == kind and t["helped"] for t in retries)}
                           for kind in sorted({t["kind"] for t in retries})},
    }


def calibrate(results: list[tuple[dict, Result, set[str]]], policy: Policy, target: float) -> tuple[Policy, list[dict]]:
    """The lowest confidence threshold whose acceptances, on the tune split, meet the target at 95%."""
    table = []
    chosen = None
    critical = tuple(dict.fromkeys(policy.required + policy.must_verify))
    for threshold in (0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99):
        trial = replace(policy, min_field_confidence=threshold)
        accepted = good = 0
        for item, result, known in results:
            if result.invoice is None:
                continue
            extraction = extraction_from(result.invoice.model_copy(deep=True), result._context)
            status, _ = check(extraction, trial, known_vendors=known)
            if status == "accepted":
                accepted += 1
                good += all(same(n, getattr(extraction.invoice, n).value, item["labels"].get(n))
                            for n in critical if n in item["labels"])
        lower = wilson_lower(good, accepted)
        table.append({"threshold": threshold, "accepted": accepted, "correct": good, "lower_bound": round(lower, 4)})
        if chosen is None and accepted and lower >= target:
            chosen = threshold
    if chosen is None:
        return policy, table
    return replace(policy, min_field_confidence=chosen, calibrated=True), table


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("data", type=Path)
    parser.add_argument("--split", default="test", choices=["test", "tune", "all"])
    parser.add_argument("--calibrate", action="store_true", help="tune thresholds on the tune split")
    parser.add_argument("--target", type=float, default=0.99, help="auto-accept precision to show (lower bound)")
    parser.add_argument("--out", type=Path, help="write the full results here as JSON")
    parser.add_argument("--policy-out", type=Path, default=Path("policy.json"))
    args = parser.parse_args()

    settings = load_settings()
    policy = load_policy(settings.policy_file)
    engine = PaddleEngine(settings)
    manifest = json.loads((args.data / "labels.json").read_text())
    split = "tune" if args.calibrate else args.split
    items = [m for m in manifest if split == "all" or m.get("split") == split]
    if not items:
        sys.exit(f"No documents in the {split!r} split.")

    critical = tuple(dict.fromkeys(policy.required + policy.must_verify))
    rows, results = [], []
    started = time.monotonic()
    # As in real use: a reviewer approves each invoice after it is processed, so a
    # vendor's first invoice is reviewed and later ones may be accepted on their own.
    known: set[str] = set()
    for index, item in enumerate(items, 1):
        snapshot = set(known)
        result = run((args.data / item["file"]).read_bytes(), engine, settings, policy, known_vendors=snapshot)
        results.append((item, result, snapshot))
        rows.append(score(item, result, critical))
        if key := vendor_key(item["labels"].get("vendor_name")):
            known.add(key)
        print(f"[{index}/{len(items)}] {item['file']}: {result.status}", file=sys.stderr)

    summary = summarize(rows, args.target)
    summary["split"] = split
    summary["wall_seconds"] = round(time.monotonic() - started, 1)
    summary["peak_rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if sys.platform == "darwin" else 1024), 1)
    summary["policy"] = {"min_field_confidence": policy.min_field_confidence, "calibrated": policy.calibrated}
    summary["engine"] = engine.versions()

    if args.calibrate:
        tuned, table = calibrate(results, policy, args.target)
        summary["calibration"] = table
        if tuned.calibrated:
            body = {"min_field_confidence": tuned.min_field_confidence, "calibrated": True,
                    "required": list(tuned.required), "must_verify": list(tuned.must_verify),
                    "rounding_tolerance": str(tuned.rounding_tolerance),
                    "date_order": tuned.date_order, "dollar_currency": tuned.dollar_currency}
            args.policy_out.write_text(json.dumps(body, indent=2))
            summary["calibration_result"] = f"wrote {args.policy_out}; now score the test split with it"
        else:
            summary["calibration_result"] = (
                f"no threshold reaches a 95% lower bound of {args.target} on this data; "
                f"that takes at least {needed_for(args.target)} correct acceptances. Policy left unchanged.")

    if args.out:
        args.out.write_text(json.dumps({"summary": summary, "documents": rows}, indent=2, default=str))
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
