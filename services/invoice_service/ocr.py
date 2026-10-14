"""
The OCR engine: PaddleOCR, loaded once per worker process.

Anything with the same three methods can stand in for it, which is how the
tests run without the models.
"""

from __future__ import annotations

import os
import threading

import numpy as np

from .config import Settings


class PaddleEngine:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._ocr = None
        self._orient = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._ocr is not None:
                return
            os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
            from paddleocr import DocImgOrientationClassification, PaddleOCR

            # Orientation is handled here rather than inside PaddleOCR, so the
            # turn is known exactly and boxes can be mapped back onto the page.
            self._ocr = PaddleOCR(
                lang=self.settings.ocr_lang,
                text_detection_model_name=self.settings.ocr_det_model,
                text_recognition_model_name=self.settings.ocr_rec_model,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
            self._orient = DocImgOrientationClassification(model_name=self.settings.ocr_orientation_model)

    def orientation(self, image: np.ndarray) -> int:
        """How far the page in the image is turned clockwise: 0, 90, 180 or 270."""
        self._load()
        result = self._orient.predict(image)[0]
        return int(result["label_names"][0])

    def read(self, image: np.ndarray) -> list[tuple[str, float, tuple[float, float, float, float]]]:
        """Every line of text found, with its confidence and box in image pixels."""
        self._load()
        result = self._ocr.predict(image[:, :, ::-1].copy())[0]  # PaddleOCR wants BGR
        return [
            (text, float(score), tuple(float(v) for v in box))
            for text, score, box in zip(result["rec_texts"], result["rec_scores"], result["rec_boxes"])
            if text.strip()
        ]

    def versions(self) -> dict[str, str]:
        from importlib.metadata import PackageNotFoundError, version

        try:
            paddle = version("paddlepaddle")
        except PackageNotFoundError:
            paddle = version("paddlepaddle-gpu")
        return {
            "paddleocr": version("paddleocr"),
            "paddlepaddle": paddle,
            "pymupdf": version("pymupdf"),
            "det_model": self.settings.ocr_det_model,
            "rec_model": self.settings.ocr_rec_model,
            "orientation_model": self.settings.ocr_orientation_model,
        }
