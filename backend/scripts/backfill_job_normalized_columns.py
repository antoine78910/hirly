"""Backfill normalized columns on existing Supabase job rows.

Run from the backend directory after applying supabase_schema.sql:
    python scripts/backfill_job_normalized_columns.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any, Dict, List

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from db import create_database_adapter  # noqa: E402
from db.supabase_adapter import upsert_supabase_documents  # noqa: E402

BATCH_SIZE = 250


async def main() -> int:
    db = create_database_adapter()
    try:
        collection = db.jobs
        jobs = await collection.find({}, {"_id": 0}).to_list(10000)
        total = len(jobs)
        if not total:
            print("No jobs found.")
            return 0

        rows: List[Dict[str, Any]] = []
        processed = 0
        for job in jobs:
            job_id = job.get("job_id")
            if not job_id:
                continue
            rows.append(job)
            if len(rows) >= BATCH_SIZE:
                result = await upsert_supabase_documents(collection.supabase_url or "", collection.secret_key or "", "jobs", rows)
                if not result.get("ok"):
                    raise RuntimeError(result.get("error") or "Supabase jobs backfill failed")
                processed += len(rows)
                print(f"Backfilled {processed}/{total} jobs")
                rows = []

        if rows:
            result = await upsert_supabase_documents(collection.supabase_url or "", collection.secret_key or "", "jobs", rows)
            if not result.get("ok"):
                raise RuntimeError(result.get("error") or "Supabase jobs backfill failed")
            processed += len(rows)
            print(f"Backfilled {processed}/{total} jobs")
        return 0
    finally:
        await db.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
