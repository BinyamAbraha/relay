import pytest

from relay.scenarios import event


@pytest.fixture
def ledger():
    return [
        event(
            "product",
            "product.updated",
            "SKU-X",
            {
                "sku": "SKU-X",
                "name": "Test part",
                "category": "Parts",
                "unit_price_cents": 2500,
            },
            -10,
        ),
        event("stock", "stock.received", "RCV-X", {"sku": "SKU-X", "quantity": 10}, -5),
        event(
            "order",
            "order.accepted",
            "ORD-X",
            {
                "customer_id": "CUS-X",
                "lines": [{"sku": "SKU-X", "quantity": 2, "unit_price_cents": 2500}],
            },
            0,
        ),
        event(
            "capture",
            "payment.captured",
            "PAY-X",
            {"order_id": "ORD-X", "amount_cents": 5000},
            1,
        ),
        event(
            "ship",
            "shipment.sent",
            "SHP-X",
            {"order_id": "ORD-X", "lines": [{"sku": "SKU-X", "quantity": 2}]},
            2,
        ),
        event(
            "refund",
            "refund.issued",
            "REF-X",
            {"order_id": "ORD-X", "payment_id": "PAY-X", "amount_cents": 2500},
            1440,
        ),
    ]
