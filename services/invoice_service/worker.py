"""
The worker: takes document ids off the queue and runs the pipeline on them.

    python -m invoice_service.worker

Safe to run more than one. A job delivered twice is processed once (the claim
in the database decides), and a job whose worker died is found by the stale
sweep and queued again, up to MAX_ATTEMPTS.
"""

from __future__ import annotations

import logging
import signal
import time
from pathlib import Path

import redis as redis_lib

from . import jobs, page_ocr
from .config import Policy, Settings, load_policy, load_settings
from .corrections import fingerprint
from .ocr import PaddleEngine
from .pipeline import run
from .store import Store

log = logging.getLogger("invoice_service.worker")


def process(doc_id: str, store: Store, engine, settings: Settings, policy: Policy, redis) -> str | None:
    """Process one document. Returns its final status, or None if it was not ours to process."""
    row = store.claim(doc_id, settings.max_attempts)
    if row is None:
        return None
    try:
        data = store.file_path(doc_id).read_bytes()
        result = run(data, engine, settings, policy,
                     duplicate_check=lambda invoice: (store.duplicate_of(row["owner_id"], fp, doc_id)
                                                      if (fp := fingerprint(invoice)) else None),
                     known_vendors=store.known_vendors(row["owner_id"]))
    except Exception:
        # A crash in the engine, not a bad document: try again, a bounded number of times.
        log.exception("processing %s failed", doc_id)
        fresh = store.get(doc_id)
        if fresh and fresh["attempts"] < settings.max_attempts:
            store.requeue(doc_id)
            time.sleep(min(30, 2 ** fresh["attempts"]))
            jobs.enqueue(redis, doc_id)
            return "queued"
        store.finish(doc_id, "failed", "", {}, None, "Processing failed repeatedly.")
        return "failed"
    error = result.issues[0].message if result.status == "failed" and result.issues else None
    store.finish(doc_id, result.status, result.model_dump_json(), result._context,
                 fingerprint(result.invoice) if result.invoice else None, error)
    log.info("processed %s: %s in %ss", doc_id, result.status, result.seconds)
    return result.status


def sweep(store: Store, settings: Settings, redis):
    """Put back documents whose worker died, and delete what has passed its retention date."""
    for doc_id in store.stale(settings.job_seconds * 2):
        log.warning("requeueing stale %s", doc_id)
        store.requeue(doc_id)
        jobs.enqueue(redis, doc_id)
    removed = store.delete_older_than(settings.retention_days)
    if removed:
        log.info("retention: deleted %d documents", removed)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = load_settings()
    policy = load_policy(settings.policy_file)
    if not policy.calibrated:
        log.warning("The acceptance policy is uncalibrated. Run the benchmark with --calibrate on labelled "
                    "invoices before trusting automatic acceptance.")
    store = Store(settings.db_path, settings.files_dir)
    redis = jobs.connect(settings.redis_url)
    engine = PaddleEngine(settings)
    stopping = False

    def stop(*_):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    last_sweep = 0.0
    log.info("worker ready")
    alive = Path("/tmp/worker-alive")  # the container health check reads this
    while not stopping:
        alive.touch()
        if time.monotonic() - last_sweep > 300:
            sweep(store, settings, redis)
            last_sweep = time.monotonic()
        try:
            work = jobs.next_work(redis, timeout=5)
        except redis_lib.RedisError:
            log.exception("redis unavailable")
            time.sleep(5)
            continue
        if work and work[0] == "ocr":
            page_ocr.answer(redis, work[1], engine, settings.max_page_pixels)
        elif work:
            process(work[1], store, engine, settings, policy, redis)


if __name__ == "__main__":
    main()
