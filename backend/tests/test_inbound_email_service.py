import asyncio
from datetime import datetime, timezone

import pytest
from svix.webhooks import Webhook

import inbound_email_service as svc
import server

TEST_WEBHOOK_SECRET = "whsec_C2FVsGKac0LRG7SxfUY1M7bJ2fVwLB4l"


def _signed_headers(secret: str, payload: bytes, msg_id: str = "msg_test") -> dict:
    ts = datetime.now(timezone.utc)
    signature = Webhook(secret).sign(msg_id, ts, payload.decode())
    return {
        "svix-id": msg_id,
        "svix-timestamp": str(int(ts.timestamp())),
        "svix-signature": signature,
    }


async def _async_return(value):
    return value


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

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
        return _Cursor(list(self.rows))

    async def update_one(self, filter, update, upsert=False):
        matched = None
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                matched = row
                break
        if not matched and upsert:
            matched = dict(filter)
            self.rows.append(matched)
        if not matched:
            return {"matched_count": 0, "modified_count": 0}
        if "$set" in update:
            matched.update(update["$set"])
        return {"matched_count": 1, "modified_count": 1}


class _DB:
    def __init__(self, applications=None, jobs=None, users=None, application_emails=None):
        self.applications = _Collection(applications)
        self.jobs = _Collection(jobs)
        self.users = _Collection(users)
        self.application_emails = _Collection(application_emails)


def _seed_db():
    return _DB(
        applications=[{"application_id": "app_abc123", "user_id": "user_1", "job_id": "job_1"}],
        jobs=[{"job_id": "job_1", "company": "Acme", "title": "Engineer"}],
        users=[{"user_id": "user_1", "email": "candidate@example.com"}],
    )


# ---- _extract_application_id ----

def test_extract_application_id_from_bare_address():
    assert svc._extract_application_id(["app_abc123@inbox.tryhirly.com"]) == "app_abc123"


def test_extract_application_id_from_name_form():
    assert svc._extract_application_id(["SmartRecruiters <app_abc123@inbox.tryhirly.com>"]) == "app_abc123"


def test_extract_application_id_picks_matching_recipient_among_several():
    to = ["someone-else@gmail.com", "app_abc123@inbox.tryhirly.com"]
    assert svc._extract_application_id(to) == "app_abc123"


def test_extract_application_id_returns_none_for_non_matching_domain():
    assert svc._extract_application_id(["someone@gmail.com"]) is None


def test_extract_application_id_returns_none_for_empty():
    assert svc._extract_application_id([]) is None
    assert svc._extract_application_id(None) is None


# ---- _normalize_body ----

def test_normalize_body_decodes_html_entities_in_plain_text():
    """Some ATS senders' plain-text MIME part is itself HTML-entity-encoded
    (e.g. Ingerop/SmartRecruiters), not real plain text -- this was showing
    up as literal "&eacute;"/"&nbsp;"/"&#39;" in the Inbox tab."""
    raw = "Nous accusons bonne r&eacute;ception de l&#39;int&eacute;r&ecirc;t&nbsp;port&eacute;"
    result = svc._normalize_body(raw, None)
    assert result == "Nous accusons bonne réception de l'intérêt\xa0porté"


def test_normalize_body_decodes_entities_in_html_fallback():
    result = svc._normalize_body(None, "<p>Bonjour &amp; bienvenue</p>")
    assert result == "Bonjour & bienvenue"


# ---- process_inbound_resend_email ----

def test_process_inbound_resend_email_stores_and_forwards(monkeypatch):
    db = _seed_db()
    monkeypatch.setattr(svc, "RESEND_API_KEY", "")  # skip the real HTTP fetch, use webhook_data only
    forwarded = {}

    async def fake_forward(**kwargs):
        forwarded.update(kwargs)
        return {"ok": True}

    monkeypatch.setattr(svc, "forward_inbound_reply", fake_forward)

    webhook_data = {
        "email_id": "re_123",
        "from": "recruiter@acme-ats.com",
        "to": ["app_abc123@inbox.tryhirly.com"],
        "subject": "Interview invitation",
    }
    result = asyncio.run(svc.process_inbound_resend_email(db, "re_123", webhook_data))

    assert result["ok"] is True
    assert result["classification"] == "interview"
    row = asyncio.run(db.application_emails.find_one({"email_id": "resend_re_123"}))
    assert row["application_id"] == "app_abc123"
    assert row["user_id"] == "user_1"
    assert row["provider"] == "resend_inbound"
    assert row["company"] == "Acme"
    assert row["forwarded_at"] is not None
    assert forwarded["to_email"] == "candidate@example.com"
    assert forwarded["original_from"] == "recruiter@acme-ats.com"


def test_process_inbound_resend_email_stores_and_forwards_html_body(monkeypatch):
    """Resend's `html` field must survive into storage and be handed to the
    forward call as body_html -- otherwise both the Inbox tab and the
    forwarded copy degrade to Resend's flattened plain-text alternative
    (the "bracketed URL" bug)."""
    db = _seed_db()
    monkeypatch.setattr(svc, "RESEND_API_KEY", "re_test_key")

    async def fake_fetch(resend_email_id):
        return {
            "subject": "Confirm your email",
            "text": "Confirm your email <https://example.com/confirm/abc>",
            "html": '<p>Please <a href="https://example.com/confirm/abc">confirm</a> your email.</p>',
            "from": "recruiter@acme-ats.com",
            "created_at": "2026-01-01T00:00:00Z",
        }

    monkeypatch.setattr(svc, "_fetch_resend_email", fake_fetch)

    forwarded = {}

    async def fake_forward(**kwargs):
        forwarded.update(kwargs)
        return {"ok": True}

    monkeypatch.setattr(svc, "forward_inbound_reply", fake_forward)

    webhook_data = {"to": ["app_abc123@inbox.tryhirly.com"], "subject": "Confirm your email"}
    asyncio.run(svc.process_inbound_resend_email(db, "re_123", webhook_data))

    row = asyncio.run(db.application_emails.find_one({"email_id": "resend_re_123"}))
    assert row["html"] == '<p>Please <a href="https://example.com/confirm/abc">confirm</a> your email.</p>'
    assert forwarded["body_html"] == row["html"]


def test_process_inbound_resend_email_is_idempotent(monkeypatch):
    db = _seed_db()
    db.application_emails.rows.append({"email_id": "resend_re_123", "application_id": "app_abc123"})
    calls = []

    async def fake_forward(**kwargs):
        calls.append(kwargs)
        return {"ok": True}

    monkeypatch.setattr(svc, "forward_inbound_reply", fake_forward)

    webhook_data = {"to": ["app_abc123@inbox.tryhirly.com"], "subject": "Interview invitation"}
    result = asyncio.run(svc.process_inbound_resend_email(db, "re_123", webhook_data))

    assert result == {"duplicate": True}
    assert calls == []


def test_process_inbound_resend_email_no_matching_address(monkeypatch):
    db = _seed_db()
    webhook_data = {"to": ["someone@gmail.com"], "subject": "Hello"}
    result = asyncio.run(svc.process_inbound_resend_email(db, "re_999", webhook_data))
    assert result == {"ok": False, "reason": "no_matching_application_address"}
    assert asyncio.run(db.application_emails.find_one({"email_id": "resend_re_999"})) is None


def test_process_inbound_resend_email_application_not_found():
    db = _seed_db()
    webhook_data = {"to": ["app_does_not_exist@inbox.tryhirly.com"], "subject": "Hello"}
    result = asyncio.run(svc.process_inbound_resend_email(db, "re_888", webhook_data))
    assert result == {"ok": False, "reason": "application_not_found"}


# ---- webhook route ----

class _FakeRequest:
    def __init__(self, body: bytes, headers: dict):
        self._body = body
        self.headers = headers

    async def body(self):
        return self._body


def test_resend_inbound_webhook_valid_signature_processes(monkeypatch):
    monkeypatch.setenv("RESEND_INBOUND_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET)

    async def fake_process(db, resend_email_id, data):
        return {"ok": True, "classification": "interview"}

    monkeypatch.setattr(server, "process_inbound_resend_email", fake_process)

    payload = b'{"type": "email.received", "data": {"email_id": "re_123", "to": ["app_abc123@inbox.tryhirly.com"]}}'
    headers = _signed_headers(TEST_WEBHOOK_SECRET, payload)

    result = asyncio.run(server.resend_inbound_webhook(_FakeRequest(payload, headers)))
    assert result == {"received": True, "ok": True, "classification": "interview"}


def test_resend_inbound_webhook_invalid_signature_rejected(monkeypatch):
    monkeypatch.setenv("RESEND_INBOUND_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET)
    payload = b'{"type": "email.received", "data": {}}'
    headers = {"svix-id": "msg_bad", "svix-timestamp": "1700000000", "svix-signature": "v1,bogus"}

    with pytest.raises(server.HTTPException) as exc_info:
        asyncio.run(server.resend_inbound_webhook(_FakeRequest(payload, headers)))
    assert exc_info.value.status_code == 400


def test_resend_inbound_webhook_isolates_processing_failure(monkeypatch):
    monkeypatch.setenv("RESEND_INBOUND_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET)

    async def raising_process(db, resend_email_id, data):
        raise RuntimeError("boom")

    monkeypatch.setattr(server, "process_inbound_resend_email", raising_process)

    payload = b'{"type": "email.received", "data": {"email_id": "re_500"}}'
    headers = _signed_headers(TEST_WEBHOOK_SECRET, payload, msg_id="msg_500")

    # Must NOT raise -- one bad/erroring payload must not surface as a 500
    # that Stripe/Resend-style webhook retries would hammer forever.
    result = asyncio.run(server.resend_inbound_webhook(_FakeRequest(payload, headers)))
    assert result["received"] is True
    assert result["ok"] is False


def test_resend_inbound_webhook_ignores_other_event_types(monkeypatch):
    monkeypatch.setenv("RESEND_INBOUND_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET)
    payload = b'{"type": "email.delivered", "data": {}}'
    headers = _signed_headers(TEST_WEBHOOK_SECRET, payload, msg_id="msg_other")

    result = asyncio.run(server.resend_inbound_webhook(_FakeRequest(payload, headers)))
    assert result == {"received": True, "ignored": "email.delivered"}


# ---- submission chokepoints ----

def test_build_candidate_context_uses_managed_address_when_enabled(monkeypatch):
    import apply_agent.agent as agent_module

    monkeypatch.setattr(agent_module, "INBOUND_MANAGED_EMAIL_ENABLED", True)
    profile = {"contact": {"email": "candidate@example.com", "name": "Jane Doe"}}
    app_doc = {"application_id": "app_abc123"}
    user = {"email": "candidate@example.com"}

    context = agent_module.build_candidate_context(profile, app_doc, user)

    assert context["profile.contact.email"] == "app_abc123@inbox.tryhirly.com"
    assert context["profile.contact.first_name"] == "Jane"


def test_build_candidate_context_uses_real_address_when_disabled(monkeypatch):
    import apply_agent.agent as agent_module

    monkeypatch.setattr(agent_module, "INBOUND_MANAGED_EMAIL_ENABLED", False)
    profile = {"contact": {"email": "candidate@example.com"}}
    app_doc = {"application_id": "app_abc123"}
    user = {"email": "candidate@example.com"}

    context = agent_module.build_candidate_context(profile, app_doc, user)

    assert context["profile.contact.email"] == "candidate@example.com"


def test_build_candidate_context_falls_back_to_profile_cv():
    import apply_agent.agent as agent_module

    profile = {
        "contact": {"email": "candidate@example.com", "name": "Jane Doe"},
        "cv_original_b64": "UkVTVU1F",
        "cv_filename": "jane.pdf",
    }
    app_doc = {"application_id": "app_abc123"}
    context = agent_module.build_candidate_context(profile, app_doc, {"email": "candidate@example.com"})
    assert context.get("application.tailored_cv_file") is None
    assert context["profile.cv_file"] == "__resume_file__"


def test_write_resume_file_falls_back_to_profile(tmp_path):
    import base64
    from apply_agent.browser import write_resume_file

    raw = b"%PDF-1.4 fake"
    path = write_resume_file(
        {},
        str(tmp_path),
        profile={"cv_original_b64": base64.b64encode(raw).decode("ascii"), "cv_filename": "cv.pdf"},
    )
    assert path
    assert open(path, "rb").read() == raw
