#!/usr/bin/env python3
"""Copy jobs inventory tables from primary Supabase to JOBS_SUPABASE_* target.

Usage:
  set SUPABASE_URL / SUPABASE_SECRET_KEY (source)
  set JOBS_SUPABASE_URL / JOBS_SUPABASE_SECRET_KEY (destination)
  python scripts/migrate_jobs_inventory.py --dry-run
  python scripts/migrate_jobs_inventory.py --table jobs --limit 5000
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db import _normalize_supabase_url  # noqa: E402
from db.supabase_adapter import SupabaseDatabaseAdapter  # noqa: E402

TABLES = (
    "jobs",
    "ats_company_sources",
    "company_boards",
    "friendly_company_career_pages",
    "geo_places",
)


async def copy_table(source, dest, table: str, *, batch_size: int, limit: int | None, dry_run: bool) -> dict:
    col = getattr(source, table)
    dest_col = getattr(dest, table)
    read_limit = limit if limit is not None else 50_000
    rows = await col._read_documents({}, read_limit=read_limit)
    if dry_run:
        return {"table": table, "fetched": len(rows), "written": 0, "dry_run": True}
    written = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        await dest_col.insert_many(batch)
        written += len(batch)
    return {"table": table, "fetched": len(rows), "written": written, "dry_run": False}


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--table", choices=TABLES, help="Copy a single table (default: all)")
    parser.add_argument("--batch-size", type=int, default=75)
    parser.add_argument("--limit", type=int, default=None, help="Max rows per table")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    src_url = _normalize_supabase_url(os.environ.get("SUPABASE_URL"))
    src_key = os.environ.get("SUPABASE_SECRET_KEY") or ""
    dst_url = _normalize_supabase_url(os.environ.get("JOBS_SUPABASE_URL"))
    dst_key = os.environ.get("JOBS_SUPABASE_SECRET_KEY") or ""
    if not src_url or not src_key:
        print("SUPABASE_URL and SUPABASE_SECRET_KEY are required (source)", file=sys.stderr)
        return 2
    if not dst_url or not dst_key:
        print("JOBS_SUPABASE_URL and JOBS_SUPABASE_SECRET_KEY are required (destination)", file=sys.stderr)
        return 2

    source = SupabaseDatabaseAdapter(src_url, src_key)
    dest = SupabaseDatabaseAdapter(dst_url, dst_key)
    tables = (args.table,) if args.table else TABLES
    for table in tables:
        result = await copy_table(
            source,
            dest,
            table,
            batch_size=max(10, args.batch_size),
            limit=args.limit,
            dry_run=args.dry_run,
        )
        print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
