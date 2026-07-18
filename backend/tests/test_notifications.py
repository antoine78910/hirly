import asyncio

import pytest
from fastapi import HTTPException

import server
from notifications_service import create_notification, resolve_user_language


def test_resolve_user_language_reads_valid_values():
    assert resolve_user_language({"language": "en"}) == "en"
    assert resolve_user_language({"language": "fr"}) == "fr"


def test_resolve_user_language_defaults_to_french():
    assert resolve_user_language({}) == "fr"
    assert resolve_user_language(None) == "fr"
    assert resolve_user_language({"language": "de"}) == "fr"


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None

    def find(self, filter=None, projection=None):
        filter = filter or {}
        matches = [dict(row) for row in self.rows if all(row.get(k) == v for k, v in filter.items())]
        return _Cursor(matches)

    async def update_one(self, filter, update, upsert=False):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                if "$set" in update:
                    for key, value in update["$set"].items():
                        if "." in key:
                            top, nested = key.split(".", 1)
                            row.setdefault(top, {})[nested] = value
                        else:
                            row[key] = value
                return {"matched_count": 1, "modified_count": 1}
        if upsert:
            new_row = dict(filter)
            new_row.update(update.get("$set", {}))
            self.rows.append(new_row)
            return {"matched_count": 0, "modified_count": 0, "upserted_id": True}
        return {"matched_count": 0, "modified_count": 0}


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, key, direction=1):
        self._rows.sort(key=lambda r: r.get(key) or "", reverse=direction < 0)
        return self

    async def to_list(self, limit=None):
        return self._rows[:limit] if limit else list(self._rows)


class _DB:
    def __init__(self, *, users=None, notifications=None):
        self.users = _Collection(users or [])
        self.notifications = _Collection(notifications or [])


def _admin():
    return server.User(user_id="admin_1", email="admin@tryhirly.com", name="Admin")


def _base_user(**overrides):
    user = {
        "user_id": "user_1",
        "billing": {"referral_bonus_credits_total": 10, "referral_bonus_credits_remaining": 10},
    }
    user.update(overrides)
    return user


def test_create_notification_shape():
    doc = asyncio.run(create_notification(
        _DB_stub := type("S", (), {"notifications": _Collection([])})(),
        user_id="user_1", type="credits_granted", title="Title", body="Body",
    ))
    assert doc["user_id"] == "user_1"
    assert doc["type"] == "credits_granted"
    assert doc["read"] is False
    assert doc["notification_id"].startswith("notif_")
    assert _DB_stub.notifications.rows == [doc]


def test_get_notifications_orders_newest_first_and_counts_unread(monkeypatch):
    db = _DB(notifications=[
        {"notification_id": "n1", "user_id": "user_1", "read": True, "created_at": "2026-01-01T00:00:00+00:00"},
        {"notification_id": "n2", "user_id": "user_1", "read": False, "created_at": "2026-01-03T00:00:00+00:00"},
        {"notification_id": "n3", "user_id": "user_1", "read": False, "created_at": "2026-01-02T00:00:00+00:00"},
        {"notification_id": "other", "user_id": "user_2", "read": False, "created_at": "2026-01-04T00:00:00+00:00"},
    ])
    monkeypatch.setattr(server, "db", db)

    result = asyncio.run(server.get_notifications(user=server.User(user_id="user_1", email="a@b.com", name="A")))

    ids = [row["notification_id"] for row in result["notifications"]]
    assert ids == ["n2", "n3", "n1"]
    assert result["unread_count"] == 2


def test_mark_notification_read(monkeypatch):
    db = _DB(notifications=[{"notification_id": "n1", "user_id": "user_1", "read": False}])
    monkeypatch.setattr(server, "db", db)

    asyncio.run(server.mark_notification_read_route("n1", user=server.User(user_id="user_1", email="a@b.com", name="A")))

    assert db.notifications.rows[0]["read"] is True


def test_mark_all_notifications_read(monkeypatch):
    db = _DB(notifications=[
        {"notification_id": "n1", "user_id": "user_1", "read": False},
        {"notification_id": "n2", "user_id": "user_1", "read": False},
        {"notification_id": "n3", "user_id": "user_2", "read": False},
    ])
    monkeypatch.setattr(server, "db", db)

    result = asyncio.run(server.mark_all_notifications_read_route(user=server.User(user_id="user_1", email="a@b.com", name="A")))

    assert result["marked"] == 2
    assert db.notifications.rows[0]["read"] is True
    assert db.notifications.rows[1]["read"] is True
    assert db.notifications.rows[2]["read"] is False


def test_admin_grant_credits_is_additive_and_notifies(monkeypatch):
    db = _DB(users=[_base_user()])
    monkeypatch.setattr(server, "db", db)

    result = asyncio.run(server.admin_grant_credits(
        "user_1",
        server.AdminGrantCreditsRequest(credits=20, reason="Apology for CV issues"),
        admin=_admin(),
    ))

    assert result["referral_bonus_credits_total"] == 30
    assert result["referral_bonus_credits_remaining"] == 30
    assert db.users.rows[0]["billing"]["referral_bonus_credits_total"] == 30
    assert db.users.rows[0]["billing"]["referral_bonus_credits_remaining"] == 30

    assert len(db.notifications.rows) == 1
    notification = db.notifications.rows[0]
    assert notification["type"] == "credits_granted"
    assert notification["user_id"] == "user_1"
    assert "20" in notification["title"]
    assert notification["body"] == "Apology for CV issues"


def test_admin_grant_credits_notification_localized_for_english_user(monkeypatch):
    db = _DB(users=[_base_user(language="en")])
    monkeypatch.setattr(server, "db", db)

    asyncio.run(server.admin_grant_credits(
        "user_1", server.AdminGrantCreditsRequest(credits=5, reason="Test"), admin=_admin(),
    ))

    assert db.notifications.rows[0]["title"] == "You received 5 free credits"


def test_admin_grant_credits_notification_localized_for_french_user(monkeypatch):
    db = _DB(users=[_base_user(language="fr")])
    monkeypatch.setattr(server, "db", db)

    asyncio.run(server.admin_grant_credits(
        "user_1", server.AdminGrantCreditsRequest(credits=5, reason="Test"), admin=_admin(),
    ))

    assert db.notifications.rows[0]["title"] == "Vous avez reçu 5 crédits gratuits"


def test_admin_grant_credits_notification_defaults_to_french_when_unset(monkeypatch):
    db = _DB(users=[_base_user()])
    monkeypatch.setattr(server, "db", db)

    asyncio.run(server.admin_grant_credits(
        "user_1", server.AdminGrantCreditsRequest(credits=5, reason="Test"), admin=_admin(),
    ))

    assert db.notifications.rows[0]["title"] == "Vous avez reçu 5 crédits gratuits"


def test_admin_grant_credits_missing_user_raises_404(monkeypatch):
    db = _DB(users=[])
    monkeypatch.setattr(server, "db", db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.admin_grant_credits(
            "missing_user",
            server.AdminGrantCreditsRequest(credits=5, reason="test"),
            admin=_admin(),
        ))
    assert exc.value.status_code == 404


def test_admin_dependency_rejects_non_admin_for_grant_credits():
    user = server.User(user_id="u", email="user@example.com", name="User")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.require_admin_user(user))
    assert exc.value.status_code == 403
