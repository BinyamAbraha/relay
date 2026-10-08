import json

import pytest

from relay.store import Store


def test_snapshot_publication_and_artifacts(tmp_path, ledger):
    s = Store(tmp_path)
    run = s.submit(ledger, "fixture", "key-one")
    result = s.execute(run["id"])
    assert result["status"] == "published"
    assert s.active_run()["id"] == run["id"]
    manifest = json.loads(
        (tmp_path / "snapshots" / run["id"] / "manifest.json").read_text()
    )
    assert "events.parquet" in manifest["artifacts"]


def test_interruption_preserves_pointer_and_retry_converges(tmp_path, ledger):
    s = Store(tmp_path)
    baseline = s.submit(ledger, "fixture", "a")
    s.execute(baseline["id"])
    failed = s.submit(ledger, "fixture", "b", fault="before_publish")
    s.execute(failed["id"])
    assert s.get_run(failed["id"])["status"] == "failed"
    assert s.active_run()["id"] == baseline["id"]
    assert failed["id"] in s.orphan_snapshots()
    retried = s.retry(failed["id"], "retry")
    s.execute(retried["id"])
    assert s.active_run()["id"] == retried["id"]
    assert (
        s.read_report(retried["id"])["fingerprint"]
        == s.read_report(baseline["id"])["fingerprint"]
    )


def test_idempotency_rejects_changed_request(tmp_path, ledger):
    s = Store(tmp_path)
    a = s.submit(ledger, "fixture", "same")
    assert s.submit(ledger, "fixture", "same")["id"] == a["id"]
    with pytest.raises(ValueError):
        s.submit(ledger, "different", "same")


def test_blocked_candidate_keeps_prior_publication(tmp_path, ledger):
    s = Store(tmp_path)
    a = s.submit(ledger, "fixture", "a")
    s.execute(a["id"])
    ledger[-1]["schema_version"] = 99
    b = s.submit(ledger, "bad", "b")
    s.execute(b["id"])
    assert s.get_run(b["id"])["status"] == "blocked"
    assert s.active_run()["id"] == a["id"]


def test_cancelled_run_does_not_publish(tmp_path, ledger):
    s = Store(tmp_path)
    a = s.submit(ledger, "fixture", "a")
    s.cancel(a["id"])
    s.execute(a["id"])
    assert s.get_run(a["id"])["status"] == "cancelled"
    assert s.active_run() is None


def test_recovery_marks_abandoned_work_retryable(tmp_path, ledger):
    s = Store(tmp_path)
    a = s.submit(ledger, "fixture", "a")
    s.update(a["id"], status="running")
    assert s.recover_interrupted() == 1
    assert s.get_run(a["id"])["status"] == "failed"


def test_raw_tampering_detected(tmp_path, ledger):
    s = Store(tmp_path)
    a = s.submit(ledger, "fixture", "a")
    (tmp_path / "raw" / (a["raw_hash"] + ".json")).write_text("[]")
    assert s.execute(a["id"])["status"] == "failed"
    assert s.active_run() is None


def test_actual_worker_exit_before_commit_is_recoverable(tmp_path, ledger):
    import subprocess
    import sys

    s = Store(tmp_path)
    baseline = s.submit(ledger, "fixture", "baseline-crash")
    s.execute(baseline["id"])
    candidate = s.submit(ledger, "fixture", "hard-crash")
    code = """
import os, sys
from relay.store import Store
store = Store(sys.argv[1])
original = store.step
def stop_at_publish(run_id, name, detail):
    if name == 'Publishing':
        os._exit(23)
    original(run_id, name, detail)
store.step = stop_at_publish
store.execute(sys.argv[2])
"""
    process = subprocess.run(
        [sys.executable, "-c", code, str(tmp_path), candidate["id"]], check=False
    )
    assert process.returncode == 23
    assert s.active_run()["id"] == baseline["id"]
    assert s.get_run(candidate["id"])["status"] == "running"
    assert s.recover_interrupted() == 1
    retry = s.retry(candidate["id"], "after-hard-crash")
    assert s.execute(retry["id"])["status"] == "published"
    assert (
        s.read_report(retry["id"])["fingerprint"]
        == s.read_report(baseline["id"])["fingerprint"]
    )


def test_concurrent_identical_requests_create_one_run(tmp_path, ledger):
    from concurrent.futures import ThreadPoolExecutor

    store = Store(tmp_path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(
            pool.map(
                lambda _: store.submit(ledger, "fixture", "concurrent-key"), range(4)
            )
        )
    assert len({r["id"] for r in results}) == 1
    assert len(store.list_runs()) == 1


def test_worker_queue_is_independent_of_recent_run_limit(tmp_path, ledger):
    store = Store(tmp_path)
    first = store.submit(ledger, "fixture", "oldest")
    for i in range(205):
        store.submit(ledger, "fixture", f"newer-{i}")
    assert first["id"] not in {r["id"] for r in store.list_runs(200)}
    assert store.next_queued()["id"] == first["id"]
