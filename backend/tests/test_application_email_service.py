import asyncio

import application_email_service as svc


def test_send_application_email_rejects_missing_recipient():
    result = asyncio.run(
        svc.send_application_email(
            to_email="",
            candidate_email="candidate@example.com",
            candidate_name="Jane",
            subject="Subject",
            body_text="Body",
        )
    )
    assert result["ok"] is False
    assert "recipient" in result["error"].lower()


def test_send_application_email_rejects_missing_candidate_email():
    result = asyncio.run(
        svc.send_application_email(
            to_email="recruiter@example.com",
            candidate_email="",
            candidate_name="Jane",
            subject="Subject",
            body_text="Body",
        )
    )
    assert result["ok"] is False
    assert "reply-to" in result["error"].lower()


def test_send_application_email_uses_smtp_when_configured(monkeypatch):
    monkeypatch.setattr(svc, "RESEND_API_KEY", "")
    monkeypatch.setattr(svc, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(svc, "SMTP_USER", "user")
    monkeypatch.setattr(svc, "SMTP_PASSWORD", "pass")

    sent = {}

    class _FakeSMTP:
        def __init__(self, host, port, timeout=30):
            sent["host"] = host

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def starttls(self):
            pass

        def login(self, user, password):
            sent["login"] = (user, password)

        def sendmail(self, from_addr, to_addrs, message):
            sent["from_addr"] = from_addr
            sent["to_addrs"] = to_addrs
            sent["message"] = message

    monkeypatch.setattr(svc.smtplib, "SMTP", _FakeSMTP)

    result = asyncio.run(
        svc.send_application_email(
            to_email="recruiter@example.com",
            candidate_email="candidate@example.com",
            candidate_name="Jane Candidate",
            subject="Candidature",
            body_text="Bonjour,\nMa candidature.",
            attachments=[("CV.docx", b"fake bytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")],
        )
    )

    assert result == {"ok": True, "transport": "smtp", "error": None}
    assert sent["to_addrs"] == ["recruiter@example.com"]
    assert "Reply-To: candidate@example.com" in sent["message"]
    assert "candidate@example.com" in sent["message"]


def test_send_application_email_reports_no_transport_configured(monkeypatch):
    monkeypatch.setattr(svc, "RESEND_API_KEY", "")
    monkeypatch.setattr(svc, "SMTP_HOST", "")

    result = asyncio.run(
        svc.send_application_email(
            to_email="recruiter@example.com",
            candidate_email="candidate@example.com",
            candidate_name="Jane",
            subject="Subject",
            body_text="Body",
        )
    )
    assert result["ok"] is False
    assert "no email transport is configured" in result["error"].lower()
