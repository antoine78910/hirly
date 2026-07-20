import asyncio
import json

import httpx

import db.supabase_adapter as adapter
from db.supabase_adapter import (
    SupabaseCollectionAdapter,
    SupabaseCursorAdapter,
    _http_get_with_retries,
    _postgrest_filter_params,
    database_journey,
    upsert_supabase_documents,
)


class _Response:
    status_code = 200
    text = ""

    def __init__(self, rows):
        self._rows = rows
        self.content = json.dumps(rows).encode("utf-8")

    def json(self):
        return self._rows


def test_postgrest_filter_params_supports_registered_scalar_operators():
    assert _postgrest_filter_params(
        "analytics_events",
        {
            "event": "cta_signup_clicked",
            "created_at": {"$gte": "2026-07-20T00:00:00Z"},
            "anonymous_id": {"$in": ["anon_1", "anon two"]},
        },
    ) == {
        "event": "eq.cta_signup_clicked",
        "created_at": "gte.2026-07-20T00:00:00Z",
        "anonymous_id": 'in.(anon_1,"anon two")',
    }


def test_postgrest_filter_params_rejects_unregistered_or_logical_filters():
    assert _postgrest_filter_params("analytics_events", {"properties.plan": "pro"}) is None
    assert _postgrest_filter_params("analytics_events", {"$or": [{"event": "a"}, {"event": "b"}]}) is None
    assert _postgrest_filter_params("analytics_events", {"event": {"$ne": "landing_view"}}) is None


def test_cursor_characterizes_local_projection_without_mutating_source(monkeypatch):
    source = [{"event_id": "evt_1", "event": "landing_view", "properties": {"plan": "pro"}}]

    async def _read(*_args, **_kwargs):
        return source

    collection = SupabaseCollectionAdapter(
        "analytics_events",
        supabase_url="https://example.supabase.co",
        secret_key="secret",
    )
    monkeypatch.setattr(collection, "_read_documents", _read)

    rows = asyncio.run(
        SupabaseCursorAdapter(collection, {}, {"event": 1, "_id": 0}).to_list(10)
    )

    assert rows == [{"event": "landing_view"}]
    assert source[0]["properties"] == {"plan": "pro"}


def test_read_metrics_include_journey_pushdown_counts_and_no_filter_values(monkeypatch, caplog):
    class _Client:
        async def get(self, *_args, **_kwargs):
            return _Response([{"data": {"event_id": "evt_1", "event": "cta_signup_clicked"}}])

    monkeypatch.setattr(adapter, "_get_shared_http_client", lambda *_args, **_kwargs: _Client())
    collection = SupabaseCollectionAdapter(
        "analytics_events",
        supabase_url="https://example.supabase.co",
        secret_key="secret",
    )

    with caplog.at_level("INFO", logger=adapter.__name__), database_journey("landing"):
        rows = asyncio.run(collection._read_documents({"event": "cta_signup_clicked"}, 1))

    assert rows == [{"event_id": "evt_1", "event": "cta_signup_clicked"}]
    read_line = next(
        record.message for record in caplog.records if '"operation":"read_documents"' in record.message
    )
    metric = json.loads(read_line.split("db_adapter_metric ", 1)[1])
    assert metric == {
        "elapsed_ms": metric["elapsed_ms"],
        "filter_status": "pushed",
        "journey": "landing",
        "operation": "read_documents",
        "remote_request_count": 1,
        "response_bytes": len(_Response([{"data": {"event_id": "evt_1", "event": "cta_signup_clicked"}}]).content),
        "retry_count": 0,
        "rows_fetched": 1,
        "rows_returned": 1,
        "status": "ok",
        "table": "analytics_events",
        "transport_request_count": 0,
        "transport_response_bytes": 0,
        "transport_retry_count": 0,
    }
    assert "cta_signup_clicked" not in read_line


def test_http_get_retry_metric_counts_attempts_without_logging_headers(monkeypatch, caplog):
    class _Client:
        calls = 0

        async def get(self, *_args, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                raise httpx.ReadTimeout("slow")
            return _Response([])

    async def _no_sleep(_seconds):
        return None

    monkeypatch.setattr(adapter.asyncio, "sleep", _no_sleep)
    client = _Client()
    with caplog.at_level("INFO", logger=adapter.__name__), database_journey("landing"):
        asyncio.run(
            _http_get_with_retries(
                client,
                "https://example.supabase.co/rest/v1/analytics_events",
                params={"event": "eq.private"},
                headers={"Authorization": "Bearer secret"},
                attempts=2,
            )
        )

    metric_line = next(
        record.message for record in caplog.records if '"operation":"http_get"' in record.message
    )
    metric = json.loads(metric_line.split("db_adapter_metric ", 1)[1])
    assert metric["remote_request_count"] == 0
    assert metric["transport_request_count"] == 2
    assert metric["retry_count"] == 0
    assert metric["transport_retry_count"] == 1
    assert metric["journey"] == "landing"
    assert "secret" not in metric_line
    assert "private" not in metric_line


def test_fast_upsert_avoids_read_before_write(monkeypatch):
    collection = SupabaseCollectionAdapter(
        "analytics_events",
        supabase_url="https://example.supabase.co",
        secret_key="secret",
    )

    async def _unexpected_read(*_args, **_kwargs):
        raise AssertionError("fast upsert must not read first")

    async def _upsert(*_args, **_kwargs):
        return {"ok": True, "rows": 1, "error": None}

    monkeypatch.setattr(collection, "find_one", _unexpected_read)
    monkeypatch.setattr(adapter, "upsert_supabase_documents", _upsert)

    result = asyncio.run(
        collection.update_one(
            {"event_id": "evt_1"},
            {"$set": {"event": "cta_signup_clicked"}},
            upsert=True,
        )
    )

    assert result.modified_count == 1
    assert result.upserted_id == "evt_1"


def test_bulk_update_characterizes_one_update_per_matched_document(monkeypatch):
    collection = SupabaseCollectionAdapter(
        "analytics_events",
        supabase_url="https://example.supabase.co",
        secret_key="secret",
    )
    calls = []

    async def _read(*_args, **_kwargs):
        return [{"event_id": "evt_1"}, {"event_id": "evt_2"}]

    async def _update(filter, update, upsert=False):
        calls.append((filter, update, upsert))

    monkeypatch.setattr(collection, "_read_documents", _read)
    monkeypatch.setattr(collection, "update_one", _update)

    result = asyncio.run(
        collection.update_many(
            {"event": "landing_view"},
            {"$set": {"source": "landing"}},
        )
    )

    assert result.matched_count == 2
    assert result.modified_count == 2
    assert [call[0] for call in calls] == [
        {"event_id": "evt_1"},
        {"event_id": "evt_2"},
    ]


def test_insert_many_can_atomically_ignore_conflicts_without_changing_default(monkeypatch):
    prefers = []

    class _Client:
        async def post(self, *_args, **kwargs):
            prefers.append(kwargs["headers"]["Prefer"])
            return _Response([])

    monkeypatch.setattr(adapter, "_get_shared_http_client", lambda *_args, **_kwargs: _Client())
    document = {"event_id": "evt_1", "event": "landing_view"}

    ignored = asyncio.run(
        upsert_supabase_documents(
            "https://example.supabase.co",
            "secret",
            "analytics_events",
            [document],
            ignore_duplicates=True,
        )
    )
    merged = asyncio.run(
        upsert_supabase_documents(
            "https://example.supabase.co",
            "secret",
            "analytics_events",
            [document],
        )
    )

    assert ignored["ok"] is True
    assert merged["ok"] is True
    assert prefers == ["resolution=ignore-duplicates", "resolution=merge-duplicates"]
