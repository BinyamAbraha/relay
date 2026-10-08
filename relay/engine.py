"""Pure batch interpretation followed by SQL materialization and reconciliation."""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import duckdb
from pydantic import ValidationError

from relay.domain import Event, content_hash

TRANSFORM_VERSION = "relay-v1"


def rows(connection, sql):
    cursor = connection.execute(sql)
    names = [c[0] for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def bulk_insert(connection, table, data, types):
    """Pass one JSON parameter, avoiding per-cell Python-to-DuckDB conversion."""
    projections = ", ".join(
        f"CAST(json_extract_string(value, '$[{index}]') AS {kind})"
        for index, kind in enumerate(types)
    )
    connection.execute(
        f"INSERT INTO {table} SELECT {projections} FROM json_each(?)",
        [json.dumps(data, default=str, separators=(",", ":"))],
    )


def evaluate(raw: list[dict], output: Path | None = None) -> dict:
    """Rebuild one self-contained batch. Rejected/pending inputs block publication."""
    grouped = defaultdict(list)
    exceptions = []
    for index, item in enumerate(raw):
        try:
            parsed = Event.model_validate(item)
            grouped[parsed.identity].append((parsed, index + 1))
        except (ValidationError, ValueError, TypeError) as exc:
            exceptions.append(
                {
                    "code": "invalid_schema",
                    "event_id": str(item.get("event_id", "unknown"))
                    if isinstance(item, dict)
                    else "unknown",
                    "line": index + 1,
                    "message": str(exc)[:1200],
                    "severity": "quarantined",
                }
            )
    accepted = []
    duplicates = 0
    for identity, candidates in sorted(grouped.items()):
        hashes = {e.business_hash() for e, _ in candidates}
        if len(hashes) != 1:
            for e, line in candidates:
                exceptions.append(
                    {
                        "code": "identity_conflict",
                        "event_id": e.event_id,
                        "line": line,
                        "message": "Same source/event ID carries different business content; all variants excluded.",
                        "severity": "quarantined",
                    }
                )
            continue
        # Earliest arrival is a deterministic representative; content ignores arrival.
        e, line = min(candidates, key=lambda x: (x[0].ingested_at, x[1]))
        accepted.append((e, line))
        duplicates += len(candidates) - 1
    accepted.sort(
        key=lambda pair: (pair[0].occurred_at, pair[0].source, pair[0].event_id)
    )
    events = [e for e, _ in accepted]
    lines = {e.identity: line for e, line in accepted}

    def issue(e, code, message, severity="blocked"):
        exceptions.append(
            {
                "code": code,
                "event_id": e.event_id,
                "line": lines[e.identity],
                "message": message,
                "severity": severity,
            }
        )

    # Business entity IDs are globally unique within a type in this one-source domain.
    entities = defaultdict(list)
    for e in events:
        if e.event_type != "product.updated":
            entities[(e.event_type, e.entity_id)].append(e)
    for candidates in entities.values():
        if len(candidates) > 1:
            for e in candidates:
                issue(
                    e,
                    "entity_conflict",
                    "Multiple events claim the same business entity.",
                )

    orders = {e.entity_id: e for e in events if e.event_type == "order.accepted"}
    captures = {e.entity_id: e for e in events if e.event_type == "payment.captured"}
    products = defaultdict(list)
    for e in events:
        if e.event_type == "product.updated":
            products[e.payload["sku"]].append(e)
    for sku, versions in products.items():
        times = defaultdict(list)
        for e in versions:
            times[e.occurred_at].append(e)
        for same_time in times.values():
            if len(same_time) > 1:
                for e in same_time:
                    issue(
                        e,
                        "product_version_conflict",
                        f"Ambiguous effective product version for {sku}.",
                    )

    refund_sums = defaultdict(int)
    shipped = defaultdict(int)
    related = defaultdict(list)
    postings, movements, order_rows, event_rows = [], [], [], []
    reference = {"booked_cents": 0, "captured_cents": 0, "refunded_cents": 0}
    stock_reference = defaultdict(int)
    for e in events:
        p = e.payload
        at = e.occurred_at.replace(tzinfo=None)
        booked = captured = refunded = 0
        order_id = (
            e.entity_id if e.event_type == "order.accepted" else p.get("order_id")
        )
        if order_id:
            related[order_id].append(
                {
                    **e.model_dump(mode="json"),
                    "input_line": lines[e.identity],
                    "business_hash": e.business_hash(),
                }
            )
        if e.event_type == "order.accepted":
            booked = sum(
                line["quantity"] * line["unit_price_cents"] for line in p["lines"]
            )
            reference["booked_cents"] += booked
            for line in p["lines"]:
                versions = [
                    v for v in products[line["sku"]] if v.occurred_at <= e.occurred_at
                ]
                version = (
                    max(versions, key=lambda v: (v.occurred_at, v.event_id))
                    if versions
                    else None
                )
                if version is None:
                    issue(
                        e,
                        "missing_product",
                        f"No product version effective for {line['sku']} at order time.",
                        "pending",
                    )
                order_rows.append(
                    {
                        "order_id": e.entity_id,
                        "customer_id": p["customer_id"],
                        "sku": line["sku"],
                        "product": version.payload["name"] if version else line["sku"],
                        "product_event_id": version.event_id if version else None,
                        "quantity": line["quantity"],
                        "unit_price_cents": line["unit_price_cents"],
                        "booked_cents": line["quantity"] * line["unit_price_cents"],
                        "occurred_at": e.occurred_at.isoformat(),
                        "input_event_id": e.event_id,
                    }
                )
        elif e.event_type == "payment.captured":
            captured = p["amount_cents"]
            reference["captured_cents"] += captured
            if p["order_id"] not in orders:
                issue(
                    e,
                    "missing_order",
                    f"Order {p['order_id']} has not arrived.",
                    "pending",
                )
        elif e.event_type == "refund.issued":
            refunded = p["amount_cents"]
            reference["refunded_cents"] += refunded
            payment = captures.get(p["payment_id"])
            if not payment:
                issue(
                    e,
                    "missing_payment",
                    f"Payment {p['payment_id']} has not arrived.",
                    "pending",
                )
            elif payment.payload["order_id"] != p["order_id"]:
                issue(
                    e,
                    "refund_order_mismatch",
                    "Refund order does not match its captured payment.",
                )
            refund_sums[p["payment_id"]] += refunded
        elif e.event_type == "shipment.sent":
            order = orders.get(p["order_id"])
            if order is None:
                issue(
                    e,
                    "missing_order",
                    f"Order {p['order_id']} has not arrived.",
                    "pending",
                )
            for line in p["lines"]:
                shipped[(p["order_id"], line["sku"])] += line["quantity"]
                movements.append((e.event_id, line["sku"], -line["quantity"], at))
                stock_reference[line["sku"]] -= line["quantity"]
        elif e.event_type in ("stock.received", "stock.adjusted"):
            movements.append((e.event_id, p["sku"], p["quantity"], at))
            stock_reference[p["sku"]] += p["quantity"]
        postings.append((e.event_id, at, booked, captured, refunded))
        event_rows.append(
            (
                e.source,
                e.event_id,
                e.event_type,
                e.entity_id,
                e.occurred_at.isoformat(),
                e.ingested_at.isoformat(),
                json.dumps(p, sort_keys=True),
                lines[e.identity],
                e.business_hash(),
            )
        )

    for payment_id, amount in refund_sums.items():
        if (
            payment_id in captures
            and amount > captures[payment_id].payload["amount_cents"]
        ):
            issue(
                captures[payment_id],
                "over_refund",
                f"Refunds {amount} exceed captured amount {captures[payment_id].payload['amount_cents']} cents.",
            )
    for (order_id, sku), quantity in shipped.items():
        if order_id in orders:
            ordered = sum(
                line["quantity"]
                for line in orders[order_id].payload["lines"]
                if line["sku"] == sku
            )
            if quantity > ordered:
                issue(
                    orders[order_id],
                    "over_shipment",
                    f"Shipped {quantity} of {sku}, ordered {ordered}.",
                )
    for sku in stock_reference:
        if sku not in products:
            exceptions.append(
                {
                    "code": "missing_product",
                    "event_id": sku,
                    "line": None,
                    "message": f"Stock movement has no product definition for {sku}.",
                    "severity": "pending",
                }
            )

    con = duckdb.connect()
    try:
        con.execute("SET threads=2")
        con.execute("SET memory_limit='512MB'")
        con.execute(
            "CREATE TABLE postings(event_id VARCHAR, occurred_at TIMESTAMP, booked_cents BIGINT, captured_cents BIGINT, refunded_cents BIGINT)"
        )
        con.execute(
            "CREATE TABLE movements(event_id VARCHAR, sku VARCHAR, quantity BIGINT, occurred_at TIMESTAMP)"
        )
        con.execute(
            "CREATE TABLE events(source VARCHAR, event_id VARCHAR, event_type VARCHAR, entity_id VARCHAR, occurred_at VARCHAR, ingested_at VARCHAR, payload VARCHAR, input_line BIGINT, business_hash VARCHAR)"
        )
        if postings:
            bulk_insert(
                con,
                "postings",
                postings,
                ["VARCHAR", "TIMESTAMP", "BIGINT", "BIGINT", "BIGINT"],
            )
            bulk_insert(
                con, "events", event_rows, ["VARCHAR"] * 7 + ["BIGINT", "VARCHAR"]
            )
        if movements:
            bulk_insert(
                con,
                "movements",
                movements,
                ["VARCHAR", "VARCHAR", "BIGINT", "TIMESTAMP"],
            )
        con.execute((Path(__file__).parent / "sql/reporting.sql").read_text())
        daily = rows(con, "SELECT * FROM daily")
        inventory = rows(con, "SELECT * FROM inventory")
        for item in inventory:
            item["product"] = (
                max(products[item["sku"]], key=lambda e: e.occurred_at).payload["name"]
                if products[item["sku"]]
                else item["sku"]
            )
        negative = [i for i in inventory if i["on_hand"] < 0]
        for i in negative:
            exceptions.append(
                {
                    "code": "negative_stock",
                    "event_id": i["sku"],
                    "line": None,
                    "message": f"{i['sku']} has {i['on_hand']} units on hand.",
                    "severity": "blocked",
                }
            )
        # Validate temporal stock as well as final stock. Same-timestamp movements are one group.
        temporal = rows(
            con,
            "SELECT sku, occurred_at, SUM(SUM(quantity)) OVER (PARTITION BY sku ORDER BY occurred_at) AS balance FROM movements GROUP BY sku, occurred_at",
        )
        for i in temporal:
            if i["balance"] < 0 and not any(
                x["code"] == "negative_stock" and x["event_id"] == i["sku"]
                for x in exceptions
            ):
                exceptions.append(
                    {
                        "code": "negative_stock",
                        "event_id": i["sku"],
                        "line": None,
                        "message": f"Historical stock fell below zero at {i['occurred_at']}.",
                        "severity": "blocked",
                    }
                )
        totals = {
            key: sum(day[key] for day in daily)
            for key in (*reference.keys(), "net_cents")
        }
        checks = []
        for key, expected in reference.items():
            observed = totals[key]
            checks.append(
                {
                    "id": key,
                    "name": {
                        "booked_cents": "Accepted order value",
                        "captured_cents": "Captured cash",
                        "refunded_cents": "Refunds issued",
                    }[key],
                    "expected": expected,
                    "observed": observed,
                    "difference": observed - expected,
                    "unit": "cents",
                    "passed": expected == observed,
                    "description": "SQL aggregate compared with a separate Python fold over validated unique source events.",
                }
            )
        inventory_delta = sum(
            abs(i["on_hand"] - stock_reference[i["sku"]]) for i in inventory
        )
        checks.append(
            {
                "id": "stock_ledger",
                "name": "Inventory ledger",
                "expected": 0,
                "observed": inventory_delta,
                "difference": inventory_delta,
                "unit": "units",
                "passed": inventory_delta == 0,
                "description": "Sum of absolute per-SKU differences between SQL stock and source movement totals.",
            }
        )
        checks.append(
            {
                "id": "publication_gate",
                "name": "Publication readiness",
                "expected": 0,
                "observed": len(exceptions),
                "difference": len(exceptions),
                "unit": "exceptions",
                "passed": not exceptions,
                "description": "All schema, identity, prerequisite, refund, shipment, and inventory exceptions must be resolved.",
            }
        )
        lines_by_order = defaultdict(list)
        for line in order_rows:
            lines_by_order[line["order_id"]].append(line)
        order_summaries = []
        for oid, order in sorted(orders.items()):
            related_events = related[oid]
            capture_total = sum(
                e["payload"]["amount_cents"]
                for e in related_events
                if e["event_type"] == "payment.captured"
            )
            refund_total = sum(
                e["payload"]["amount_cents"]
                for e in related_events
                if e["event_type"] == "refund.issued"
            )
            order_summaries.append(
                {
                    "order_id": oid,
                    "customer_id": order.payload["customer_id"],
                    "occurred_at": order.occurred_at.isoformat(),
                    "booked_cents": sum(
                        l["quantity"] * l["unit_price_cents"]
                        for l in order.payload["lines"]
                    ),
                    "captured_cents": capture_total,
                    "refunded_cents": refund_total,
                    "net_cents": capture_total - refund_total,
                    "events": related_events,
                    "lines": lines_by_order[oid],
                }
            )
        business = {
            "totals": totals,
            "daily": daily,
            "inventory": inventory,
            "order_lines": order_rows,
        }
        report = {
            **business,
            "fingerprint": content_hash(business),
            "input_count": len(raw),
            "accepted_count": len(events),
            "duplicate_count": duplicates,
            "exceptions": exceptions,
            "checks": checks,
            "orders": order_summaries,
            "can_publish": all(c["passed"] for c in checks),
            "event_time_min": min(
                (e.occurred_at.isoformat() for e in events), default=None
            ),
            "event_time_max": max(
                (e.occurred_at.isoformat() for e in events), default=None
            ),
            "arrival_time_max": max(
                (e.ingested_at.isoformat() for e in events), default=None
            ),
            "transform_version": TRANSFORM_VERSION,
        }
        if output is not None:
            output.mkdir(parents=True, exist_ok=True)
            for table in ("events", "daily", "inventory", "postings", "movements"):
                path = str(output / f"{table}.parquet").replace("'", "''")
                con.execute(
                    f"COPY {table} TO '{path}' (FORMAT PARQUET, COMPRESSION ZSTD)"
                )
        return report
    finally:
        con.close()
