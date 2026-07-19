import asyncio
import io

import httpx
import pytest
from fastapi import HTTPException, UploadFile
from openai import RateLimitError

import server


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None

    async def update_one(self, filter, update, upsert=False):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                if "$set" in update:
                    row.update(update["$set"])
                return {"matched_count": 1, "modified_count": 1}
        if upsert:
            new_row = dict(filter)
            new_row.update(update.get("$set", {}))
            self.rows.append(new_row)
            return {"matched_count": 0, "modified_count": 0, "upserted_id": True}
        return {"matched_count": 0, "modified_count": 0}


class _DB:
    def __init__(self):
        self.profiles = _Collection([])


def _user():
    return server.User(user_id="user_1", email="user@example.com", name="Test User")


def _rate_limit_error():
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(status_code=429, request=request)
    return RateLimitError("You exceeded your current quota", response=response, body=None)


def _cv_upload_file():
    content = b"Jane Doe\nSoftware Engineer\nExperience: five years building web applications at Acme Corp."
    return UploadFile(filename="cv.txt", file=io.BytesIO(content), headers={"content-type": "text/plain"})


def test_upload_cv_falls_back_to_heuristic_extraction_when_ai_quota_exceeded(monkeypatch):
    db = _DB()
    monkeypatch.setattr(server, "db", db)

    async def _raise_rate_limit(cv_text):
        raise _rate_limit_error()

    monkeypatch.setattr(server, "claude_extract_profile", _raise_rate_limit)

    result = asyncio.run(server.upload_cv(file=_cv_upload_file(), user=_user()))

    assert result["cv_filename"] == "cv.txt"
    assert db.profiles.rows[0]["user_id"] == "user_1"
    assert db.profiles.rows[0]["cv_filename"] == "cv.txt"


def test_upload_cv_surfaces_clean_message_for_other_ai_failures(monkeypatch):
    db = _DB()
    monkeypatch.setattr(server, "db", db)

    async def _raise_generic(cv_text):
        raise RuntimeError("boom: some internal provider detail nobody should see")

    monkeypatch.setattr(server, "claude_extract_profile", _raise_generic)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.upload_cv(file=_cv_upload_file(), user=_user()))

    assert exc.value.status_code == 500
    assert "boom" not in exc.value.detail
    assert "some internal provider detail" not in exc.value.detail
