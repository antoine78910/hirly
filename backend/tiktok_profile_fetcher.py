"""Fetch public TikTok profile stats without authenticated API keys."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

import httpx

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
REHYDRATION_PATTERN = re.compile(
    r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>',
    re.DOTALL,
)


def _parse_video(item: Dict[str, Any]) -> Dict[str, Any]:
    stats = item.get("stats") or {}
    video_id = str(item.get("id") or "")
    author = item.get("author") or {}
    handle = author.get("uniqueId") or ""
    return {
        "video_id": video_id,
        "posted_at": _unix_to_iso(item.get("createTime")),
        "description": (item.get("desc") or "").strip(),
        "views": int(stats.get("playCount") or 0),
        "likes": int(stats.get("diggCount") or 0),
        "comments": int(stats.get("commentCount") or 0),
        "shares": int(stats.get("shareCount") or 0),
        "url": f"https://www.tiktok.com/@{handle}/video/{video_id}" if video_id and handle else "",
    }


def _unix_to_iso(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return None
    return datetime_from_unix(ts)


def datetime_from_unix(ts: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def fetch_tiktok_profile(handle: str) -> Dict[str, Any]:
    clean_handle = (handle or "").strip().lstrip("@")
    if not clean_handle:
        raise ValueError("TikTok handle is required")

    url = f"https://www.tiktok.com/@{clean_handle}"
    with httpx.Client(
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
        follow_redirects=True,
        timeout=25.0,
    ) as client:
        response = client.get(url)
        response.raise_for_status()
        match = REHYDRATION_PATTERN.search(response.text)
        if not match:
            raise RuntimeError("Could not parse TikTok profile payload")

        payload = json.loads(match.group(1))
        scope = payload.get("__DEFAULT_SCOPE__") or {}
        detail = scope.get("webapp.user-detail") or {}
        user_info = detail.get("userInfo") or {}
        user = user_info.get("user") or {}
        stats = user_info.get("stats") or {}
        item_list = detail.get("itemList") or []

        videos: List[Dict[str, Any]] = [_parse_video(item) for item in item_list if isinstance(item, dict)]
        videos = [video for video in videos if video.get("video_id")]

        return {
            "handle": user.get("uniqueId") or clean_handle,
            "nickname": user.get("nickname") or clean_handle,
            "avatar_url": user.get("avatarLarger") or user.get("avatarMedium") or "",
            "profile_url": url,
            "followers": int(stats.get("followerCount") or 0),
            "following": int(stats.get("followingCount") or 0),
            "likes_total": int(stats.get("heartCount") or stats.get("heart") or 0),
            "video_count": int(stats.get("videoCount") or 0),
            "videos": videos,
            "views_total": sum(int(video.get("views") or 0) for video in videos),
            "comments_total": sum(int(video.get("comments") or 0) for video in videos),
        }
