"""Supabase database adapter package."""

from __future__ import annotations

from .base import DatabaseAdapter
from .supabase_adapter import SupabaseDatabaseAdapter


def create_database_adapter() -> DatabaseAdapter:
    import os

    return SupabaseDatabaseAdapter(
        supabase_url=os.environ["SUPABASE_URL"],
        secret_key=os.environ["SUPABASE_SECRET_KEY"],
        db_url=os.environ.get("SUPABASE_DB_URL"),
    )
