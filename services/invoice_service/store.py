"""
Job records in SQLite and uploaded files on private disk.

SQLite is the source of truth for every document's state; Redis only says
"there is work". A worker that dies mid-job leaves its row "processing", and
the next sweep puts it back in the queue.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    created TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    filename TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    result TEXT,
    context TEXT,
    corrections TEXT,
    fingerprint TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    vendor TEXT
);
CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner_id, created);
CREATE INDEX IF NOT EXISTS documents_fingerprint ON documents(owner_id, fingerprint);
CREATE INDEX IF NOT EXISTS documents_status ON documents(status, updated);
"""

DONE = ("accepted", "needs_review", "failed")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Store:
    def __init__(self, db_path: Path, files_dir: Path):
        self.db_path = db_path
        self.files_dir = files_dir
        db_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        files_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.db() as db:
            db.executescript(SCHEMA)
            if "vendor" not in [row[1] for row in db.execute("PRAGMA table_info(documents)")]:
                db.execute("ALTER TABLE documents ADD COLUMN vendor TEXT")

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.db_path, timeout=30, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
        finally:
            connection.close()

    # ------------------------------------------------------------------ users

    def create_user(self, name: str) -> str:
        """A new user and their token. The token is shown once; only its hash is kept."""
        token = secrets.token_urlsafe(32)
        with self.db() as db:
            db.execute("INSERT INTO users (name, token_hash, created) VALUES (?, ?, ?)",
                       (name, hash_token(token), now()))
        return token

    def rotate_token(self, name: str) -> str | None:
        token = secrets.token_urlsafe(32)
        with self.db() as db:
            changed = db.execute("UPDATE users SET token_hash = ?, disabled = 0 WHERE name = ?",
                                 (hash_token(token), name)).rowcount
        return token if changed else None

    def disable_user(self, name: str) -> bool:
        with self.db() as db:
            return db.execute("UPDATE users SET disabled = 1 WHERE name = ?", (name,)).rowcount > 0

    def user_for_token(self, token: str):
        with self.db() as db:
            return db.execute("SELECT id, name FROM users WHERE token_hash = ? AND disabled = 0",
                              (hash_token(token),)).fetchone()

    # -------------------------------------------------------------- documents

    def file_path(self, doc_id: str) -> Path:
        return self.files_dir / f"{uuid.UUID(doc_id)}.bin"

    def add_document(self, owner_id: int, filename: str, kind: str, data: bytes) -> str:
        doc_id = str(uuid.uuid4())
        path = self.file_path(doc_id)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
        stamp = now()
        with self.db() as db:
            db.execute(
                "INSERT INTO documents (id, owner_id, filename, kind, size, sha256, status, created, updated)"
                " VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
                (doc_id, owner_id, filename[:255], kind, len(data), hashlib.sha256(data).hexdigest(), stamp, stamp),
            )
        return doc_id

    def get(self, doc_id: str, owner_id: int | None = None):
        """A document, or None. With owner_id, only if that user owns it."""
        try:
            uuid.UUID(doc_id)
        except ValueError:
            return None
        with self.db() as db:
            if owner_id is None:
                return db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            return db.execute("SELECT * FROM documents WHERE id = ? AND owner_id = ?", (doc_id, owner_id)).fetchone()

    def list_for(self, owner_id: int, limit: int = 100):
        with self.db() as db:
            return db.execute(
                "SELECT id, filename, status, attempts, error, created, updated, reviewed_by, reviewed_at"
                " FROM documents WHERE owner_id = ? ORDER BY created DESC LIMIT ?", (owner_id, limit)).fetchall()

    def claim(self, doc_id: str, max_attempts: int):
        """
        Take a document for processing, once. Returns None if it is already done,
        or has been tried too many times: the queue may deliver a job twice.
        """
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if row is None or row["status"] in DONE:
                db.execute("COMMIT")
                return None
            if row["attempts"] >= max_attempts:
                db.execute("UPDATE documents SET status = 'failed', error = ?, updated = ? WHERE id = ?",
                           ("Processing failed repeatedly.", now(), doc_id))
                db.execute("COMMIT")
                return None
            db.execute("UPDATE documents SET status = 'processing', attempts = attempts + 1, updated = ?"
                       " WHERE id = ?", (now(), doc_id))
            db.execute("COMMIT")
            return row

    def finish(self, doc_id: str, status: str, result_json: str, context: dict, fingerprint: str | None,
               error: str | None = None):
        with self.db() as db:
            db.execute("UPDATE documents SET status = ?, result = ?, context = ?, fingerprint = ?, error = ?,"
                       " updated = ? WHERE id = ?",
                       (status, result_json, json.dumps(context), fingerprint, error, now(), doc_id))

    def requeue(self, doc_id: str, reset_attempts: bool = False):
        with self.db() as db:
            db.execute("UPDATE documents SET status = 'queued', error = NULL, updated = ?"
                       + (", attempts = 0" if reset_attempts else "") + " WHERE id = ?", (now(), doc_id))

    def stale(self, older_than_seconds: int) -> list[str]:
        """Documents stuck: queued or processing for longer than any job may take."""
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=older_than_seconds)).isoformat(timespec="seconds")
        with self.db() as db:
            return [r["id"] for r in db.execute(
                "SELECT id FROM documents WHERE status IN ('queued', 'processing') AND updated < ?", (cutoff,))]

    def duplicate_of(self, owner_id: int, fingerprint: str, exclude: str) -> str | None:
        with self.db() as db:
            row = db.execute("SELECT id FROM documents WHERE owner_id = ? AND fingerprint = ? AND id != ?"
                             " ORDER BY created LIMIT 1", (owner_id, fingerprint, exclude)).fetchone()
        return row["id"] if row else None

    def save_review(self, doc_id: str, status: str, result_json: str, corrections: dict,
                    reviewer: str | None = None, vendor: str | None = None):
        """Corrections, and on approval who approved it and the vendor they confirmed."""
        with self.db() as db:
            db.execute("UPDATE documents SET status = ?, result = ?, corrections = ?, updated = ?,"
                       " reviewed_by = COALESCE(?, reviewed_by), reviewed_at = CASE WHEN ? IS NULL"
                       " THEN reviewed_at ELSE ? END, vendor = COALESCE(?, vendor) WHERE id = ?",
                       (status, result_json, json.dumps(corrections), now(), reviewer, reviewer, now(),
                        vendor, doc_id))

    def known_vendors(self, owner_id: int) -> set[str]:
        """Vendors this user has approved an invoice from: the vendor list they have built by reviewing."""
        with self.db() as db:
            return {row["vendor"] for row in db.execute(
                "SELECT DISTINCT vendor FROM documents WHERE owner_id = ? AND reviewed_by IS NOT NULL"
                " AND vendor IS NOT NULL", (owner_id,))}

    def delete_older_than(self, days: int) -> int:
        """Retention: remove documents, and their files, older than `days`."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        with self.db() as db:
            ids = [r["id"] for r in db.execute("SELECT id FROM documents WHERE created < ?", (cutoff,))]
            for doc_id in ids:
                self.file_path(doc_id).unlink(missing_ok=True)
                db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        return len(ids)
