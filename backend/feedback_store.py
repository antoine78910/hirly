"""File-backed user feedback index (features, training completion)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

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


def save_submission(record: Dict[str, Any]) -> Dict[str, Any]:
    submission_id = record.get("id") or uuid.uuid4().hex
    created_at = record.get("created_at") or _now_iso()
    row = {**record, "id": submission_id, "created_at": created_at}

    folder = STORAGE_ROOT / submission_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "meta.json").write_text(json.dumps(row, indent=2), encoding="utf-8")

    summary = {
        "id": submission_id,
        "created_at": created_at,
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
    rows = _load_index()
    rows.insert(0, summary)
    _save_index(rows[:2000])
    return row


def list_submissions(
    feedback_type: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    rows = _load_index()
    if feedback_type:
        rows = [row for row in rows if row.get("feedback_type") == feedback_type]
    return rows[:limit]


def get_submission(submission_id: str) -> Optional[Dict[str, Any]]:
    path = STORAGE_ROOT / submission_id / "meta.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
