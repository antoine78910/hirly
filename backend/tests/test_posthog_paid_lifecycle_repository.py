from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import asyncpg
import pytest

import database
from database import PostHogPaidLifecycleRepository


NOW = datetime(2026, 7, 21, tzinfo=timezone.utc)
TOKEN = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
EVENT_UUID = UUID("bbbbbbbb-bbbb-5bbb-8bbb-bbbbbbbbbbbb")


class FakeConnection:
    def __init__(self):
        self.queries = []
        self.fetchrow_result = None
        self.fetch_result = []
        self.fetchval_result = False
        self.error = None

    def _record(self, query, arguments):
        self.queries.append((" ".join(query.split()), arguments))
        if self.error:
            raise self.error

    async def fetchrow(self, query, *arguments):
        self._record(query, arguments)
        return self.fetchrow_result

    async def fetch(self, query, *arguments):
        self._record(query, arguments)
        return self.fetch_result

    async def fetchval(self, query, *arguments):
        self._record(query, arguments)
        return self.fetchval_result

    async def execute(self, query, *arguments):
        self._record(query, arguments)


class Acquire:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return False


class FakePool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return Acquire(self.connection)

    async def close(self):
        pass


@pytest.mark.asyncio
async def test_repository_maps_records_and_calls_only_private_functions():
    connection = FakeConnection()
    repository = PostHogPaidLifecycleRepository(FakePool(connection))
    connection.fetchrow_result = {
        "invoice_key": "invoice-paid:evt_1",
        "paid_generation_key": "paid:sub_1:1",
        "activation_key": "activation:11111111-1111-4111-8111-111111111111",
        "churn_key": None,
        "generation": 1,
        "watermark_advanced": True,
        "activation_created": True,
        "churn_created": False,
    }

    result = await repository.record_paid_invoice(
        user_id="11111111-1111-4111-8111-111111111111",
        subscription_id="sub_1",
        invoice_id="in_1",
        stripe_event_id="evt_1",
        stripe_event_type="invoice.payment_succeeded",
        source_occurred_at=NOW,
        currency="eur",
        revenue=Decimal("19.99"),
        billing_reason="subscription_create",
    )

    assert result.generation == 1
    assert result.activation_created is True
    query, arguments = connection.queries[-1]
    assert "analytics_private.record_posthog_paid_invoice" in query
    assert "posthog_paid_lifecycle_evidence" not in query
    assert arguments[7] == Decimal("19.99")

    connection.fetchrow_result = {
        "state_key": "subscription-state:evt_2",
        "paid_generation_key": "paid:sub_1:1",
        "churn_key": "end:sub_1:1",
        "generation": 1,
        "watermark_advanced": True,
        "churn_created": True,
    }
    state = await repository.record_subscription_state(
        user_id="11111111-1111-4111-8111-111111111111",
        subscription_id="sub_1",
        stripe_event_id="evt_2",
        stripe_event_type="customer.subscription.deleted",
        source_occurred_at=NOW,
        status="canceled",
        loss_occurred_at=NOW,
        reason="customer_requested",
    )
    assert state.generation == 1
    assert state.churn_created is True
    assert "analytics_private.record_posthog_subscription_state" in connection.queries[-1][0]


@pytest.mark.asyncio
async def test_repository_maps_claim_generation_and_surfaces_false_fences():
    connection = FakeConnection()
    repository = PostHogPaidLifecycleRepository(FakePool(connection))
    connection.fetch_result = [{
        "fact_key": "end:sub_1:1",
        "event_name": "subscription_churned",
        "posthog_uuid": EVENT_UUID,
        "payload": '{"properties":{"generation":1}}',
        "status": "claimed",
        "attempt_count": 2,
        "next_attempt_at": NOW,
        "lease_owner": "worker-a",
        "lease_token": TOKEN,
        "lease_generation": 3,
        "lease_expires_at": NOW,
    }]

    [delivery] = await repository.claim_due(
        owner="worker-a", limit=10, lease_seconds=60
    )
    assert delivery.lease_generation == 3
    assert delivery.lease_token == TOKEN
    assert delivery.payload["properties"]["generation"] == 1

    connection.fetchval_result = False
    assert await repository.mark_sent(
        fact_key=delivery.fact_key,
        owner=delivery.lease_owner,
        token=delivery.lease_token,
        generation=delivery.lease_generation,
    ) is False
    assert "analytics_private.mark_posthog_paid_lifecycle_sent" in connection.queries[-1][0]


@pytest.mark.asyncio
async def test_repository_fails_closed_when_migration_is_absent():
    connection = FakeConnection()
    connection.error = asyncpg.UndefinedFunctionError("missing")
    repository = PostHogPaidLifecycleRepository(FakePool(connection))

    with pytest.raises(RuntimeError, match="20260721002000 is required"):
        await repository.claim_due(owner="worker-a", limit=1, lease_seconds=60)

    connection.error = None
    connection.fetchval_result = False
    with pytest.raises(RuntimeError, match="20260721002000 is required"):
        await repository.verify_migration()


@pytest.mark.asyncio
async def test_init_db_does_not_require_paid_lifecycle_migration_when_disabled(monkeypatch):
    connection = FakeConnection()
    pool = FakePool(connection)
    monkeypatch.setattr(database, "db", None)
    monkeypatch.setattr(database, "_pool", None)
    monkeypatch.setenv("DATABASE_URL", "postgresql://local/test")
    monkeypatch.delenv("POSTHOG_PAID_LIFECYCLE_ENABLED", raising=False)

    async def create_pool(*_args, **_kwargs):
        return pool

    monkeypatch.setattr(database.asyncpg, "create_pool", create_pool)

    async def unexpected_verification(_repository):
        pytest.fail("disabled startup must not verify the paid lifecycle migration")

    monkeypatch.setattr(
        database.PostHogPaidLifecycleRepository,
        "verify_migration",
        unexpected_verification,
    )

    initialized = await database.init_db()

    assert initialized.posthog_paid_lifecycle is not None
