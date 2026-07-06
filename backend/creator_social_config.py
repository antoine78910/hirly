"""Configured Hirly content creators for admin social tracking."""

from __future__ import annotations

from typing import Any, Dict, List
from urllib.parse import urlparse

DEFAULT_CREATORS: List[Dict[str, Any]] = [
    {
        "creator_id": "elodie",
        "name": "Elodie",
        "platform": "tiktok",
        "handle": "eloworks0",
        "profile_url": "https://www.tiktok.com/@eloworks0",
        "tags": ["france", "hirly"],
    },
    {
        "creator_id": "eva",
        "name": "Eva",
        "platform": "tiktok",
        "handle": "hirlyjob",
        "profile_url": "https://www.tiktok.com/@hirlyjob",
        "tags": ["france", "hirly"],
    },
]


def normalize_handle(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if "tiktok.com" in raw:
        path = urlparse(raw).path.strip("/")
        if path.startswith("@"):
            return path[1:].split("/")[0]
        return path.split("/")[0]
    return raw.lstrip("@")


def get_configured_creators() -> List[Dict[str, Any]]:
    rows = []
    for item in DEFAULT_CREATORS:
        row = dict(item)
        row["handle"] = normalize_handle(row.get("handle") or row.get("profile_url") or "")
        rows.append(row)
    return rows


def get_creator_by_id(creator_id: str) -> Dict[str, Any] | None:
    for row in get_configured_creators():
        if row.get("creator_id") == creator_id:
            return row
    return None
