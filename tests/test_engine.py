import random
from copy import deepcopy

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from relay.engine import evaluate
from relay.scenarios import event, generate


def test_hand_calculated_ledger(ledger):
    r = evaluate(ledger)
    assert r["totals"] == {
        "booked_cents": 5000,
        "captured_cents": 5000,
        "refunded_cents": 2500,
        "net_cents": 2500,
    }
    assert r["inventory"][0]["on_hand"] == 8
    assert r["can_publish"]
    assert (
        next(d for d in r["daily"] if d["date"] == "2026-09-15")["net_cents"] == -2500
    )


@given(st.integers(min_value=0, max_value=10000))
@settings(
    max_examples=12,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_permutation_and_duplicate_invariance(ledger, seed):
    baseline = evaluate(ledger)
    permuted = deepcopy(ledger + [ledger[3], ledger[3]])
    random.Random(seed).shuffle(permuted)
    result = evaluate(permuted)
    assert result["fingerprint"] == baseline["fingerprint"]
    assert result["duplicate_count"] == 2


def test_conflict_excludes_all_variants_in_either_order(ledger):
    conflict = deepcopy(ledger[3])
    conflict["payload"]["amount_cents"] = 7000
    for data in (ledger + [conflict], [conflict] + ledger):
        report = evaluate(data)
        assert not report["can_publish"]
        assert report["totals"]["captured_cents"] == 0
        assert sum(e["code"] == "identity_conflict" for e in report["exceptions"]) == 2


def test_pending_resolves_when_prerequisite_arrives(ledger):
    report = evaluate([e for e in ledger if e["event_id"] != "capture"])
    assert any(e["severity"] == "pending" for e in report["exceptions"])
    assert not report["can_publish"]
    assert evaluate(ledger)["can_publish"]


def test_over_refund_blocks(ledger):
    ledger[-1]["payload"]["amount_cents"] = 5001
    assert any(e["code"] == "over_refund" for e in evaluate(ledger)["exceptions"])


def test_historical_catalog_does_not_reprice_order(ledger):
    ledger.append(
        event(
            "product-v2",
            "product.updated",
            "SKU-X",
            {
                "sku": "SKU-X",
                "name": "New name",
                "category": "Parts",
                "unit_price_cents": 9900,
            },
            5,
        )
    )
    report = evaluate(ledger)
    assert report["orders"][0]["lines"][0]["product"] == "Test part"
    assert report["totals"]["booked_cents"] == 5000


def test_over_shipment_blocks(ledger):
    ledger[4]["payload"]["lines"][0]["quantity"] = 3
    assert any(e["code"] == "over_shipment" for e in evaluate(ledger)["exceptions"])


def test_negative_historical_stock_blocks_even_after_replenishment(ledger):
    ledger[1]["occurred_at"] = "2026-09-16T00:00:00Z"
    r = evaluate(ledger)
    assert r["inventory"][0]["on_hand"] == 8
    assert any(e["code"] == "negative_stock" for e in r["exceptions"])


@pytest.mark.parametrize(
    "scenario,publish",
    [
        ("baseline", True),
        ("duplicates", True),
        ("late_refund", True),
        ("conflict", False),
        ("invalid", False),
        ("missing_payment", False),
        ("negative_stock", False),
    ],
)
def test_scenario_outcomes(scenario, publish):
    assert evaluate(generate(scenario, orders=4))["can_publish"] is publish
