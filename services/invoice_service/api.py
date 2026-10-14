"""
The HTTP API. Every invoice route needs a bearer token, and every document is
visible only to the user who uploaded it: another user's id gets a 404, so ids
do not even leak whether they exist.

    uvicorn invoice_service.api:app
"""

from __future__ import annotations

import json
from typing import Any

import redis as redis_lib
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import jobs, page_ocr
from .config import Settings, load_policy, load_settings
from .corrections import BadCorrection, apply, vendor_key
from .ingest import KINDS, Rejected, open_document, sniff
from .schema import Result
from .store import Store


class CorrectionRequest(BaseModel):
    corrections: dict[str, Any] = {}
    approve: bool = False


def create_app(settings: Settings | None = None, redis=None) -> FastAPI:
    settings = settings or load_settings()
    policy = load_policy(settings.policy_file)
    store = Store(settings.db_path, settings.files_dir)
    redis = redis or jobs.connect(settings.redis_url)

    app = FastAPI(title="Invoice OCR", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
        max_age=600,
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response

    def client_ip(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def current_user(request: Request):
        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            _limit_failures(request)
            raise HTTPException(401, "Sign in with your access token.", headers={"WWW-Authenticate": "Bearer"})
        user = store.user_for_token(header[7:].strip())
        if user is None:
            _limit_failures(request)
            raise HTTPException(401, "That access token is not valid.", headers={"WWW-Authenticate": "Bearer"})
        if not jobs.allow(redis, f"user:{user['id']}", settings.requests_per_minute, 60):
            raise HTTPException(429, "Too many requests. Wait a minute and try again.")
        return user

    def _limit_failures(request: Request):
        if not jobs.allow(redis, f"badauth:{client_ip(request)}", 20, 60):
            raise HTTPException(429, "Too many failed sign-ins. Wait a minute and try again.")

    def owned(doc_id: str, user) -> Any:
        row = store.get(doc_id, user["id"])
        if row is None:
            raise HTTPException(404, "No such invoice.")
        return row

    def summary(row) -> dict:
        return {key: row[key] for key in ("id", "filename", "status", "attempts", "error", "created", "updated",
                                          "reviewed_by", "reviewed_at") if key in row.keys()}

    @app.get("/api/health")
    def health():
        return {"ok": True}

    @app.get("/api/ready")
    def ready():
        redis.ping()
        with store.db() as db:
            db.execute("SELECT 1")
        return {"ok": True}

    @app.post("/api/invoices", status_code=202)
    async def upload(request: Request, file: UploadFile = File(...), user=Depends(current_user)):
        if not jobs.allow(redis, f"upload:{user['id']}", settings.uploads_per_hour, 3600):
            raise HTTPException(429, "Upload limit reached for this hour.")
        declared = request.headers.get("content-length")
        if declared and int(declared) > settings.max_upload_bytes + 64 * 1024:
            raise HTTPException(413, f"Files can be up to {settings.max_upload_bytes // (1024 * 1024)} MB.")
        data = await file.read(settings.max_upload_bytes + 1)
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, f"Files can be up to {settings.max_upload_bytes // (1024 * 1024)} MB.")
        kind = sniff(data[:1024])
        if kind is None:
            raise HTTPException(415, "Only PDF, PNG and JPEG files can be processed.")
        try:
            _, doc = open_document(data, settings.max_pages, settings.max_page_pixels)
            doc.close()
        except Rejected as rejected:
            raise HTTPException(422, rejected.message) from rejected
        doc_id = store.add_document(user["id"], file.filename or f"upload.{kind}", kind, data)
        jobs.enqueue(redis, doc_id)
        return {"id": doc_id, "status": "queued"}

    @app.get("/api/invoices")
    def list_invoices(user=Depends(current_user)):
        return {"invoices": [summary(row) for row in store.list_for(user["id"])]}

    @app.get("/api/invoices/{doc_id}")
    def get_invoice(doc_id: str, user=Depends(current_user)):
        return summary(owned(doc_id, user))

    @app.get("/api/invoices/{doc_id}/status")
    def get_status(doc_id: str, user=Depends(current_user)):
        row = owned(doc_id, user)
        return {"id": row["id"], "status": row["status"], "attempts": row["attempts"], "error": row["error"]}

    def view(row, corrections: dict | None = None) -> dict:
        """A document as a reviewer sees it: the original reading with every correction applied."""
        corrections = corrections if corrections is not None else (
            json.loads(row["corrections"]) if row["corrections"] else {})
        result = None
        if row["result"]:
            original = Result.model_validate_json(row["result"])
            result = original
            if corrections:
                # Always from the original reading, so corrections never compound.
                result = apply(original, json.loads(row["context"] or "{}"), corrections, policy,
                               store.known_vendors(row["owner_id"]))
            if row["status"] in ("accepted", "needs_review"):
                result.status = row["status"]
            result = json.loads(result.model_dump_json())
        return {**summary(row), "result": result, "corrections": corrections}

    @app.get("/api/invoices/{doc_id}/result")
    def get_result(doc_id: str, user=Depends(current_user)):
        return view(owned(doc_id, user))

    @app.get("/api/invoices/{doc_id}/file")
    def get_file(doc_id: str, user=Depends(current_user)):
        row = owned(doc_id, user)
        path = store.file_path(row["id"])
        if not path.exists():
            raise HTTPException(410, "The file has been deleted under the retention policy.")
        return Response(path.read_bytes(), media_type=KINDS[row["kind"]],
                        headers={"Content-Disposition": "inline"})

    @app.patch("/api/invoices/{doc_id}/corrections")
    def correct(doc_id: str, body: CorrectionRequest, user=Depends(current_user)):
        row = owned(doc_id, user)
        if row["status"] not in ("accepted", "needs_review") or not row["result"]:
            raise HTTPException(409, "This invoice has not finished processing.")
        if len(body.corrections) > 500:
            raise HTTPException(422, "Too many corrections at once.")
        merged = {**(json.loads(row["corrections"]) if row["corrections"] else {}), **body.corrections}
        try:
            seen = view(row, merged)  # every correction must parse before any is saved
        except BadCorrection as error:
            raise HTTPException(422, str(error)) from error
        # A corrected invoice needs a person's approval, however its checks come out.
        status = "accepted" if body.approve else ("needs_review" if body.corrections else row["status"])
        vendor = vendor_key(seen["result"]["invoice"]["vendor_name"]["value"]) if body.approve else None
        store.save_review(row["id"], status, row["result"], merged, user["name"] if body.approve else None, vendor)
        return view(store.get(row["id"]))

    @app.post("/api/ocr")
    async def read_page(request: Request, image: UploadFile = File(...), user=Depends(current_user)):
        """
        Read one picture of a page for the Split tab. Nothing is stored: it waits
        in Redis for a worker, at most a couple of minutes, and is deleted.
        """
        limit = 15 * 1024 * 1024
        data = await image.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, "That picture is too large.")
        if sniff(data[:1024]) not in ("png", "jpeg"):
            raise HTTPException(415, "Send the page as a PNG or JPEG picture.")
        result = await run_in_threadpool(page_ocr.ask, redis, data, settings.job_seconds)
        if result is None:
            raise HTTPException(504, "No OCR worker answered. Check the worker is running.")
        if "error" in result:
            raise HTTPException(422, result["error"])
        return result

    @app.post("/api/invoices/{doc_id}/retry", status_code=202)
    def retry(doc_id: str, user=Depends(current_user)):
        row = owned(doc_id, user)
        if row["status"] != "failed":
            raise HTTPException(409, "Only a failed invoice can be retried.")
        store.requeue(row["id"], reset_attempts=True)
        jobs.enqueue(redis, row["id"])
        return {"id": row["id"], "status": "queued"}

    @app.exception_handler(redis_lib.RedisError)
    async def redis_down(_request: Request, _error: Exception):
        return JSONResponse({"detail": "The service is busy. Try again shortly."}, status_code=503)

    app.state.store = store
    app.state.redis = redis
    app.state.settings = settings
    return app


def __getattr__(name):
    # `uvicorn invoice_service.api:app` builds the app on first use, not on import.
    if name == "app":
        globals()["app"] = create_app()
        return globals()["app"]
    raise AttributeError(name)
