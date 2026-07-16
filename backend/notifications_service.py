"""Real in-app notifications -- credit grants, offer-expired refunds, etc.

Kept intentionally minimal (create + list + mark-read) since this is
consumed from a handful of call sites (billing grants, admin actions) and a
single frontend panel, not a general pub/sub system.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_notification(
    db,
    *,
    user_id: str,
    type: str,
    title: str,
    body: str,
    application_id: Optional[str] = None,
) -> Dict[str, Any]:
    doc = {
        "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "type": type,
        "title": title,
        "body": body,
        "application_id": application_id,
        "read": False,
        "created_at": _now_iso(),
    }
    await db.notifications.update_one({"notification_id": doc["notification_id"]}, {"$set": doc}, upsert=True)
    return doc


async def list_notifications(db, *, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    rows = await db.notifications.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return rows


async def mark_notification_read(db, *, user_id: str, notification_id: str) -> bool:
    result = await db.notifications.update_one(
        {"notification_id": notification_id, "user_id": user_id},
        {"$set": {"read": True, "updated_at": _now_iso()}},
    )
    return bool(getattr(result, "matched_count", 0))


async def mark_all_notifications_read(db, *, user_id: str) -> int:
    rows = await db.notifications.find({"user_id": user_id, "read": False}, {"_id": 0}).to_list(500)
    now = _now_iso()
    for row in rows:
        await db.notifications.update_one(
            {"notification_id": row["notification_id"], "user_id": user_id},
            {"$set": {"read": True, "updated_at": now}},
        )
    return len(rows)
