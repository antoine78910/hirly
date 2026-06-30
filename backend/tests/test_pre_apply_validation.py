import asyncio

import pytest
from fastapi import HTTPException

import server


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
        self.inserted = []
        self.updated = []

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if _matches(row, filter):
                return dict(row)
        return None

    def find(self, filter=None, projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, filter or {})])

    async def insert_one(self, document):
        self.inserted.append(dict(document))
        self.rows.append(dict(document))
        return {"inserted_id": document.get(self.key)}

    async def update_one(self, filter, update, upsert=False):
        self.updated.append((dict(filter), dict(update), upsert))
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
        if "$setOnInsert" in update and len([row for row in self.rows if _matches(row, filter)]) == 1:
            for key, value in update["$setOnInsert"].items():
                existing.setdefault(key, value)
        return {"matched_count": 1, "modified_count": 1}


class _FakeDB:
    def __init__(self, job):
        self.jobs = _Collection([job], key="job_id")
        self.swipes = _Collection([], key="swipe_id")
        self.applications = _Collection([], key="application_id")
        self.profiles = _Collection([{"user_id": "user_1", "cv_text": "CV"}], key="user_id")
        self.users = _Collection([{"user_id": "user_1", "billing": {"credits_remaining": 10, "credits_total": 10}}], key="user_id")


def _matches(row, filter):
    for key, expected in (filter or {}).items():
        if row.get(key) != expected:
            return False
    return True


def _job(url, **extra):
    return {
        "job_id": "job_1",
        "title": "Marketing Manager",
        "company": "Acme",
        "description": "Lead campaigns.",
        "external_url": url,
        "selected_apply_url": url,
        "manual_fulfillment_ready": True,
        "apply_fulfillment_status": "manual_ready",
        **extra,
    }


def _run_swipe(monkeypatch, job, *, allow_c=False):
    fake_db = _FakeDB(job)
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setenv("JOBS_ALLOW_UNKNOWN_TIER_APPLICATION", "true" if allow_c else "false")
    monkeypatch.setattr(server, "_billing_apply_credit_status", lambda user: _async({"is_premium": True, "credits_remaining": 10}))
    consume_calls = {"count": 0}

    async def _consume(user_id):
        consume_calls["count"] += 1
        return {"credits_remaining": 9, "credits_total": 10}

    monkeypatch.setattr(server, "_consume_application_credit", _consume)
    monkeypatch.setattr(server, "_schedule_application_generation", lambda user_id: None)
    user = server.User(user_id="user_1", email="user@example.com", name="User")
    req = server.SwipeRequest(job_id="job_1", direction="right")
    try:
        response = asyncio.run(server.swipe(req, user=user))
        error = None
    except HTTPException as exc:
        response = None
        error = exc
    return response, error, fake_db, consume_calls


async def _async(value):
    return value


def test_a_tier_valid_job_charges_and_creates_application(monkeypatch):
    response, error, fake_db, consume_calls = _run_swipe(monkeypatch, _job("https://boards.greenhouse.io/acme/jobs/123"))
    assert error is None
    assert response["applied"] is True
    assert consume_calls["count"] == 1
    assert len(fake_db.applications.rows) == 1


def test_b_tier_valid_job_charges_and_creates_application(monkeypatch):
    response, error, fake_db, consume_calls = _run_swipe(monkeypatch, _job("https://jobs.smartrecruiters.com/acme/123"))
    assert error is None
    assert response["applied"] is True
    assert consume_calls["count"] == 1
    assert len(fake_db.applications.rows) == 1


@pytest.mark.parametrize("url", [
    "https://www.linkedin.com/jobs/view/123",
    "https://www.indeed.com/viewjob?jk=123",
    "https://candidat.francetravail.fr/offres/recherche/detail/123",
])
def test_login_required_job_blocks_without_credit_or_application(monkeypatch, url):
    response, error, fake_db, consume_calls = _run_swipe(monkeypatch, _job(url))
    assert response is None
    assert error.status_code == 422
    assert error.detail["blocked"] is True
    assert consume_calls["count"] == 0
    assert len(fake_db.applications.rows) == 0
    assert len(fake_db.swipes.rows) == 0


def test_missing_apply_url_blocks_without_credit_or_application(monkeypatch):
    response, error, fake_db, consume_calls = _run_swipe(monkeypatch, _job(None, external_url=None, selected_apply_url=None))
    assert response is None
    assert error.status_code == 422
    assert error.detail["applyability_tier"] == "E"
    assert consume_calls["count"] == 0
    assert len(fake_db.applications.rows) == 0


def test_c_tier_blocks_by_default(monkeypatch):
    response, error, fake_db, consume_calls = _run_swipe(monkeypatch, _job("https://careers.acme.com/jobs/123"))
    assert response is None
    assert error.status_code == 422
    assert error.detail["applyability_tier"] == "C"
    assert consume_calls["count"] == 0
    assert len(fake_db.applications.rows) == 0


def test_c_tier_allowed_when_enabled_and_manual_ready(monkeypatch):
    response, error, fake_db, consume_calls = _run_swipe(monkeypatch, _job("https://careers.acme.com/jobs/123"), allow_c=True)
    assert error is None
    assert response["applied"] is True
    assert consume_calls["count"] == 1
    assert len(fake_db.applications.rows) == 1


def test_expired_job_blocks_without_credit(monkeypatch):
    response, error, fake_db, consume_calls = _run_swipe(
        monkeypatch,
        _job("https://boards.greenhouse.io/acme/jobs/123", description="This job is no longer available."),
    )
    assert response is None
    assert error.status_code == 422
    assert error.detail["applyability_tier"] == "E"
    assert consume_calls["count"] == 0
    assert len(fake_db.applications.rows) == 0


def test_old_job_without_validation_fields_is_revalidated_and_persisted(monkeypatch):
    response, error, fake_db, consume_calls = _run_swipe(monkeypatch, _job("https://jobs.lever.co/acme/123"))
    assert error is None
    assert consume_calls["count"] == 1
    assert fake_db.jobs.updated
    latest_job = fake_db.jobs.rows[0]
    assert latest_job["validation_status"] == "valid"
    assert latest_job["applyability_tier"] == "A"


def test_left_swipe_does_not_require_application_validation(monkeypatch):
    fake_db = _FakeDB(_job("https://www.linkedin.com/jobs/view/123"))
    monkeypatch.setattr(server, "db", fake_db)
    user = server.User(user_id="user_1", email="user@example.com", name="User")
    req = server.SwipeRequest(job_id="job_1", direction="left")
    response = asyncio.run(server.swipe(req, user=user))
    assert response["applied"] is False
    assert len(fake_db.swipes.rows) == 1
    assert len(fake_db.applications.rows) == 0
