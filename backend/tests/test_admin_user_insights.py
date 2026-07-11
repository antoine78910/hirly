import asyncio

import server
from tests.test_admin_users_billing import _Collection


def _fake_db_with_activity():
    user = {
        "user_id": "user-1",
        "email": "user1@example.com",
        "name": "User One",
        "created_at": "2026-07-01T10:00:00+00:00",
        "last_login_at": "2026-07-11T09:00:00+00:00",
        "billing": {"plan": None, "subscription_status": None},
    }
    profile = {
        "user_id": "user-1",
        "extras": {
            "onboarding": {
                "job_search_status": "actively_looking",
                "onboarding_location": "Paris, France",
                "contract_type": "full_time",
                "categories": [{"id": "sales", "label": "Sales"}],
                "selected_roles": ["Account Executive"],
                "interviews_per_week": 3,
                "acquisition_source": "tiktok",
                "referral_code": None,
                "salary_min": 40000,
                "salary_max": 60000,
            },
        },
    }
    events = [
        {"user_id": "user-1", "event": "onboarding_started", "created_at": "2026-07-11T08:00:00+00:00", "properties": {}},
        {"user_id": "user-1", "event": "onboarding_step_completed", "created_at": "2026-07-11T08:01:00+00:00", "properties": {"step": "jobSearch", "step_index": 2}},
        {"user_id": "user-1", "event": "onboarding_step_completed", "created_at": "2026-07-11T08:05:00+00:00", "properties": {"step": "location", "step_index": 3}},
        # Isolated event far later => separate session.
        {"user_id": "user-1", "event": "landing_view", "created_at": "2026-07-11T09:30:00+00:00", "properties": {}},
    ]
    sessions = [
        {"user_id": "user-1", "session_token": "sess-1", "created_at": "2026-07-11T09:00:00+00:00"},
        {"user_id": "user-1", "session_token": "sess-2", "created_at": "2026-07-05T09:00:00+00:00"},
    ]
    return type("DB", (), {
        "users": _Collection([user], "users"),
        "profiles": _Collection([profile], "profiles"),
        "swipes": _Collection([], "swipes"),
        "applications": _Collection([], "applications"),
        "jobs": _Collection([], "jobs"),
        "analytics_events": _Collection(events, "analytics_events"),
        "user_sessions": _Collection(sessions, "user_sessions"),
    })()


def test_onboarding_progress_reports_drop_off_step():
    events = [
        {"event": "onboarding_started", "created_at": "2026-07-11T08:00:00+00:00"},
        {"event": "onboarding_step_completed", "created_at": "2026-07-11T08:01:00+00:00", "properties": {"step": "jobSearch", "step_index": 2}},
        {"event": "onboarding_step_completed", "created_at": "2026-07-11T08:05:00+00:00", "properties": {"step": "location", "step_index": 3}},
    ]
    progress = server._onboarding_progress_for_events(events)
    assert progress["completed"] is False
    assert progress["furthest_step"] == "location"
    assert progress["drop_off_step"] == "contractType"


def test_onboarding_progress_completed():
    events = [
        {"event": "onboarding_started", "created_at": "2026-07-11T08:00:00+00:00"},
        {"event": "onboarding_completed", "created_at": "2026-07-11T08:30:00+00:00"},
    ]
    progress = server._onboarding_progress_for_events(events)
    assert progress["completed"] is True
    assert progress["drop_off_step"] is None


def test_estimate_time_spent_splits_sessions_on_large_gaps():
    timestamps = [
        "2026-07-11T08:00:00+00:00",
        "2026-07-11T08:05:00+00:00",
        "2026-07-11T09:30:00+00:00",  # gap > 20 min => new session
    ]
    stats = server._estimate_time_spent(timestamps)
    assert stats["sessions"] == 2
    assert stats["minutes"] >= 5.5


def test_admin_list_users_exposes_activity_fields(monkeypatch):
    monkeypatch.setattr(server, "db", _fake_db_with_activity())

    response = asyncio.run(server.admin_list_users(admin=object()))
    user = response["users"][0]

    assert user["last_login_at"] == "2026-07-11T09:00:00+00:00"
    assert user["onboarding_completed"] is False
    assert user["onboarding_drop_off_step_label"] is not None
    assert user["time_spent_minutes"] > 0


def test_admin_get_user_exposes_onboarding_and_activity(monkeypatch):
    monkeypatch.setattr(server, "db", _fake_db_with_activity())

    response = asyncio.run(server.admin_get_user("user-1", admin=object()))

    onboarding = response["onboarding"]
    assert onboarding["answers"]["job_search_status"] == "actively_looking"
    assert onboarding["progress"]["completed"] is False
    assert onboarding["progress"]["drop_off_step"] == "contractType"

    activity = response["activity"]
    assert activity["last_login_at"] == "2026-07-11T09:00:00+00:00"
    assert activity["login_count"] == 2
    assert activity["total_events"] == 4
