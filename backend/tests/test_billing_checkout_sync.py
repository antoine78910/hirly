import asyncio

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
