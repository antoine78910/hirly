"""Send a tailored application (CV + cover letter) by email on behalf of a candidate.

Used for job sources that don't expose an "apply" API (e.g. France Travail
listings where the recruiter only shared a contact email). The email is sent
from Hirly's own transactional sender with `Reply-To` set to the candidate's
own address, so the recruiter can reply directly to them. This intentionally
avoids requiring Gmail "send" OAuth access (a Google-restricted scope that
needs an app verification review) — it reuses the same SMTP/Resend
transactional setup already used for feedback emails.

This is meant to be triggered by an admin/operator reviewing a "manual
completion needed" application, not directly by end users, so a human always
reviews the recipient and content before it goes out.
"""
from __future__ import annotations

import base64
import logging
import os
import smtplib
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders
from typing import Any, Dict, List, Optional, Tuple

import httpx

from email_addresses import APPLICATION_EMAIL_FROM, INBOX_FORWARD_FROM

logger = logging.getLogger(__name__)
RESEND_API_KEY = (os.environ.get("RESEND_API_KEY") or "").strip()
SMTP_HOST = (os.environ.get("APPLICATION_SMTP_HOST") or os.environ.get("SMTP_HOST") or "").strip()
SMTP_PORT = int(os.environ.get("APPLICATION_SMTP_PORT") or os.environ.get("SMTP_PORT") or "587")
SMTP_USER = (os.environ.get("APPLICATION_SMTP_USER") or os.environ.get("SMTP_USER") or "").strip()
SMTP_PASSWORD = (os.environ.get("APPLICATION_SMTP_PASSWORD") or os.environ.get("SMTP_PASSWORD") or "").strip()

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

Attachment = Tuple[str, bytes, str]  # (filename, content, mime_type)


def _build_plain_body(body_text: str, candidate_name: str, candidate_email: str) -> str:
    footer = (
        f"\n\n--\nSent via Hirly on behalf of {candidate_name or candidate_email}.\n"
        f"Please reply directly to {candidate_email} to reach the candidate."
    )
    return f"{body_text.strip()}{footer}"


async def _send_via_resend(
    *,
    to_email: str,
    reply_to_email: str,
    subject: str,
    plain: str,
    attachments: List[Attachment],
    from_email: str = APPLICATION_EMAIL_FROM,
) -> bool:
    if not RESEND_API_KEY:
        return False
    payload: Dict[str, Any] = {
        "from": from_email,
        "to": [to_email],
        "reply_to": [reply_to_email] if reply_to_email else None,
        "subject": subject,
        "text": plain,
    }
    payload = {key: value for key, value in payload.items() if value is not None}
    if attachments:
        payload["attachments"] = [
            {"filename": name, "content": base64.b64encode(content).decode("ascii")}
            for name, content, _mime in attachments
        ]
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json=payload,
        )
        if response.status_code >= 400:
            logger.error("Resend application email failed: %s %s", response.status_code, response.text[:300])
            return False
    return True


def _send_via_smtp(
    *,
    to_email: str,
    reply_to_email: str,
    subject: str,
    plain: str,
    attachments: List[Attachment],
    from_email: str = APPLICATION_EMAIL_FROM,
) -> bool:
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASSWORD:
        return False

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    if reply_to_email:
        msg["Reply-To"] = reply_to_email
    msg.attach(MIMEText(plain, "plain", "utf-8"))

    for name, content, mime in attachments:
        maintype, _, subtype = (mime or "application/octet-stream").partition("/")
        part = MIMEBase(maintype or "application", subtype or "octet-stream")
        part.set_payload(content)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=name)
        msg.attach(part)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, [to_email], msg.as_string())
    return True


async def send_application_email(
    *,
    to_email: str,
    candidate_email: str,
    candidate_name: Optional[str],
    subject: str,
    body_text: str,
    attachments: Optional[List[Attachment]] = None,
) -> Dict[str, Any]:
    """Send a tailored application email. Returns {"ok", "transport", "error"}."""
    to_email = (to_email or "").strip()
    candidate_email = (candidate_email or "").strip()
    if not to_email or "@" not in to_email:
        return {"ok": False, "transport": None, "error": "Missing or invalid recipient email"}
    if not candidate_email or "@" not in candidate_email:
        return {"ok": False, "transport": None, "error": "Missing or invalid candidate reply-to email"}

    safe_attachments: List[Attachment] = []
    for name, content, mime in attachments or []:
        if not content or len(content) > MAX_ATTACHMENT_BYTES:
            continue
        safe_attachments.append((name, content, mime))

    plain = _build_plain_body(body_text or "", candidate_name or "", candidate_email)

    try:
        if await _send_via_resend(
            to_email=to_email,
            reply_to_email=candidate_email,
            subject=subject,
            plain=plain,
            attachments=safe_attachments,
        ):
            return {"ok": True, "transport": "resend", "error": None}
    except Exception as exc:
        logger.exception("Resend application email raised: %s", exc)

    try:
        if _send_via_smtp(
            to_email=to_email,
            reply_to_email=candidate_email,
            subject=subject,
            plain=plain,
            attachments=safe_attachments,
        ):
            return {"ok": True, "transport": "smtp", "error": None}
    except Exception as exc:
        logger.exception("SMTP application email raised: %s", exc)
        return {"ok": False, "transport": "smtp", "error": str(exc)[:300]}

    return {"ok": False, "transport": None, "error": "No email transport is configured (RESEND_API_KEY or SMTP_* env vars)"}


def _build_forward_body(body_text: str, to_email: str) -> str:
    footer = (
        f"\n\n--\nThis is your Hirly Managed Email.\nForwarding to: {to_email}\n\n"
        "Good luck with your application!"
    )
    return f"{body_text.strip()}{footer}"


async def forward_inbound_reply(
    *,
    to_email: str,
    original_from: str,
    subject: str,
    body_text: str,
    company: Optional[str] = None,
    job_title: Optional[str] = None,
) -> Dict[str, Any]:
    """Forward a copy of an employer's reply (received on our managed inbound
    address) to the candidate's real email, mirroring Sorce's "Forwarding
    to: ..." footer. Reply-To stays the employer's own address so a user
    replying from their real mailbox reaches the employer directly -- sending
    replies back out from inside the app is a separate, unbuilt feature.
    """
    to_email = (to_email or "").strip()
    original_from = (original_from or "").strip()
    if not to_email or "@" not in to_email:
        return {"ok": False, "transport": None, "error": "Missing or invalid recipient email"}

    prefixed_subject = subject if subject.lower().startswith("fwd:") else f"Fwd: {subject}"
    plain = _build_forward_body(body_text or "", to_email)

    try:
        if await _send_via_resend(
            to_email=to_email,
            reply_to_email=original_from,
            subject=prefixed_subject,
            plain=plain,
            attachments=[],
            from_email=INBOX_FORWARD_FROM,
        ):
            return {"ok": True, "transport": "resend", "error": None}
    except Exception as exc:
        logger.exception("Resend inbound-forward raised: %s", exc)

    try:
        if _send_via_smtp(
            to_email=to_email,
            reply_to_email=original_from,
            subject=prefixed_subject,
            plain=plain,
            attachments=[],
            from_email=INBOX_FORWARD_FROM,
        ):
            return {"ok": True, "transport": "smtp", "error": None}
    except Exception as exc:
        logger.exception("SMTP inbound-forward raised: %s", exc)
        return {"ok": False, "transport": "smtp", "error": str(exc)[:300]}

    return {"ok": False, "transport": None, "error": "No email transport is configured (RESEND_API_KEY or SMTP_* env vars)"}
