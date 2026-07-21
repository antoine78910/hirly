import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest

import server


USER_ID = "abcdefab-cdef-4abc-8def-abcdefabcdef"
NOW = datetime(2026, 7, 21, 12, 0, tzinfo=timezone.utc)
LEASE_TOKEN = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
EVENT_UUID = UUID("bbbbbbbb-bbbb-5bbb-8bbb-bbbbbbbbbbbb")


def _event(event_id, event_type, occurred_at=NOW):
    return {
        "id": event_id,
        "type": event_type,
        "created": int(occurred_at.timestamp()),
    }


def _invoice(**overrides):
    invoice = {
        "id": "in_1",
        "subscription": "sub_1",
        "customer": "cus_1",
        "amount_paid": 1999,
        "currency": "eur",
        "billing_reason": "subscription_create",
        "customer_email": "private@example.com",
        "metadata": {"user_id": USER_ID, "plan": "pro", "token": "secret"},
    }
    invoice.update(overrides)
    return invoice


def _delivery(*, payload=None, attempt_count=1, fact_key="activation:fact"):
    return server.PostHogPaidLifecycleDelivery(
        fact_key=fact_key,
        event_name="subscription_activated",
        posthog_uuid=EVENT_UUID,
        payload=payload
        if payload is not None
        else {
            "distinct_id": USER_ID,
            "timestamp": NOW.isoformat(),
            "properties": {
                "invoice_id": "in_1",
                "subscription_id": "sub_1",
                "currency": "eur",
                "revenue": 19.99,
            },
        },
        status="claimed",
        attempt_count=attempt_count,
        next_attempt_at=NOW - timedelta(seconds=5),
        lease_owner="worker-a",
        lease_token=LEASE_TOKEN,
        lease_generation=3,
        lease_expires_at=NOW + timedelta(seconds=30),
    )


class RecordingRepository:
    def __init__(self):
        self.invoice_calls = []
        self.state_calls = []
        self.transitions = []

    async def record_paid_invoice(self, **kwargs):
        self.invoice_calls.append(kwargs)
        return SimpleNamespace(
            generation=1,
            activation_created=len(self.invoice_calls) == 1,
            churn_created=False,
        )

    async def record_subscription_state(self, **kwargs):
        self.state_calls.append(kwargs)
        return SimpleNamespace(generation=1, churn_created=bool(kwargs["loss_occurred_at"]))

    async def mark_sent(self, **kwargs):
        self.transitions.append(("sent", kwargs))
        return True

    async def retry(self, **kwargs):
        self.transitions.append(("retrying", kwargs))
        return True

    async def block(self, **kwargs):
        self.transitions.append(("blocked", kwargs))
        return True


@pytest.fixture(autouse=True)
def _reset_runtime(monkeypatch):
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", None)
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_pool", None)
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_task", None)
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_stop", None)


@pytest.mark.asyncio
async def test_repository_none_keeps_paid_lifecycle_adapters_default_off(monkeypatch):
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: pytest.fail("disabled adapters must return before identity lookup"),
    )

    assert not await server._record_posthog_paid_invoice_lifecycle(
        _event("evt_disabled_invoice", "invoice.payment_succeeded"), _invoice()
    )
    assert not await server._record_posthog_subscription_lifecycle(
        _event("evt_disabled_subscription", "customer.subscription.updated"),
        {"id": "sub_1", "status": "past_due"},
    )


@pytest.mark.asyncio
async def test_positive_paid_invoice_uses_canonical_identity_and_no_pii(monkeypatch):
    repository = RecordingRepository()
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", repository)
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: asyncio.sleep(0, result=USER_ID),
    )

    assert await server._record_posthog_paid_invoice_lifecycle(
        _event("evt_1", "invoice.payment_succeeded"), _invoice()
    )

    [recorded] = repository.invoice_calls
    assert recorded["user_id"] == USER_ID
    assert recorded["revenue"] == server.Decimal("19.99")
    assert recorded["currency"] == "eur"
    assert recorded["plan"] == "pro"
    assert recorded["billing_reason"] == "subscription_create"
    serialized = json.dumps(recorded, default=str)
    assert "private@example.com" not in serialized
    assert "secret" not in serialized


@pytest.mark.asyncio
async def test_invalid_or_non_lowercase_identity_never_reaches_repository(monkeypatch):
    repository = RecordingRepository()
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", repository)
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: asyncio.sleep(0, result=USER_ID.upper()),
    )

    assert not await server._record_posthog_paid_invoice_lifecycle(
        _event("evt_upper", "invoice.payment_succeeded"), _invoice()
    )
    assert repository.invoice_calls == []


@pytest.mark.asyncio
async def test_duplicate_out_of_order_concurrent_invoices_leave_first_seen_to_sql(monkeypatch):
    repository = RecordingRepository()
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", repository)
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: asyncio.sleep(0, result=USER_ID),
    )
    later = NOW + timedelta(hours=2)
    earlier = NOW

    results = await asyncio.gather(
        server._record_posthog_paid_invoice_lifecycle(
            _event("evt_later", "invoice.payment_succeeded", later),
            _invoice(id="in_later"),
        ),
        server._record_posthog_paid_invoice_lifecycle(
            _event("evt_earlier", "invoice.payment_succeeded", earlier),
            _invoice(id="in_earlier"),
        ),
        server._record_posthog_paid_invoice_lifecycle(
            _event("evt_later", "invoice.payment_succeeded", later),
            _invoice(id="in_later"),
        ),
    )

    assert results == [True, True, True]
    assert {call["stripe_event_id"] for call in repository.invoice_calls} == {
        "evt_later",
        "evt_earlier",
    }
    assert repository.invoice_calls[0]["stripe_event_id"] == "evt_later"
    assert sum(call["source_occurred_at"] == later for call in repository.invoice_calls) == 2


@pytest.mark.parametrize(
    ("event_type", "status", "ended_at", "period_end", "expected_status", "expected_loss"),
    [
        ("customer.subscription.updated", "active", None, None, "active", None),
        ("customer.subscription.updated", "past_due", None, None, "past_due", NOW),
        (
            "customer.subscription.updated",
            "unpaid",
            int((NOW - timedelta(minutes=5)).timestamp()),
            None,
            "unpaid",
            NOW - timedelta(minutes=5),
        ),
        (
            "customer.subscription.updated",
            "paused",
            int((NOW + timedelta(minutes=5)).timestamp()),
            int((NOW - timedelta(minutes=1)).timestamp()),
            "paused",
            NOW - timedelta(minutes=1),
        ),
        (
            "customer.subscription.deleted",
            "active",
            None,
            None,
            "canceled",
            NOW,
        ),
    ],
)
def test_terminal_status_and_loss_time_mapping(
    event_type, status, ended_at, period_end, expected_status, expected_loss
):
    mapped_status, loss = server._posthog_paid_lifecycle_loss_time(
        {
            "status": status,
            "ended_at": ended_at,
            "current_period_end": period_end,
            "cancel_at_period_end": True,
        },
        event_type=event_type,
        source_occurred_at=NOW,
    )

    assert mapped_status == expected_status
    assert loss == expected_loss


@pytest.mark.asyncio
async def test_generation_reactivation_observations_are_forwarded_without_snapshot_inference(
    monkeypatch,
):
    repository = RecordingRepository()
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", repository)
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: asyncio.sleep(0, result=USER_ID),
    )
    ended = NOW + timedelta(days=30)
    reactivated = ended + timedelta(days=1)
    repaid = ended + timedelta(days=2)

    await server._record_posthog_paid_invoice_lifecycle(
        _event("evt_paid_1", "invoice.payment_succeeded", NOW), _invoice()
    )
    await server._record_posthog_subscription_lifecycle(
        _event("evt_end_1", "customer.subscription.deleted", ended),
        {"id": "sub_1", "customer": "cus_1", "status": "canceled"},
    )
    await server._record_posthog_subscription_lifecycle(
        _event("evt_active_2", "customer.subscription.updated", reactivated),
        {"id": "sub_1", "customer": "cus_1", "status": "active"},
    )
    await server._record_posthog_paid_invoice_lifecycle(
        _event("evt_paid_2", "invoice.payment_succeeded", repaid),
        _invoice(id="in_2"),
    )

    assert repository.state_calls[0]["loss_occurred_at"] == ended
    assert repository.state_calls[1]["loss_occurred_at"] is None
    assert repository.invoice_calls[1]["source_occurred_at"] == repaid
    assert all("generation" not in call for call in repository.invoice_calls)


def test_governed_delivery_preserves_uuid_and_rejects_pii():
    capture = server._governed_posthog_paid_lifecycle_capture(_delivery())
    assert capture["distinct_id"] == USER_ID
    assert capture["uuid"] == str(EVENT_UUID)
    assert capture["properties"]["timestamp_quality"] == "exact_business_timestamp"

    invalid = _delivery()
    invalid.payload["properties"]["email"] = "private@example.com"
    with pytest.raises(server._PostHogPaidLifecycleInvalidPayload):
        server._governed_posthog_paid_lifecycle_capture(invalid)

    with pytest.raises(server._PostHogPaidLifecycleInvalidPayload):
        server._governed_posthog_paid_lifecycle_capture(_delivery(payload={}))


@pytest.mark.asyncio
async def test_invalid_governed_payload_is_blocked_with_lease_fence(monkeypatch):
    repository = RecordingRepository()
    invalid = _delivery()
    invalid.payload["distinct_id"] = USER_ID.upper()

    await server._dispatch_posthog_paid_lifecycle_delivery(repository, invalid)

    [(transition, kwargs)] = repository.transitions
    assert transition == "blocked"
    assert kwargs["token"] == LEASE_TOKEN
    assert kwargs["generation"] == 3


@pytest.mark.asyncio
async def test_transient_delivery_retries_with_deterministic_capped_jitter(monkeypatch):
    repository = RecordingRepository()
    delivery = _delivery(attempt_count=4, fact_key="end:sub_1:1")
    monkeypatch.setenv("POSTHOG_PAID_LIFECYCLE_RETRY_BASE_SECONDS", "5")
    monkeypatch.setenv("POSTHOG_PAID_LIFECYCLE_RETRY_CAP_SECONDS", "20")

    async def retryable(_delivery):
        raise server._PostHogPaidLifecycleRetryableDelivery("http_429")

    monkeypatch.setattr(server, "_send_posthog_paid_lifecycle_delivery", retryable)
    before = datetime.now(timezone.utc)
    await server._dispatch_posthog_paid_lifecycle_delivery(repository, delivery)
    after = datetime.now(timezone.utc)

    [(transition, kwargs)] = repository.transitions
    assert transition == "retrying"
    delay = (kwargs["next_attempt_at"] - before).total_seconds()
    assert 14.9 <= delay <= 20.1
    assert kwargs["next_attempt_at"] <= after + timedelta(seconds=20.1)
    assert server._posthog_paid_lifecycle_retry_delay_seconds("end:sub_1:1", 4) == server._posthog_paid_lifecycle_retry_delay_seconds("end:sub_1:1", 4)


@pytest.mark.asyncio
async def test_worker_crash_leaves_claim_for_sql_lease_recovery(monkeypatch):
    repository = RecordingRepository()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def hanging(_delivery):
        entered.set()
        await release.wait()

    monkeypatch.setattr(server, "_send_posthog_paid_lifecycle_delivery", hanging)
    task = asyncio.create_task(
        server._dispatch_posthog_paid_lifecycle_delivery(repository, _delivery())
    )
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert repository.transitions == []


@pytest.mark.asyncio
async def test_delivery_batches_are_processed_concurrently_with_fenced_results(monkeypatch):
    repository = RecordingRepository()
    deliveries = [_delivery(fact_key=f"activation:{index}") for index in range(3)]

    async def claim_due(**_kwargs):
        claimed = list(deliveries)
        deliveries.clear()
        return claimed

    repository.claim_due = claim_due
    active = 0
    peak = 0

    async def send(_delivery):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0)
        active -= 1

    monkeypatch.setattr(server, "_send_posthog_paid_lifecycle_delivery", send)

    assert await server._dispatch_posthog_paid_lifecycle_once(repository, "worker-a") == 3
    assert peak == 3
    assert [transition for transition, _kwargs in repository.transitions] == [
        "sent",
        "sent",
        "sent",
    ]


@pytest.mark.asyncio
async def test_subscription_webhook_enqueues_before_snapshot_and_never_dispatches(monkeypatch):
    repository = RecordingRepository()
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", repository)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    event = {
        **_event("evt_terminal", "customer.subscription.deleted"),
        "data": {
            "object": {
                "id": "sub_1",
                "customer": "cus_1",
                "status": "canceled",
                "metadata": {"user_id": USER_ID},
            }
        },
    }
    order = []

    async def record_state(**kwargs):
        order.append("lifecycle")
        return await RecordingRepository.record_subscription_state(repository, **kwargs)

    async def update_snapshot(*_args, **_kwargs):
        order.append("billing_snapshot")

    async def record_processed(_event):
        order.append("processed")

    repository.record_subscription_state = record_state
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", lambda *_args: event)
    monkeypatch.setattr(
        server, "_stripe_event_already_processed", lambda _event_id: asyncio.sleep(0, result=False)
    )
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: asyncio.sleep(0, result=USER_ID),
    )
    monkeypatch.setattr(server, "_handle_subscription_event", update_snapshot)
    monkeypatch.setattr(server, "_record_processed_stripe_event", record_processed)
    monkeypatch.setattr(
        server,
        "_send_posthog_paid_lifecycle_delivery",
        lambda _delivery: pytest.fail("webhook must not dispatch lifecycle network calls"),
    )

    request = SimpleNamespace(
        headers={"Stripe-Signature": "signature"},
        body=lambda: asyncio.sleep(0, result=b"{}"),
    )
    assert await server.stripe_webhook(request) == {"received": True}
    assert order == ["lifecycle", "billing_snapshot", "processed"]


@pytest.mark.asyncio
async def test_invoice_webhook_preserves_payment_capture_after_durable_enqueue(monkeypatch):
    repository = RecordingRepository()
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", repository)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    event = {
        **_event("evt_invoice", "invoice.payment_succeeded"),
        "data": {"object": _invoice()},
    }
    order = []

    async def record_invoice(**kwargs):
        order.append("lifecycle")
        return await RecordingRepository.record_paid_invoice(repository, **kwargs)

    repository.record_paid_invoice = record_invoice
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", lambda *_args: event)
    monkeypatch.setattr(
        server, "_stripe_event_already_processed", lambda _event_id: asyncio.sleep(0, result=False)
    )
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: asyncio.sleep(0, result=USER_ID),
    )
    monkeypatch.setattr(
        server.stripe.Subscription,
        "retrieve",
        lambda _subscription_id: {
            "id": "sub_1",
            "customer": "cus_1",
            "status": "active",
        },
    )
    monkeypatch.setattr(
        server,
        "_handle_subscription_event",
        lambda *_args, **_kwargs: asyncio.sleep(0, result=order.append("billing_snapshot")),
    )
    monkeypatch.setattr(server, "_posthog_revenue_enabled", lambda kind: kind == "payment")
    monkeypatch.setattr(
        server,
        "_build_posthog_payment_capture",
        lambda _event: asyncio.sleep(0, result={"event": "payment_succeeded"}),
    )
    monkeypatch.setattr(
        server,
        "_capture_posthog_server_event",
        lambda _capture: asyncio.sleep(0, result=order.append("payment_capture")),
    )
    monkeypatch.setattr(
        server,
        "_record_processed_stripe_event",
        lambda _event: asyncio.sleep(0, result=order.append("processed")),
    )

    request = SimpleNamespace(
        headers={"Stripe-Signature": "signature"},
        body=lambda: asyncio.sleep(0, result=b"{}"),
    )
    assert await server.stripe_webhook(request) == {"received": True}
    assert order == ["billing_snapshot", "lifecycle", "payment_capture", "processed"]


@pytest.mark.asyncio
async def test_invoice_repository_failure_returns_500_without_marking_processed(monkeypatch):
    repository = RecordingRepository()
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", repository)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    event = {
        **_event("evt_invoice_failure", "invoice.payment_succeeded"),
        "data": {"object": _invoice()},
    }

    async def fail_invoice(**_kwargs):
        raise RuntimeError("repository unavailable")

    repository.record_paid_invoice = fail_invoice
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", lambda *_args: event)
    monkeypatch.setattr(
        server, "_stripe_event_already_processed", lambda _event_id: asyncio.sleep(0, result=False)
    )
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: asyncio.sleep(0, result=USER_ID),
    )
    monkeypatch.setattr(
        server.stripe.Subscription,
        "retrieve",
        lambda _subscription_id: {"id": "sub_1", "customer": "cus_1", "status": "active"},
    )
    monkeypatch.setattr(
        server, "_handle_subscription_event", lambda *_args, **_kwargs: asyncio.sleep(0)
    )
    monkeypatch.setattr(server, "_posthog_revenue_enabled", lambda _kind: False)
    processed = []
    monkeypatch.setattr(
        server,
        "_record_processed_stripe_event",
        lambda processed_event: processed.append(processed_event["id"]) or asyncio.sleep(0),
    )

    request = SimpleNamespace(
        headers={"Stripe-Signature": "signature"},
        body=lambda: asyncio.sleep(0, result=b"{}"),
    )
    with pytest.raises(server.HTTPException) as exc_info:
        await server.stripe_webhook(request)

    assert exc_info.value.status_code == 500
    assert processed == []


@pytest.mark.asyncio
async def test_subscription_repository_failure_returns_500_without_marking_processed(monkeypatch):
    repository = RecordingRepository()
    monkeypatch.setattr(server, "_posthog_paid_lifecycle_repository", repository)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    event = {
        **_event("evt_subscription_failure", "customer.subscription.updated"),
        "data": {
            "object": {
                "id": "sub_1",
                "customer": "cus_1",
                "status": "past_due",
                "metadata": {"user_id": USER_ID},
            }
        },
    }

    async def fail_subscription(**_kwargs):
        raise RuntimeError("repository unavailable")

    repository.record_subscription_state = fail_subscription
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", lambda *_args: event)
    monkeypatch.setattr(
        server, "_stripe_event_already_processed", lambda _event_id: asyncio.sleep(0, result=False)
    )
    monkeypatch.setattr(
        server,
        "_resolve_posthog_user_id",
        lambda **_kwargs: asyncio.sleep(0, result=USER_ID),
    )
    monkeypatch.setattr(
        server, "_handle_subscription_event", lambda *_args, **_kwargs: asyncio.sleep(0)
    )
    processed = []
    monkeypatch.setattr(
        server,
        "_record_processed_stripe_event",
        lambda processed_event: processed.append(processed_event["id"]) or asyncio.sleep(0),
    )

    request = SimpleNamespace(
        headers={"Stripe-Signature": "signature"},
        body=lambda: asyncio.sleep(0, result=b"{}"),
    )
    with pytest.raises(server.HTTPException) as exc_info:
        await server.stripe_webhook(request)

    assert exc_info.value.status_code == 500
    assert processed == []


@pytest.mark.asyncio
async def test_runtime_verifies_migration_resumes_dispatcher_and_closes_pool(monkeypatch):
    calls = []

    class Pool:
        async def close(self):
            calls.append("pool_closed")

    class Repository:
        async def verify_migration(self):
            calls.append("migration_verified")

        async def claim_due(self, **_kwargs):
            calls.append("claim_due")
            return []

    pool = Pool()
    repository = Repository()

    async def create_pool(**kwargs):
        calls.append(("create_pool", kwargs["dsn"]))
        return pool

    monkeypatch.setenv("POSTHOG_PAID_LIFECYCLE_ENABLED", "true")
    monkeypatch.setattr(server.db, "db_url", "postgresql://lifecycle")
    monkeypatch.setattr(server.asyncpg, "create_pool", create_pool)
    monkeypatch.setattr(server, "PostHogPaidLifecycleRepository", lambda _pool: repository)
    monkeypatch.setenv("POSTHOG_PAID_LIFECYCLE_POLL_SECONDS", "0.1")

    assert await server._start_posthog_paid_lifecycle_runtime()
    await asyncio.sleep(0)
    await server._stop_posthog_paid_lifecycle_runtime()

    assert calls[0] == ("create_pool", "postgresql://lifecycle")
    assert "migration_verified" in calls
    assert "claim_due" in calls
    assert calls[-1] == "pool_closed"
