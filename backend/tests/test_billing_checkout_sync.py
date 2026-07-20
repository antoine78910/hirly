import asyncio
from pathlib import Path

import pytest
import stripe

import server


async def _async_return(value):
    return value


def test_stripe_to_dict_converts_real_stripe_object():
    """Recent stripe-python releases no longer make StripeObject a dict subclass --
    it has no .get() method at all, so calling .get() on a real SDK response
    (construct_event/.retrieve()/.list()/auto_paging_iter()) raises AttributeError
    even though our own dict-based test mocks never surface this. This is the
    exact bug that made every Stripe webhook delivery 500 in production."""
    real_subscription = stripe._stripe_object.StripeObject.construct_from(
        {
            "id": "sub_real",
            "customer": "cus_real",
            "status": "active",
            "metadata": {"plan": "monthly"},
            "items": {"data": [{"price": {"id": "price_x"}}]},
        },
        "sk_test_x",
    )
    with pytest.raises(AttributeError):
        real_subscription.get("status")

    converted = server._stripe_to_dict(real_subscription)
    assert isinstance(converted, dict)
    assert converted.get("status") == "active"
    assert isinstance(converted["items"], dict)
    assert isinstance(converted["items"]["data"][0], dict)


def test_checkout_return_url_includes_stripe_session_placeholder():
    url = server._checkout_return_url("https://app.tryhirly.com", "/swipe", "success")
    assert url == "https://app.tryhirly.com/swipe?upgrade=success&session_id={CHECKOUT_SESSION_ID}"

    cancelled = server._checkout_return_url("https://app.tryhirly.com", "/swipe", "cancelled")
    assert cancelled == "https://app.tryhirly.com/swipe?upgrade=cancelled"
    assert "{CHECKOUT_SESSION_ID}" not in cancelled


def test_checkout_session_belongs_to_user_by_reference():
    session_obj = {"client_reference_id": "user_1", "customer": "cus_123"}
    user_doc = {"user_id": "user_1", "billing": {"stripe_customer_id": "cus_123"}}
    assert asyncio.run(server._checkout_session_belongs_to_user(session_obj, user_doc)) is True


def test_checkout_session_belongs_to_user_by_customer():
    session_obj = {"customer": "cus_123"}
    user_doc = {"user_id": "user_1", "billing": {"stripe_customer_id": "cus_123"}}
    assert asyncio.run(server._checkout_session_belongs_to_user(session_obj, user_doc)) is True


def test_checkout_session_rejects_foreign_user():
    session_obj = {"client_reference_id": "user_2", "customer": "cus_999"}
    user_doc = {"user_id": "user_1", "billing": {"stripe_customer_id": "cus_123"}}
    assert asyncio.run(server._checkout_session_belongs_to_user(session_obj, user_doc)) is False


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None

    async def update_one(self, filter, update, upsert=False):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                if "$set" in update:
                    for key, value in update["$set"].items():
                        if key.startswith("billing."):
                            row.setdefault("billing", {})[key.split(".", 1)[1]] = value
                        else:
                            row[key] = value
                return {"matched_count": 1, "modified_count": 1}
        return {"matched_count": 0, "modified_count": 0}


def test_apply_checkout_session_billing_grants_credits(monkeypatch):
    users = _Collection([{"user_id": "user_1", "billing": {}}])
    monkeypatch.setattr(server, "db", type("DB", (), {"users": users})())
    monkeypatch.setattr(
        server.stripe.Subscription,
        "retrieve",
        lambda subscription_id: {
            "id": subscription_id,
            "customer": "cus_123",
            "status": "active",
            "metadata": {"plan": "pro", "interval": "monthly", "source": "app"},
            "items": {"data": [{"price": {"id": "price_unknown", "recurring": {"interval": "month"}}}]},
            "current_period_start": 1_700_000_000,
            "current_period_end": 1_700_259_200,
        },
    )

    session_obj = {
        "customer": "cus_123",
        "subscription": "sub_123",
        "payment_status": "paid",
        "client_reference_id": "user_1",
        "metadata": {"user_id": "user_1", "plan": "pro", "interval": "monthly", "source": "app"},
    }

    asyncio.run(server._apply_checkout_session_billing(session_obj))

    updated = asyncio.run(users.find_one({"user_id": "user_1"}))
    billing = updated["billing"]
    assert billing["subscription_status"] == "active"
    assert billing["credits_total"] == 200
    assert billing["credits_remaining"] == 200


def test_merge_billing_credit_state_prorated_upgrade_grants_delta():
    """Pro (200 credits) at 0 remaining upgrades mid-cycle to Ultra (600 credits) —
    same Stripe subscription and same billing-period bounds — should grant only the
    +400 difference, landing at 400/600, not a full reset to 600/600."""
    existing_billing = {
        "subscription_status": "active",
        "plan": "pro",
        "interval": "monthly",
        "source": "app",
        "stripe_subscription_id": "sub_123",
        "current_period_start": "2026-01-01T00:00:00+00:00",
        "current_period_end": "2026-02-01T00:00:00+00:00",
        "credits_total": 200,
        "credits_remaining": 0,
    }
    existing_billing["credits_period_key"] = server._billing_credit_period_key(existing_billing)

    updates = {
        "subscription_status": "active",
        "plan": "ultra",
        "interval": "monthly",
        "source": "app",
        "stripe_subscription_id": "sub_123",
        "current_period_start": "2026-01-01T00:00:00+00:00",
        "current_period_end": "2026-02-01T00:00:00+00:00",
    }

    merged = server._merge_billing_credit_state(existing_billing, updates)
    assert merged["credits_total"] == 600
    assert merged["credits_remaining"] == 400


def test_merge_billing_credit_state_prorated_upgrade_keeps_leftover_credits():
    """Same upgrade but with 50 credits left over — the delta is added on top."""
    existing_billing = {
        "subscription_status": "active",
        "plan": "pro",
        "interval": "monthly",
        "source": "app",
        "stripe_subscription_id": "sub_123",
        "current_period_start": "2026-01-01T00:00:00+00:00",
        "current_period_end": "2026-02-01T00:00:00+00:00",
        "credits_total": 200,
        "credits_remaining": 50,
    }
    existing_billing["credits_period_key"] = server._billing_credit_period_key(existing_billing)

    updates = {**existing_billing, "plan": "ultra"}
    merged = server._merge_billing_credit_state(existing_billing, updates)
    assert merged["credits_total"] == 600
    assert merged["credits_remaining"] == 450


def test_merge_billing_credit_state_renewal_still_full_resets():
    """A genuine renewal (new period bounds) still resets to the full allowance,
    even though the plan is unchanged."""
    existing_billing = {
        "subscription_status": "active",
        "plan": "pro",
        "interval": "monthly",
        "source": "app",
        "stripe_subscription_id": "sub_123",
        "current_period_start": "2026-01-01T00:00:00+00:00",
        "current_period_end": "2026-02-01T00:00:00+00:00",
        "credits_total": 200,
        "credits_remaining": 30,
    }
    existing_billing["credits_period_key"] = server._billing_credit_period_key(existing_billing)

    updates = {
        **existing_billing,
        "current_period_start": "2026-02-01T00:00:00+00:00",
        "current_period_end": "2026-03-01T00:00:00+00:00",
    }
    merged = server._merge_billing_credit_state(existing_billing, updates)
    assert merged["credits_total"] == 200
    assert merged["credits_remaining"] == 200


def test_billing_status_payload_includes_plan_tier():
    user_doc = {
        "billing": {
            "subscription_status": "active",
            "plan": "monthly",
            "credits_total": 200,
            "credits_remaining": 200,
        }
    }
    payload = server._billing_status_payload(user_doc)
    assert payload["plan_tier"] == "pro"
    assert payload["is_premium"] is True


def test_billing_credit_limit_onboarding_matches_app_tier_pricing():
    """Onboarding monthly (29.99€) grants the same 200 credits as the app's Pro tier
    at the same price; onboarding quarterly (59.99€) matches Ultra's 600."""
    assert server._billing_credit_limit("monthly", True, source="onboarding") == 200
    assert server._billing_credit_limit("quarterly", True, source="onboarding") == 600


def test_period_iso_reads_subscription_item_fields():
    subscription = {
        "items": {
            "data": [
                {
                    "current_period_start": 1_700_000_000,
                    "current_period_end": 1_700_259_200,
                }
            ]
        }
    }
    assert server._period_start_iso(subscription) == "2023-11-14T22:13:20+00:00"
    assert server._period_end_iso(subscription) == "2023-11-17T22:13:20+00:00"


def test_posthog_currency_conversion_and_semantic_uuid_are_exact():
    assert server._posthog_major_units(1234, "EUR") == 12.34
    assert server._posthog_major_units(1234, "JPY") == 1234.0
    assert server._posthog_major_units(1234, "BHD") == 1.234
    assert server._posthog_major_units(1234, "EUR", negative=True) == -12.34
    assert server._posthog_semantic_uuid("payment_succeeded", "invoice", "in_1") == (
        server._posthog_semantic_uuid("payment_succeeded", "invoice", "in_1")
    )
    assert server._posthog_semantic_uuid("payment_succeeded", "invoice", "in_1") != (
        server._posthog_semantic_uuid("payment_succeeded", "invoice", "in_2")
    )


def test_build_posthog_payment_capture_uses_stripe_fact_and_internal_user(monkeypatch):
    users = _Collection([{"user_id": "user_1"}])
    monkeypatch.setattr(server, "db", type("DB", (), {"users": users})())
    event = {
        "id": "evt_invoice",
        "type": "invoice.payment_succeeded",
        "created": 1_700_000_000,
        "data": {
            "object": {
                "id": "in_1",
                "amount_paid": 2999,
                "currency": "eur",
                "customer": "cus_1",
                "subscription": "sub_1",
                "metadata": {"user_id": "user_1", "plan": "pro"},
                "lines": {"data": [{"price": {"id": "price_1", "product": "prod_1"}}]},
            }
        },
    }
    capture = asyncio.run(server._build_posthog_payment_capture(event))
    assert capture == {
        "event": "payment_succeeded",
        "distinct_id": "user_1",
        "timestamp": "2023-11-14T22:13:20+00:00",
        "uuid": server._posthog_semantic_uuid("payment_succeeded", "invoice", "in_1"),
        "properties": {
            "revenue": 29.99,
            "currency": "EUR",
            "amount_minor": 2999,
            "stripe_event_id": "evt_invoice",
            "invoice_id": "in_1",
            "source": "stripe_webhook",
            "$process_person_profile": False,
            "product_id": "prod_1",
            "price_id": "price_1",
            "plan": "pro",
            "subscription_id": "sub_1",
        },
    }
    assert "email" not in repr(capture)


@pytest.mark.parametrize(
    ("event_type", "status", "previous_status", "expected"),
    [
        ("refund.created", "succeeded", None, True),
        ("refund.created", "pending", None, False),
        ("refund.updated", "succeeded", "pending", True),
        ("refund.updated", "succeeded", "succeeded", False),
        ("refund.updated", "succeeded", None, False),
        ("refund.failed", "failed", "pending", False),
    ],
)
def test_posthog_refund_success_confirmation_state_machine(
    event_type, status, previous_status, expected
):
    event = {
        "type": event_type,
        "data": {
            "object": {"id": "re_1", "status": status},
            "previous_attributes": (
                {"status": previous_status} if previous_status is not None else {}
            ),
        },
    }
    assert server._posthog_refund_confirms_success(event) is expected


def test_build_posthog_refund_capture_uses_partial_amount_and_confirmation_time(monkeypatch):
    users = _Collection([{"user_id": "user_1"}])
    monkeypatch.setattr(server, "db", type("DB", (), {"users": users})())
    monkeypatch.setattr(
        server,
        "_posthog_invoice_for_refund",
        lambda refund: _async_return(
            {
                "id": "in_1",
                "customer": "cus_1",
                "subscription": "sub_1",
                "metadata": {"user_id": "user_1"},
                "lines": {"data": []},
            }
        ),
    )
    event = {
        "id": "evt_refund_success",
        "type": "refund.updated",
        "created": 1_700_000_100,
        "data": {
            "object": {
                "id": "re_1",
                "status": "succeeded",
                "amount": 500,
                "currency": "eur",
            },
            "previous_attributes": {"status": "pending"},
        },
    }
    capture = asyncio.run(server._build_posthog_refund_capture(event))
    assert capture["event"] == "payment_refunded"
    assert capture["properties"]["revenue"] == -5.0
    assert capture["properties"]["amount_minor"] == 500
    assert capture["properties"]["refund_id"] == "re_1"
    assert capture["timestamp"] == "2023-11-14T22:15:00+00:00"
    assert capture["uuid"] == server._posthog_semantic_uuid(
        "payment_refunded", "refund", "re_1"
    )


def test_posthog_capture_exact_schema_timeout_and_fail_open(monkeypatch):
    monkeypatch.setenv("POSTHOG_PROJECT_API_KEY", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", "https://us.i.posthog.com")
    calls = []

    class _Response:
        def raise_for_status(self):
            return None

    class _Client:
        def __init__(self, timeout):
            self.timeout = timeout
            calls.append(("timeout", timeout))

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json):
            calls.append(("post", url, json))
            return _Response()

    monkeypatch.setattr(server.httpx, "AsyncClient", _Client)
    capture = {
        "event": "payment_succeeded",
        "distinct_id": "user_1",
        "timestamp": "2023-11-14T22:13:20+00:00",
        "uuid": "semantic-uuid",
        "properties": {
            "revenue": 29.99,
            "currency": "EUR",
            "amount_minor": 2999,
            "stripe_event_id": "evt_1",
            "invoice_id": "in_1",
            "source": "stripe_webhook",
            "$process_person_profile": False,
        },
    }
    asyncio.run(server._capture_posthog_server_event(capture))
    timeout = calls[0][1]
    assert (timeout.connect, timeout.read, timeout.write, timeout.pool) == (
        0.25,
        0.50,
        0.50,
        0.25,
    )
    assert calls[1][1] == "https://us.i.posthog.com/capture/"
    assert set(calls[1][2]) == {
        "api_key",
        "event",
        "distinct_id",
        "timestamp",
        "uuid",
        "properties",
    }

    class _FailingClient(_Client):
        async def post(self, url, json):
            raise server.httpx.ConnectError("blocked")

    monkeypatch.setattr(server.httpx, "AsyncClient", _FailingClient)
    asyncio.run(server._capture_posthog_server_event(capture))


def test_repair_premium_credits_grants_missing_allowance(monkeypatch):
    user_rows = _Collection([
        {
            "user_id": "user_1",
            "billing": {
                "subscription_status": "active",
                "plan": "monthly",
                "interval": "monthly",
                "source": "onboarding",
                "stripe_subscription_id": "sub_123",
                "credits_total": 0,
                "credits_remaining": 0,
            },
        }
    ])
    swipe_rows = _Collection([])

    class _DB:
        users = user_rows
        swipes = swipe_rows

    async def _find(query, projection=None):
        rows = []
        for row in swipe_rows.rows:
            if all(row.get(key) == value for key, value in query.items()):
                rows.append(row)
        return rows

    swipe_rows.find = _find
    monkeypatch.setattr(server, "db", _DB())

    repaired = asyncio.run(server._repair_premium_credits_if_needed("user_1", user_rows.rows[0]))
    billing = repaired["billing"]
    assert billing["credits_total"] == 200
    assert billing["credits_remaining"] == 200


def test_resolve_user_id_from_checkout_session_by_email(monkeypatch):
    users = _Collection([{"user_id": "user_1", "email": "paid@example.com", "billing": {}}])
    monkeypatch.setattr(server, "db", type("DB", (), {"users": users})())

    async def _no_customer_match(customer_id):
        return None

    monkeypatch.setattr(server, "_resolve_user_id_for_stripe_customer", _no_customer_match)

    session_obj = {
        "customer": "cus_orphan",
        "customer_details": {"email": "paid@example.com"},
    }
    resolved = asyncio.run(server._resolve_user_id_from_checkout_session(session_obj))
    assert resolved == "user_1"


def test_checkout_session_rejects_email_only_match():
    session_obj = {"customer": "cus_orphan", "customer_details": {"email": "paid@example.com"}}
    user_doc = {"user_id": "user_1", "email": "paid@example.com", "billing": {}}
    assert asyncio.run(server._checkout_session_belongs_to_user(session_obj, user_doc)) is False


def test_checkout_session_rejects_foreign_user_id_in_metadata():
    session_obj = {
        "client_reference_id": "user_old",
        "customer": "cus_123",
        "customer_details": {"email": "paid@example.com"},
    }
    user_doc = {"user_id": "user_new", "email": "paid@example.com", "billing": {}}
    assert asyncio.run(server._checkout_session_belongs_to_user(session_obj, user_doc)) is False


def test_discover_stripe_customer_requires_metadata_user_id(monkeypatch):
    monkeypatch.setattr(server, "_stripe_configured", lambda: True)
    monkeypatch.setattr(server, "_stripe_secret_key", lambda: "sk_test")
    monkeypatch.setattr(
        server.stripe.Customer,
        "list",
        lambda email, limit=10: {
            "data": [
                {"id": "cus_other", "metadata": {"user_id": "user_old"}},
            ]
        },
    )
    user_doc = {"user_id": "user_new", "email": "paid@example.com", "billing": {}}
    assert asyncio.run(server._discover_stripe_customer_for_user(user_doc)) is None


def test_stripe_object_id_handles_dict_and_string():
    assert server._stripe_object_id("pi_123") == "pi_123"
    assert server._stripe_object_id({"id": "cus_456"}) == "cus_456"
    assert server._stripe_object_id(None) is None


def test_resolve_stripe_payment_intent_context_uses_checkout_session(monkeypatch):
    monkeypatch.setattr(server, "_stripe_secret_key", lambda: "sk_test")
    monkeypatch.setattr(
        server.stripe.PaymentIntent,
        "retrieve",
        lambda payment_intent_id, expand=None: {
            "id": payment_intent_id,
            "customer": {"id": "cus_123", "email": "paid@example.com"},
            "invoice": {"subscription": {"id": "sub_123"}},
            "latest_charge": None,
        },
    )
    monkeypatch.setattr(
        server.stripe.checkout.Session,
        "list",
        lambda payment_intent, limit=1: {
            "data": [
                {
                    "client_reference_id": "user_1",
                    "customer": "cus_123",
                    "customer_details": {"email": "paid@example.com"},
                    "subscription": "sub_123",
                }
            ]
        },
    )

    context = server._resolve_stripe_payment_intent_context("pi_123")
    assert context["customer_id"] == "cus_123"
    assert context["email"] == "paid@example.com"
    assert context["subscription_id"] == "sub_123"
    assert context["user_id_hint"] == "user_1"


def test_ensure_checkout_entitlements_grants_credits_from_metadata(monkeypatch):
    user_rows = _Collection([
        {
            "user_id": "user_1",
            "billing": {"stripe_customer_id": "cus_123", "credits_total": 0, "credits_remaining": 0},
        }
    ])
    swipe_rows = _Collection([])

    class _DB:
        users = user_rows
        swipes = swipe_rows

    async def _find(query, projection=None):
        rows = []
        for row in swipe_rows.rows:
            if all(row.get(key) == value for key, value in query.items()):
                rows.append(row)
        return rows

    swipe_rows.find = _find
    monkeypatch.setattr(server, "db", _DB())

    session_obj = {
        "mode": "subscription",
        "payment_status": "paid",
        "status": "complete",
        "customer": "cus_123",
        "subscription": "sub_123",
        "metadata": {"plan": "monthly", "interval": "monthly", "source": "onboarding", "user_id": "user_1"},
    }
    asyncio.run(server._ensure_checkout_entitlements_from_session("user_1", session_obj))

    updated = asyncio.run(user_rows.find_one({"user_id": "user_1"}))
    billing = updated["billing"]
    assert billing["subscription_status"] == "active"
    assert billing["credits_total"] == 200
    assert billing["credits_remaining"] == 200


def test_stripe_reconcile_repairs_webhook_miss_without_rewriting_synced_users(monkeypatch):
    users = _Collection([
        {"user_id": "user_missing", "billing": {}},
        {
            "user_id": "user_synced",
            "billing": {
                "stripe_customer_id": "cus_synced",
                "stripe_subscription_id": "sub_synced",
                "subscription_status": "active",
                "plan": "monthly",
                "interval": "monthly",
                "source": "onboarding",
                "current_period_start": "2023-11-14T22:13:20+00:00",
                "current_period_end": "2023-11-17T22:13:20+00:00",
                "cancel_at_period_end": False,
            },
        },
    ])
    monkeypatch.setattr(server, "db", type("DB", (), {"users": users})())
    monkeypatch.setattr(server, "_stripe_configured", lambda: True)

    def _subscription(customer_id, subscription_id, user_id):
        return {
            "id": subscription_id,
            "customer": {"id": customer_id, "email": f"{user_id}@example.com"},
            "status": "active",
            "created": 1_700_000_000,
            "metadata": {
                "user_id": user_id,
                "plan": "monthly",
                "interval": "monthly",
                "source": "onboarding",
            },
            "items": {
                "data": [{
                    "price": {"id": "price_monthly", "recurring": {"interval": "month"}},
                    "current_period_start": 1_700_000_000,
                    "current_period_end": 1_700_259_200,
                }]
            },
            "cancel_at_period_end": False,
        }

    subscriptions = [
        _subscription("cus_missing", "sub_missing", "user_missing"),
        _subscription("cus_synced", "sub_synced", "user_synced"),
    ]
    monkeypatch.setattr(server, "_list_stripe_subscriptions_for_reconcile", lambda: subscriptions)

    async def _resolve(customer_id):
        return "user_missing" if customer_id == "cus_missing" else "user_synced"

    updates = []

    async def _update(user_id, values):
        updates.append((user_id, values))
        row = next(row for row in users.rows if row["user_id"] == user_id)
        row.setdefault("billing", {}).update(values)

    async def _repair(user_id, user_doc):
        return user_doc

    monkeypatch.setattr(server, "_resolve_user_id_for_stripe_customer", _resolve)
    monkeypatch.setattr(server, "_update_user_billing_by_user_id", _update)
    monkeypatch.setattr(server, "_repair_premium_credits_if_needed", _repair)

    result = asyncio.run(server._reconcile_stripe_subscriptions_once())

    assert result == {"scanned": 2, "updated": 1, "unmatched": 0}
    assert [user_id for user_id, _values in updates] == ["user_missing"]
    assert updates[0][1]["stripe_subscription_id"] == "sub_missing"
    assert updates[0][1]["subscription_status"] == "active"

def test_subscription_metadata_plan_wins_when_price_id_is_unmapped(monkeypatch):
    monkeypatch.setattr(server, "_plan_from_price", lambda _price_id: "unknown")
    subscription = {
        "id": "sub_123",
        "customer": "cus_123",
        "status": "active",
        "metadata": {"plan": "monthly", "interval": "monthly", "source": "onboarding"},
        "items": {
            "data": [{
                "price": {"id": "price_new", "recurring": {"interval": "month"}},
                "current_period_start": 1_700_000_000,
                "current_period_end": 1_700_259_200,
            }]
        },
    }

    updates = server._subscription_billing_updates(subscription)

    assert updates["plan"] == "monthly"

class _FakeRequest:
    cookies = {}


def _make_checkout_test_user():
    return server.User(user_id="user_redeemed", email="redeemed@example.com", name="Redeemed User")


def test_checkout_session_applies_signup_discount_for_referred_user(monkeypatch):
    captured = {}

    monkeypatch.setattr(server, "_stripe_secret_key", lambda: "sk_test_fake")
    monkeypatch.setattr(server, "_get_user_doc", lambda user: _async_return({"user_id": user.user_id, "billing": {}}))
    monkeypatch.setattr(server, "_stripe_customer_for_user", lambda user_doc: _async_return("cus_123"))
    monkeypatch.setattr(server, "_stripe_price_for_plan", lambda plan, interval=None, source=None: "price_123")
    monkeypatch.setattr(server, "has_redeemed_friend_referral_code", lambda db, user_id: _async_return(True))
    monkeypatch.setattr(server, "_ensure_friend_referral_signup_discount_coupon", lambda: "friend_referral_signup_25off")

    def fake_session_create(**kwargs):
        captured.update(kwargs)
        return {"url": "https://checkout.stripe.com/fake"}

    monkeypatch.setattr(server.stripe.checkout.Session, "create", fake_session_create)

    body = server.BillingCheckoutRequest(plan="monthly", source="onboarding")
    result = asyncio.run(
        server.create_billing_checkout_session(body, _FakeRequest(), _make_checkout_test_user())
    )

    assert result == {"url": "https://checkout.stripe.com/fake"}
    assert captured.get("discounts") == [{"coupon": "friend_referral_signup_25off"}]
    assert "allow_promotion_codes" not in captured


def test_checkout_session_offers_promo_box_for_non_referred_user(monkeypatch):
    captured = {}

    monkeypatch.setattr(server, "_stripe_secret_key", lambda: "sk_test_fake")
    monkeypatch.setattr(server, "_get_user_doc", lambda user: _async_return({"user_id": user.user_id, "billing": {}}))
    monkeypatch.setattr(server, "_stripe_customer_for_user", lambda user_doc: _async_return("cus_123"))
    monkeypatch.setattr(server, "_stripe_price_for_plan", lambda plan, interval=None, source=None: "price_123")
    monkeypatch.setattr(server, "has_redeemed_friend_referral_code", lambda db, user_id: _async_return(False))

    def fake_session_create(**kwargs):
        captured.update(kwargs)
        return {"url": "https://checkout.stripe.com/fake"}

    monkeypatch.setattr(server.stripe.checkout.Session, "create", fake_session_create)

    body = server.BillingCheckoutRequest(plan="monthly", source="onboarding")
    asyncio.run(
        server.create_billing_checkout_session(body, _FakeRequest(), _make_checkout_test_user())
    )

    assert captured.get("allow_promotion_codes") is True
    assert "discounts" not in captured


def _enable_posthog_revenue(monkeypatch, *, refunds=False):
    monkeypatch.setenv("POSTHOG_SERVER_API_KEY", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", "https://eu.i.posthog.com")
    monkeypatch.setenv("POSTHOG_PAYMENT_REVENUE_ENABLED", "true")
    monkeypatch.setenv("POSTHOG_REFUND_REVENUE_ENABLED", "true" if refunds else "false")


def test_posthog_env_example_documents_runtime_server_key(monkeypatch):
    env_example = Path(server.__file__).with_name(".env.example").read_text()
    assert "POSTHOG_SERVER_API_KEY=" in env_example
    assert "POSTHOG_PROJECT_API_KEY=" not in env_example

    monkeypatch.setenv("POSTHOG_SERVER_API_KEY", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", "https://eu.i.posthog.com")
    assert server._posthog_server_capture_configured() is True


def test_posthog_capture_disabled_without_token_or_host(monkeypatch):
    monkeypatch.delenv("POSTHOG_SERVER_API_KEY", raising=False)
    monkeypatch.delenv("POSTHOG_HOST", raising=False)

    class _UnexpectedClient:
        def __init__(self, **kwargs):
            raise AssertionError("disabled PostHog capture must not create an HTTP client")

    monkeypatch.setattr(server.httpx, "AsyncClient", _UnexpectedClient)
    captured = asyncio.run(
        server._capture_posthog_server_event(
            event_name="payment_succeeded",
            distinct_id="user_1",
            timestamp="2026-01-01T00:00:00Z",
            semantic_uuid="uuid",
            properties={"source": "stripe_webhook"},
        )
    )
    assert captured is False


def test_posthog_capture_exact_schema_and_timeouts(monkeypatch):
    _enable_posthog_revenue(monkeypatch)
    request = {}

    class _Response:
        status_code = 200

        def raise_for_status(self):
            return None

    class _Client:
        def __init__(self, *, timeout):
            request["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, *, json):
            request["url"] = url
            request["json"] = json
            return _Response()

    monkeypatch.setattr(server.httpx, "AsyncClient", _Client)
    result = asyncio.run(
        server._capture_posthog_server_event(
            event_name="payment_succeeded",
            distinct_id="user_1",
            timestamp="2026-01-01T00:00:00Z",
            semantic_uuid="uuid-1",
            properties={"revenue": 12.34, "$process_person_profile": False},
        )
    )

    assert result is True
    assert request["url"] == "https://eu.i.posthog.com/capture/"
    assert set(request["json"]) == {"api_key", "event", "distinct_id", "timestamp", "uuid", "properties"}
    assert request["json"]["distinct_id"] == "user_1"
    assert request["timeout"].connect == 0.25
    assert request["timeout"].read == 0.50
    assert request["timeout"].write == 0.50
    assert request["timeout"].pool == 0.25


@pytest.mark.parametrize(
    "host",
    [
        "http://eu.i.posthog.com",
        "https://evil.example",
        "https://eu.i.posthog.com?redirect=evil",
        "https://user:pass@eu.i.posthog.com",
        "https://eu.i.posthog.com:444",
        "https://eu.i.posthog.com/unapproved-path",
    ],
)
def test_posthog_capture_rejects_unapproved_or_unsafe_hosts(monkeypatch, host):
    monkeypatch.setenv("POSTHOG_SERVER_API_KEY", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", host)
    monkeypatch.delenv("POSTHOG_ALLOWED_HOSTS", raising=False)

    class _UnexpectedClient:
        def __init__(self, **kwargs):
            raise AssertionError("invalid PostHog host must not create an HTTP client")

    monkeypatch.setattr(server.httpx, "AsyncClient", _UnexpectedClient)
    assert server._posthog_server_capture_configured() is False
    assert asyncio.run(
        server._capture_posthog_server_event(
            event_name="payment_succeeded",
            distinct_id="user_1",
            timestamp="2026-01-01T00:00:00Z",
            semantic_uuid="uuid",
            properties={"source": "stripe_webhook"},
        )
    ) is False


def test_posthog_capture_allows_explicit_self_hosted_https_hostname(monkeypatch):
    monkeypatch.setenv("POSTHOG_SERVER_API_KEY", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", "https://analytics.tryhirly.com")
    monkeypatch.setenv("POSTHOG_ALLOWED_HOSTS", "analytics.tryhirly.com")
    assert server._posthog_server_capture_configured() is True
    assert server._posthog_capture_url() == "https://analytics.tryhirly.com/capture/"


def test_posthog_revenue_uuid_and_currency_conversion_are_semantic():
    payment_a = server._posthog_revenue_uuid("payment_succeeded", "invoice", "in_123")
    payment_b = server._posthog_revenue_uuid("payment_succeeded", "invoice", "in_123")
    payment_other = server._posthog_revenue_uuid("payment_succeeded", "invoice", "in_456")
    refund = server._posthog_revenue_uuid("payment_refunded", "refund", "re_123")

    assert payment_a == payment_b
    assert payment_a != payment_other
    assert payment_a != refund
    assert str(server._posthog_major_amount(1234, "EUR")) == "12.34"
    assert str(server._posthog_major_amount(1234, "JPY")) == "1234"
    assert str(server._posthog_major_amount(1234, "BHD")) == "1.234"
    with pytest.raises(ValueError, match="unsupported currency"):
        server._posthog_major_amount(1234, "ZZZ")


def test_posthog_invoice_payment_uses_stable_user_and_allowlist(monkeypatch):
    _enable_posthog_revenue(monkeypatch)
    monkeypatch.setattr(
        server,
        "_posthog_resolve_billing_user_id",
        lambda **kwargs: _async_return("user_1"),
    )
    captured = {}

    async def _capture(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(server, "_capture_posthog_server_event", _capture)
    event = {"id": "evt_invoice_1", "created": 1_700_000_000}
    invoice = {
        "id": "in_123",
        "amount_paid": 2999,
        "currency": "eur",
        "customer": "cus_123",
        "subscription": "sub_123",
        "customer_email": "private@example.com",
        "metadata": {"user_id": "user_1", "token": "secret"},
        "lines": {"data": [{"price": {"id": "price_1", "product": "prod_1"}}]},
    }

    assert asyncio.run(server._capture_posthog_invoice_payment(event, invoice)) is True
    assert captured["event_name"] == "payment_succeeded"
    assert captured["distinct_id"] == "user_1"
    assert captured["timestamp"] == "2023-11-14T22:13:20Z"
    assert captured["semantic_uuid"] == server._posthog_revenue_uuid(
        "payment_succeeded", "invoice", "in_123"
    )
    assert captured["properties"] == {
        "revenue": 29.99,
        "currency": "EUR",
        "amount_minor": 2999,
        "stripe_event_id": "evt_invoice_1",
        "invoice_id": "in_123",
        "subscription_id": "sub_123",
        "price_id": "price_1",
        "product_id": "prod_1",
        "source": "stripe_webhook",
        "$process_person_profile": False,
    }
    assert "customer_email" not in captured["properties"]
    assert "token" not in captured["properties"]


@pytest.mark.parametrize(
    ("event_type", "status", "previous_status", "expected"),
    [
        ("refund.created", "succeeded", None, True),
        ("refund.created", "pending", None, False),
        ("refund.updated", "succeeded", "pending", True),
        ("refund.updated", "succeeded", "succeeded", False),
        ("refund.updated", "succeeded", None, False),
        ("refund.failed", "failed", "pending", False),
    ],
)
def test_posthog_refund_requires_terminal_success_transition(
    event_type, status, previous_status, expected
):
    event = {
        "type": event_type,
        "data": {"previous_attributes": {} if previous_status is None else {"status": previous_status}},
    }
    assert server._posthog_refund_success_confirmed(event, {"status": status}) is expected


def test_posthog_refund_uses_partial_amount_and_negative_revenue(monkeypatch):
    _enable_posthog_revenue(monkeypatch, refunds=True)
    monkeypatch.setattr(
        server,
        "_posthog_refund_context",
        lambda refund: _async_return(
            {
                "invoice": {"id": "in_123"},
                "subscription": {},
                "invoice_id": "in_123",
                "subscription_id": "sub_123",
                "customer_id": "cus_123",
                "currency": "EUR",
                "user_id": "user_1",
            }
        ),
    )
    captured = {}

    async def _capture(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(server, "_capture_posthog_server_event", _capture)
    event = {
        "id": "evt_refund_1",
        "type": "refund.updated",
        "created": 1_700_000_100,
        "data": {"previous_attributes": {"status": "pending"}},
    }
    refund = {
        "id": "re_123",
        "status": "succeeded",
        "amount": 500,
        "amount_refunded": 2999,
    }

    assert asyncio.run(server._capture_posthog_refund(event, refund)) is True
    assert captured["event_name"] == "payment_refunded"
    assert captured["distinct_id"] == "user_1"
    assert captured["properties"]["amount_minor"] == 500
    assert captured["properties"]["revenue"] == -5.0
    assert captured["semantic_uuid"] == server._posthog_revenue_uuid(
        "payment_refunded", "refund", "re_123"
    )


def test_posthog_refund_unknown_status_does_not_block_on_stripe_retrieve(monkeypatch):
    _enable_posthog_revenue(monkeypatch, refunds=True)
    retrieved = []
    captures = []
    monkeypatch.setattr(
        server.stripe.Refund,
        "retrieve",
        lambda refund_id: retrieved.append(refund_id) or {"id": refund_id, "status": "succeeded"},
    )
    monkeypatch.setattr(
        server,
        "_capture_posthog_server_event",
        lambda **kwargs: captures.append(kwargs) or _async_return(True),
    )
    event = {
        "id": "evt_refund_unknown",
        "type": "refund.updated",
        "created": 1_700_000_100,
        "data": {"previous_attributes": {"status": "pending"}},
    }

    assert asyncio.run(server._capture_posthog_refund(event, {"id": "re_unknown"})) is False
    assert retrieved == []
    assert captures == []


def test_stripe_webhook_records_event_when_posthog_capture_fails(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    event = {
        "id": "evt_invoice_1",
        "type": "invoice.payment_succeeded",
        "created": 1_700_000_000,
        "data": {
            "object": {
                "id": "in_123",
                "customer": "cus_123",
                "subscription": None,
                "amount_paid": 2999,
                "currency": "eur",
            }
        },
    }
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", lambda *args: event)
    monkeypatch.setattr(server, "_stripe_event_already_processed", lambda event_id: _async_return(False))
    order = []

    async def _billing(customer_id, updates):
        order.append("billing")

    async def _capture(*args, **kwargs):
        order.append("capture_failed")
        return False

    async def _record(processed_event):
        order.append("record")

    monkeypatch.setattr(server, "_update_user_billing_by_customer_id", _billing)
    monkeypatch.setattr(server, "_capture_posthog_invoice_payment", _capture)
    monkeypatch.setattr(server, "_record_processed_stripe_event", _record)

    class _WebhookRequest:
        headers = {"Stripe-Signature": "signature"}

        async def body(self):
            return b"{}"

    result = asyncio.run(server.stripe_webhook(_WebhookRequest()))
    assert result == {"received": True}
    assert order == ["billing", "capture_failed", "record"]


@pytest.mark.parametrize("failure_kind", ["identity_db", "property_mapping"])
def test_stripe_invoice_webhook_acks_when_posthog_adapter_preparation_fails(
    monkeypatch, failure_kind
):
    _enable_posthog_revenue(monkeypatch)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    invoice = {
        "id": "in_analytics_failure",
        "customer": "cus_123",
        "subscription": None,
        "amount_paid": 2999,
        "currency": "eur",
        "metadata": {"user_id": "user_1"},
    }
    if failure_kind == "property_mapping":
        invoice["metadata"] = "not-a-mapping"
    event = {
        "id": f"evt_{failure_kind}",
        "type": "invoice.payment_succeeded",
        "created": 1_700_000_000,
        "data": {"object": invoice},
    }
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", lambda *args: event)
    monkeypatch.setattr(server, "_stripe_event_already_processed", lambda event_id: _async_return(False))
    monkeypatch.setattr(
        server,
        "_update_user_billing_by_customer_id",
        lambda *args, **kwargs: _async_return(None),
    )
    if failure_kind == "identity_db":
        async def _identity_failure(**kwargs):
            raise RuntimeError("database unavailable")

        monkeypatch.setattr(server, "_posthog_resolve_billing_user_id", _identity_failure)
    recorded = []
    monkeypatch.setattr(
        server,
        "_record_processed_stripe_event",
        lambda processed_event: recorded.append(processed_event["id"]) or _async_return(None),
    )

    class _WebhookRequest:
        headers = {"Stripe-Signature": "signature"}

        async def body(self):
            return b"{}"

    assert asyncio.run(server.stripe_webhook(_WebhookRequest())) == {"received": True}
    assert recorded == [f"evt_{failure_kind}"]


def test_stripe_refund_webhook_acks_when_posthog_enrichment_times_out(monkeypatch):
    _enable_posthog_revenue(monkeypatch, refunds=True)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    event = {
        "id": "evt_refund_timeout",
        "type": "refund.updated",
        "created": 1_700_000_000,
        "data": {
            "object": {
                "id": "re_timeout",
                "status": "succeeded",
                "amount": 500,
                "charge": "ch_slow",
            },
            "previous_attributes": {"status": "pending"},
        },
    }
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", lambda *args: event)
    monkeypatch.setattr(server, "_stripe_event_already_processed", lambda event_id: _async_return(False))

    async def _slow_to_thread(*args, **kwargs):
        await asyncio.sleep(server._POSTHOG_STRIPE_ENRICHMENT_TIMEOUT_SECONDS * 2)

    monkeypatch.setattr(server.asyncio, "to_thread", _slow_to_thread)
    recorded = []
    monkeypatch.setattr(
        server,
        "_record_processed_stripe_event",
        lambda processed_event: recorded.append(processed_event["id"]) or _async_return(None),
    )

    class _WebhookRequest:
        headers = {"Stripe-Signature": "signature"}

        async def body(self):
            return b"{}"

    assert asyncio.run(server.stripe_webhook(_WebhookRequest())) == {"received": True}
    assert recorded == ["evt_refund_timeout"]


def test_stripe_invoice_webhook_acks_with_invalid_posthog_host(monkeypatch):
    _enable_posthog_revenue(monkeypatch)
    monkeypatch.setenv("POSTHOG_HOST", "http://attacker.invalid")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    event = {
        "id": "evt_invalid_posthog_host",
        "type": "invoice.payment_succeeded",
        "created": 1_700_000_000,
        "data": {
            "object": {
                "id": "in_123",
                "customer": "cus_123",
                "subscription": None,
                "amount_paid": 2999,
                "currency": "eur",
            }
        },
    }
    monkeypatch.setattr(server.stripe.Webhook, "construct_event", lambda *args: event)
    monkeypatch.setattr(server, "_stripe_event_already_processed", lambda event_id: _async_return(False))
    monkeypatch.setattr(
        server,
        "_update_user_billing_by_customer_id",
        lambda *args, **kwargs: _async_return(None),
    )
    recorded = []
    monkeypatch.setattr(
        server,
        "_record_processed_stripe_event",
        lambda processed_event: recorded.append(processed_event["id"]) or _async_return(None),
    )

    class _UnexpectedClient:
        def __init__(self, **kwargs):
            raise AssertionError("invalid host must not create PostHog client")

    monkeypatch.setattr(server.httpx, "AsyncClient", _UnexpectedClient)

    class _WebhookRequest:
        headers = {"Stripe-Signature": "signature"}

        async def body(self):
            return b"{}"

    assert asyncio.run(server.stripe_webhook(_WebhookRequest())) == {"received": True}
    assert recorded == ["evt_invalid_posthog_host"]
