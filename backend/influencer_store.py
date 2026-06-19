"""File-backed influencer tracking for admin demo account provisioning."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

STORE_PATH = Path(__file__).resolve().parent / "data" / "influencers.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_store() -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        STORE_PATH.write_text("[]", encoding="utf-8")


def load_influencers() -> List[Dict[str, Any]]:
    _ensure_store()
    try:
        raw = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_influencers(rows: List[Dict[str, Any]]) -> None:
    _ensure_store()
    STORE_PATH.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def list_influencers() -> List[Dict[str, Any]]:
    rows = load_influencers()
    rows.sort(key=lambda item: item.get("updated_at") or item.get("created_at") or "", reverse=True)
    return rows


def get_influencer(influencer_id: str) -> Optional[Dict[str, Any]]:
    for row in load_influencers():
        if row.get("influencer_id") == influencer_id:
            return row
    return None


def create_influencer(payload: Dict[str, Any]) -> Dict[str, Any]:
    now = _now_iso()
    row = {
        "influencer_id": str(uuid.uuid4()),
        "name": (payload.get("name") or "").strip(),
        "email": (payload.get("email") or "").strip().lower(),
        "platform": (payload.get("platform") or "other").strip().lower(),
        "handle": (payload.get("handle") or "").strip(),
        "notes": (payload.get("notes") or "").strip(),
        "status": (payload.get("status") or "pending").strip().lower(),
        "user_id": payload.get("user_id"),
        "demo_granted": False,
        "created_at": now,
        "updated_at": now,
    }
    rows = load_influencers()
    rows.append(row)
    save_influencers(rows)
    return row


def update_influencer(influencer_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = load_influencers()
    updated = None
    for index, row in enumerate(rows):
        if row.get("influencer_id") != influencer_id:
            continue
        next_row = {**row}
        for key in ("name", "email", "platform", "handle", "notes", "status", "user_id", "demo_granted"):
            if key in payload and payload[key] is not None:
                value = payload[key]
                if key == "email" and isinstance(value, str):
                    value = value.strip().lower()
                elif isinstance(value, str):
                    value = value.strip()
                next_row[key] = value
        next_row["updated_at"] = _now_iso()
        rows[index] = next_row
        updated = next_row
        break
    if updated is None:
        return None
    save_influencers(rows)
    return updated
