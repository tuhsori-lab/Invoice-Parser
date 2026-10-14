"""
Stage D: words into lines, lines into cells, and the line-item table into rows
and columns, keeping every box so each value can point back at its source.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from statistics import median

from .pages import PageWords, Word


@dataclass
class Segment:
    """A run of words on one line with no big gap in it: in practice, one cell."""

    words: list[Word]

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    @property
    def page(self) -> int:
        return self.words[0].page

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (min(w.x0 for w in self.words), min(w.y0 for w in self.words),
                max(w.x1 for w in self.words), max(w.y1 for w in self.words))

    @property
    def evidence_bbox(self) -> tuple[float, float, float, float]:
        return union(w.evidence_box for w in self.words)

    @property
    def conf(self) -> float | None:
        scores = [w.conf for w in self.words if w.conf is not None]
        return min(scores) if scores else None

    @property
    def source(self) -> str:
        return self.words[0].source


@dataclass
class Line:
    page: int
    segments: list[Segment] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "  ".join(s.text for s in self.segments)

    @property
    def y0(self) -> float:
        return min(s.bbox[1] for s in self.segments)

    @property
    def y1(self) -> float:
        return max(s.bbox[3] for s in self.segments)

    @property
    def height(self) -> float:
        return self.y1 - self.y0


def union(boxes) -> tuple[float, float, float, float]:
    boxes = list(boxes)
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def _overlap(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def build_lines(pages: list[PageWords], gap_factor: float = 1.0) -> list[Line]:
    """Every line on every page, top to bottom, cut into segments at wide gaps."""
    lines: list[Line] = []
    for page in pages:
        rows: list[list[Word]] = []
        for word in sorted(page.words, key=lambda w: (w.y0 + w.y1) / 2):
            centre, height = (word.y0 + word.y1) / 2, (word.y1 - word.y0) or 1
            best, best_distance = None, float("inf")
            for row in rows[-6:]:
                # A row's position is its typical word, not the union of them all: on a
                # crooked scan, unions creep downwards and swallow the next line.
                row_centre = median((w.y0 + w.y1) / 2 for w in row)
                row_height = median(w.y1 - w.y0 for w in row)
                distance = abs(centre - row_centre)
                if distance > 0.5 * min(height, row_height):
                    continue
                # Two words one above the other are never on the same line.
                if any(_overlap(word.x0, word.x1, w.x0, w.x1) > 0 for w in row):
                    continue
                if distance < best_distance:
                    best, best_distance = row, distance
            if best is None:
                rows.append([word])
            else:
                best.append(word)
        for row in rows:
            row.sort(key=lambda w: w.x0)
            height = median(w.y1 - w.y0 for w in row)
            line = Line(page.number)
            current = [row[0]]
            for word in row[1:]:
                if word.x0 - current[-1].x1 > gap_factor * height:
                    line.segments.append(Segment(current))
                    current = []
                current.append(word)
            line.segments.append(Segment(current))
            lines.append(line)
    lines.sort(key=lambda line: (line.page, line.y0))
    return lines


# Column headings of a line-item table, most specific first.
COLUMNS = {
    "quantity": ("quantity", "qty", "units", "hours", "hrs", "no. of units"),
    "unit_price": ("unit price", "unit cost", "price per unit", "price/unit", "rate", "price", "each"),
    "tax_rate": ("tax rate", "vat rate", "tax %", "vat %", "gst %", "tax", "vat", "gst"),
    "line_total": ("line total", "ext. price", "extended price", "extended", "net amount", "amount", "total"),
    "description": ("description", "item description", "details", "particulars", "service", "product", "item"),
}


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9%/.]+", " ", text.lower()).strip(" .")


def column_of(text: str) -> str | None:
    words = _norm(text)
    for name, labels in COLUMNS.items():
        if words in labels:
            return name
    return None


@dataclass
class Table:
    page: int
    header: Line
    columns: dict[str, tuple[float, float]]  # column name -> (x0, x1) of its heading
    rows: list[Line]


def find_tables(lines: list[Line], is_stop) -> list[Table]:
    """
    Line-item tables: a heading line naming a description and at least one
    number column, and the lines under it until the totals start.
    """
    tables = []
    index = 0
    while index < len(lines):
        line = lines[index]
        columns = {}
        for segment in line.segments:
            name = column_of(segment.text)
            if name and name not in columns:
                columns[name] = segment.bbox[0], segment.bbox[2]
        if "description" in columns and len(columns) >= 2 and "line_total" in columns:
            rows = []
            index += 1
            while index < len(lines) and lines[index].page == line.page and not is_stop(lines[index]):
                rows.append(lines[index])
                index += 1
            tables.append(Table(line.page, line, columns, rows))
            continue
        index += 1
    return tables


def assign_cells(table: Table, row: Line, strategy: str = "overlap") -> dict[str, list[Segment]]:
    """
    Which segments of a row sit under which heading.

    "overlap" puts a segment under the heading it overlaps most; "right_edge"
    under the heading whose right edge is nearest, for numbers set flush right
    that do not reach under their heading. Anything left of every number column
    is description.
    """
    cells: dict[str, list[Segment]] = {}
    number_columns = {k: v for k, v in table.columns.items() if k != "description"}
    first_number_x = min(x0 for x0, _ in number_columns.values()) if number_columns else float("inf")
    for segment in row.segments:
        x0, _, x1, _ = segment.bbox
        if x1 <= first_number_x + 2 or "description" in table.columns and _is_text(segment.text):
            cells.setdefault("description", []).append(segment)
            continue
        if strategy == "overlap":
            name = max(number_columns, key=lambda k: (_overlap(x0, x1, *number_columns[k]),
                                                      -abs((x0 + x1) / 2 - sum(number_columns[k]) / 2)))
        else:
            name = min(number_columns, key=lambda k: abs(x1 - number_columns[k][1]))
        cells.setdefault(name, []).append(segment)
    return cells


def _is_text(text: str) -> bool:
    letters = sum(c.isalpha() for c in text)
    return letters > 3 and letters > sum(c.isdigit() for c in text)
