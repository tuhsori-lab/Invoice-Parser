"""The Redis side: a queue of document ids, and request rate limits."""

from __future__ import annotations

import time

QUEUE = "invoices:queue"


def connect(url: str):
    """
    A Redis client for blocking reads. redis-py 8 gives up on any read after 5 s
    by default, which cuts off every wait for a job or a page longer than that;
    here each blocking call carries its own timeout instead.
    """
    import redis

    return redis.Redis.from_url(url, socket_timeout=None, socket_connect_timeout=5, health_check_interval=30)


def enqueue(redis, doc_id: str):
    redis.lpush(QUEUE, doc_id)


def next_job(redis, timeout: int = 5) -> str | None:
    item = redis.brpop(QUEUE, timeout=timeout)
    if item is None:
        return None
    value = item[1]
    return value.decode() if isinstance(value, bytes) else value


def next_work(redis, timeout: int = 5) -> tuple[str, str] | None:
    """The next thing to do: a picture someone is waiting on comes before a queued document."""
    from .page_ocr import QUEUE as OCR_QUEUE

    item = redis.brpop([OCR_QUEUE, QUEUE], timeout=timeout)
    if item is None:
        return None
    queue, value = (v.decode() if isinstance(v, bytes) else v for v in item)
    return ("ocr" if queue == OCR_QUEUE else "document"), value


def allow(redis, key: str, limit: int, window_seconds: int) -> bool:
    """A fixed-window counter: True while `key` has made fewer than `limit` calls this window."""
    bucket = f"rate:{key}:{int(time.time() // window_seconds)}"
    count = redis.incr(bucket)
    if count == 1:
        redis.expire(bucket, window_seconds + 5)
    return count <= limit
