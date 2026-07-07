"""Configured Hirly content creators for admin social tracking."""

from __future__ import annotations

from typing import Any, Dict, List

from creator_social_registry import (
    add_creator as register_creator,
    get_configured_creators,
    get_creator_by_id,
    normalize_handle,
)

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
    {
        "creator_id": "mike_instagram",
        "name": "Mike",
        "platform": "instagram",
        "handle": "mike.jobtips",
        "profile_url": "https://www.instagram.com/mike.jobtips/",
        "tags": ["hirly"],
    },
    {
        "creator_id": "mike_tiktok",
        "name": "Mike",
        "platform": "tiktok",
        "handle": "Mike_ways0",
        "profile_url": "https://www.tiktok.com/@Mike_ways0",
        "tags": ["hirly"],
    },
    {
        "creator_id": "gerece_instagram",
        "name": "Gerece",
        "platform": "instagram",
        "handle": "gerece934",
        "profile_url": "https://www.instagram.com/gerece934/",
        "tags": ["hirly"],
    },
    {
        "creator_id": "gerece_tiktok",
        "name": "Gerece",
        "platform": "tiktok",
        "handle": "gereceverse",
        "profile_url": "https://www.tiktok.com/@gereceverse",
        "tags": ["hirly"],
    },
]


def add_creator(*, platform: str, handle: str, name: str | None = None) -> Dict[str, Any]:
    return register_creator(platform=platform, handle=handle, name=name)


__all__ = [
    "DEFAULT_CREATORS",
    "add_creator",
    "get_configured_creators",
    "get_creator_by_id",
    "normalize_handle",
]
