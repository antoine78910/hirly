import asyncio

import pytest
from fastapi import HTTPException

import server
from server import User


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def limit(self, count):
        return self

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, length):
        return list(self.rows[:length])


class _Collection:
    def __init__(self, rows=None, key="job_id"):
        self.rows = list(rows or [])
        self.key = key
        self.deleted = []

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if _matches(row, filter):
                return dict(row)
        return None

    def find(self, filter=None, projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, filter or {})])

    async def insert_one(self, document):
        self.rows.append(dict(document))
        return {"inserted_id": document.get(self.key)}

    async def update_one(self, filter, update, upsert=False):
        existing = None
        for row in self.rows:
            if _matches(row, filter):
                existing = row
                break
        if existing is None:
            if not upsert:
                return {"matched_count": 0, "modified_count": 0}
            existing = dict(filter)
            self.rows.append(existing)
        if "$set" in update:
            existing.update(update["$set"])
        return {"matched_count": 1, "modified_count": 1}

    async def delete_one(self, filter):
        before = len(self.rows)
        self.rows = [row for row in self.rows if not _matches(row, filter)]
        self.deleted.append(dict(filter))
        return {"deleted_count": before - len(self.rows)}


class _FakeDB:
    def __init__(self, *, jobs=None, swipes=None, profiles=None):
        self.jobs = _Collection(jobs or [], key="job_id")
        self.swipes = _Collection(swipes or [], key="swipe_id")
        self.applications = _Collection([], key="application_id")
        self.profiles = _Collection(
            profiles or [{"user_id": "user_1", "cv_text": "CV body", "contact": {"name": "Alex"}}],
            key="user_id",
        )


def _matches(row, filter):
    for key, expected in (filter or {}).items():
        if row.get(key) != expected:
            return False
    return True


def _job():
    return {
        "job_id": "job_1",
        "title": "Analyst",
        "company": "Acme",
        "description": "Analyze data.",
        "external_url": "https://boards.greenhouse.io/acme/jobs/1",
        "selected_apply_url": "https://boards.greenhouse.io/acme/jobs/1",
        "manual_fulfillment_ready": True,
        "apply_fulfillment_status": "manual_ready",
        "provider": "france_travail",
        "source": "france_travail",
    }


def test_apply_from_passed_restores_job_snapshot(monkeypatch):
    job = _job()
    swipe = {
        "user_id": "user_1",
        "job_id": "job_1",
        "direction": "left",
        "job_snapshot": job,
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    fake_db = _FakeDB(jobs=[], swipes=[swipe])
    monkeypatch.setattr(server, "db", fake_db)

    swipe_calls = []

    async def fake_swipe(req, user):
        swipe_calls.append((req.job_id, req.direction))
        return {"ok": True, "applied": True, "application_id": "app_1"}

    monkeypatch.setattr(server, "swipe", fake_swipe)

    user = User(user_id="user_1", email="u@example.com", name="User")
    result = asyncio.run(server.apply_from_passed("job_1", user))

    assert result["applied"] is True
    assert swipe_calls == [("job_1", "right")]
    assert len(fake_db.jobs.rows) == 1
    assert fake_db.jobs.rows[0]["job_id"] == "job_1"
    assert not any(row.get("job_id") == "job_1" for row in fake_db.swipes.rows)


def test_apply_from_passed_requires_left_swipe(monkeypatch):
    fake_db = _FakeDB(jobs=[_job()], swipes=[])
    monkeypatch.setattr(server, "db", fake_db)
    user = User(user_id="user_1", email="u@example.com", name="User")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.apply_from_passed("job_1", user))

    assert exc.value.status_code == 404


def test_swipe_left_stores_job_snapshot():
    job = _job()
    doc = server._swipe_insert_doc("user_1", "job_1", "left", job)

    assert doc["direction"] == "left"
    assert doc["job_snapshot"]["job_id"] == "job_1"
    assert doc["job_snapshot"]["title"] == "Analyst"
