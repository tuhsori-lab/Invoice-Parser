"""
Stages B and C: the words on each page, with where they are.

A page's own text is used when it can be trusted; otherwise the page is
rendered and read with OCR. Every word keeps its page and its box in PDF points,
top-left origin, whichever way it was read.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

import numpy as np
import pymupdf

from .ingest import safe_dpi


@dataclass
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    page: int
    conf: float | None
    source: str  # "pdf_text" or "ocr"
    # Where the word is on the page as stored, when that differs from the upright
    # position used for layout (a page scanned sideways). Evidence points here.
    page_box: tuple[float, float, float, float] | None = None

    @property
    def evidence_box(self) -> tuple[float, float, float, float]:
        return self.page_box or (self.x0, self.y0, self.x1, self.y1)


@dataclass
class PageWords:
    number: int
    width: float
    height: float
    words: list[Word]
    source: str
    dpi: int | None = None
    rotation: int = 0
    text_check: str | None = None

    @property
    def mean_confidence(self) -> float | None:
        scores = [w.conf for w in self.words if w.conf is not None]
        return sum(scores) / len(scores) if scores else None


def native_words(page: pymupdf.Page) -> list[Word]:
    return [
        Word(text, x0, y0, x1, y1, page.number + 1, None, "pdf_text")
        for x0, y0, x1, y1, text, *_ in page.get_text("words", sort=True)
        if text.strip()
    ]


def check_text(page: pymupdf.Page, words: list[Word]) -> str | None:
    """
    Why a page's own text cannot be trusted, or None when it can.

    Having text is not enough: scanners add invisible OCR layers of any quality,
    and broken font encodings turn real words into private-use characters.
    """
    text = "".join(w.text for w in words)
    if len(text) < 20:
        return "no_text"
    odd = sum(1 for c in text if c == "�" or unicodedata.category(c) in ("Co", "Cc", "Cn"))
    if odd / len(text) > 0.02:
        return "garbled"
    readable = sum(1 for c in text if c.isalnum())
    if readable / len(text) < 0.5:
        return "garbled"
    if not re.search(r"[A-Za-z]{3,}", text):
        return "garbled"
    # A page that is mostly one picture with a thin layer of text is a scan.
    page_area = page.rect.width * page.rect.height
    for info in page.get_image_info():
        x0, y0, x1, y1 = info["bbox"]
        if (x1 - x0) * (y1 - y0) > 0.6 * page_area and len(text) < 400:
            return "scan_text_layer"
    return None


def render(page: pymupdf.Page, dpi: int, max_page_pixels: int) -> tuple[np.ndarray, int]:
    """A page as an RGB image, at no more than the pixel budget allows."""
    dpi = safe_dpi(page, dpi, max_page_pixels)
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
    image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    return image.copy(), dpi


def image_quality(image: np.ndarray) -> str | None:
    """A reason the image is not worth reading, or None."""
    grey = image.mean(axis=2)
    if grey.std() < 4:
        return "blank"
    if min(image.shape[:2]) < 600:
        return "low_resolution"
    return None


def unrotate_box(box, k: int, width: int, height: int):
    """
    A box found on an image turned by np.rot90(image, k), as a box on the image
    before it was turned. width and height are the unturned image's.
    """
    x0, y0, x1, y1 = box
    for step in range(k % 4, 0, -1):
        # One quarter turn back, onto np.rot90(image, step - 1), which is this wide:
        turned_width = width if (step - 1) % 2 == 0 else height
        x0, y0, x1, y1 = turned_width - y1, x0, turned_width - y0, x1
    return x0, y0, x1, y1


def ocr_page(page: pymupdf.Page, engine, dpi: int, max_page_pixels: int) -> PageWords:
    image, dpi = render(page, dpi, max_page_pixels)
    height, width = image.shape[:2]
    quality = image_quality(image)
    if quality == "blank":
        return PageWords(page.number + 1, page.rect.width, page.rect.height, [], "ocr", dpi, 0, "blank")
    turn = engine.orientation(image) // 90  # how far it is turned clockwise, in quarter turns
    upright = np.ascontiguousarray(np.rot90(image, turn)) if turn else image
    scale = 72 / dpi
    words = []
    for text, conf, box in engine.read(upright):
        # Laid out upright; pointed at where it really is on the stored page.
        x0, y0, x1, y1 = (v * scale for v in box)
        page_box = tuple(v * scale for v in unrotate_box(box, turn, width, height)) if turn else None
        words.append(Word(text, x0, y0, x1, y1, page.number + 1, conf, "ocr", page_box))
    words.sort(key=lambda w: (round(w.y0 / 4), w.x0))
    return PageWords(page.number + 1, page.rect.width, page.rect.height, words, "ocr", dpi, turn * 90, quality)
