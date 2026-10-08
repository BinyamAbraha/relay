"""Local operational commands; no paid services or credentials required."""

import argparse
import hashlib
import json
import os
import platform
import resource
import subprocess
import sys
import time
import uuid
from pathlib import Path

from relay.api import summary
from relay.scenarios import SCENARIOS, generate
from relay.store import Store, now


def export_bundle(store, destination):
    active = store.active_run()
    runs = store.list_runs(50)
    reports = {r["id"]: store.read_report(r["id"]) for r in runs if r["report_path"]}
    benchmarks = store.root / "benchmarks.json"
    bundle = {
        "mode": "recorded",
        "exported_at": now(),
        "scenarios": SCENARIOS,
        "overview": {
            "mode": "recorded",
            "active_run": active,
            "report": summary(reports.get(active["id"])) if active else None,
            "runs": runs,
            "orphan_snapshots": store.orphan_snapshots(),
        },
        "reports": reports,
        "benchmarks": json.loads(benchmarks.read_text())
        if benchmarks.exists()
        else {"results": []},
    }
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(bundle, separators=(",", ":")))
    return {
        "path": str(destination),
        "bytes": destination.stat().st_size,
        "runs": len(runs),
    }


def main():
    parser = argparse.ArgumentParser(prog="relay")
    parser.add_argument(
        "--data-dir", default=os.environ.get("RELAY_DATA_DIR", ".relay")
    )
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument(
        "scenario", choices=[s["id"] for s in SCENARIOS], nargs="?", default="baseline"
    )
    run.add_argument("--orders", type=int, default=160)
    run.add_argument("--seed", type=int, default=42)
    commands.add_parser("seed")
    server = commands.add_parser("serve")
    server.add_argument("--port", type=int, default=8000)
    export = commands.add_parser("export")
    export.add_argument("destination")
    verify = commands.add_parser("verify")
    verify.add_argument("run_id")
    bench = commands.add_parser("benchmark")
    bench.add_argument("--sizes", type=int, nargs="+", default=[100, 1000, 5000])
    bench.add_argument("--repeats", type=int, default=3)
    child = commands.add_parser("bench-child")
    child.add_argument("--orders", type=int, required=True)
    args = parser.parse_args()
    if args.command == "serve":
        import uvicorn

        from relay.api import create_app

        uvicorn.run(create_app(args.data_dir), host="127.0.0.1", port=args.port)
        return
    if args.command == "bench-child":
        from relay.engine import evaluate

        start = time.perf_counter()
        raw = generate(orders=args.orders)
        report = evaluate(raw)
        elapsed = time.perf_counter() - start
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        mb = rss / (1024**2 if platform.system() == "Darwin" else 1024)
        print(
            json.dumps(
                {
                    "orders": args.orders,
                    "events": len(raw),
                    "elapsed_seconds": round(elapsed, 4),
                    "events_per_second": round(len(raw) / elapsed, 1),
                    "peak_rss_mib": round(mb, 1),
                    "fingerprint": report["fingerprint"],
                    "checks_passed": report["can_publish"],
                }
            )
        )
        return
    store = Store(args.data_dir)
    if args.command == "run":
        if not 2 <= args.orders <= 100_000:
            parser.error("orders must be between 2 and 100000")
        run = store.submit(
            generate(args.scenario, args.orders, args.seed),
            args.scenario,
            uuid.uuid4().hex,
            fault="before_publish" if args.scenario == "interrupted" else None,
        )
        print(json.dumps(store.execute(run["id"]), indent=2))
    elif args.command == "seed":
        # Idempotent initial demonstration setup. Keys are stable per seed version.
        for scenario in (
            "baseline",
            "duplicates",
            "conflict",
            "interrupted",
            "late_refund",
        ):
            run = store.submit(
                generate(scenario),
                scenario,
                f"seed-v2-{scenario}",
                fault="before_publish" if scenario == "interrupted" else None,
            )
            print(scenario, store.execute(run["id"])["status"])
    elif args.command == "export":
        print(json.dumps(export_bundle(store, args.destination), indent=2))
    elif args.command == "verify":
        run = store.get_run(args.run_id)
        if run["status"] != "published":
            parser.error("verification requires a published run")
        directory = store.root / "snapshots" / args.run_id
        manifest = json.loads((directory / "manifest.json").read_text())
        result = {
            name: hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest
            for name, digest in manifest["artifacts"].items()
        }
        store.retained_input(args.run_id)
        print(
            json.dumps(
                {"run_id": args.run_id, "artifacts": result, "raw_input": "verified"},
                indent=2,
            )
        )
        if not all(result.values()):
            raise SystemExit(1)
    elif args.command == "benchmark":
        if (
            args.repeats < 1
            or args.repeats > 10
            or any(n < 2 or n > 100_000 for n in args.sizes)
        ):
            parser.error("choose 1 to 10 repeats and 2 to 100000 orders per size")
        results = []
        for size in args.sizes:
            for repeat in range(args.repeats):
                completed = subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "relay.cli",
                        "bench-child",
                        "--orders",
                        str(size),
                    ],
                    check=True,
                    text=True,
                    capture_output=True,
                )
                result = json.loads(completed.stdout)
                result["repeat"] = repeat + 1
                results.append(result)
                print(json.dumps(result), flush=True)
        document = {
            "recorded_at": now(),
            "platform": platform.platform(),
            "python": platform.python_version(),
            "processor": platform.machine(),
            "method": "Fresh child process for each repeat. Times generation, validation, SQL, and report assembly. Excludes imports, disk persistence, API, and UI. OS caches uncontrolled. Peak RSS includes interpreter and libraries. Synthetic data only.",
            "results": results,
        }
        (store.root / "benchmarks.json").write_text(json.dumps(document, indent=2))


if __name__ == "__main__":
    main()
