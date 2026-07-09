from datetime import datetime, timedelta, timezone

from creator_social_maintenance import (
    get_creator_social_refresh_status,
    refresh_interval_hours,
    should_refresh_creator_social,
)


def test_should_refresh_when_snapshot_missing(monkeypatch):
    monkeypatch.setattr(
        "creator_social_maintenance.get_configured_creators",
        lambda: [{"creator_id": "eva"}],
    )
    monkeypatch.setattr(
        "creator_social_maintenance.latest_snapshot_for_creator",
        lambda _cid: None,
    )
    assert should_refresh_creator_social() is True


def test_should_not_refresh_when_all_fresh(monkeypatch):
    now = datetime(2026, 7, 9, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        "creator_social_maintenance.get_configured_creators",
        lambda: [{"creator_id": "eva"}, {"creator_id": "elodie"}],
    )
    monkeypatch.setattr(
        "creator_social_maintenance.latest_snapshot_for_creator",
        lambda cid: {
            "creator_id": cid,
            "recorded_at": (now - timedelta(hours=2)).isoformat(),
        },
    )
    assert should_refresh_creator_social(now=now) is False


def test_should_refresh_when_one_creator_stale(monkeypatch):
    now = datetime(2026, 7, 9, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        "creator_social_maintenance.get_configured_creators",
        lambda: [{"creator_id": "eva"}, {"creator_id": "elodie"}],
    )

    def latest(cid):
        if cid == "eva":
            return {"creator_id": cid, "recorded_at": (now - timedelta(hours=2)).isoformat()}
        return {"creator_id": cid, "recorded_at": (now - timedelta(hours=8)).isoformat()}

    monkeypatch.setattr("creator_social_maintenance.latest_snapshot_for_creator", latest)
    assert should_refresh_creator_social(now=now) is True


def test_refresh_status_includes_interval(monkeypatch):
    monkeypatch.setenv("CREATOR_SOCIAL_REFRESH_INTERVAL_HOURS", "6")
    status = get_creator_social_refresh_status()
    assert status["interval_hours"] == refresh_interval_hours() == 6
