import asyncio
from types import SimpleNamespace

import server


class _Collection:
    def __init__(self, found=None):
        self.found = found
        self.find_calls = 0
        self.update_calls = 0
        self.insert_calls = 0

    async def find_one(self, *_args, **_kwargs):
        self.find_calls += 1
        return self.found

    async def update_one(self, *_args, **_kwargs):
        self.update_calls += 1

    async def insert_one(self, *_args, **_kwargs):
        self.insert_calls += 1


def test_upsert_existing_auth_user_avoids_redundant_post_update_read(monkeypatch):
    users = _Collection(
        {
            "user_id": "user_1",
            "email": "person@example.com",
            "name": "Old",
            "untouched": True,
        }
    )
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    monkeypatch.setattr(server, "_find_user_by_email", users.find_one)

    result = asyncio.run(
        server._upsert_auth_user(
            "PERSON@example.com",
            "New",
            None,
            {"last_login_at": "2026-07-20T00:00:00+00:00"},
        )
    )

    assert users.find_calls == 1
    assert users.update_calls == 1
    assert result["user_id"] == "user_1"
    assert result["name"] == "New"
    assert result["untouched"] is True


def test_upsert_new_auth_user_returns_inserted_document_without_read(monkeypatch):
    users = _Collection()
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    monkeypatch.setattr(server, "_find_user_by_email", users.find_one)

    result = asyncio.run(server._upsert_auth_user("NEW@example.com", "New", None))

    assert users.find_calls == 1
    assert users.insert_calls == 1
    assert result["email"] == "new@example.com"
    assert result["user_id"].startswith("user_")
