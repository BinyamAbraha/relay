"""Loopback-only API. One process owns one serialized durable worker."""

import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from relay.scenarios import SCENARIOS, generate
from relay.store import Store


class RunRequest(BaseModel):
    scenario: str = "baseline"
    orders: int = Field(default=160, ge=2, le=2000, strict=True)
    seed: int = Field(default=42, ge=0, le=1_000_000, strict=True)


def create_app(root=None, start_worker=True):
    store = Store(root or os.environ.get("RELAY_DATA_DIR", ".relay"))
    stop = threading.Event()

    def worker():
        while not stop.is_set():
            queued = store.next_queued()
            if queued:
                store.execute(queued["id"])
            else:
                stop.wait(0.15)

    @asynccontextmanager
    async def lifespan(app):
        thread = None
        if start_worker:
            store.recover_interrupted()
            thread = threading.Thread(target=worker, daemon=True, name="relay-worker")
            thread.start()
        yield
        stop.set()
        if thread:
            thread.join(timeout=10)

    app = FastAPI(title="Relay", version="0.1.0", lifespan=lifespan)
    app.state.store = store
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"]
    )

    @app.middleware("http")
    async def local_mutations(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            if origin:
                parsed = urlparse(origin)
                if (
                    parsed.scheme != "http"
                    or parsed.hostname not in ("localhost", "127.0.0.1")
                    or parsed.port not in (5173, 4173, 8000)
                ):
                    return JSONResponse(
                        {"detail": "Mutation origin is not an allowed local UI"},
                        status_code=403,
                    )
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse({"detail": "Record not found"}, status_code=404)

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "mode": "local", "version": "0.1.0"}

    @app.get("/api/scenarios")
    def scenarios():
        return SCENARIOS

    @app.get("/api/overview")
    def overview():
        active = store.active_run()
        report = store.read_report(active["id"]) if active else None
        return {
            "mode": "local",
            "active_run": active,
            "report": summary(report),
            "runs": store.list_runs(),
            "orphan_snapshots": store.orphan_snapshots(),
        }

    @app.get("/api/runs")
    def runs():
        return store.list_runs()

    @app.post("/api/runs", status_code=202)
    def create_run(
        body: RunRequest, idempotency_key: str = Header(min_length=8, max_length=150)
    ):
        raw = generate(body.scenario, body.orders, body.seed)
        fault = "before_publish" if body.scenario == "interrupted" else None
        return store.submit(raw, body.scenario, idempotency_key, fault=fault)

    @app.get("/api/runs/{run_id}")
    def run(run_id: str):
        return {
            "run": store.get_run(run_id),
            "report": summary(store.read_report(run_id)),
        }

    @app.post("/api/runs/{run_id}/retry", status_code=202)
    def retry(run_id: str, idempotency_key: str = Header(min_length=8, max_length=150)):
        return store.retry(run_id, idempotency_key)

    @app.post("/api/runs/{run_id}/cancel")
    def cancel(run_id: str):
        return store.cancel(run_id)

    @app.get("/api/runs/{run_id}/input")
    def raw(run_id: str, line: int = Query(ge=1)):
        data = store.retained_input(run_id)
        if line > len(data):
            raise HTTPException(404, "Input line not found")
        return {
            "line": line,
            "event": data[line - 1],
            "raw_hash": store.get_run(run_id)["raw_hash"],
        }

    @app.get("/api/orders")
    def orders(
        run_id: str | None = None,
        search: str = Query(default="", max_length=100),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=25, ge=1, le=100),
    ):
        if not run_id:
            active = store.active_run()
            if not active:
                return {"items": [], "total": 0}
            run_id = active["id"]
        report = store.read_report(run_id)
        items = report["orders"] if report else []
        items = [
            o
            for o in items
            if search.lower() in (o["order_id"] + " " + o["customer_id"]).lower()
        ]
        return {
            "items": [
                {k: v for k, v in o.items() if k not in ("events", "lines")}
                for o in items[offset : offset + limit]
            ],
            "total": len(items),
            "run_id": run_id,
        }

    @app.get("/api/orders/{order_id}")
    def order(order_id: str, run_id: str | None = None):
        if not run_id:
            active = store.active_run()
            if not active:
                raise KeyError(order_id)
            run_id = active["id"]
        report = store.read_report(run_id)
        for item in report["orders"] if report else []:
            if item["order_id"] == order_id:
                return {**item, "run_id": run_id}
        raise KeyError(order_id)

    @app.get("/api/compare")
    def compare(before: str, after: str):
        for run_id in (before, after):
            if store.get_run(run_id)["status"] != "published":
                raise ValueError("Comparison requires two published snapshots")
        a, b = store.read_report(before), store.read_report(after)
        return {
            "before": before,
            "after": after,
            "same_business_result": a["fingerprint"] == b["fingerprint"],
            "metrics": [
                {
                    "id": key,
                    "before": a["totals"][key],
                    "after": b["totals"][key],
                    "difference": b["totals"][key] - a["totals"][key],
                }
                for key in a["totals"]
            ],
            "before_fingerprint": a["fingerprint"],
            "after_fingerprint": b["fingerprint"],
        }

    @app.get("/api/benchmarks")
    def benchmarks():
        path = store.root / "benchmarks.json"
        import json

        return (
            json.loads(path.read_text())
            if path.exists()
            else {
                "results": [],
                "note": "No benchmarks recorded for this data directory.",
            }
        )

    dist = Path(__file__).resolve().parent.parent / "web" / "dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
    return app


def summary(report):
    return (
        {k: v for k, v in report.items() if k not in ("orders", "order_lines")}
        if report
        else None
    )
