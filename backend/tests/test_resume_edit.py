import asyncio

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

    async def update_one(self, filter, update, upsert=False):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                if "$set" in update:
                    row.update(update["$set"])
                return {"matched_count": 1, "modified_count": 1}
        return {"matched_count": 0, "modified_count": 0}


class _DB:
    def __init__(self, *, applications=None, profiles=None, jobs=None):
        self.applications = _Collection(applications or [])
        self.profiles = _Collection(profiles or [])
        self.jobs = _Collection(jobs or [])


def _user(**overrides):
    defaults = dict(user_id="user_1", email="candidate@example.com", name="Jane Candidate")
    defaults.update(overrides)
    return server.User(**defaults)


def _base_application(**overrides):
    app = {
        "application_id": "app_1",
        "user_id": "user_1",
        "job_id": "job_1",
        "cv_source": "tailored",
        "tailored_resume_structured": {
            "headline": "Backend Engineer | Python | APIs",
            "summary": "Backend engineer with 5 years of experience.",
            "experience": [{
                "role": "Software Engineer",
                "company": "Acme",
                "location": "Paris",
                "duration": "2020 - Present",
                "highlights": ["Built APIs", "Improved performance"],
            }],
            "education": [{"degree": "MSc Computer Science", "school": "Sorbonne", "year": "2019"}],
            "languages": ["English - Fluent"],
        },
    }
    app.update(overrides)
    return app


def _base_profile(**overrides):
    profile = {"user_id": "user_1", "contact": {"name": "Jane Doe", "email": "jane@example.com"}}
    profile.update(overrides)
    return profile


def _edit_body(**overrides):
    body = {
        "experience": [{
            "role": "Senior Software Engineer",
            "company": "Acme",
            "location": "Paris",
            "duration": "2020 - Present",
            "highlights": ["Rewrote the payments service", "Mentored two engineers"],
        }],
        "education": [{"degree": "MSc Computer Science", "school": "Sorbonne", "year": "2019"}],
        "languages": ["English - Native"],
    }
    body.update(overrides)
    return server.ResumeEditRequest(**body)


def test_edit_resume_updates_content_and_regenerates_docx(monkeypatch):
    db = _DB(
        applications=[_base_application()],
        profiles=[_base_profile()],
        jobs=[{"job_id": "job_1", "title": "Senior Backend Engineer"}],
    )
    monkeypatch.setattr(server, "db", db)
    user = _user()

    result = asyncio.run(server.edit_application_resume("app_1", _edit_body(), user=user))

    resume = result["tailored_resume_structured"]
    assert resume["experience"][0]["role"] == "Senior Software Engineer"
    assert resume["experience"][0]["highlights"] == ["Rewrote the payments service", "Mentored two engineers"]
    assert resume["languages"] == ["English - Native"]
    # Untouched fields preserved.
    assert resume["headline"] == "Backend Engineer | Python | APIs"
    assert resume["summary"] == "Backend engineer with 5 years of experience."
    assert result["tailored_cv_file_b64"]
    assert result["ai_tailored_cv_file_b64"] == result["tailored_cv_file_b64"]


def test_edit_resume_does_not_overwrite_active_file_when_using_original_cv(monkeypatch):
    db = _DB(
        applications=[_base_application(cv_source="original", tailored_cv_file_b64="ORIGINAL_B64")],
        profiles=[_base_profile()],
        jobs=[{"job_id": "job_1", "title": "Senior Backend Engineer"}],
    )
    monkeypatch.setattr(server, "db", db)
    user = _user()

    result = asyncio.run(server.edit_application_resume("app_1", _edit_body(), user=user))

    assert result["cv_source"] == "original"
    assert result["tailored_cv_file_b64"] == "ORIGINAL_B64"
    # Backup is still updated so switching back to "tailored" reflects the edit.
    assert result["ai_tailored_cv_file_b64"] not in (None, "ORIGINAL_B64")


def test_edit_resume_resets_approval_status(monkeypatch):
    db = _DB(
        applications=[_base_application(document_review_status="approved", document_review_approved_at="2026-01-01T00:00:00Z")],
        profiles=[_base_profile()],
        jobs=[{"job_id": "job_1", "title": "Senior Backend Engineer"}],
    )
    monkeypatch.setattr(server, "db", db)
    user = _user()

    result = asyncio.run(server.edit_application_resume("app_1", _edit_body(), user=user))

    assert result["document_review_status"] == "awaiting_user"
    assert result["document_review_approved_at"] is None


def test_edit_resume_404s_for_missing_application(monkeypatch):
    db = _DB(applications=[], profiles=[_base_profile()], jobs=[])
    monkeypatch.setattr(server, "db", db)
    user = _user()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.edit_application_resume("app_missing", _edit_body(), user=user))

    assert exc_info.value.status_code == 404


def test_edit_resume_400s_for_missing_profile(monkeypatch):
    db = _DB(applications=[_base_application()], profiles=[], jobs=[{"job_id": "job_1"}])
    monkeypatch.setattr(server, "db", db)
    user = _user()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.edit_application_resume("app_1", _edit_body(), user=user))

    assert exc_info.value.status_code == 400
