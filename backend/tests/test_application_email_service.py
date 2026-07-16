import asyncio

import application_email_service as svc


def test_hex_to_rgba_converts_known_brand_color():
    assert svc._hex_to_rgba("#7C3AED", 0.08) == "rgba(124, 58, 237, 0.08)"


def test_hex_to_rgba_falls_back_for_invalid_input():
    assert svc._hex_to_rgba("not-a-color", 0.5) == "rgba(124, 58, 237, 0.5)"


def test_build_forward_html_escapes_and_includes_branding():
    result = svc._build_forward_html(
        "Bonjour <b>Younes</b>,\nVotre candidature.",
        "candidate@example.com",
        "recruiter@acme-ats.com",
    )
    assert "&lt;b&gt;Younes&lt;/b&gt;" in result  # body is escaped, not raw HTML
    assert svc.HIRLY_LOGO_URL in result
    assert "candidate@example.com" in result
    assert "recruiter@acme-ats.com" in result
    assert "Good luck with your application!" in result


def test_build_forward_html_embeds_real_html_when_available():
    result = svc._build_forward_html(
        "Confirm your email <https://example.com/confirm/abc>",
        "candidate@example.com",
        "recruiter@acme-ats.com",
        body_html='<p>Please <a href="https://example.com/confirm/abc">confirm</a> your email.</p>',
    )
    # The real clickable link survives, not the escaped bracketed-URL text.
    assert '<a href="https://example.com/confirm/abc">confirm</a>' in result
    assert "&lt;https" not in result
    assert svc.HIRLY_LOGO_URL in result


def test_build_forward_html_strips_script_tags():
    result = svc._build_forward_html(
        "plain fallback",
        "candidate@example.com",
        "recruiter@acme-ats.com",
        body_html='<p>hello</p><script>alert(1)</script>',
    )
    assert "<script>" not in result
    assert "alert(1)" not in result
    assert "<p>hello</p>" in result


def test_forward_inbound_reply_sends_html_via_resend(monkeypatch):
    monkeypatch.setattr(svc, "RESEND_API_KEY", "test_key")
    captured = {}

    async def fake_post(self, url, headers=None, json=None):
        captured.update(json)

        class _Resp:
            status_code = 200
            text = ""

        return _Resp()

    monkeypatch.setattr(svc.httpx.AsyncClient, "post", fake_post)

    result = asyncio.run(
        svc.forward_inbound_reply(
            to_email="candidate@example.com",
            original_from="recruiter@acme-ats.com",
            subject="Interview invitation",
            body_text="Please schedule your interview.",
        )
    )

    assert result == {"ok": True, "transport": "resend", "error": None}
    assert captured["from"] == svc.INBOX_FORWARD_FROM
    assert "Good luck with your application!" in captured["html"]
    assert "Please schedule your interview." in captured["text"]


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
