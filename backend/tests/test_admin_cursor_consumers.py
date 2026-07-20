import asyncio
import hashlib
import hmac
import json

import pytest

import server
from db.supabase_adapter import SupabaseDatabaseAdapter


NOW = "2026-07-20T12:00:00+00:00"


def _cursor_payload(version, rows_key, rows=None, **extra):
    rows = rows or []
    return {
        "contract_version": version,
        rows_key: rows,
        "total": len(rows),
        "has_previous": False,
        "has_next": False,
        "generated_at": NOW,
        "model_updated_at": NOW,
        "canonical_changed_at": NOW,
        "freshness_lag_seconds": 0,
        "read_model_version": 3,
        **extra,
    }


class _AdminCursorDb:
    def __init__(self):
        self.calls = []
        self.users_payload = _cursor_payload(
            "admin-users-cursor/v3",
            "users",
            aggregates={"matching_paying": 0},
        )
        self.analytics_payload = _cursor_payload(
            "admin-user-analytics-cursor/v2",
            "users",
            summary={
                "total_users": 0,
                "onboarding_completed": 0,
                "onboarding_in_progress": 0,
                "onboarding_never_started": 0,
                "avg_time_spent_minutes": 0,
                "total_swipes": 0,
                "total_applications": 0,
            },
            onboarding_dropoff={
                "by_step": [],
                "never_started": 0,
                "in_progress": 0,
                "completed": 0,
            },
            answer_distributions=[],
        )
        self.applications_payload = _cursor_payload(
            "admin-applications-cursor/v3",
            "applications",
            queue={"active_count": 0, "items": []},
        )

    async def admin_users_cursor(self, **kwargs):
        self.calls.append(("users", kwargs))
        return self.users_payload

    async def admin_user_analytics_cursor(self, **kwargs):
        self.calls.append(("analytics", kwargs))
        return self.analytics_payload

    async def admin_applications_cursor(self, **kwargs):
        self.calls.append(("applications", kwargs))
        return self.applications_payload


class _RpcRecorder:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    async def _python_ingestion_rpc(self, name, payload):
        self.calls.append((name, payload))
        return self.payload


def _admin():
    return server.User(user_id="admin", email="admin@example.com", name="Admin")


def test_routes_use_one_cursor_rpc_and_normalize_scopes(monkeypatch):
    database = _AdminCursorDb()
    monkeypatch.setattr(server, "db", database)

    asyncio.run(server.admin_list_users(25, None, "  Alice   SMITH  ", True, _admin()))
    asyncio.run(server.admin_user_analytics(25, None, None, _admin()))
    asyncio.run(server.admin_list_applications(None, "prepared", 25, None, _admin()))

    assert database.calls == [
        ("users", {
            "limit": 25,
            "cursor_time": None,
            "cursor_id": None,
            "direction": "next",
            "q": "alice smith",
            "paying_only": True,
        }),
        ("analytics", {
            "limit": 25,
            "cursor_time": None,
            "cursor_id": None,
            "direction": "next",
            "q": None,
        }),
        ("applications", {
            "limit": 25,
            "cursor_time": None,
            "cursor_id": None,
            "direction": "next",
            "status_filter": "prepared",
        }),
    ]


def test_signed_cursor_round_trip_and_scope_tamper_fail_before_rpc(monkeypatch):
    monkeypatch.setenv("ADMIN_CURSOR_SECRET", "test-only-admin-cursor-secret")
    database = _AdminCursorDb()
    database.users_payload = _cursor_payload(
        "admin-users-cursor/v3",
        "users",
        rows=[
            {"user_id": "u1", "last_active_at": "2026-07-20T12:00:00+00:00"},
            {"user_id": "u2", "last_active_at": "2026-07-20T11:00:00+00:00"},
        ],
        total=3,
        has_next=True,
        aggregates={"matching_paying": 1},
    )
    monkeypatch.setattr(server, "db", database)

    first = asyncio.run(server.admin_list_users(2, None, None, False, _admin()))
    assert first["previous_cursor"] is None
    assert isinstance(first["next_cursor"], str)

    asyncio.run(server.admin_list_users(2, first["next_cursor"], None, False, _admin()))
    assert database.calls[-1][1] == {
        "limit": 2,
        "cursor_time": "2026-07-20T11:00:00+00:00",
        "cursor_id": "u2",
        "direction": "next",
        "q": None,
        "paying_only": False,
    }
    calls_before_invalid = len(database.calls)

    tampered = first["next_cursor"][:-1] + ("A" if first["next_cursor"][-1] != "A" else "B")
    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server.admin_list_users(2, tampered, None, False, _admin()))
    assert exc.value.status_code == 422

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server.admin_list_users(2, first["next_cursor"], "different scope", False, _admin()))
    assert exc.value.status_code == 422
    assert len(database.calls) == calls_before_invalid


def test_impossible_cursor_date_is_422_before_rpc(monkeypatch):
    secret = "test-only-admin-cursor-secret"
    monkeypatch.setenv("ADMIN_CURSOR_SECRET", secret)
    database = _AdminCursorDb()
    monkeypatch.setattr(server, "db", database)
    scope_hash = server._admin_cursor_scope_hash("users", 100, q=None, paying_only=False)
    payload = {
        "v": 1,
        "resource": "users",
        "direction": "next",
        "last_active_at": "2026-02-30T12:00:00+00:00",
        "id": "u1",
        "scope_hash": scope_hash,
    }
    unsigned = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    payload["sig"] = server._admin_base64url_encode(
        hmac.new(secret.encode(), unsigned, hashlib.sha256).digest()
    )
    token = server._admin_base64url_encode(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    )

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server.admin_list_users(100, token, None, False, _admin()))
    assert exc.value.status_code == 422
    assert database.calls == []


def test_non_ready_read_model_maps_to_503(monkeypatch):
    class _NotReady:
        async def admin_users_cursor(self, **_kwargs):
            raise RuntimeError("55000: admin read model unavailable")

    monkeypatch.setattr(server, "db", _NotReady())
    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(server._admin_bounded_read(
            "admin_users_cursor",
            limit=100,
            cursor_time=None,
            cursor_id=None,
            direction="next",
            q=None,
            paying_only=False,
        ))
    assert exc.value.status_code == 503


def test_adapter_calls_exact_cursor_rpcs_and_rejects_bad_freshness():
    users = _RpcRecorder(_cursor_payload(
        "admin-users-cursor/v3",
        "users",
        aggregates={"matching_paying": 0},
    ))
    asyncio.run(SupabaseDatabaseAdapter.admin_users_cursor(
        users,
        limit=100,
        cursor_time=None,
        cursor_id=None,
        direction="next",
        q="alice",
        paying_only=True,
    ))
    assert users.calls == [("admin_users_cursor_v3", {
        "p_limit": 100,
        "p_cursor_time": None,
        "p_cursor_id": None,
        "p_direction": "next",
        "p_q": "alice",
        "p_paying_only": True,
    })]

    invalid = _cursor_payload(
        "admin-users-cursor/v3",
        "users",
        aggregates={"matching_paying": 0},
        canonical_changed_at="2026-02-30T12:00:00+00:00",
    )
    with pytest.raises(RuntimeError, match="canonical_changed_at"):
        asyncio.run(SupabaseDatabaseAdapter.admin_users_cursor(
            _RpcRecorder(invalid),
            limit=100,
            cursor_time=None,
            cursor_id=None,
            direction="next",
            q=None,
            paying_only=False,
        ))
