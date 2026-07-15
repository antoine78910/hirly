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
        "tailored_cv_file_b64": "AI_FILE_B64",
        "tailored_cv_filename": "ai_resume.docx",
        "tailored_cv_mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "ai_tailored_cv_file_b64": "AI_FILE_B64",
        "ai_tailored_cv_filename": "ai_resume.docx",
        "ai_tailored_cv_mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "cover_letter": {"greeting": "Dear team,", "paragraphs": ["Para one."], "sign_off": "Best,", "signature_name": "Jane"},
        "tailored_cover_letter": {"greeting": "Dear team,", "paragraphs": ["Para one."], "sign_off": "Best,", "signature_name": "Jane"},
    }
    app.update(overrides)
    return app


# ---------------------------------------------------------------- cv-source

def test_cv_source_switch_to_original_uses_profile_file(monkeypatch):
    db = _DB(
        applications=[_base_application()],
        profiles=[{"user_id": "user_1", "cv_original_b64": "ORIGINAL_B64", "cv_filename": "my_cv.pdf", "cv_mime": "application/pdf"}],
        jobs=[{"job_id": "job_1"}],
    )
    monkeypatch.setattr(server, "db", db)
    user = _user()

    result = asyncio.run(server.set_application_cv_source("app_1", server.CvSourceUpdate(source="original"), user=user))

    assert result["cv_source"] == "original"
    assert result["tailored_cv_file_b64"] == "ORIGINAL_B64"
    assert result["tailored_cv_filename"] == "my_cv.pdf"
    # AI backup is preserved so switching back works.
    assert result["ai_tailored_cv_file_b64"] == "AI_FILE_B64"


def test_cv_source_switch_to_original_fails_without_uploaded_cv(monkeypatch):
    db = _DB(
        applications=[_base_application()],
        profiles=[{"user_id": "user_1"}],
        jobs=[{"job_id": "job_1"}],
    )
    monkeypatch.setattr(server, "db", db)
    user = _user()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.set_application_cv_source("app_1", server.CvSourceUpdate(source="original"), user=user))

    assert exc_info.value.status_code == 400


def test_cv_source_switch_back_to_tailored_restores_ai_backup(monkeypatch):
    db = _DB(
        applications=[_base_application(
            cv_source="original",
            tailored_cv_file_b64="ORIGINAL_B64",
            tailored_cv_filename="my_cv.pdf",
        )],
        profiles=[{"user_id": "user_1"}],
        jobs=[{"job_id": "job_1"}],
    )
    monkeypatch.setattr(server, "db", db)
    user = _user()

    result = asyncio.run(server.set_application_cv_source("app_1", server.CvSourceUpdate(source="tailored"), user=user))

    assert result["cv_source"] == "tailored"
    assert result["tailored_cv_file_b64"] == "AI_FILE_B64"
    assert result["tailored_cv_filename"] == "ai_resume.docx"


def test_cv_source_switch_resets_approval_status(monkeypatch):
    db = _DB(
        applications=[_base_application(document_review_status="approved", document_review_approved_at="2026-01-01T00:00:00Z")],
        profiles=[{"user_id": "user_1", "cv_original_b64": "ORIGINAL_B64", "cv_filename": "my_cv.pdf", "cv_mime": "application/pdf"}],
        jobs=[{"job_id": "job_1"}],
    )
    monkeypatch.setattr(server, "db", db)
    user = _user()

    result = asyncio.run(server.set_application_cv_source("app_1", server.CvSourceUpdate(source="original"), user=user))

    assert result["document_review_status"] == "awaiting_user"
    assert result["document_review_approved_at"] is None


def test_cv_source_404s_for_missing_application(monkeypatch):
    db = _DB(applications=[], profiles=[], jobs=[])
    monkeypatch.setattr(server, "db", db)
    user = _user()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.set_application_cv_source("app_missing", server.CvSourceUpdate(source="original"), user=user))

    assert exc_info.value.status_code == 404


# ------------------------------------------------------------- cover-letter

def test_edit_cover_letter_splits_paragraphs_and_clears_fields(monkeypatch):
    db = _DB(applications=[_base_application()], profiles=[], jobs=[{"job_id": "job_1"}])
    monkeypatch.setattr(server, "db", db)
    user = _user()

    body_text = "Hello,\n\nFirst paragraph.\n\nSecond paragraph.\n\nBest regards,\n\nJane"
    result = asyncio.run(server.edit_application_cover_letter(
        "app_1", server.CoverLetterEditRequest(body_text=body_text), user=user,
    ))

    letter = result["cover_letter"]
    assert letter["paragraphs"] == ["Hello,", "First paragraph.", "Second paragraph.", "Best regards,", "Jane"]
    assert letter["greeting"] == ""
    assert letter["sign_off"] == ""
    assert letter["signature_name"] == ""
    assert letter["cover_letter_edited"] is True
    # tailored_cover_letter kept in sync
    assert result["tailored_cover_letter"]["cover_letter_edited"] is True


def test_edit_cover_letter_preserves_letterhead_fields(monkeypatch):
    app = _base_application()
    app["cover_letter"]["subject"] = "Candidature pour le poste"
    app["cover_letter"]["sender_name"] = "Jane Candidate"
    app["tailored_cover_letter"]["subject"] = "Candidature pour le poste"
    app["tailored_cover_letter"]["sender_name"] = "Jane Candidate"
    db = _DB(applications=[app], profiles=[], jobs=[{"job_id": "job_1"}])
    monkeypatch.setattr(server, "db", db)
    user = _user()

    result = asyncio.run(server.edit_application_cover_letter(
        "app_1", server.CoverLetterEditRequest(body_text="New body text."), user=user,
    ))

    assert result["cover_letter"]["subject"] == "Candidature pour le poste"
    assert result["cover_letter"]["sender_name"] == "Jane Candidate"


def test_edit_cover_letter_rejects_empty_text(monkeypatch):
    db = _DB(applications=[_base_application()], profiles=[], jobs=[{"job_id": "job_1"}])
    monkeypatch.setattr(server, "db", db)
    user = _user()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.edit_application_cover_letter("app_1", server.CoverLetterEditRequest(body_text="   "), user=user))

    assert exc_info.value.status_code == 400


def test_edit_cover_letter_resets_approval_status(monkeypatch):
    db = _DB(
        applications=[_base_application(document_review_status="approved", document_review_approved_at="2026-01-01T00:00:00Z")],
        profiles=[],
        jobs=[{"job_id": "job_1"}],
    )
    monkeypatch.setattr(server, "db", db)
    user = _user()

    result = asyncio.run(server.edit_application_cover_letter(
        "app_1", server.CoverLetterEditRequest(body_text="New body text."), user=user,
    ))

    assert result["document_review_status"] == "awaiting_user"
    assert result["document_review_approved_at"] is None


def test_edit_cover_letter_404s_for_missing_application(monkeypatch):
    db = _DB(applications=[], profiles=[], jobs=[])
    monkeypatch.setattr(server, "db", db)
    user = _user()

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.edit_application_cover_letter("app_missing", server.CoverLetterEditRequest(body_text="x"), user=user))

    assert exc_info.value.status_code == 404
