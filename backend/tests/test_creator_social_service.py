from datetime import datetime, timedelta, timezone

import creator_social_service
from creator_social_service import _engagement_rate, build_dashboard, refresh_creator
from creator_social_store import append_snapshot, load_snapshots, save_snapshots


def _freeze_utc_now(monkeypatch, fixed: datetime):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return fixed.replace(tzinfo=None)
            return fixed.astimezone(tz)

    monkeypatch.setattr(creator_social_service, "datetime", FrozenDateTime)


def test_build_dashboard_aggregates_daily_deltas(monkeypatch):
    now = datetime(2026, 7, 6, 12, 0, tzinfo=timezone.utc)
    _freeze_utc_now(monkeypatch, now)
    snapshots = [
        {
            "creator_id": "eva",
            "recorded_at": (now - timedelta(days=2)).isoformat(),
            "followers": 1,
            "likes_total": 50,
            "video_count": 1,
            "views_total": 0,
            "comments_total": 2,
            "videos": [],
        },
        {
            "creator_id": "eva",
            "recorded_at": (now - timedelta(days=1)).isoformat(),
            "followers": 2,
            "likes_total": 90,
            "video_count": 2,
            "views_total": 0,
            "comments_total": 4,
            "videos": [],
        },
        {
            "creator_id": "eva",
            "recorded_at": now.isoformat(),
            "followers": 2,
            "likes_total": 132,
            "video_count": 2,
            "views_total": 0,
            "comments_total": 6,
            "videos": [],
        },
    ]
    monkeypatch.setattr("creator_social_service.load_snapshots", lambda: snapshots)
    monkeypatch.setattr("creator_social_service.latest_snapshot_for_creator", lambda cid: snapshots[-1] if cid == "eva" else None)

    dashboard = build_dashboard(days=3, creator_ids=["eva"])
    assert dashboard["summary"]["followers"] == 2
    assert dashboard["summary"]["likes"] == 132
    assert len(dashboard["daily"]) == 3
    assert dashboard["daily"][-1]["followers"] == 2


def test_engagement_rate_uses_likes_favorites_comments_shares_over_views(monkeypatch):
    _freeze_utc_now(monkeypatch, datetime(2026, 7, 9, 12, 0, tzinfo=timezone.utc))
    rate = _engagement_rate(
        1000,
        likes=50,
        favorites=10,
        comments=5,
        shares=5,
    )
    assert rate == 7.0

    snapshots = [
        {
            "creator_id": "eva",
            "recorded_at": "2026-07-09T12:00:00+00:00",
            "followers": 2,
            "likes_total": 999,
            "video_count": 1,
            "views_total": 1000,
            "comments_total": 5,
            "shares_total": 5,
            "favorites_total": 10,
            "videos": [
                {
                    "video_id": "1",
                    "posted_at": "2026-07-09T10:00:00+00:00",
                    "views": 1000,
                    "likes": 50,
                    "comments": 5,
                    "shares": 5,
                    "favorites": 10,
                }
            ],
        }
    ]

    def fake_configured():
        return [{"creator_id": "eva", "name": "Eva", "platform": "tiktok", "handle": "hirlyjob"}]

    def fake_get_creator(cid):
        return fake_configured()[0] if cid == "eva" else None

    monkeypatch.setattr(creator_social_service, "load_snapshots", lambda: snapshots)
    monkeypatch.setattr(creator_social_service, "latest_snapshot_for_creator", lambda cid: snapshots[-1] if cid == "eva" else None)
    monkeypatch.setattr(creator_social_service, "get_configured_creators", fake_configured)
    monkeypatch.setattr(creator_social_service, "get_creator_by_id", fake_get_creator)
    dashboard = build_dashboard(days=7, creator_ids=["eva"])
    assert dashboard["summary"]["engagement_rate"] == 7.0


def test_refresh_creator_stores_snapshot(monkeypatch, tmp_path):
    monkeypatch.setattr("creator_social_store.STORE_PATH", tmp_path / "snapshots.json")

    def fake_fetch(handle):
        return {
            "handle": handle,
            "nickname": "Eva",
            "avatar_url": "",
            "profile_url": f"https://www.tiktok.com/@{handle}",
            "followers": 2,
            "following": 3,
            "likes_total": 132,
            "video_count": 2,
            "videos": [],
            "views_total": 0,
            "comments_total": 0,
        }

    monkeypatch.setattr("creator_social_service.fetch_tiktok_profile", fake_fetch)
    row = refresh_creator("eva")
    assert row["creator_id"] == "eva"
    assert row["followers"] == 2
    stored = load_snapshots()
    assert len(stored) == 1
