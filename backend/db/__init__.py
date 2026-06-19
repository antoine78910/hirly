"""Supabase database adapter package."""

from __future__ import annotations

from .base import DatabaseAdapter
from .supabase_adapter import SupabaseDatabaseAdapter


def _normalize_supabase_url(value: str | None) -> str:
    url = (value or "").strip().rstrip("/")
    for suffix in ("/rest/v1", "/auth/v1"):
        if url.endswith(suffix):
            return url[: -len(suffix)]
    return url


def create_database_adapter() -> DatabaseAdapter:
    import os

    return SupabaseDatabaseAdapter(
        supabase_url=_normalize_supabase_url(os.environ.get("SUPABASE_URL")),
        secret_key=os.environ.get("SUPABASE_SECRET_KEY"),
        db_url=os.environ.get("SUPABASE_DB_URL"),
    )
