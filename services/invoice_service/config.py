"""Settings from the environment, and the acceptance policy from a JSON file."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, fields, replace
from decimal import Decimal
from pathlib import Path


def _list(name: str, default: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in os.environ.get(name, default).split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    redis_url: str
    allowed_origins: tuple[str, ...]
    max_upload_bytes: int
    max_pages: int
    max_page_pixels: int
    job_seconds: int
    max_attempts: int
    ocr_dpi_ladder: tuple[int, ...]
    ocr_lang: str
    ocr_det_model: str
    ocr_rec_model: str
    ocr_orientation_model: str
    requests_per_minute: int
    uploads_per_hour: int
    retention_days: int
    policy_file: Path | None

    @property
    def db_path(self) -> Path:
        return self.data_dir / "invoices.sqlite3"

    @property
    def files_dir(self) -> Path:
        return self.data_dir / "documents"


def load_settings() -> Settings:
    env = os.environ.get
    policy = env("POLICY_FILE")
    return Settings(
        data_dir=Path(env("DATA_DIR", "./data")).resolve(),
        redis_url=env("REDIS_URL", "redis://localhost:6379/0"),
        # Exact origins only, e.g. https://tuhsori-lab.github.io. Never "*".
        allowed_origins=_list("ALLOWED_ORIGINS", "http://localhost:5173"),
        max_upload_bytes=int(env("MAX_UPLOAD_MB", "20")) * 1024 * 1024,
        max_pages=int(env("MAX_PAGES", "30")),
        max_page_pixels=int(env("MAX_PAGE_PIXELS", "40000000")),
        job_seconds=int(env("JOB_SECONDS", "300")),
        max_attempts=int(env("MAX_ATTEMPTS", "3")),
        ocr_dpi_ladder=tuple(int(dpi) for dpi in _list("OCR_DPI_LADDER", "200,300")),
        ocr_lang=env("OCR_LANG", "en"),
        # Pinned, so a PaddleOCR upgrade cannot silently swap the models under a benchmark.
        ocr_det_model=env("OCR_DET_MODEL", "PP-OCRv6_medium_det"),
        ocr_rec_model=env("OCR_REC_MODEL", "PP-OCRv6_medium_rec"),
        ocr_orientation_model=env("OCR_ORIENTATION_MODEL", "PP-LCNet_x1_0_doc_ori"),
        requests_per_minute=int(env("REQUESTS_PER_MINUTE", "600")),
        uploads_per_hour=int(env("UPLOADS_PER_HOUR", "200")),
        retention_days=int(env("RETENTION_DAYS", "30")),
        policy_file=Path(policy) if policy else None,
    )


@dataclass(frozen=True)
class Policy:
    """
    When an invoice may be accepted without a person looking at it.

    The confidence numbers here are UNCALIBRATED starting points. Run
    `python -m invoice_service.benchmark --calibrate` on labelled invoices to
    replace them with values measured against your own documents.
    """

    required: tuple[str, ...] = ("vendor_name", "invoice_number", "invoice_date", "currency", "total_due")
    # These must also be cross-checked (a total that reconciles, a date that parses
    # unambiguously) rather than merely present.
    # A vendor is verified by a label naming it, or by matching one a reviewer has approved before.
    must_verify: tuple[str, ...] = ("vendor_name", "invoice_number", "invoice_date", "currency", "total_due")
    min_field_confidence: float = 0.90
    retry_ocr_below: float = 0.85
    rounding_tolerance: Decimal = Decimal("0.01")
    # "DMY" or "MDY" when every supplier writes dates one way; otherwise ambiguous dates go to review.
    date_order: str | None = None
    # What a bare "$" means for you, e.g. "USD". Unset: a bare "$" leaves the currency unresolved.
    dollar_currency: str | None = None
    calibrated: bool = False
    extra: dict = field(default_factory=dict)


def load_policy(path: Path | None) -> Policy:
    policy = Policy()
    if path is None or not path.exists():
        return policy
    data = json.loads(path.read_text())
    known = {f.name for f in fields(Policy)}
    values = {}
    for key, value in data.items():
        if key not in known:
            raise ValueError(f"Unknown policy setting: {key}")
        if key == "rounding_tolerance":
            value = Decimal(str(value))
        elif isinstance(value, list):
            value = tuple(value)
        values[key] = value
    return replace(policy, **values)
