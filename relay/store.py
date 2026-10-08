"""Durable single-host control plane and immutable snapshot publication."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from relay.domain import canonical, content_hash
from relay.engine import TRANSFORM_VERSION, evaluate


def now():
    return datetime.now(UTC).isoformat()


def write_json(path: Path, value):
    with path.open("xb") as handle:
        handle.write(canonical(value))
        handle.flush()
        os.fsync(handle.fileno())


def sync_dir(path: Path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Cancelled(Exception):
    pass


class Store:
    def __init__(self, root: str | Path):
        self.root = Path(root).expanduser().resolve()
        for folder in (
            self.root,
            self.root / "raw",
            self.root / "staging",
            self.root / "snapshots",
        ):
            folder.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "control.sqlite3"
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL,
                scenario TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                raw_hash TEXT NOT NULL, input_count INTEGER NOT NULL, fault TEXT,
                parent_id TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0, elapsed_ms REAL,
                error TEXT, report_path TEXT, steps TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS publication (singleton INTEGER PRIMARY KEY CHECK(singleton=1), run_id TEXT NOT NULL REFERENCES runs(id));
            CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at DESC);
            CREATE INDEX IF NOT EXISTS runs_queue ON runs(status,created_at,id);
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        try:
            with db:
                yield db
        finally:
            db.close()

    @contextmanager
    def writer_lock(self, blocking=True):
        with (self.root / "writer.lock").open("a") as handle:
            fcntl.flock(
                handle.fileno(), fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
            )
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def submit(
        self, raw: list, scenario: str, request_key: str, fault=None, parent_id=None
    ):
        digest = content_hash(raw)
        request_hash = content_hash(
            {"input": digest, "scenario": scenario, "fault": fault, "parent": parent_id}
        )
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT * FROM runs WHERE request_key=?", (request_key,)
            ).fetchone()
            if existing:
                if existing["request_hash"] != request_hash:
                    raise ValueError(
                        "Idempotency key was already used for a different request"
                    )
                return self.decode(existing)
            path = self.root / "raw" / f"{digest}.json"
            if not path.exists():
                write_json(path, raw)
                sync_dir(path.parent)
            elif hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError("Retained input checksum mismatch")
            run_id = uuid.uuid4().hex[:16]
            at = now()
            db.execute(
                "INSERT INTO runs(id,request_key,request_hash,scenario,status,created_at,updated_at,raw_hash,input_count,fault,parent_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    run_id,
                    request_key,
                    request_hash,
                    scenario,
                    "queued",
                    at,
                    at,
                    digest,
                    len(raw),
                    fault,
                    parent_id,
                ),
            )
        return self.get_run(run_id)

    @staticmethod
    def decode(row):
        data = dict(row)
        data["steps"] = json.loads(data["steps"])
        data.pop("request_hash", None)
        data.pop("request_key", None)
        return data

    def get_run(self, run_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError(run_id)
        return self.decode(row)

    def list_runs(self, limit=50):
        with self.connect() as db:
            return [
                self.decode(row)
                for row in db.execute(
                    "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
                )
            ]

    def next_queued(self):
        """Select work independently of the recent-run presentation window."""
        with self.connect() as db:
            row = db.execute(
                "SELECT * FROM runs WHERE status='queued' ORDER BY created_at,id LIMIT 1"
            ).fetchone()
        return self.decode(row) if row else None

    def update(self, run_id, **fields):
        allowed = {"status", "elapsed_ms", "error", "report_path", "cancel_requested"}
        if not set(fields) <= allowed:
            raise ValueError("Unsupported run update")
        fields["updated_at"] = now()
        with self.connect() as db:
            db.execute(
                "UPDATE runs SET "
                + ",".join(f"{key}=?" for key in fields)
                + " WHERE id=?",
                [*fields.values(), run_id],
            )

    def step(self, run_id, name, detail):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT steps,cancel_requested FROM runs WHERE id=?", (run_id,)
            ).fetchone()
            if row["cancel_requested"]:
                raise Cancelled("Cancelled at a safe checkpoint")
            steps = json.loads(row["steps"])
            steps.append({"name": name, "detail": detail, "at": now()})
            db.execute(
                "UPDATE runs SET steps=?,updated_at=? WHERE id=?",
                (json.dumps(steps), now(), run_id),
            )

    def active_run(self):
        with self.connect() as db:
            row = db.execute(
                "SELECT run_id FROM publication WHERE singleton=1"
            ).fetchone()
        return self.get_run(row["run_id"]) if row else None

    def read_report(self, run_id):
        run = self.get_run(run_id)
        if not run["report_path"]:
            return None
        return json.loads((self.root / run["report_path"]).read_text())

    def retained_input(self, run_id):
        run = self.get_run(run_id)
        path = self.root / "raw" / f"{run['raw_hash']}.json"
        raw_bytes = path.read_bytes()
        if hashlib.sha256(raw_bytes).hexdigest() != run["raw_hash"]:
            raise ValueError("Retained input checksum mismatch")
        return json.loads(raw_bytes)

    def retry(self, run_id, request_key):
        prior = self.get_run(run_id)
        if prior["status"] not in ("failed", "cancelled", "blocked"):
            raise ValueError("Only failed, cancelled, or blocked runs can be retried")
        return self.submit(
            self.retained_input(run_id),
            prior["scenario"],
            request_key,
            parent_id=run_id,
        )

    def cancel(self, run_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            run = db.execute("SELECT status FROM runs WHERE id=?", (run_id,)).fetchone()
            if run is None:
                raise KeyError(run_id)
            if run["status"] not in ("queued", "running"):
                raise ValueError("Run is already terminal")
            db.execute(
                "UPDATE runs SET cancel_requested=1,updated_at=? WHERE id=?",
                (now(), run_id),
            )
        return self.get_run(run_id)

    def recover_interrupted(self):
        """Called only under the writer lock, before starting the local worker."""
        with self.writer_lock(), self.connect() as db:
            count = db.execute(
                "UPDATE runs SET status='failed', error='Worker stopped before completion. Retained input is available for retry.', updated_at=? WHERE status='running'",
                (now(),),
            ).rowcount
        return count

    def orphan_snapshots(self):
        with self.connect() as db:
            published = {
                row[0]
                for row in db.execute("SELECT id FROM runs WHERE status='published'")
            }
        return sorted(
            path.name
            for path in (self.root / "snapshots").iterdir()
            if path.is_dir() and path.name not in published
        )

    def execute(self, run_id):
        start = time.perf_counter()
        with self.writer_lock():
            run = self.get_run(run_id)
            if run["status"] != "queued":
                return run
            self.update(run_id, status="running")
            try:
                self.step(
                    run_id,
                    "Input retained",
                    f"Checksum {run['raw_hash'][:12]} · {run['input_count']} input events",
                )
                raw = self.retained_input(run_id)
                self.step(
                    run_id,
                    "Contracts & identity",
                    "Validate schemas, timestamps, money, and duplicate identities",
                )
                staging = self.root / "staging" / run_id
                report = evaluate(raw, staging)
                self.step(
                    run_id,
                    "SQL models complete",
                    f"{report['accepted_count']} unique events · {report['duplicate_count']} duplicate deliveries",
                )
                report["run_id"] = run_id
                report["scenario"] = run["scenario"]
                write_json(staging / "report.json", report)
                self.update(run_id, report_path=f"staging/{run_id}/report.json")
                self.step(
                    run_id,
                    "Reconciliation complete",
                    f"{sum(c['passed'] for c in report['checks'])}/{len(report['checks'])} checks passed · {len(report['exceptions'])} exceptions",
                )
                if not report["can_publish"]:
                    self.update(
                        run_id,
                        status="blocked",
                        error="Candidate failed publication checks. Previous snapshot preserved.",
                    )
                    return self.get_run(run_id)
                artifacts = {
                    p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in staging.iterdir()
                    if p.is_file()
                }
                write_json(
                    staging / "manifest.json",
                    {
                        "run_id": run_id,
                        "raw_hash": run["raw_hash"],
                        "transform_version": TRANSFORM_VERSION,
                        "implementation_hash": content_hash(
                            {
                                str(
                                    p.relative_to(Path(__file__).parent)
                                ): hashlib.sha256(p.read_bytes()).hexdigest()
                                for p in sorted(Path(__file__).parent.rglob("*"))
                                if p.suffix in (".py", ".sql")
                            }
                        ),
                        "business_fingerprint": report["fingerprint"],
                        "created_at": now(),
                        "artifacts": artifacts,
                        "sql_hash": hashlib.sha256(
                            (Path(__file__).parent / "sql/reporting.sql").read_bytes()
                        ).hexdigest(),
                    },
                )
                for p in staging.iterdir():
                    with p.open("rb") as f:
                        os.fsync(f.fileno())
                sync_dir(staging)
                self.step(
                    run_id,
                    "Snapshot ready",
                    "All files complete; current publication has not changed",
                )
                destination = self.root / "snapshots" / run_id
                staging.rename(destination)
                sync_dir(destination.parent)
                self.update(run_id, report_path=f"snapshots/{run_id}/report.json")
                if run["fault"] == "before_publish":
                    raise RuntimeError(
                        "Injected interruption after snapshot completion, before publication pointer commit"
                    )
                self.step(
                    run_id,
                    "Publishing",
                    "Commit snapshot pointer and run state in one database transaction",
                )
                with self.connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    if db.execute(
                        "SELECT cancel_requested FROM runs WHERE id=?", (run_id,)
                    ).fetchone()[0]:
                        raise Cancelled("Cancelled before publication commit")
                    db.execute(
                        "INSERT INTO publication(singleton,run_id) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET run_id=excluded.run_id",
                        (run_id,),
                    )
                    db.execute(
                        "UPDATE runs SET status='published',updated_at=? WHERE id=?",
                        (now(), run_id),
                    )
            except Cancelled as exc:
                self.update(run_id, status="cancelled", error=str(exc))
            except Exception as exc:  # noqa: BLE001 - persist unexpected worker failures before returning
                self.update(run_id, status="failed", error=str(exc))
            finally:
                self.update(
                    run_id, elapsed_ms=round((time.perf_counter() - start) * 1000, 2)
                )
        return self.get_run(run_id)
