"""File-backed daily snapshots for creator social performance."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

STORE_PATH = Path(__file__).resolve().parent / "data" / "creator_social_snapshots.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_store() -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        STORE_PATH.write_text("[]", encoding="utf-8")


def load_snapshots() -> List[Dict[str, Any]]:
    _ensure_store()
    try:
        raw = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_snapshots(rows: List[Dict[str, Any]]) -> None:
    _ensure_store()
    STORE_PATH.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def append_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    rows = load_snapshots()
    row = {
        **snapshot,
        "recorded_at": snapshot.get("recorded_at") or _now_iso(),
    }
    rows.append(row)
    save_snapshots(rows)
    return row


def latest_snapshot_for_creator(creator_id: str) -> Optional[Dict[str, Any]]:
    matches = [row for row in load_snapshots() if row.get("creator_id") == creator_id]
    if not matches:
        return None
    matches.sort(key=lambda item: item.get("recorded_at") or "", reverse=True)
    return matches[0]
