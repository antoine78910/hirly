"""Copy low-risk Mongo collections to Supabase without changing app routing.

Usage from repo root:
    backend\\venv\\Scripts\\python.exe backend\\scripts\\migrate_low_risk_to_supabase.py

The script reads backend/.env, keeps DATABASE_PROVIDER untouched, and migrates:
- jobs
- company_boards
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import certifi
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from db.supabase_adapter import count_supabase_table, upsert_supabase_documents  # noqa: E402


BATCH_SIZE = int(os.environ.get("SUPABASE_MIGRATION_BATCH_SIZE", "200"))
TABLES = ("jobs", "company_boards")


async def migrate_collection(mongo_db: Any, supabase_url: str, secret_key: str, table: str) -> Dict[str, Any]:
    scanned = 0
    migrated = 0
    errors: List[str] = []
    batch: List[Dict[str, Any]] = []

    cursor = mongo_db[table].find({})
    async for document in cursor:
        scanned += 1
        batch.append(document)
        if len(batch) >= BATCH_SIZE:
            result = await upsert_supabase_documents(supabase_url, secret_key, table, batch)
            if result.get("ok"):
                migrated += result.get("rows", 0)
            else:
                errors.append(result.get("error") or f"{table} batch failed")
            batch = []

    if batch:
        result = await upsert_supabase_documents(supabase_url, secret_key, table, batch)
        if result.get("ok"):
            migrated += result.get("rows", 0)
        else:
            errors.append(result.get("error") or f"{table} batch failed")

    count_result = await count_supabase_table(supabase_url, secret_key, table)
    return {
        "table": table,
        "mongo_scanned": scanned,
        "supabase_migrated": migrated,
        "supabase_count": count_result.get("count"),
        "errors": errors[:5],
    }


async def main() -> None:
    load_dotenv(BACKEND_DIR / ".env")
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    supabase_url = os.environ["SUPABASE_URL"]
    secret_key = os.environ["SUPABASE_SECRET_KEY"]

    client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
    try:
        mongo_db = client[db_name]
        results = []
        for table in TABLES:
            results.append(await migrate_collection(mongo_db, supabase_url, secret_key, table))
        for result in results:
            print(result)
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
