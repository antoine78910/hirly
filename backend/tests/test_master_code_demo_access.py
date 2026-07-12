import asyncio

import server


def _install_master_code_fakes(monkeypatch):
    calls = {"demo": [], "profile": []}

    monkeypatch.setattr(server, "_is_master_billing_code", lambda code: code == "123456")

    async def grant(user_id, plan, *, interval=None, source=None):
        return {"plan": plan, "is_premium": True}

    async def set_demo(user_id, enabled):
        calls["demo"].append((user_id, enabled))

    async def ensure_profile(user_id):
        calls["profile"].append(user_id)

    monkeypatch.setattr(server, "_grant_master_billing_access", grant)
    monkeypatch.setattr(server, "_set_user_demo_account", set_demo)
    monkeypatch.setattr(server, "_ensure_demo_feed_profile", ensure_profile)
    return calls


def test_billing_master_code_grants_demo_access(monkeypatch):
    calls = _install_master_code_fakes(monkeypatch)
    user = server.User(user_id="user_1", email="user@example.com", name="User")

    result = asyncio.run(server.redeem_billing_master_code(
        server.BillingMasterCodeRequest(code="123456", plan="ultra"),
        user=user,
    ))

    assert result["master_code"] is True
    assert result["demo_account"] is True
    assert calls == {"demo": [("user_1", True)], "profile": ["user_1"]}


def test_onboarding_master_code_grants_demo_access(monkeypatch):
    calls = _install_master_code_fakes(monkeypatch)
    user = server.User(user_id="user_2", email="user2@example.com", name="User Two")

    result = asyncio.run(server.redeem_creator_invite(
        {"code": "123456", "plan": "monthly", "source": "onboarding"},
        user=user,
    ))

    assert result["master_code"] is True
    assert result["demo_account"] is True
    assert calls == {"demo": [("user_2", True)], "profile": ["user_2"]}
