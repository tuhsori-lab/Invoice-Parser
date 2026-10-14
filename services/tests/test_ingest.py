import io

import numpy as np
import pymupdf
import pytest
from PIL import Image

from invoice_service.ingest import Rejected, open_document, sniff
from invoice_service.pages import unrotate_box

from .conftest import blank_pdf


def code_of(data, **limits):
    with pytest.raises(Rejected) as raised:
        open_document(data, limits.get("max_pages", 5), limits.get("max_page_pixels", 40_000_000))
    return raised.value.code


def test_the_bytes_decide_the_kind_not_the_name():
    assert sniff(b"%PDF-1.7\n") == "pdf"
    assert sniff(b"\x89PNG\r\n\x1a\nrest") == "png"
    assert sniff(b"\xff\xd8\xff\xe0") == "jpeg"
    assert sniff(b"MZ\x90\x00") is None  # an .exe renamed .pdf
    assert sniff(b"<html>") is None


def test_rejects_what_it_should():
    assert code_of(b"not a pdf at all") == "unsupported_type"
    assert code_of(b"%PDF-1.7\n garbage garbage") == "malformed"
    assert code_of(blank_pdf(pages=6)) == "too_many_pages"
    assert code_of(blank_pdf(width=72 * 100, height=72 * 100)) == "page_too_large"


def test_rejects_password_protected_pdfs():
    doc = pymupdf.open()
    doc.new_page()
    data = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="o", user_pw="u")
    assert code_of(data) == "encrypted"


def test_rejects_decompression_bombs():
    buffer = io.BytesIO()
    Image.new("L", (6000, 6000)).save(buffer, format="PNG")
    assert code_of(buffer.getvalue(), max_page_pixels=1_000_000) == "image_too_large"


def test_accepts_a_real_image():
    buffer = io.BytesIO()
    Image.new("RGB", (800, 1000), "white").save(buffer, format="JPEG")
    kind, doc = open_document(buffer.getvalue(), 5, 40_000_000)
    assert kind == "jpeg" and doc.page_count == 1


@pytest.mark.parametrize("turns", [0, 1, 2, 3])
def test_boxes_found_on_a_turned_page_map_back_onto_it(turns):
    height, width = 40, 70
    image = np.zeros((height, width))
    image[5:9, 10:30] = 1
    turned = np.rot90(image, turns)
    ys, xs = np.nonzero(turned)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    assert tuple(int(v) for v in unrotate_box(box, turns, width, height)) == (10, 5, 30, 9)
