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
TIKWM_USER_POSTS_URL = "https://www.tikwm.com/api/user/posts"


def _parse_video(item: Dict[str, Any], *, default_handle: str = "") -> Dict[str, Any]:
    stats = item.get("stats") or {}
    video_id = str(item.get("id") or "")
    author = item.get("author") or {}
    handle = author.get("uniqueId") or default_handle
    video = item.get("video") or {}
    cover = (
        video.get("cover")
        or video.get("originCover")
        or video.get("dynamicCover")
        or ""
    )
    return {
        "video_id": video_id,
        "posted_at": _unix_to_iso(item.get("createTime")),
        "description": (item.get("desc") or "").strip(),
        "views": int(stats.get("playCount") or 0),
        "likes": int(stats.get("diggCount") or 0),
        "comments": int(stats.get("commentCount") or 0),
        "shares": int(stats.get("shareCount") or 0),
        "cover_url": cover,
        "url": f"https://www.tiktok.com/@{handle}/video/{video_id}" if video_id and handle else "",
    }


def _parse_tikwm_video(item: Dict[str, Any], handle: str) -> Dict[str, Any]:
    video_id = str(item.get("video_id") or "")
    description = (item.get("title") or "").strip()
    if not description:
        content_desc = item.get("content_desc") or []
        if isinstance(content_desc, list):
            description = " ".join(part.strip() for part in content_desc if part).strip()
        elif content_desc:
            description = str(content_desc).strip()

    return {
        "video_id": video_id,
        "posted_at": _unix_to_iso(item.get("create_time")),
        "description": description,
        "views": int(item.get("play_count") or 0),
        "likes": int(item.get("digg_count") or 0),
        "comments": int(item.get("comment_count") or 0),
        "shares": int(item.get("share_count") or 0),
        "cover_url": item.get("cover") or item.get("origin_cover") or "",
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


def _fetch_videos_from_api(
    client: httpx.Client,
    *,
    sec_uid: str,
    handle: str,
    referer: str,
) -> List[Dict[str, Any]]:
    if not sec_uid:
        return []

    params = {
        "secUid": sec_uid,
        "count": 35,
        "cursor": 0,
        "coverFormat": 2,
        "post_item_list_request_type": 0,
    }
    ms_token = client.cookies.get("msToken")
    if ms_token:
        params["msToken"] = ms_token

    response = client.get(
        "https://www.tiktok.com/api/post/item_list/",
        params=params,
        headers={"Referer": referer, "Accept": "application/json"},
    )
    if not response.text.strip():
        return []

    try:
        payload = response.json()
    except json.JSONDecodeError:
        return []

    item_list = payload.get("itemList") or []
    return [_parse_video(item, default_handle=handle) for item in item_list if isinstance(item, dict)]


def _fetch_videos_from_tikwm(handle: str) -> List[Dict[str, Any]]:
    response = httpx.get(
        TIKWM_USER_POSTS_URL,
        params={"unique_id": handle, "count": 35},
        headers={"User-Agent": USER_AGENT},
        timeout=25.0,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") not in (0, "0", None):
        return []

    videos = (payload.get("data") or {}).get("videos") or []
    return [_parse_tikwm_video(item, handle) for item in videos if isinstance(item, dict)]


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
        item_list = user_info.get("itemList") or detail.get("itemList") or []

        videos: List[Dict[str, Any]] = [
            _parse_video(item, default_handle=clean_handle)
            for item in item_list
            if isinstance(item, dict)
        ]
        if not videos:
            videos = _fetch_videos_from_api(
                client,
                sec_uid=user.get("secUid") or "",
                handle=clean_handle,
                referer=url,
            )

    if not videos:
        videos = _fetch_videos_from_tikwm(clean_handle)

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
