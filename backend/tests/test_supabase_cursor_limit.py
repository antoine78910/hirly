import asyncio
import json

import pytest

from db.supabase_adapter import (
    SupabaseCollectionAdapter,
    SupabaseCursorAdapter,
    _postgrest_filter_params,
    database_journey,
)
import db.supabase_adapter as adapter


def test_cursor_postgrest_order_keeps_limit_for_jobs_sort():
    collection = SupabaseCollectionAdapter("jobs", supabase_url="https://example.supabase.co", secret_key="secret")
    cursor = SupabaseCursorAdapter(collection, {})
    cursor.sort("imported_at", -1).limit(25)
    assert cursor._postgrest_order() == "imported_at.desc.nullslast,job_id.desc.nullslast"
    # to_list would pass pushed_limit=25 (not None) — verified via order helper + limit fields
    assert cursor._limit == 25


def test_cursor_default_jobs_order_without_sort_spec():
    collection = SupabaseCollectionAdapter("jobs", supabase_url="https://example.supabase.co", secret_key="secret")
    cursor = SupabaseCursorAdapter(collection, {})
    assert cursor._postgrest_order() == "imported_at.desc.nullslast,job_id.desc.nullslast"


def test_jobs_sort_adds_unique_job_id_tiebreaker():
    collection = SupabaseCollectionAdapter("jobs", supabase_url="https://example.supabase.co", secret_key="secret")
    cursor = SupabaseCursorAdapter(collection, {}).sort("imported_at", -1)
    assert cursor._postgrest_order() == "imported_at.desc.nullslast,job_id.desc.nullslast"


def test_read_limit_ceiling_fails_instead_of_returning_truncated_success(monkeypatch):
    class _Response:
        status_code = 200
        text = ""

        def json(self):
            return [{"data": {"job_id": "same"}}]

    async def _get(*_args, **_kwargs):
        return _Response()

    monkeypatch.setattr(adapter, "READ_PAGE_SIZE", 1)
    monkeypatch.setattr(adapter, "MAX_READ_ROWS", 2)
    monkeypatch.setattr(adapter, "_http_get_with_retries", _get)
    collection = SupabaseCollectionAdapter("jobs", supabase_url="https://example.supabase.co", secret_key="secret")

    with pytest.raises(RuntimeError, match="result is incomplete"):
        asyncio.run(collection._read_documents({}, None))


def test_postgrest_filter_characterization_covers_pushable_and_local_paths():
    assert _postgrest_filter_params("users", {"email": "person@example.com"}) == {
        "email": "eq.person@example.com",
    }
    assert _postgrest_filter_params("jobs", {"job_id": {"$in": ["a", "b"]}}) == {
        "job_id": "in.(a,b)",
    }
    assert _postgrest_filter_params("jobs", {"imported_at": {"$gte": "2026-01-01"}}) == {
        "imported_at": "gte.2026-01-01",
    }
    assert _postgrest_filter_params("users", {"data.email": "person@example.com"}) is None
    assert _postgrest_filter_params("users", {"email": {"$ne": "blocked@example.com"}}) is None


def test_read_emits_pii_free_journey_metric(monkeypatch, caplog):
    class _Response:
        status_code = 200
        text = ""
        content = b'[{"data":{"user_id":"user-1"}}]'

        def json(self):
            return [{"data": {"user_id": "user-1"}}]

    async def _get(*_args, **_kwargs):
        return _Response()

    monkeypatch.setattr(adapter, "_http_get_with_retries", _get)
    collection = SupabaseCollectionAdapter("users", supabase_url="https://example.supabase.co", secret_key="secret")
    with caplog.at_level("INFO", logger="db.supabase_adapter"):
        with database_journey("landing"):
            assert asyncio.run(collection._read_documents({"user_id": "user-1"}, read_limit=1)) == [{"user_id": "user-1"}]

    metrics = [record for record in caplog.records if record.getMessage().startswith("db_adapter_metric ")]
    assert metrics
    metric = json.loads(metrics[-1].getMessage().split(" ", 1)[1])
    assert metric == {
        "elapsed_ms": metric["elapsed_ms"],
        "filter_status": "pushed",
        "journey": "landing",
        "operation": "read_documents",
        "remote_request_count": 0,
        "response_bytes": 0,
        "retry_count": 0,
        "rows_fetched": 1,
        "rows_returned": 1,
        "status": "ok",
        "table": "users",
        "transport_request_count": 0,
    }
    assert "user-1" not in metrics[-1].getMessage()


def test_http_get_retry_metric_counts_attempts_without_logging_request_data(monkeypatch, caplog):
    class _Response:
        status_code = 200
        text = ""
        content = b"[]"

    class _Client:
        attempts = 0

        async def get(self, *_args, **_kwargs):
            self.attempts += 1
            if self.attempts == 1:
                raise adapter.httpx.ReadTimeout("temporary")
            return _Response()

    async def _sleep(_delay):
        return None

    monkeypatch.setattr(adapter.asyncio, "sleep", _sleep)
    with caplog.at_level("INFO", logger="db.supabase_adapter"):
        asyncio.run(
            adapter._http_get_with_retries(
                _Client(),
                "https://example.supabase.co/rest/v1/users",
                params={"select": "data"},
                headers={"apikey": "secret"},
                attempts=2,
            )
        )

    metric = json.loads(
        [record for record in caplog.records if record.getMessage().startswith("db_adapter_metric ")][-1]
        .getMessage()
        .split(" ", 1)[1]
    )
    assert metric["operation"] == "http_get"
    assert metric["remote_request_count"] == 0
    assert metric["transport_request_count"] == 2
    assert metric["retry_count"] == 1
    assert "secret" not in caplog.records[-1].getMessage()
