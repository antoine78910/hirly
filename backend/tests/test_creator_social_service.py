from datetime import datetime, timedelta, timezone

from creator_social_service import build_dashboard, refresh_creator
from creator_social_store import append_snapshot, load_snapshots, save_snapshots


def test_build_dashboard_aggregates_daily_deltas(monkeypatch):
    now = datetime(2026, 7, 6, 12, 0, tzinfo=timezone.utc)
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
