"""Strict event contracts and semantic business identity."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

Positive = Annotated[StrictInt, Field(gt=0, le=1_000_000_000)]
Nonnegative = Annotated[StrictInt, Field(ge=0, le=1_000_000_000)]
Identifier = Annotated[
    str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")
]


class Payload(BaseModel):
    model_config = ConfigDict(extra="allow")


class Line(Payload):
    sku: Identifier
    quantity: Positive
    unit_price_cents: Nonnegative


class Order(Payload):
    lines: Annotated[list[Line], Field(min_length=1, max_length=100)]
    customer_id: Identifier
    currency: Literal["USD"] = "USD"

    @model_validator(mode="after")
    def unique_skus(self):
        if len({line.sku for line in self.lines}) != len(self.lines):
            raise ValueError("order lines must have unique SKUs")
        return self


class Capture(Payload):
    order_id: Identifier
    amount_cents: Positive
    currency: Literal["USD"] = "USD"


class Refund(Payload):
    payment_id: Identifier
    order_id: Identifier
    amount_cents: Positive
    currency: Literal["USD"] = "USD"


class ShipmentLine(Payload):
    sku: Identifier
    quantity: Positive


class Shipment(Payload):
    order_id: Identifier
    lines: Annotated[list[ShipmentLine], Field(min_length=1, max_length=100)]


class Receipt(Payload):
    sku: Identifier
    quantity: Positive


class Adjustment(Payload):
    sku: Identifier
    quantity: Annotated[StrictInt, Field(ge=-1_000_000_000, le=1_000_000_000)]
    reason: Annotated[str, Field(min_length=1, max_length=250)]


class Product(Payload):
    sku: Identifier
    name: Annotated[str, Field(min_length=1, max_length=120)]
    category: Annotated[str, Field(min_length=1, max_length=80)]
    unit_price_cents: Nonnegative


PAYLOADS = {
    "order.accepted": Order,
    "payment.captured": Capture,
    "refund.issued": Refund,
    "shipment.sent": Shipment,
    "stock.received": Receipt,
    "stock.adjusted": Adjustment,
    "product.updated": Product,
}


class Event(BaseModel):
    model_config = ConfigDict(extra="allow")
    source: Identifier
    event_id: Identifier
    event_type: Literal[
        "order.accepted",
        "payment.captured",
        "refund.issued",
        "shipment.sent",
        "stock.received",
        "stock.adjusted",
        "product.updated",
    ]
    schema_version: Literal[1]
    occurred_at: datetime
    ingested_at: datetime
    entity_id: Identifier
    payload: dict

    @field_validator("schema_version", mode="before")
    @classmethod
    def strict_version(cls, value):
        if type(value) is not int:
            raise ValueError("schema_version must be an integer")
        return value

    @field_validator("occurred_at", "ingested_at", mode="before")
    @classmethod
    def explicit_timestamp(cls, value):
        if not isinstance(value, (str, datetime)):
            raise ValueError(  # noqa: TRY004 - Pydantic requires validation errors
                "timestamp must be an ISO string with an explicit timezone"
            )
        return value

    @field_validator("occurred_at", "ingested_at")
    @classmethod
    def aware_timestamp(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must contain a timezone offset")
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def validate_payload(self):
        self.payload = (
            PAYLOADS[self.event_type].model_validate(self.payload).model_dump()
        )
        return self

    @property
    def identity(self) -> tuple[str, str]:
        return self.source, self.event_id

    def business_hash(self) -> str:
        data = self.model_dump(mode="json", exclude={"ingested_at"})
        return hashlib.sha256(canonical(data)).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()


def content_hash(value) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()
