"""
The whole pipeline for one document, with targeted retries.

Retries are aimed at the part that went wrong, never the whole run again, and
each one is bounded and recorded in the result.
"""

from __future__ import annotations

import time
from decimal import Decimal

import pymupdf

from .config import Policy, Settings
from .corrections import context_of
from .extraction import Extraction, extract, relaxed_search
from .ingest import Rejected, open_document
from .layout import build_lines
from .pages import PageWords, check_text, native_words, ocr_page
from .schema import Issue, PageInfo, Result, Retry
from .validation import check, reconcile


class Deadline:
    def __init__(self, seconds: float):
        self.ends = time.monotonic() + seconds

    def check(self):
        if time.monotonic() > self.ends:
            raise TimeoutError("The document took too long to process.")


def _read_pages(doc: pymupdf.Document, engine, settings: Settings, policy: Policy,
                deadline: Deadline, retries: list[Retry]) -> list[PageWords]:
    pages = []
    for page in doc:
        deadline.check()
        words = native_words(page)
        problem = check_text(page, words)
        if problem is None:
            pages.append(PageWords(page.number + 1, page.rect.width, page.rect.height, words, "pdf_text"))
            continue
        ladder = settings.ocr_dpi_ladder
        read = ocr_page(page, engine, ladder[0], settings.max_page_pixels)
        read.text_check = problem if read.text_check is None else f"{problem}, {read.text_check}"
        # Poor OCR: render the page sharper and read it again, keeping the better reading.
        for dpi in ladder[1:]:
            mean = read.mean_confidence
            if read.text_check and "blank" in read.text_check or (mean is not None and mean >= policy.retry_ocr_below):
                break
            deadline.check()
            again = ocr_page(page, engine, dpi, settings.max_page_pixels)
            better = (again.mean_confidence or 0) > (mean or 0)
            retries.append(Retry(kind="rerender_ocr", target=f"page {page.number + 1}",
                                 reason=f"mean OCR confidence {mean:.2f} at {read.dpi} dpi" if mean is not None
                                 else f"no text read at {read.dpi} dpi", helped=better))
            if better:
                again.text_check = read.text_check
                read = again
        pages.append(read)
    return pages


def _found(extraction: Extraction, names) -> int:
    return sum(getattr(extraction.invoice, n).value is not None for n in names)


def run(data: bytes, engine, settings: Settings, policy: Policy, duplicate_check=None,
        known_vendors: set[str] | None = None) -> Result:
    """Process one uploaded file. Never raises for a bad document: a failed Result says why."""
    started = time.monotonic()
    deadline = Deadline(settings.job_seconds)
    retries: list[Retry] = []
    try:
        _, doc = open_document(data, settings.max_pages, settings.max_page_pixels)
    except Rejected as rejected:
        return Result(status="failed", issues=[Issue(code=rejected.code, severity="error", message=rejected.message)])
    try:
        pages = _read_pages(doc, engine, settings, policy, deadline, retries)
        deadline.check()
        lines = build_lines(pages)
        extraction = extract(lines, policy)

        # Critical fields missing from a page whose own text was used: that text
        # may be incomplete (a total drawn as a picture), so read those pages with OCR.
        critical = [n for n in policy.required if getattr(extraction.invoice, n).value is None]
        native = [p for p in pages if p.source == "pdf_text"]
        if critical and native:
            deadline.check()
            swapped = [ocr_page(doc[p.number - 1], engine, settings.ocr_dpi_ladder[0], settings.max_page_pixels)
                       if p.source == "pdf_text" else p for p in pages]
            second = extract(build_lines(swapped), policy)
            helped = _found(second, critical) > 0
            retries.append(Retry(kind="ocr_text_pages", target=", ".join(critical),
                                 reason="required fields missing from the PDF's own text", helped=helped))
            if helped and _found(second, policy.required) > _found(extraction, policy.required):
                pages, extraction, lines = swapped, second, build_lines(swapped)

        # A broken line-item table: rebuild the columns another way.
        _, issues = check(_copy(extraction), policy)
        if _table_problems(issues):
            deadline.check()
            second = extract(lines, policy, table_strategy="right_edge")
            _, second_issues = check(_copy(second), policy)
            helped = _table_problems(second_issues) < _table_problems(issues)
            retries.append(Retry(kind="table_columns", target="line_items",
                                 reason="line items did not add up", helped=helped))
            if helped:
                extraction = second

        # An ambiguous total: of every labelled total, take the one the parts add up to.
        total_candidates = extraction.candidates.get("total_due", [])
        current = extraction.invoice.total_due.value
        if current is not None and not reconcile(extraction.invoice, Decimal(current), policy.rounding_tolerance):
            for candidate in total_candidates:
                value = candidate.field.value
                if value not in (None, current) and reconcile(extraction.invoice, Decimal(value),
                                                              policy.rounding_tolerance):
                    extraction.invoice.total_due = candidate.field.model_copy(deep=True)
                    retries.append(Retry(kind="total_candidates", target="total_due",
                                         reason=f"{current} did not reconcile; {value} does", helped=True))
                    break
            else:
                if len(total_candidates) > 1:
                    retries.append(Retry(kind="total_candidates", target="total_due",
                                         reason="no labelled total reconciles", helped=False))

        # Still missing: look again without labels. What this finds always goes to review.
        missing = [n for n in ("invoice_number", "total_due") if getattr(extraction.invoice, n).value is None]
        if missing:
            found = relaxed_search(lines, extraction.invoice, policy)
            for name in found:
                extraction.notes.append(("found_without_label", "Found by pattern, not next to a label.", name))
            retries.append(Retry(kind="relaxed_search", target=", ".join(missing),
                                 reason="no label led to these fields", helped=bool(found)))

        duplicate_of = duplicate_check(extraction.invoice) if duplicate_check else None
        status, issues = check(extraction, policy, duplicate_of, known_vendors=known_vendors)
        result = Result(
            status=status,
            invoice=extraction.invoice,
            issues=issues,
            pages=[PageInfo(number=p.number, width=p.width, height=p.height, source=p.source, dpi=p.dpi,
                            rotation=p.rotation, mean_confidence=p.mean_confidence, text_check=p.text_check)
                   for p in pages],
            retries=retries,
            engine=engine.versions(),
            seconds=round(time.monotonic() - started, 2),
        )
        result._context = context_of(extraction)
        return result
    except TimeoutError as error:
        return Result(status="failed", issues=[Issue(code="timeout", severity="error", message=str(error))],
                      retries=retries, seconds=round(time.monotonic() - started, 2))
    finally:
        doc.close()


def _table_problems(issues: list[Issue]) -> int:
    return sum(i.code in ("line_mismatch", "lines_dont_add_up") for i in issues)


def _copy(extraction: Extraction) -> Extraction:
    """A copy to try checks on without touching the real field statuses."""
    return Extraction(
        invoice=extraction.invoice.model_copy(deep=True),
        candidates=extraction.candidates,
        currencies=set(extraction.currencies),
        decimal_sep=extraction.decimal_sep,
        date_order=extraction.date_order,
        notes=list(extraction.notes),
    )

