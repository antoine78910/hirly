"""Fetch public Instagram profile stats without authenticated API keys."""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import httpx

from tiktok_profile_fetcher import datetime_from_unix

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
IG_APP_ID = "936619743392459"


def _unix_to_iso(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return None
    return datetime_from_unix(ts)


def _post_url(handle: str, shortcode: str, *, is_reel: bool) -> str:
    if not shortcode:
        return ""
    path = "reel" if is_reel else "p"
    return f"https://www.instagram.com/{path}/{shortcode}/"


def _parse_media_node(node: Dict[str, Any], handle: str) -> Dict[str, Any]:
    shortcode = str(node.get("shortcode") or "")
    is_reel = node.get("product_type") == "clips" or (
        node.get("is_video") and node.get("__typename") == "GraphVideo"
    )
    caption_edges = (node.get("edge_media_to_caption") or {}).get("edges") or []
    description = ""
    if caption_edges:
        description = ((caption_edges[0] or {}).get("node") or {}).get("text") or ""
    description = str(description).strip()

    return {
        "video_id": shortcode,
        "posted_at": _unix_to_iso(node.get("taken_at_timestamp")),
        "description": description,
        "views": int(node.get("video_view_count") or node.get("play_count") or 0),
        "likes": int((node.get("edge_liked_by") or {}).get("count") or 0),
        "comments": int((node.get("edge_media_to_comment") or {}).get("count") or 0),
        "shares": 0,
        "cover_url": node.get("thumbnail_src") or node.get("display_url") or "",
        "url": _post_url(handle, shortcode, is_reel=is_reel),
    }


def _fetch_profile_payload(clean_handle: str, profile_url: str) -> Dict[str, Any]:
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            response = httpx.get(
                "https://www.instagram.com/api/v1/users/web_profile_info/",
                params={"username": clean_handle},
                headers={
                    "User-Agent": USER_AGENT,
                    "X-IG-App-ID": IG_APP_ID,
                    "Accept": "*/*",
                    "Referer": profile_url,
                },
                follow_redirects=True,
                timeout=30.0,
            )
            if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            response.raise_for_status()
            payload = response.json()
            user = (payload.get("data") or {}).get("user") or {}
            if user:
                return user
            raise RuntimeError("Could not parse Instagram profile payload")
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise RuntimeError(f"Instagram profile fetch failed: {exc}") from exc

    if last_error:
        raise RuntimeError(f"Instagram profile fetch failed: {last_error}") from last_error
    raise RuntimeError("Instagram profile fetch failed")


def fetch_instagram_profile(handle: str) -> Dict[str, Any]:
    clean_handle = (handle or "").strip().lstrip("@")
    if not clean_handle:
        raise ValueError("Instagram handle is required")

    profile_url = f"https://www.instagram.com/{clean_handle}/"
    user = _fetch_profile_payload(clean_handle, profile_url)

    edges = (user.get("edge_owner_to_timeline_media") or {}).get("edges") or []
    videos: List[Dict[str, Any]] = []
    for edge in edges:
        node = (edge or {}).get("node") or {}
        if not isinstance(node, dict) or not node.get("shortcode"):
            continue
        videos.append(_parse_media_node(node, clean_handle))

    return {
        "handle": user.get("username") or clean_handle,
        "nickname": user.get("full_name") or clean_handle,
        "avatar_url": user.get("profile_pic_url_hd") or user.get("profile_pic_url") or "",
        "profile_url": profile_url,
        "followers": int((user.get("edge_followed_by") or {}).get("count") or 0),
        "following": int((user.get("edge_follow") or {}).get("count") or 0),
        "likes_total": sum(int(video.get("likes") or 0) for video in videos),
        "video_count": int((user.get("edge_owner_to_timeline_media") or {}).get("count") or len(videos)),
        "videos": videos,
        "views_total": sum(int(video.get("views") or 0) for video in videos),
        "comments_total": sum(int(video.get("comments") or 0) for video in videos),
    }
