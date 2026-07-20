import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

import server
from db import supabase_adapter


class _Response:
    status_code = 200
    content = b"[]"
    text = "[]"

    def __init__(self, payload):
        self._payload = payload
        self.content = b"x"

    def json(self):
        return self._payload


class _Client:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    async def get(self, url, **kwargs):
        self.calls.append(("get", url, kwargs))
        return _Response(self.payload)

    async def post(self, url, **kwargs):
        self.calls.append(("post", url, kwargs))
        return _Response(self.payload)


def test_safe_inclusion_projection_avoids_jsonb(monkeypatch):
    client = _Client([{"job_id": "j1"}])
    monkeypatch.setattr(supabase_adapter, "_get_shared_http_client", lambda **_kwargs: client)
    collection = supabase_adapter.SupabaseCollectionAdapter("jobs", "https://db.test", "secret")

    rows = asyncio.run(
        collection.find({"job_id": "j1"}, {"_id": 0, "job_id": 1}).limit(1).to_list(1)
    )

    assert rows == [{"job_id": "j1"}]
    assert client.calls[0][2]["params"]["select"] == "job_id"


def test_critical_feed_read_rejects_local_filter_before_http(monkeypatch):
    client = _Client([])
    monkeypatch.setattr(supabase_adapter, "_get_shared_http_client", lambda **_kwargs: client)
    collection = supabase_adapter.SupabaseCollectionAdapter("jobs", "https://db.test", "secret")

    with pytest.raises(RuntimeError, match="unsupported local filter"):
        asyncio.run(
            collection.read_with_select(
                {"$or": [{"country_code": "fr"}]},
                25,
                select=supabase_adapter.JOB_FEED_LIGHT_SELECT,
                require_pushed=True,
            )
        )

    assert client.calls == []


def test_fast_feed_requires_pushable_column_filter(monkeypatch):
    calls = []

    class _Jobs:
        async def read_with_select(self, query, limit, **kwargs):
            calls.append((query, limit, kwargs))
            return [{"job_id": "j1"}]

    monkeypatch.setattr(server, "db", SimpleNamespace(jobs=_Jobs()))
    server._clear_feed_job_pool_cache()

    rows = asyncio.run(server._get_feed_job_candidates({"country_code": "fr"}, 25))

    assert rows == [{"job_id": "j1"}]
    assert calls[0][2]["require_pushed"] is True
    assert "data" not in calls[0][2]["select"].split(",")


def test_status_endpoint_uses_one_returning_rpc_when_enabled(monkeypatch):
    class _Db:
        def __init__(self):
            self.calls = []

        async def patch_user_application_status(self, application_id, user_id, status):
            self.calls.append((application_id, user_id, status))
            return {"application_id": application_id, "user_id": user_id, "status": status}

    db = _Db()
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setenv("APPLICATION_TRACKER_RPC_ENABLED", "true")

    result = asyncio.run(
        server.update_status(
            "a1",
            server.StatusUpdate(status="interview"),
            server.User(user_id="u1", email="u@example.com", name="User"),
        )
    )

    assert result == {"ok": True}
    assert db.calls == [("a1", "u1", "interview")]


def test_application_status_rpc_is_one_remote_operation(monkeypatch):
    client = _Client({"application_id": "a1", "status": "offer"})
    monkeypatch.setattr(supabase_adapter, "_get_shared_http_client", lambda **_kwargs: client)
    adapter = supabase_adapter.SupabaseDatabaseAdapter("https://db.test", "secret")

    result = asyncio.run(adapter.patch_user_application_status("a1", "u1", "offer"))

    assert result["status"] == "offer"
    assert len(client.calls) == 1
    assert client.calls[0][0] == "post"
    assert client.calls[0][1].endswith("/rpc/patch_user_application_status")


def test_tracker_migration_syncs_old_writes_and_is_service_role_only():
    sql = (
        Path(__file__).parents[1]
        / "db/migrations/20260720001300_application_tracker_contracts.sql"
    ).read_text()
    down = (
        Path(__file__).parents[1]
        / "db/migrations/20260720001300_application_tracker_contracts.down.sql"
    ).read_text()

    assert "BEFORE INSERT OR UPDATE OF data" in sql
    assert "NEW.generation_status := NULLIF(NEW.data ->> 'generation_status', '')" in sql
    assert "UPDATE public.applications SET data = data" in sql
    assert "applications_user_status_updated_idx" in sql
    assert "applications_generation_queue_idx" in sql
    assert "SET statement_timeout = '2s'" in sql
    assert "REVOKE ALL" in sql
    assert "GRANT EXECUTE" in sql and "service_role" in sql
    assert "DROP FUNCTION IF EXISTS public.patch_user_application_status" in down
