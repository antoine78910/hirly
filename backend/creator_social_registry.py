"""Persisted registry of tracked creator social accounts."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

REGISTRY_PATH = Path(__file__).resolve().parent / "data" / "creator_social_creators.json"


def normalize_handle(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if "tiktok.com" in raw:
        path = urlparse(raw).path.strip("/")
        if path.startswith("@"):
            return path[1:].split("/")[0]
        return path.split("/")[0]
    if "instagram.com" in raw:
        path = urlparse(raw).path.strip("/")
        if not path:
            return ""
        return path.split("/")[0]
    return raw.lstrip("@")


def _ensure_registry() -> None:
    from creator_social_config import DEFAULT_CREATORS

    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if REGISTRY_PATH.exists():
        return
    REGISTRY_PATH.write_text(json.dumps(DEFAULT_CREATORS, indent=2), encoding="utf-8")


def load_registry() -> List[Dict[str, Any]]:
    _ensure_registry()
    try:
        raw = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_registry(rows: List[Dict[str, Any]]) -> None:
    _ensure_registry()
    REGISTRY_PATH.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def _slugify_handle(handle: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", handle.lower()).strip("_")
    return slug or "creator"


def _profile_url(platform: str, handle: str) -> str:
    if platform == "instagram":
        return f"https://www.instagram.com/{handle}/"
    return f"https://www.tiktok.com/@{handle}"


def _normalize_platform(value: str) -> str:
    platform = (value or "").strip().lower()
    if platform in {"instagram", "ig", "insta"}:
        return "instagram"
    if platform in {"tiktok", "tt"}:
        return "tiktok"
    raise ValueError("Platform must be tiktok or instagram")


def add_creator(*, platform: str, handle: str, name: Optional[str] = None) -> Dict[str, Any]:
    normalized_platform = _normalize_platform(platform)
    normalized_handle = normalize_handle(handle)
    if not normalized_handle:
        raise ValueError("Handle is required")

    rows = load_registry()
    for row in rows:
        existing_platform = (row.get("platform") or "").lower()
        existing_handle = normalize_handle(row.get("handle") or row.get("profile_url") or "")
        if existing_platform == normalized_platform and existing_handle.lower() == normalized_handle.lower():
            raise ValueError("This account is already tracked")

    base_id = _slugify_handle(normalized_handle)
    creator_id = base_id
    suffix = 2
    existing_ids = {row.get("creator_id") for row in rows}
    while creator_id in existing_ids:
        creator_id = f"{base_id}_{suffix}"
        suffix += 1
    if normalized_platform == "instagram" and not creator_id.endswith("_instagram"):
        if f"{base_id}_instagram" not in existing_ids and creator_id == base_id:
            creator_id = f"{base_id}_instagram"
        elif creator_id in existing_ids:
            creator_id = f"{base_id}_{uuid.uuid4().hex[:6]}"

    display_name = (name or "").strip() or normalized_handle
    row = {
        "creator_id": creator_id,
        "name": display_name,
        "platform": normalized_platform,
        "handle": normalized_handle,
        "profile_url": _profile_url(normalized_platform, normalized_handle),
        "tags": ["hirly"],
    }
    rows.append(row)
    save_registry(rows)
    return row


def get_configured_creators() -> List[Dict[str, Any]]:
    rows = []
    for item in load_registry():
        row = dict(item)
        row["handle"] = normalize_handle(row.get("handle") or row.get("profile_url") or "")
        rows.append(row)
    return rows


def get_creator_by_id(creator_id: str) -> Dict[str, Any] | None:
    for row in get_configured_creators():
        if row.get("creator_id") == creator_id:
            return row
    return None
