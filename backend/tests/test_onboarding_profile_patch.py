import asyncio
from pathlib import Path
from types import SimpleNamespace

import server


class _Db:
    def __init__(self):
        self.calls = []

    async def patch_onboarding_profile(self, user_id, **patch):
        self.calls.append((user_id, patch))
        return {
            "user_id": user_id,
            "extras": patch["extras"],
            "contact": patch["contact"],
            **patch["preferences"],
        }


def test_onboarding_patch_is_one_atomic_mutation_and_forces_authenticated_email(monkeypatch):
    db = _Db()
    monkeypatch.setattr(server, "db", db)
    user = server.User(user_id="u1", email="real@example.com", name="Real")
    body = server.OnboardingProfilePatch(
        onboarding={"last_step": "contactPhone"},
        preferences={"target_role": "Engineer"},
        contact={"email": "attacker@example.com", "phone": "+33123456789"},
    )

    result = asyncio.run(server.patch_onboarding_profile(body, user))

    assert len(db.calls) == 1
    user_id, patch = db.calls[0]
    assert user_id == "u1"
    assert patch["extras"] == {"onboarding": {"last_step": "contactPhone"}}
    assert patch["contact"]["email"] == "real@example.com"
    assert result["profile"]["target_role"] == "Engineer"


def test_onboarding_patch_fails_closed_without_atomic_contract(monkeypatch):
    monkeypatch.setattr(server, "db", SimpleNamespace())
    user = server.User(user_id="u1", email="real@example.com", name="Real")

    try:
        asyncio.run(server.patch_onboarding_profile(server.OnboardingProfilePatch(), user))
    except server.HTTPException as exc:
        assert exc.status_code == 503
    else:
        raise AssertionError("missing atomic contract must fail closed")


def test_onboarding_migration_merges_sections_and_is_service_role_only():
    sql = (
        Path(__file__).parents[1]
        / "db/migrations/20260720001200_onboarding_profile_patch.sql"
    ).read_text()

    assert "ON CONFLICT (user_id) DO UPDATE" in sql
    assert "public.profiles.data -> 'extras'" in sql
    assert "public.profiles.data -> 'contact'" in sql
    assert "SET statement_timeout = '2s'" in sql
    assert "REVOKE ALL" in sql
    assert "GRANT EXECUTE" in sql and "service_role" in sql
