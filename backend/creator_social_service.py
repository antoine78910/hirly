"""Aggregate creator social snapshots into admin dashboard metrics."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from creator_social_config import get_configured_creators, get_creator_by_id
from creator_social_store import append_snapshot, latest_snapshot_for_creator, load_snapshots
from instagram_profile_fetcher import fetch_instagram_profile
from tiktok_profile_fetcher import fetch_tiktok_profile


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _utc_date(value: Any) -> Optional[date]:
    parsed = _parse_dt(value)
    return parsed.date() if parsed else None


def _date_key(day: date) -> str:
    return day.isoformat()


def _sum_video_metric(videos: Sequence[Dict[str, Any]], key: str) -> int:
    return sum(int(video.get(key) or 0) for video in (videos or []))


def _video_metric_totals(videos: Sequence[Dict[str, Any]]) -> Dict[str, int]:
    return {
        "views": _sum_video_metric(videos, "views"),
        "likes": _sum_video_metric(videos, "likes"),
        "comments": _sum_video_metric(videos, "comments"),
        "shares": _sum_video_metric(videos, "shares"),
        "favorites": _sum_video_metric(videos, "favorites"),
    }


def _engagement_rate(
    views: int,
    *,
    likes: int = 0,
    favorites: int = 0,
    comments: int = 0,
    shares: int = 0,
) -> float:
    if views <= 0:
        return 0.0
    interactions = int(likes) + int(favorites) + int(comments) + int(shares)
    return round((interactions / views) * 100, 2)


def refresh_creator(creator_id: str) -> Dict[str, Any]:
    creator = get_creator_by_id(creator_id)
    if not creator:
        raise ValueError(f"Unknown creator: {creator_id}")

    handle = creator.get("handle") or ""
    platform = (creator.get("platform") or "tiktok").lower()
    if platform == "instagram":
        profile = fetch_instagram_profile(handle)
    else:
        profile = fetch_tiktok_profile(handle)
    snapshot = append_snapshot({
        "creator_id": creator_id,
        "platform": creator.get("platform") or "tiktok",
        "handle": profile.get("handle") or handle,
        "nickname": profile.get("nickname") or creator.get("name"),
        "avatar_url": profile.get("avatar_url") or "",
        "followers": profile.get("followers") or 0,
        "following": profile.get("following") or 0,
        "likes_total": profile.get("likes_total") or 0,
        "video_count": profile.get("video_count") or 0,
        "views_total": profile.get("views_total") or 0,
        "comments_total": profile.get("comments_total") or 0,
        "shares_total": profile.get("shares_total") or 0,
        "favorites_total": profile.get("favorites_total") or 0,
        "videos": profile.get("videos") or [],
    })
    return snapshot


def refresh_all_creators() -> List[Dict[str, Any]]:
    rows = []
    for creator in get_configured_creators():
        try:
            rows.append(refresh_creator(creator["creator_id"]))
        except Exception as exc:
            rows.append({
                "creator_id": creator["creator_id"],
                "name": creator.get("name"),
                "handle": creator.get("handle"),
                "platform": creator.get("platform"),
                "error": str(exc),
            })
    return rows


def _filter_snapshots(
    snapshots: Sequence[Dict[str, Any]],
    *,
    creator_ids: Optional[Sequence[str]] = None,
    days: int = 14,
) -> List[Dict[str, Any]]:
    end_day = datetime.now(timezone.utc).date()
    start_day = end_day - timedelta(days=max(1, days) - 1)
    allowed = set(creator_ids or [])
    rows = []
    for row in snapshots:
        if allowed and row.get("creator_id") not in allowed:
            continue
        day = _utc_date(row.get("recorded_at"))
        if day and day < start_day:
            continue
        rows.append(row)
    rows.sort(key=lambda item: item.get("recorded_at") or "")
    return rows


def _latest_by_creator_day(snapshots: Sequence[Dict[str, Any]]) -> Dict[Tuple[str, str], Dict[str, Any]]:
    grouped: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for row in snapshots:
        creator_id = row.get("creator_id")
        day = _utc_date(row.get("recorded_at"))
        if not creator_id or not day:
            continue
        key = (creator_id, _date_key(day))
        current = grouped.get(key)
        if not current or (row.get("recorded_at") or "") >= (current.get("recorded_at") or ""):
            grouped[key] = row
    return grouped


def _daily_points(
  grouped: Dict[Tuple[str, str], Dict[str, Any]],
  *,
  creator_ids: Sequence[str],
  days: int,
) -> List[Dict[str, Any]]:
    end_day = datetime.now(timezone.utc).date()
    start_day = end_day - timedelta(days=max(1, days) - 1)
    day_list = [start_day + timedelta(days=offset) for offset in range((end_day - start_day).days + 1)]

    per_creator_day: Dict[str, Dict[str, Dict[str, Any]]] = {cid: {} for cid in creator_ids}
    for (creator_id, day_key), row in grouped.items():
        if creator_id in per_creator_day:
            per_creator_day[creator_id][day_key] = row

    daily_rows: List[Dict[str, Any]] = []
    previous_totals: Dict[str, Dict[str, int]] = {
        cid: {
            "followers": 0,
            "likes_total": 0,
            "video_count": 0,
            "views_total": 0,
            "comments_total": 0,
            "shares_total": 0,
            "favorites_total": 0,
        }
        for cid in creator_ids
    }

    for day in day_list:
        day_key = _date_key(day)
        posted_videos = 0
        views = 0
        likes = 0
        comments = 0
        shares = 0
        favorites = 0
        followers = 0
        active_accounts = 0
        video_posts_from_list = 0

        for creator_id in creator_ids:
            row = per_creator_day[creator_id].get(day_key)
            if not row:
                continue
            active_accounts += 1
            followers += int(row.get("followers") or 0)
            prev = previous_totals[creator_id]
            current_videos = int(row.get("video_count") or 0)
            current_likes = int(row.get("likes_total") or 0)
            current_views = int(row.get("views_total") or 0)
            current_comments = int(row.get("comments_total") or 0)
            current_shares = int(row.get("shares_total") or 0)
            current_favorites = int(row.get("favorites_total") or 0)

            posted_videos += max(0, current_videos - int(prev.get("video_count") or 0))
            likes += max(0, current_likes - int(prev.get("likes_total") or 0))
            views += max(0, current_views - int(prev.get("views_total") or 0))
            comments += max(0, current_comments - int(prev.get("comments_total") or 0))
            shares += max(0, current_shares - int(prev.get("shares_total") or 0))
            favorites += max(0, current_favorites - int(prev.get("favorites_total") or 0))

            for video in row.get("videos") or []:
                posted_day = _utc_date(video.get("posted_at"))
                if posted_day == day:
                    video_posts_from_list += 1
                    views += int(video.get("views") or 0)
                    likes += int(video.get("likes") or 0)
                    comments += int(video.get("comments") or 0)
                    shares += int(video.get("shares") or 0)
                    favorites += int(video.get("favorites") or 0)

            previous_totals[creator_id] = {
                "followers": int(row.get("followers") or 0),
                "likes_total": current_likes,
                "video_count": current_videos,
                "views_total": current_views,
                "comments_total": current_comments,
                "shares_total": current_shares,
                "favorites_total": current_favorites,
            }

        if video_posts_from_list > 0:
            posted_videos = video_posts_from_list

        daily_rows.append({
            "date": day_key,
            "posted_videos": posted_videos,
            "views": views,
            "likes": likes,
            "comments": comments,
            "shares": shares,
            "favorites": favorites,
            "engagement_rate": _engagement_rate(
                views,
                likes=likes,
                favorites=favorites,
                comments=comments,
                shares=shares,
            ),
            "followers": followers,
            "active_accounts": active_accounts,
        })

    return daily_rows


def _sum_metric(rows: Sequence[Dict[str, Any]], key: str) -> int:
    return sum(int(row.get(key) or 0) for row in rows)


def _delta(current: int, previous: int) -> int:
    return int(current) - int(previous)


def build_dashboard(
    *,
    days: int = 14,
    creator_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    configured = get_configured_creators()
    selected_ids = list(creator_ids or [row["creator_id"] for row in configured])
    selected_ids = [cid for cid in selected_ids if get_creator_by_id(cid)]

    snapshots = _filter_snapshots(load_snapshots(), creator_ids=selected_ids, days=days + 1)
    grouped = _latest_by_creator_day(snapshots)
    daily = _daily_points(grouped, creator_ids=selected_ids, days=days)

    creators_payload = []
    summary_followers = 0
    summary_videos = 0
    summary_likes = 0
    summary_views = 0
    summary_comments = 0
    summary_shares = 0
    summary_favorites = 0
    summary_interaction_likes = 0
    active_accounts = 0

    trend_followers = 0
    trend_videos = 0
    trend_likes = 0
    trend_views = 0

    all_videos: List[Dict[str, Any]] = []
    last_refreshed_at = None

    for creator in configured:
        if creator["creator_id"] not in selected_ids:
            continue
        creator_id = creator["creator_id"]
        latest = latest_snapshot_for_creator(creator_id)
        if latest:
            active_accounts += 1
            if not last_refreshed_at or (latest.get("recorded_at") or "") > last_refreshed_at:
                last_refreshed_at = latest.get("recorded_at")

        current_followers = int((latest or {}).get("followers") or 0)
        current_videos = int((latest or {}).get("video_count") or 0)
        current_likes = int((latest or {}).get("likes_total") or 0)
        current_views = int((latest or {}).get("views_total") or 0)
        current_comments = int((latest or {}).get("comments_total") or 0)
        current_shares = int((latest or {}).get("shares_total") or 0)
        current_favorites = int((latest or {}).get("favorites_total") or 0)
        video_totals = _video_metric_totals((latest or {}).get("videos") or [])
        if video_totals["views"] > 0:
            current_views = video_totals["views"]
            current_comments = video_totals["comments"]
            current_shares = video_totals["shares"]
            current_favorites = video_totals["favorites"]
            interaction_likes = video_totals["likes"]
        else:
            interaction_likes = current_likes

        summary_followers += current_followers
        summary_videos += current_videos
        summary_likes += current_likes
        summary_views += current_views
        summary_comments += current_comments
        summary_shares += current_shares
        summary_favorites += current_favorites
        summary_interaction_likes += interaction_likes

        period_start_day = datetime.now(timezone.utc).date() - timedelta(days=max(1, days) - 1)
        start_key = _date_key(period_start_day)
        start_row = grouped.get((creator_id, start_key))
        if start_row:
            trend_followers += _delta(current_followers, int(start_row.get("followers") or 0))
            trend_videos += _delta(current_videos, int(start_row.get("video_count") or 0))
            trend_likes += _delta(current_likes, int(start_row.get("likes_total") or 0))
            trend_views += _delta(
                current_views,
                int(start_row.get("views_total") or 0),
            )

        for video in (latest or {}).get("videos") or []:
            all_videos.append({
                **video,
                "creator_id": creator_id,
                "creator_name": creator.get("name"),
            })

        creators_payload.append({
            "creator_id": creator_id,
            "name": creator.get("name"),
            "handle": (latest or {}).get("handle") or creator.get("handle"),
            "platform": creator.get("platform") or "tiktok",
            "profile_url": creator.get("profile_url"),
            "avatar_url": (latest or {}).get("avatar_url") or "",
            "tags": creator.get("tags") or [],
            "current": {
                "followers": current_followers,
                "videos": current_videos,
                "likes": current_likes,
                "views": current_views,
                "comments": current_comments,
                "shares": current_shares,
                "favorites": current_favorites,
                "engagement_rate": _engagement_rate(
                    current_views,
                    likes=interaction_likes,
                    favorites=current_favorites,
                    comments=current_comments,
                    shares=current_shares,
                ),
            },
            "last_refreshed_at": (latest or {}).get("recorded_at"),
            "fetch_error": (latest or {}).get("error"),
        })

    period_posted = _sum_metric(daily, "posted_videos")
    period_views = _sum_metric(daily, "views")
    period_likes = _sum_metric(daily, "likes")
    period_comments = _sum_metric(daily, "comments")
    period_shares = _sum_metric(daily, "shares")
    period_favorites = _sum_metric(daily, "favorites")

    period_start_day = datetime.now(timezone.utc).date() - timedelta(days=max(1, days) - 1)
    period_video_views = 0
    period_video_likes = 0
    period_video_comments = 0
    period_video_shares = 0
    period_video_favorites = 0
    for video in all_videos:
        posted_day = _utc_date(video.get("posted_at"))
        if not posted_day or posted_day < period_start_day:
            continue
        period_video_views += int(video.get("views") or 0)
        period_video_likes += int(video.get("likes") or 0)
        period_video_comments += int(video.get("comments") or 0)
        period_video_shares += int(video.get("shares") or 0)
        period_video_favorites += int(video.get("favorites") or 0)

    engagement_rate = _engagement_rate(
        summary_views,
        likes=summary_interaction_likes,
        favorites=summary_favorites,
        comments=summary_comments,
        shares=summary_shares,
    )
    period_engagement_rate = _engagement_rate(
        period_video_views or period_views,
        likes=period_video_likes or period_likes,
        favorites=period_video_favorites or period_favorites,
        comments=period_video_comments or period_comments,
        shares=period_video_shares or period_shares,
    )

    uses_likes_proxy = summary_views == 0 and summary_likes > 0
    display_views = summary_views if summary_views else summary_likes
    display_views_period = period_views if period_views else period_likes
    display_views_delta = trend_views if trend_views else trend_likes

    return {
        "days": days,
        "creators": creators_payload,
        "summary": {
            "posted_videos": summary_videos,
            "posted_videos_period": period_posted,
            "posted_videos_delta": trend_videos,
            "active_accounts": active_accounts,
            "views": display_views,
            "views_period": display_views_period,
            "views_delta": display_views_delta,
            "likes": summary_likes,
            "likes_period": period_likes,
            "likes_delta": trend_likes,
            "comments": summary_comments,
            "comments_period": period_comments,
            "shares": summary_shares,
            "shares_period": period_shares,
            "favorites": summary_favorites,
            "favorites_period": period_favorites,
            "engagement_rate": engagement_rate,
            "engagement_rate_period": period_engagement_rate,
            "followers": summary_followers,
            "followers_delta": trend_followers,
        },
        "daily": daily,
        "videos": sorted(
            all_videos,
            key=lambda item: item.get("posted_at") or "",
            reverse=True,
        ),
        "last_refreshed_at": last_refreshed_at,
        "uses_likes_as_views_proxy": uses_likes_proxy,
    }
