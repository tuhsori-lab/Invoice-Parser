"""
Reading one picture for the browser's Split tab.

Split renders a scanned page (or a part of it) in the browser and asks for it
to be read. The answer comes back in the shape Split already understands from
Tesseract: lines, words with boxes in the picture's pixels, confidence 0-100.
Nothing is stored: the picture waits in Redis for at most a couple of minutes.
"""

from __future__ import annotations

import io
import json
import uuid

import numpy as np
from PIL import Image

QUEUE = "ocr:queue"
IMAGE_TTL = 120
RESULT_TTL = 60


def _box(x0, y0, x1, y1) -> dict:
    return {"x0": round(x0), "y0": round(y0), "x1": round(x1), "y1": round(y1)}


def split_words(text: str, box, confidence: float) -> list[dict]:
    """A line's words, each given a share of the line's width by its length."""
    x0, y0, x1, y1 = box
    words, position = [], 0
    width_per_char = (x1 - x0) / max(len(text), 1)
    for word in text.split(" "):
        if word:
            start = x0 + position * width_per_char
            words.append({"text": word, "confidence": confidence,
                          "bbox": _box(start, y0, start + len(word) * width_per_char, y1)})
        position += len(word) + 1
    return words


def read_picture(data: bytes, engine, max_pixels: int) -> dict:
    Image.MAX_IMAGE_PIXELS = max_pixels
    with Image.open(io.BytesIO(data)) as image:
        picture = np.asarray(image.convert("RGB"))
    height, width = picture.shape[:2]
    # Only a whole page can be told to be sideways; a strip or a box is read as it is.
    page_like = min(width, height) >= 600 and 0.5 <= width / height <= 2
    turn = engine.orientation(picture) // 90 if page_like else 0
    upright = np.ascontiguousarray(np.rot90(picture, turn)) if turn else picture
    lines = []
    for text, conf, box in engine.read(upright):
        score = round(conf * 100, 1)
        lines.append({"text": text, "confidence": score, "bbox": _box(*box),
                      "words": split_words(text, box, score)})
    lines.sort(key=lambda line: (line["bbox"]["y0"], line["bbox"]["x0"]))
    return {"lines": lines, "rotation": turn * 90}


def ask(redis, data: bytes, timeout: int) -> dict | None:
    """Queue a picture for a worker and wait for what it read, or None if no worker answered in time."""
    job = uuid.uuid4().hex
    redis.set(f"ocr:image:{job}", data, ex=IMAGE_TTL)
    redis.lpush(QUEUE, job)
    answer = redis.blpop([f"ocr:result:{job}"], timeout=timeout)
    redis.delete(f"ocr:image:{job}")
    return json.loads(answer[1]) if answer else None


def answer(redis, job: str, engine, max_pixels: int):
    """In the worker: read the picture a request is waiting on, and hand the result back."""
    data = redis.get(f"ocr:image:{job}")
    redis.delete(f"ocr:image:{job}")
    if data is None:
        return  # the request gave up waiting
    try:
        body = read_picture(data, engine, max_pixels)
    except Exception as error:  # a bad picture must not take the worker down
        body = {"error": f"The picture could not be read: {type(error).__name__}."}
    key = f"ocr:result:{job}"
    redis.rpush(key, json.dumps(body))
    redis.expire(key, RESULT_TTL)
