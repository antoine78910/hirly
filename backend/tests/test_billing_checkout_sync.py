import asyncio

import pytest

import server


def test_checkout_return_url_includes_stripe_session_placeholder():
    url = server._checkout_return_url("https://app.tryhirly.com", "/swipe", "success")
    assert url == "https://app.tryhirly.com/swipe?upgrade=success&session_id={CHECKOUT_SESSION_ID}"

    cancelled = server._checkout_return_url("https://app.tryhirly.com", "/swipe", "cancelled")
    assert cancelled == "https://app.tryhirly.com/swipe?upgrade=cancelled"
    assert "{CHECKOUT_SESSION_ID}" not in cancelled


def test_checkout_session_belongs_to_user_by_reference():
    session_obj = {"client_reference_id": "user_1", "customer": "cus_123"}
    user_doc = {"user_id": "user_1", "billing": {"stripe_customer_id": "cus_123"}}
    assert server._checkout_session_belongs_to_user(session_obj, user_doc) is True


def test_checkout_session_belongs_to_user_by_customer():
    session_obj = {"customer": "cus_123"}
    user_doc = {"user_id": "user_1", "billing": {"stripe_customer_id": "cus_123"}}
    assert server._checkout_session_belongs_to_user(session_obj, user_doc) is True


def test_checkout_session_rejects_foreign_user():
    session_obj = {"client_reference_id": "user_2", "customer": "cus_999"}
    user_doc = {"user_id": "user_1", "billing": {"stripe_customer_id": "cus_123"}}
    assert server._checkout_session_belongs_to_user(session_obj, user_doc) is False


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
