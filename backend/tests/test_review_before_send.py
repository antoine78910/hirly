import asyncio

import pytest
from fastapi import HTTPException

import server


def _user(**overrides):
    defaults = dict(user_id="user_1", email="candidate@example.com", name="Jane Candidate")
    defaults.update(overrides)
    return server.User(**defaults)


class _FakeResult:
    def to_dict(self):
        return {"success_detected": False, "application_url": None}


def _install_agent_apply_fakes(monkeypatch, *, app_doc):
    job = {"job_id": "job_1", "title": "Data Analyst", "company": "Acme"}
    profile = {"user_id": "user_1", "cv_text": "..."}
    calls = {"count": 0}

    async def fake_loader(job_id, user):
        return job, profile, dict(app_doc)

    async def fake_run_apply_attempt(**kwargs):
        calls["count"] += 1
        return _FakeResult()

    monkeypatch.setattr(server, "_load_or_create_agent_application", fake_loader)
    monkeypatch.setattr(server, "run_apply_attempt", fake_run_apply_attempt)
    return calls


def test_run_agent_apply_blocks_submit_when_review_required_and_not_approved(monkeypatch):
    app_doc = {"application_id": "app_1", "document_review_status": "awaiting_user"}
    calls = _install_agent_apply_fakes(monkeypatch, app_doc=app_doc)
    user = _user(require_review_before_send=True)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server._run_agent_apply("job_1", user, click_submit=True))

    assert exc_info.value.status_code == 409
    assert calls["count"] == 0


def test_run_agent_apply_allows_submit_when_documents_approved(monkeypatch):
    app_doc = {"application_id": "app_1", "document_review_status": "approved"}
    calls = _install_agent_apply_fakes(monkeypatch, app_doc=app_doc)
    user = _user(require_review_before_send=True)

    result = asyncio.run(server._run_agent_apply("job_1", user, click_submit=True))

    assert calls["count"] == 1
    assert result["application_id"] == "app_1"


def test_run_agent_apply_allows_submit_when_review_not_required(monkeypatch):
    app_doc = {"application_id": "app_1", "document_review_status": "awaiting_user"}
    calls = _install_agent_apply_fakes(monkeypatch, app_doc=app_doc)
    user = _user(require_review_before_send=False)

    result = asyncio.run(server._run_agent_apply("job_1", user, click_submit=True))

    assert calls["count"] == 1
    assert result["application_id"] == "app_1"


def _install_greenhouse_fakes(monkeypatch, *, app_doc, package_status="not_generated"):
    job = {"job_id": "job_1", "ats_provider": "greenhouse"}
    payload = {}
    full_app_doc = {"application_id": "app_1", "package_status": package_status, **app_doc}

    async def fake_loader(job_id, user):
        return job, full_app_doc, payload

    monkeypatch.setattr(server, "_load_greenhouse_prepared_application", fake_loader)


def test_greenhouse_submit_blocks_when_review_required_and_not_approved(monkeypatch):
    _install_greenhouse_fakes(monkeypatch, app_doc={"document_review_status": "awaiting_user"})
    user = _user(require_review_before_send=True)
    body = server.GreenhousePrepareSubmitRequest(job_id="job_1")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.greenhouse_submit(body, user=user))

    assert exc_info.value.status_code == 409


def test_greenhouse_submit_proceeds_past_gate_when_approved(monkeypatch):
    _install_greenhouse_fakes(monkeypatch, app_doc={"document_review_status": "approved"})
    user = _user(require_review_before_send=True)
    body = server.GreenhousePrepareSubmitRequest(job_id="job_1")

    # package_status is intentionally left "not_generated" so the gate
    # being bypassed surfaces as the existing 400 (not our 409) --
    # proving review-required no longer blocks once approved.
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.greenhouse_submit(body, user=user))

    assert exc_info.value.status_code == 400


def test_greenhouse_submit_proceeds_past_gate_when_review_not_required(monkeypatch):
    _install_greenhouse_fakes(monkeypatch, app_doc={"document_review_status": "awaiting_user"})
    user = _user(require_review_before_send=False)
    body = server.GreenhousePrepareSubmitRequest(job_id="job_1")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server.greenhouse_submit(body, user=user))

    assert exc_info.value.status_code == 400


class _Result:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class _UsersCollection:
    def __init__(self, matched_count=1):
        self.matched_count = matched_count
        self.updates = []

    async def update_one(self, filter, update):
        self.updates.append((filter, update))
        return _Result(self.matched_count)


class _DB:
    def __init__(self, matched_count=1):
        self.users = _UsersCollection(matched_count=matched_count)


def test_update_account_settings_persists_value(monkeypatch):
    fake_db = _DB()
    monkeypatch.setattr(server, "db", fake_db)
    user = _user(require_review_before_send=True)
    body = server.AccountSettingsUpdate(require_review_before_send=False)

    result = asyncio.run(server.update_account_settings(body, user=user))

    assert result == {"require_review_before_send": False, "language": None}
    assert fake_db.users.updates[0][1]["$set"]["require_review_before_send"] is False


def test_set_user_require_review_before_send_404s_for_unknown_user(monkeypatch):
    fake_db = _DB(matched_count=0)
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server._set_user_require_review_before_send("missing_user", True))

    assert exc_info.value.status_code == 404


def test_update_account_settings_persists_language(monkeypatch):
    fake_db = _DB()
    monkeypatch.setattr(server, "db", fake_db)
    user = _user()
    body = server.AccountSettingsUpdate(language="fr")

    result = asyncio.run(server.update_account_settings(body, user=user))

    assert result == {"require_review_before_send": True, "language": "fr"}
    assert fake_db.users.updates[0][1]["$set"]["language"] == "fr"


@pytest.mark.parametrize("language", ["de", "es", "it"])
def test_update_account_settings_persists_new_supported_language(monkeypatch, language):
    fake_db = _DB()
    monkeypatch.setattr(server, "db", fake_db)
    user = _user()

    result = asyncio.run(server.update_account_settings(server.AccountSettingsUpdate(language=language), user=user))

    assert result == {"require_review_before_send": True, "language": language}
    assert fake_db.users.updates[0][1]["$set"]["language"] == language


def test_update_account_settings_ignores_invalid_language(monkeypatch):
    fake_db = _DB()
    monkeypatch.setattr(server, "db", fake_db)
    user = _user()

    result = asyncio.run(server.update_account_settings(server.AccountSettingsUpdate(language="pt"), user=user))

    assert result == {"require_review_before_send": True, "language": None}
    assert fake_db.users.updates == []


def test_set_user_language_404s_for_unknown_user(monkeypatch):
    fake_db = _DB(matched_count=0)
    monkeypatch.setattr(server, "db", fake_db)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(server._set_user_language("missing_user", "fr"))

    assert exc_info.value.status_code == 404
