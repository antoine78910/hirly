import asyncio

import server


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, limit):
        return list(self._rows[:limit])


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None

    def find(self, filter=None, projection=None):
        return _Cursor([])


class _DB:
    def __init__(self, *, application, job, user, profile):
        self.applications = _Collection([application])
        self.jobs = _Collection([job])
        self.users = _Collection([user])
        self.profiles = _Collection([profile])
        self.browser_submission_runs = _Collection([])


def _base_docs(**application_overrides):
    application = {
        "application_id": "app_abc123",
        "user_id": "user_1",
        "job_id": "job_1",
        **application_overrides,
    }
    job = {"job_id": "job_1", "title": "Data Analyst", "company": "Acme"}
    user = {"user_id": "user_1", "email": "candidate@example.com", "name": "Jane Candidate"}
    profile = {"user_id": "user_1", "contact": {"name": "Jane Candidate"}}
    return application, job, user, profile


def test_submission_email_uses_recorded_value_when_already_submitted(monkeypatch):
    application, job, user, profile = _base_docs(
        agent_apply_result={"submission_email": "app_abc123@inbox.tryhirly.com"},
    )
    monkeypatch.setattr(server, "db", _DB(application=application, job=job, user=user, profile=profile))
    monkeypatch.setattr(server, "INBOUND_MANAGED_EMAIL_ENABLED", False)  # recorded value wins regardless

    admin = server.User(user_id="admin", email="admin@tryhirly.com", name="Admin")
    result = asyncio.run(server.admin_get_application("app_abc123", admin=admin))

    assert result["application"]["submission_contact_email"] == "app_abc123@inbox.tryhirly.com"


def test_submission_email_previews_managed_address_before_submission(monkeypatch):
    application, job, user, profile = _base_docs()  # no agent_apply_result yet
    monkeypatch.setattr(server, "db", _DB(application=application, job=job, user=user, profile=profile))
    monkeypatch.setattr(server, "INBOUND_MANAGED_EMAIL_ENABLED", True)

    admin = server.User(user_id="admin", email="admin@tryhirly.com", name="Admin")
    result = asyncio.run(server.admin_get_application("app_abc123", admin=admin))

    assert result["application"]["submission_contact_email"] == "app_abc123@inbox.tryhirly.com"


def test_submission_email_previews_real_email_when_feature_disabled(monkeypatch):
    application, job, user, profile = _base_docs()
    monkeypatch.setattr(server, "db", _DB(application=application, job=job, user=user, profile=profile))
    monkeypatch.setattr(server, "INBOUND_MANAGED_EMAIL_ENABLED", False)

    admin = server.User(user_id="admin", email="admin@tryhirly.com", name="Admin")
    result = asyncio.run(server.admin_get_application("app_abc123", admin=admin))

    assert result["application"]["submission_contact_email"] == "candidate@example.com"
