import asyncio
import base64

import pytest

import server
from application_documents import DOCX_MIME


class _FakeCollection:
    def __init__(self, rows):
        self._rows = {row["_key"]: row for row in rows}

    async def find_one(self, query, projection=None):
        for row in self._rows.values():
            if all(row.get(k) == v for k, v in query.items()):
                return {k: v for k, v in row.items() if k != "_key"}
        return None

    async def update_one(self, query, update):
        for row in self._rows.values():
            if all(row.get(k) == v for k, v in query.items()):
                row.update(update.get("$set") or {})
                return
        raise AssertionError("no matching row to update")


class _FakeDB:
    def __init__(self, *, application, job, user, profile):
        self.applications = _FakeCollection([{**application, "_key": "app"}])
        self.jobs = _FakeCollection([{**job, "_key": "job"}])
        self.users = _FakeCollection([{**user, "_key": "user"}])
        self.profiles = _FakeCollection([{**profile, "_key": "profile"}])


def _setup(monkeypatch, *, job_contact_email="recrutement@bistrot.fr", sent_ok=True):
    application = {
        "application_id": "app_1",
        "user_id": "user_1",
        "job_id": "job_1",
        "user_email": "candidate@example.com",
        "tailored_cover_letter": {},
        "tailored_cv_file_b64": base64.b64encode(b"fake docx bytes").decode(),
        "tailored_cv_filename": "CV.docx",
        "tailored_cv_mime": DOCX_MIME,
    }
    job = {
        "job_id": "job_1",
        "title": "Serveur",
        "company": "Le Bistrot",
        "contact_email": job_contact_email,
    }
    user = {"user_id": "user_1", "email": "candidate@example.com", "name": "Jane Candidate"}
    profile = {"user_id": "user_1", "contact": {"name": "Jane Candidate"}}

    fake_db = _FakeDB(application=application, job=job, user=user, profile=profile)
    monkeypatch.setattr(server, "db", fake_db)

    sent_calls = []

    async def fake_send(**kwargs):
        sent_calls.append(kwargs)
        return {"ok": sent_ok, "transport": "smtp", "error": None if sent_ok else "boom"}

    monkeypatch.setattr(server, "send_application_email", fake_send)
    return fake_db, sent_calls


def test_admin_send_application_email_uses_job_contact_and_marks_submitted(monkeypatch):
    fake_db, sent_calls = _setup(monkeypatch)
    admin = server.User(user_id="admin", email="admin@tryhirly.com", name="Admin")

    result = asyncio.run(
        server.admin_send_application_email(
            "app_1",
            server.AdminSendApplicationEmail(),
            admin=admin,
        )
    )

    assert result["ok"] is True
    assert len(sent_calls) == 1
    assert sent_calls[0]["to_email"] == "recrutement@bistrot.fr"
    assert sent_calls[0]["candidate_email"] == "candidate@example.com"
    assert len(sent_calls[0]["attachments"]) == 1
    updated_app = asyncio.run(fake_db.applications.find_one({"application_id": "app_1"}))
    assert updated_app["manual_status"] == "manually_submitted"
    assert updated_app["submission_status"] == "submitted"
    assert updated_app["application_email_sent_to"] == "recrutement@bistrot.fr"


def test_admin_send_application_email_requires_contact_email(monkeypatch):
    _setup(monkeypatch, job_contact_email="")
    admin = server.User(user_id="admin", email="admin@tryhirly.com", name="Admin")

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(
            server.admin_send_application_email(
                "app_1",
                server.AdminSendApplicationEmail(),
                admin=admin,
            )
        )
    assert exc.value.status_code == 400


def test_admin_send_application_email_surfaces_transport_failure(monkeypatch):
    _setup(monkeypatch, sent_ok=False)
    admin = server.User(user_id="admin", email="admin@tryhirly.com", name="Admin")

    with pytest.raises(server.HTTPException) as exc:
        asyncio.run(
            server.admin_send_application_email(
                "app_1",
                server.AdminSendApplicationEmail(),
                admin=admin,
            )
        )
    assert exc.value.status_code == 502
