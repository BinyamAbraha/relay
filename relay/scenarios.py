"""Deterministic synthetic data, with explicit failure scenarios."""

from __future__ import annotations

import random
from copy import deepcopy
from datetime import UTC, datetime, timedelta

SCENARIOS = [
    {
        "id": "baseline",
        "name": "Baseline batch",
        "category": "Baseline",
        "description": "Process a deterministic day of orders, captures, shipments, and refunds.",
        "invariant": "Published totals match the source ledger.",
        "outcome": "published",
    },
    {
        "id": "duplicates",
        "name": "Duplicate payments",
        "category": "Idempotency",
        "description": "Deliver every payment twice, with a different arrival time.",
        "invariant": "Cash totals stay identical to the baseline.",
        "outcome": "published",
    },
    {
        "id": "late_refund",
        "name": "Late refund",
        "category": "Event time",
        "description": "Receive a prior-day refund three days after it occurred.",
        "invariant": "Apply the refund to its event date, not its arrival date.",
        "outcome": "published",
    },
    {
        "id": "conflict",
        "name": "Conflicting payment",
        "category": "Data contract",
        "description": "Reuse a payment event ID with a different amount.",
        "invariant": "Quarantine the conflicting identity and preserve the last publication.",
        "outcome": "blocked",
    },
    {
        "id": "invalid",
        "name": "Unsupported schema",
        "category": "Validation",
        "description": "Send an unsupported schema version into an otherwise valid batch.",
        "invariant": "Retain the input and report the unsupported schema version.",
        "outcome": "blocked",
    },
    {
        "id": "missing_payment",
        "name": "Refund without payment",
        "category": "Relationships",
        "description": "Receive a refund whose payment has not arrived.",
        "invariant": "Mark the relationship pending; do not silently discard the refund.",
        "outcome": "blocked",
    },
    {
        "id": "interrupted",
        "name": "Interrupted publication",
        "category": "Recovery",
        "description": "Interrupt after output files are complete but before publication.",
        "invariant": "The previous snapshot stays readable. A retry safely publishes the retained input.",
        "outcome": "failed",
    },
    {
        "id": "negative_stock",
        "name": "Negative inventory",
        "category": "Reconciliation",
        "description": "Apply a documented adjustment that exceeds physical stock.",
        "invariant": "The inventory check prevents publication of invalid stock.",
        "outcome": "blocked",
    },
]
PRODUCTS = [
    ("SKU-100", "Precision driver", "Tools", 2500),
    ("SKU-200", "Sensor module", "Electronics", 4800),
    ("SKU-300", "Mounting bracket", "Components", 1800),
    ("SKU-400", "Calibration kit", "Tools", 7600),
]
BASE = datetime(2026, 9, 14, tzinfo=UTC)


def event(event_id, event_type, entity_id, payload, minutes=0, arrival_delay=2):
    at = BASE + timedelta(minutes=minutes)
    return {
        "source": "relay-synthetic",
        "event_id": event_id,
        "event_type": event_type,
        "schema_version": 1,
        "occurred_at": at.isoformat(),
        "ingested_at": (at + timedelta(minutes=arrival_delay)).isoformat(),
        "entity_id": entity_id,
        "payload": payload,
    }


def generate(scenario="baseline", orders=160, seed=42):
    if scenario not in {s["id"] for s in SCENARIOS}:
        raise ValueError("unknown scenario")
    rng = random.Random(seed)
    data = []
    for sku, name, category, price in PRODUCTS:
        data.append(
            event(
                f"product-{sku}-v1",
                "product.updated",
                sku,
                {
                    "sku": sku,
                    "name": name,
                    "category": category,
                    "unit_price_cents": price,
                },
                -1440,
            )
        )
        data.append(
            event(
                f"receipt-{sku}",
                "stock.received",
                f"RCV-{sku}",
                {"sku": sku, "quantity": max(200, orders * 4)},
                -100,
            )
        )
    for i in range(orders):
        sku, _, _, price = PRODUCTS[i % len(PRODUCTS)]
        quantity = rng.randint(1, 3)
        order_id, payment_id = f"ORD-{10400 + i}", f"PAY-{10400 + i}"
        minute = 8 * 60 + i * 3
        data.append(
            event(
                f"order-{i}",
                "order.accepted",
                order_id,
                {
                    "customer_id": f"CUS-{100 + i % 37}",
                    "currency": "USD",
                    "lines": [
                        {"sku": sku, "quantity": quantity, "unit_price_cents": price}
                    ],
                },
                minute,
            )
        )
        data.append(
            event(
                f"capture-{i}",
                "payment.captured",
                payment_id,
                {
                    "order_id": order_id,
                    "amount_cents": quantity * price,
                    "currency": "USD",
                },
                minute + 1,
            )
        )
        data.append(
            event(
                f"shipment-{i}",
                "shipment.sent",
                f"SHP-{10400 + i}",
                {"order_id": order_id, "lines": [{"sku": sku, "quantity": quantity}]},
                minute + 20,
            )
        )
        if i % 11 == 0:
            data.append(
                event(
                    f"refund-{i}",
                    "refund.issued",
                    f"REF-{10400 + i}",
                    {
                        "payment_id": payment_id,
                        "order_id": order_id,
                        "amount_cents": price,
                        "currency": "USD",
                    },
                    minute + 65,
                )
            )
    # Historical attributes change without rewriting previously accepted prices.
    data.append(
        event(
            "product-SKU-100-v2",
            "product.updated",
            "SKU-100",
            {
                "sku": "SKU-100",
                "name": "Precision driver Mk II",
                "category": "Tools",
                "unit_price_cents": 2900,
            },
            1440,
        )
    )
    if scenario == "duplicates":
        for item in list(data):
            if item["event_type"] == "payment.captured":
                clone = deepcopy(item)
                clone["ingested_at"] = (
                    datetime.fromisoformat(clone["ingested_at"]) + timedelta(days=2)
                ).isoformat()
                data.append(clone)
    elif scenario == "late_refund":
        data.append(
            event(
                "late-refund",
                "refund.issued",
                "REF-LATE",
                {
                    "payment_id": "PAY-10401",
                    "order_id": "ORD-10401",
                    "amount_cents": 4800,
                },
                900,
                arrival_delay=4320,
            )
        )
    elif scenario == "conflict":
        clone = deepcopy(next(e for e in data if e["event_id"] == "capture-1"))
        clone["payload"]["amount_cents"] += 1000
        data.append(clone)
    elif scenario == "invalid":
        bad = deepcopy(data[-1])
        bad["schema_version"] = 99
        bad["event_id"] = "invalid-schema"
        data.append(bad)
    elif scenario == "missing_payment":
        data.append(
            event(
                "refund-missing",
                "refund.issued",
                "REF-MISSING",
                {
                    "payment_id": "PAY-UNKNOWN",
                    "order_id": "ORD-10400",
                    "amount_cents": 100,
                },
                1000,
            )
        )
    elif scenario == "negative_stock":
        data.append(
            event(
                "bad-adjustment",
                "stock.adjusted",
                "ADJ-1",
                {
                    "sku": "SKU-100",
                    "quantity": -max(1000, orders * 10),
                    "reason": "Injected inventory discrepancy",
                },
                1800,
            )
        )
    return data
