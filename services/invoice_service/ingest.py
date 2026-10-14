"""
Stage A: deciding whether an uploaded file is safe and sensible to process.

Nothing here trusts the file name or the MIME type the browser sent: the first
bytes of the file decide what it is.
"""

from __future__ import annotations

import io
import math

import pymupdf
from PIL import Image

pymupdf.TOOLS.mupdf_display_errors(False)

KINDS = {"pdf": "application/pdf", "png": "image/png", "jpeg": "image/jpeg"}
# A page larger than this, in inches, is not an invoice (and is a classic rendering bomb).
MAX_PAGE_INCHES = 60


class Rejected(Exception):
    """A file that will not be processed, and why, in words a person can act on."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def sniff(head: bytes) -> str | None:
    """The real kind of a file, from its first bytes."""
    if b"%PDF-" in head[:1024]:
        return "pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    return None


def open_document(data: bytes, max_pages: int, max_page_pixels: int) -> tuple[str, pymupdf.Document]:
    """Open an upload as a document of pages, or raise Rejected."""
    kind = sniff(data[:1024])
    if kind is None:
        raise Rejected("unsupported_type", "Only PDF, PNG and JPEG files can be processed.")

    if kind != "pdf":
        # Pillow refuses images bigger than this before decoding them: the decompression-bomb guard.
        Image.MAX_IMAGE_PIXELS = max_page_pixels
        try:
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
        except Image.DecompressionBombError as error:
            raise Rejected("image_too_large", "The image is too large to process.") from error
        except Exception as error:
            raise Rejected("malformed", "The image is damaged or not really an image.") from error

    try:
        doc = pymupdf.open(stream=data, filetype=kind)
    except Exception as error:
        raise Rejected("malformed", "The file is damaged or not really a PDF.") from error

    if doc.needs_pass or doc.is_encrypted:
        doc.close()
        raise Rejected("encrypted", "The PDF is password-protected. Remove the password and upload it again.")
    if doc.page_count == 0:
        doc.close()
        raise Rejected("malformed", "The file has no pages.")
    if doc.page_count > max_pages:
        count = doc.page_count
        doc.close()
        raise Rejected("too_many_pages", f"The file has {count} pages; the limit is {max_pages}.")
    for page in doc:
        width, height = page.rect.width / 72, page.rect.height / 72
        if not (0 < width <= MAX_PAGE_INCHES and 0 < height <= MAX_PAGE_INCHES):
            number = page.number + 1
            doc.close()
            raise Rejected("page_too_large", f"Page {number} is not a document-sized page.")
    return kind, doc


def safe_dpi(page: pymupdf.Page, wanted: int, max_page_pixels: int) -> int:
    """The highest resolution up to `wanted` that keeps a page's image within the pixel budget."""
    inches = (page.rect.width / 72) * (page.rect.height / 72)
    return max(72, min(wanted, int(math.sqrt(max_page_pixels / inches))))
