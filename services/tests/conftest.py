import random
from dataclasses import replace

import fakeredis
import pymupdf
import pytest

from invoice_service.config import load_settings
from invoice_service.synth import draw, make_invoice


class FakeEngine:
    """Stands in for PaddleOCR: returns whatever lines it is given, as if read from the page."""

    def __init__(self, lines_by_call=None, turn=0):
        self.lines_by_call = list(lines_by_call or [])
        self.turn = turn
        self.calls = 0

    def orientation(self, image):
        return self.turn

    def read(self, image):
        self.calls += 1
        if not self.lines_by_call:
            return []
        return self.lines_by_call[min(self.calls, len(self.lines_by_call)) - 1]

    def versions(self):
        return {"engine": "fake"}


@pytest.fixture
def settings(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://example-user.github.io")
    return replace(load_settings(), max_upload_bytes=2 * 1024 * 1024, max_pages=5)


@pytest.fixture
def redis():
    return fakeredis.FakeRedis()


def invoice(seed=1, **overrides):
    """A made-up invoice (as synth draws them) and its PDF."""
    inv = make_invoice(random.Random(seed), 0)
    inv.update(overrides)
    return inv, draw(inv)


def blank_pdf(pages=1, width=612, height=792) -> bytes:
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page(width=width, height=height)
    return doc.tobytes()
