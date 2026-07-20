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

    async def admin_users_page(self, **kwargs):
        self.calls.append(("users", kwargs))
        return {"users": [], "generated_at": "now", **kwargs}

    async def admin_applications_page(self, **kwargs):
        self.calls.append(("applications", kwargs))
        return {"applications": [], "generated_at": "now", **kwargs}


def test_admin_bounded_endpoints_use_one_operation_each(monkeypatch):
    db = _AdminDb()
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setenv("ADMIN_BOUNDED_RPC_ENABLED", "true")
    admin = server.User(user_id="admin", email="admin@example.com", name="Admin")

    asyncio.run(server.admin_overview(admin))
    asyncio.run(server.admin_analytics(30, admin))
    asyncio.run(server.admin_list_users(2, 100, 30, admin))
    asyncio.run(server.admin_list_applications(None, None, 2, 100, 30, admin))

    assert db.calls == [
        ("overview",),
        ("analytics", 30),
        ("users", {"page": 2, "page_size": 100, "window_days": 30}),
        ("applications", {"page": 2, "page_size": 100, "window_days": 30, "status_filter": None}),
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
