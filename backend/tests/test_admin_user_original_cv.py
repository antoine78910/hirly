import asyncio
import base64

import pytest
from fastapi import HTTPException

import server


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None


class _DB:
    def __init__(self, profiles=None):
        self.profiles = _Collection(profiles or [])


def test_admin_download_user_original_cv_returns_file(monkeypatch):
    content = b"fake pdf bytes"
    db = _DB(profiles=[{
        "user_id": "user_1",
        "cv_original_b64": base64.b64encode(content).decode("ascii"),
        "cv_filename": "resume.pdf",
        "cv_mime": "application/pdf",
    }])
    monkeypatch.setattr(server, "db", db)
    admin = server.User(user_id="admin_1", email="admin@tryhirly.com", name="Admin")

    response = asyncio.run(server.admin_download_user_original_cv("user_1", admin=admin))

    assert response.body == content
    assert response.media_type == "application/pdf"
    assert "resume.pdf" in response.headers["content-disposition"]


def test_admin_download_user_original_cv_404s_when_not_uploaded(monkeypatch):
    db = _DB(profiles=[{"user_id": "user_1"}])
    monkeypatch.setattr(server, "db", db)
    admin = server.User(user_id="admin_1", email="admin@tryhirly.com", name="Admin")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.admin_download_user_original_cv("user_1", admin=admin))

    assert exc_info.value.status_code == 404


def test_admin_download_user_original_cv_404s_for_missing_profile(monkeypatch):
    db = _DB(profiles=[])
    monkeypatch.setattr(server, "db", db)
    admin = server.User(user_id="admin_1", email="admin@tryhirly.com", name="Admin")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.admin_download_user_original_cv("user_missing", admin=admin))

    assert exc_info.value.status_code == 404
