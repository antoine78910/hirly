"""User feedback index (features, training completion) with Supabase persistence."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

STORAGE_ROOT = Path(__file__).resolve().parent / "storage" / "feedback"
INDEX_PATH = STORAGE_ROOT / "index.json"

FEEDBACK_FEATURE_USER = "feature_user"
FEEDBACK_FEATURE_CREATOR = "feature_creator"
FEEDBACK_TRAINING_COMPLETION = "training_completion"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_store() -> None:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    if not INDEX_PATH.exists():
        INDEX_PATH.write_text("[]", encoding="utf-8")


def _load_index() -> List[Dict[str, Any]]:
    _ensure_store()
    try:
        raw = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save_index(rows: List[Dict[str, Any]]) -> None:
    _ensure_store()
    INDEX_PATH.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def _has_feedback_db(db) -> bool:
    return db is not None and hasattr(db, "user_feedback")


def _summary_from_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": row.get("id") or row.get("submission_id"),
        "created_at": row.get("created_at"),
        "feedback_type": row.get("feedback_type"),
        "user_id": row.get("user_id"),
        "user_email": row.get("user_email"),
        "user_name": row.get("user_name"),
        "category": row.get("category"),
        "beneficial": row.get("beneficial"),
        "rating": row.get("rating"),
        "course_id": row.get("course_id"),
        "message_preview": (row.get("message") or "")[:240],
        "attachment_count": len(row.get("attachments") or []),
    }


async def _load_rows_db(db, feedback_type: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    if not _has_feedback_db(db):
        return []
    try:
        query: Dict[str, Any] = {}
        if feedback_type:
            query["feedback_type"] = feedback_type
        cursor = db.user_feedback.find(query)
        if hasattr(cursor, "sort"):
            cursor = cursor.sort("created_at", -1)
        rows = await cursor.to_list(max(limit, 100))
        summaries = [_summary_from_row(row) for row in rows or []]
        return summaries[:limit]
    except Exception as exc:
        logger.warning("user_feedback db read failed: %s", exc)
        return []


async def _get_row_db(db, submission_id: str) -> Optional[Dict[str, Any]]:
    if not _has_feedback_db(db):
        return None
    try:
        row = await db.user_feedback.find_one({"submission_id": submission_id}, {"_id": 0})
        if row:
            return row
        return await db.user_feedback.find_one({"id": submission_id}, {"_id": 0})
    except Exception as exc:
        logger.warning("user_feedback db read failed id=%s: %s", submission_id, exc)
        return None


async def _upsert_row_db(db, row: Dict[str, Any]) -> Dict[str, Any]:
    doc = dict(row)
    submission_id = str(doc.get("id") or doc.get("submission_id") or uuid.uuid4().hex)
    doc["id"] = submission_id
    doc["submission_id"] = submission_id
    doc.setdefault("created_at", _now_iso())
    doc["updated_at"] = _now_iso()
    await db.user_feedback.update_one(
        {"submission_id": submission_id},
        {"$set": doc},
        upsert=True,
    )
    return doc


def save_submission(record: Dict[str, Any]) -> Dict[str, Any]:
    """Sync save for file fallback (local dev without Supabase)."""
    submission_id = record.get("id") or uuid.uuid4().hex
    created_at = record.get("created_at") or _now_iso()
    row = {**record, "id": submission_id, "submission_id": submission_id, "created_at": created_at}

    folder = STORAGE_ROOT / submission_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "meta.json").write_text(json.dumps(row, indent=2), encoding="utf-8")

    summary = _summary_from_row(row)
    rows = _load_index()
    rows.insert(0, summary)
    _save_index(rows[:2000])
    return row


async def save_submission_async(db, record: Dict[str, Any]) -> Dict[str, Any]:
    submission_id = record.get("id") or uuid.uuid4().hex
    created_at = record.get("created_at") or _now_iso()
    row = {**record, "id": submission_id, "submission_id": submission_id, "created_at": created_at}

    folder = STORAGE_ROOT / submission_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "meta.json").write_text(json.dumps(row, indent=2), encoding="utf-8")

    if _has_feedback_db(db):
        try:
            return await _upsert_row_db(db, row)
        except Exception as exc:
            logger.warning("user_feedback db upsert failed: %s", exc)

    summary = _summary_from_row(row)
    rows = _load_index()
    rows.insert(0, summary)
    _save_index(rows[:2000])
    return row


async def list_submissions(
    db,
    feedback_type: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    db_rows = await _load_rows_db(db, feedback_type=feedback_type, limit=max(limit, 100))
    file_rows = _load_index()
    if feedback_type:
        file_rows = [row for row in file_rows if row.get("feedback_type") == feedback_type]

    merged: Dict[str, Dict[str, Any]] = {}
    for row in db_rows + file_rows:
        row_id = str(row.get("id") or row.get("submission_id") or "").strip()
        if not row_id:
            continue
        merged[row_id] = row

    rows = sorted(
        merged.values(),
        key=lambda item: item.get("created_at") or "",
        reverse=True,
    )
    return rows[:limit]


async def get_submission(db, submission_id: str) -> Optional[Dict[str, Any]]:
    row = await _get_row_db(db, submission_id)
    if row:
        return row

    path = STORAGE_ROOT / submission_id / "meta.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


async def migrate_file_feedback_to_db(db) -> None:
    """Bootstrap: copy file-backed feedback into Supabase."""
    if not _has_feedback_db(db):
        return
    seen: set[str] = set()
    for summary in _load_index():
        submission_id = str(summary.get("id") or "").strip()
        if not submission_id or submission_id in seen:
            continue
        seen.add(submission_id)
        path = STORAGE_ROOT / submission_id / "meta.json"
        if not path.exists():
            continue
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        try:
            await _upsert_row_db(db, row)
        except Exception as exc:
            logger.warning("feedback migration failed id=%s: %s", submission_id, exc)
