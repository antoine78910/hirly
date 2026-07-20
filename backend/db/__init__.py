"""Split auth DB vs jobs inventory DB.

When JOBS_SUPABASE_URL + JOBS_SUPABASE_SECRET_KEY are set, job inventory
collections are routed to that PostgREST endpoint (second Supabase project,
Neon+PostgREST, or Railway Postgres + PostgREST). Auth/users/profiles stay on
the primary SUPABASE_URL.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from .base import DatabaseAdapter
from .supabase_adapter import SupabaseDatabaseAdapter

logger = logging.getLogger(__name__)

# High-volume inventory tables — keep off the auth/billing project when split.
JOBS_INVENTORY_COLLECTIONS = (
    "jobs",
    "ats_company_sources",
    "company_boards",
    "friendly_company_career_pages",
    "geo_places",
)


def _normalize_supabase_url(value: str | None) -> str:
    url = (value or "").strip().rstrip("/")
    for suffix in ("/rest/v1", "/auth/v1"):
        if url.endswith(suffix):
            return url[: -len(suffix)]
    return url


def attach_jobs_inventory(primary: SupabaseDatabaseAdapter, jobs_db: SupabaseDatabaseAdapter) -> SupabaseDatabaseAdapter:
    """Point inventory collections on `primary` at `jobs_db` collections."""
    for name in JOBS_INVENTORY_COLLECTIONS:
        if hasattr(jobs_db, name):
            setattr(primary, name, getattr(jobs_db, name))
    primary.jobs_inventory_url = jobs_db.supabase_url  # type: ignore[attr-defined]
    primary._jobs_inventory_rpc_adapter = jobs_db  # type: ignore[attr-defined]
    return primary


def create_database_adapter() -> DatabaseAdapter:
    primary = SupabaseDatabaseAdapter(
        supabase_url=_normalize_supabase_url(os.environ.get("SUPABASE_URL")),
        secret_key=os.environ.get("SUPABASE_SECRET_KEY"),
        db_url=os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL"),
    )

    jobs_url = _normalize_supabase_url(os.environ.get("JOBS_SUPABASE_URL"))
    jobs_key = (os.environ.get("JOBS_SUPABASE_SECRET_KEY") or "").strip()
    if jobs_url and jobs_key:
        jobs_db = SupabaseDatabaseAdapter(
            supabase_url=jobs_url,
            secret_key=jobs_key,
            db_url=os.environ.get("JOBS_DATABASE_URL") or os.environ.get("JOBS_SUPABASE_DB_URL"),
        )
        attach_jobs_inventory(primary, jobs_db)
        logger.info(
            "jobs_inventory_split_enabled primary=%s jobs=%s collections=%s",
            primary.supabase_url,
            jobs_url,
            ",".join(JOBS_INVENTORY_COLLECTIONS),
        )
    else:
        logger.info("jobs_inventory_split_disabled using_primary_supabase_for_jobs")

    return primary
