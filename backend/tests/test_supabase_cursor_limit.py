import asyncio

import pytest

from db.supabase_adapter import SupabaseCollectionAdapter, SupabaseCursorAdapter
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
