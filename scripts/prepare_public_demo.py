"""Generate public evidence in an isolated, reproducible synthetic workspace."""
from pathlib import Path
import shutil
from relay.cli import export_bundle
from relay.scenarios import generate
from relay.store import Store

root = Path(__file__).resolve().parent.parent
store = Store(root / ".relay" / "public-release")
expected = {"baseline": "published", "duplicates": "published", "conflict": "blocked", "interrupted": "failed", "late_refund": "published", "invalid": "blocked", "missing_payment": "blocked", "negative_stock": "blocked"}
for scenario, status in expected.items():
    run = store.submit(generate(scenario), scenario, f"public-v1-{scenario}", fault="before_publish" if scenario == "interrupted" else None)
    result = store.execute(run["id"])
    assert result["status"] == status, (scenario, result["status"])
    print(scenario, result["status"])
    if scenario == "interrupted":
        retry = store.retry(run["id"], "public-v1-recovery")
        assert store.execute(retry["id"])["status"] == "published"
        print("recovery", retry["id"], "published")
shutil.copyfile(root / "docs/evidence/benchmark-after.json", store.root / "benchmarks.json")
print(export_bundle(store, root / "web/public/demo.json"))
