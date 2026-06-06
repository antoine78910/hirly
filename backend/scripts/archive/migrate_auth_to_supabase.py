"""Copy Mongo auth collections to Supabase without changing frontend behavior.

Usage from repo root:
    backend\\venv\\Scripts\\python.exe backend\\scripts\\migrate_auth_to_supabase.py

Migrates:
- users
- user_sessions

The script reads backend/.env, never hardcodes Supabase credentials, and does
not mutate Mongo.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

import certifi
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from db.supabase_adapter import _supabase_row, count_supabase_table, upsert_supabase_documents  # noqa: E402


BATCH_SIZE = int(os.environ.get("SUPABASE_MIGRATION_BATCH_SIZE", "200"))
TABLES = ("users", "user_sessions")


def sanitize_null_bytes(value: Any) -> Tuple[Any, int]:
    """Return a copy of value with Postgres-incompatible null bytes removed."""
    if isinstance(value, str):
        removed = value.count("\u0000")
        if removed:
            return value.replace("\u0000", ""), removed
        return value, 0
    if isinstance(value, list):
        cleaned = []
        removed_total = 0
        for item in value:
            cleaned_item, removed = sanitize_null_bytes(item)
            cleaned.append(cleaned_item)
            removed_total += removed
        return cleaned, removed_total
    if isinstance(value, dict):
        cleaned_dict: Dict[str, Any] = {}
        removed_total = 0
        for key, item in value.items():
            cleaned_key, key_removed = sanitize_null_bytes(key)
            cleaned_item, item_removed = sanitize_null_bytes(item)
            cleaned_dict[cleaned_key] = cleaned_item
            removed_total += key_removed + item_removed
        return cleaned_dict, removed_total
    return value, 0


async def migrate_collection(mongo_db: Any, supabase_url: str, secret_key: str, table: str) -> Dict[str, Any]:
    scanned = 0
    migrated = 0
    skipped = 0
    null_bytes_removed_count = 0
    documents_sanitized_count = 0
    errors: List[str] = []
    batch: List[Dict[str, Any]] = []

    async def flush_batch(items: List[Dict[str, Any]]) -> None:
        nonlocal migrated, skipped
        if not items:
            return
        result = await upsert_supabase_documents(supabase_url, secret_key, table, items)
        if result.get("ok"):
            migrated += result.get("rows", 0)
        else:
            skipped += len(items)
            errors.append(result.get("error") or f"{table} batch failed")

    cursor = mongo_db[table].find({})
    async for document in cursor:
        scanned += 1
        sanitized_document, removed_count = sanitize_null_bytes(document)
        if removed_count:
            documents_sanitized_count += 1
            null_bytes_removed_count += removed_count
        try:
            _supabase_row(table, sanitized_document)
        except Exception as exc:
            skipped += 1
            errors.append(f"row_mapping_error document_index={scanned}: {exc.__class__.__name__}: {str(exc)[:300]}")
            continue
        batch.append(sanitized_document)
        if len(batch) >= BATCH_SIZE:
            await flush_batch(batch)
            batch = []

    await flush_batch(batch)

    count_result = await count_supabase_table(supabase_url, secret_key, table)
    return {
        "table": table,
        "mongo_scanned": scanned,
        "migrated": migrated,
        "skipped": skipped,
        "null_bytes_removed_count": null_bytes_removed_count,
        "documents_sanitized_count": documents_sanitized_count,
        "supabase_count": count_result.get("count"),
        "first_5_errors": errors[:5],
        "supabase_count_error": count_result.get("error"),
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
        for table in TABLES:
            print(await migrate_collection(mongo_db, supabase_url, secret_key, table))
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
