import asyncio
from pathlib import Path

import pytest

import server


class _AdminDb:
    def __init__(self):
        self.calls = []

    async def admin_overview_snapshot(self):
        self.calls.append(("overview",))
        return {"metrics": {}, "generated_at": "now"}

    async def admin_analytics_snapshot(self, days):
        self.calls.append(("analytics", days))
        return {"metrics": {}, "generated_at": "now", "window_days": days}

    async def admin_users_cursor(self, **kwargs):
        self.calls.append(("users", kwargs))
        return {
            "contract_version": "admin-users-cursor/v3",
            "users": [],
            **_page(),
            "aggregates": {"matching_paying": 0},
        }

    async def admin_user_analytics_cursor(self, **kwargs):
        self.calls.append(("user-analytics", kwargs))
        return {
            "contract_version": "admin-user-analytics-cursor/v2",
            "users": [],
            **_page(),
            "summary": {},
            "onboarding_dropoff": {"by_step": [], "never_started": 0, "in_progress": 0, "completed": 0},
            "answer_distributions": [],
        }

    async def admin_applications_cursor(self, **kwargs):
        self.calls.append(("applications", kwargs))
        return {
            "contract_version": "admin-applications-cursor/v3",
            "applications": [],
            **_page(),
            "filter": kwargs.get("status_filter") or "all",
            "queue": {"active_count": 0, "items": []},
        }


def _page():
    return {
        "total": 0,
        "has_previous": False,
        "has_next": False,
        "generated_at": "2026-07-20T12:00:00+00:00",
        "model_updated_at": "2026-07-20T12:00:00+00:00",
        "canonical_changed_at": "2026-07-20T12:00:00+00:00",
        "freshness_lag_seconds": 0,
        "read_model_version": 3,
    }


def test_admin_bounded_endpoints_use_one_operation_each(monkeypatch):
    db = _AdminDb()
    monkeypatch.setattr(server, "db", db)
    admin = server.User(user_id="admin", email="admin@example.com", name="Admin")

    asyncio.run(server.admin_list_users(100, None, None, False, admin))
    asyncio.run(server.admin_user_analytics(100, None, None, admin))
    asyncio.run(server.admin_list_applications(None, None, 100, None, admin))

    assert db.calls == [
        ("users", {
            "limit": 100,
            "cursor_time": None,
            "cursor_id": None,
            "direction": "next",
            "q": None,
            "paying_only": False,
        }),
        ("user-analytics", {
            "limit": 100,
            "cursor_time": None,
            "cursor_id": None,
            "direction": "next",
            "q": None,
        }),
        ("applications", {
            "limit": 100,
            "cursor_time": None,
            "cursor_id": None,
            "direction": "next",
            "status_filter": None,
        }),
    ]


def test_admin_overview_uses_bounded_snapshot_by_default(monkeypatch):
    db = _AdminDb()
    monkeypatch.setattr(server, "db", db)
    monkeypatch.delenv("ADMIN_OVERVIEW_RPC_ENABLED", raising=False)
    monkeypatch.setenv("ADMIN_BOUNDED_RPC_ENABLED", "false")
    admin = server.User(user_id="admin", email="admin@example.com", name="Admin")

    result = asyncio.run(server.admin_overview(admin))

    assert db.calls == [("overview",)]
    assert result["metrics"] == {}


def test_admin_database_failure_is_not_a_successful_empty_result():
    class _Broken:
        table_name = "applications"

        def find(self, *_args):
            raise RuntimeError("database unavailable")

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server._admin_safe_find(_Broken()))
    assert exc.value.status_code == 503


def test_admin_contract_rollout_and_security():
    root = Path(__file__).parents[1]
    assert "ADMIN_BOUNDED_RPC_ENABLED=false" in (root / ".env.example").read_text()
    assert "ADMIN_OVERVIEW_RPC_ENABLED=true" in (root / ".env.example").read_text()
    sql = (root / "db/migrations/20260720001600_admin_bounded_contracts.sql").read_text()
    down = (root / "db/migrations/20260720001600_admin_bounded_contracts.down.sql").read_text()
    assert "SET statement_timeout = '10s'" in sql
    assert "LEAST(GREATEST(COALESCE(p_limit,100),1),500)" in sql
    assert "LEAST(COALESCE(p_window_days,30),365)" in sql
    assert "left(u.email::text,320)" in sql
    assert "left(u.name::text,256)" in sql
    assert "left(j.company::text,256)" in sql
    assert "left(j.title::text,512)" in sql
    assert "left(a.submission_status::text,64)" in sql
    assert "left(COALESCE(p_status,'all'),64)" in sql
    assert "'generated_at'" in sql
    assert "REVOKE ALL" in sql and "service_role" in sql
    assert "DROP FUNCTION IF EXISTS public.admin_overview_snapshot" in down
@pytest.mark.parametrize("legacy_field", ["tailored_resume", "cover_letter"])
def test_application_package_inference_accepts_legacy_documents(legacy_field):
    normalized = server._normalize_application_status_fields({
        "application_id": f"legacy-{legacy_field}",
        legacy_field: {"content": "present"},
    })

    assert normalized["package_status"] == "generated"


def test_admin_cursor_inputs_are_normalized_and_invalid_filters_fail_before_read(monkeypatch):
    db = _AdminDb()
    monkeypatch.setattr(server, "db", db)
    admin = server.User(user_id="admin", email="admin@example.com", name="Admin")

    asyncio.run(server.admin_list_users(25, None, "  Alice   SMITH  ", True, admin))
    asyncio.run(server.admin_list_applications(None, "prepared", 25, None, admin))
    assert db.calls == [
        ("users", {
            "limit": 25,
            "cursor_time": None,
            "cursor_id": None,
            "direction": "next",
            "q": "alice smith",
            "paying_only": True,
        }),
        ("applications", {
            "limit": 25,
            "cursor_time": None,
            "cursor_id": None,
            "direction": "next",
            "status_filter": "prepared",
        }),
    ]

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server.admin_user_analytics(100, "not-a-cursor", None, admin))
    assert exc.value.status_code == 422

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server.admin_list_applications("unknown", None, 100, None, admin))
    assert exc.value.status_code == 422
    assert len(db.calls) == 2
