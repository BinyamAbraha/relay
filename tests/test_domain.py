from copy import deepcopy

import pytest
from pydantic import ValidationError

from relay.domain import Event


@pytest.mark.parametrize("value", [25.0, "2500", True, -1, 0])
def test_capture_rejects_nonpositive_or_noninteger_money(ledger, value):
    item = deepcopy(ledger[3])
    item["payload"]["amount_cents"] = value
    with pytest.raises(ValidationError):
        Event.model_validate(item)


def test_timezone_required(ledger):
    ledger[0]["occurred_at"] = "2026-09-14T08:00:00"
    with pytest.raises(ValidationError):
        Event.model_validate(ledger[0])


def test_utc_normalization(ledger):
    ledger[0]["occurred_at"] = "2026-09-14T01:00:00+01:00"
    assert Event.model_validate(ledger[0]).occurred_at.hour == 0


def test_arrival_does_not_change_business_identity(ledger):
    a = Event.model_validate(ledger[3])
    ledger[3]["ingested_at"] = "2026-10-01T00:00:00Z"
    b = Event.model_validate(ledger[3])
    assert a.business_hash() == b.business_hash()


@pytest.mark.parametrize("version", [True, 1.0, "1", 2])
def test_schema_is_strict(ledger, version):
    ledger[0]["schema_version"] = version
    with pytest.raises(ValidationError):
        Event.model_validate(ledger[0])
