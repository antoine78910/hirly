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
import html as html_escape
import logging
import os
import smtplib
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email import encoders
from typing import Any, Dict, List, Optional, Tuple

import httpx

from email_addresses import APPLICATION_EMAIL_FROM, HIRLY_BRAND_COLOR, HIRLY_LOGO_URL, INBOX_FORWARD_FROM

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
    html: Optional[str] = None,
) -> bool:
    if not RESEND_API_KEY:
        return False
    payload: Dict[str, Any] = {
        "from": from_email,
        "to": [to_email],
        "reply_to": [reply_to_email] if reply_to_email else None,
        "subject": subject,
        "text": plain,
        "html": html,
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
    html: Optional[str] = None,
) -> bool:
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASSWORD:
        return False

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    if reply_to_email:
        msg["Reply-To"] = reply_to_email
    if html:
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(plain, "plain", "utf-8"))
        alt.attach(MIMEText(html, "html", "utf-8"))
        msg.attach(alt)
    else:
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


def _build_forward_body(body_text: str, to_email: str, original_from: str) -> str:
    footer = (
        f"\n\n--\nThis is your Hirly Managed Email.\nForwarding to: {to_email}\n"
        f"Sent from: {original_from}\n\n"
        "Good luck with your application!"
    )
    return f"{body_text.strip()}{footer}"


def _hex_to_rgba(hex_color: str, alpha: float) -> str:
    value = hex_color.strip().lstrip("#")
    if len(value) != 6:
        return f"rgba(124, 58, 237, {alpha})"
    r, g, b = (int(value[i : i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r}, {g}, {b}, {alpha})"


def _build_forward_html(body_text: str, to_email: str, original_from: str) -> str:
    """Branded HTML footer mirroring Sorce's "Managed Email" banner (logo,
    Forwarding to / Sent from lines, closing message) in Hirly's own purple.
    """
    safe_body = html_escape.escape(body_text.strip()).replace("\n", "<br>")
    safe_to = html_escape.escape(to_email)
    safe_from = html_escape.escape(original_from or "")
    color = HIRLY_BRAND_COLOR
    box_bg = _hex_to_rgba(color, 0.08)
    return f"""\
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #111827; max-width: 640px;">
  <div>{safe_body}</div>
  <div style="margin-top: 28px; padding: 32px 24px; text-align: center; background-color: {box_bg}; border-radius: 16px;">
    <img src="{HIRLY_LOGO_URL}" alt="Hirly" width="40" height="40" style="display: block; margin: 0 auto 16px; border-radius: 8px;" />
    <p style="margin: 0 0 12px; font-weight: 700; color: #111827;">
      This is your Hirly Managed Email.<br>
      Forwarding to: <a href="mailto:{safe_to}" style="color: {color}; text-decoration: underline;">{safe_to}</a>
    </p>
    <p style="margin: 0 0 16px; font-weight: 700; color: #111827;">
      Sent from: <a href="mailto:{safe_from}" style="color: {color}; text-decoration: underline;">{safe_from}</a>
    </p>
    <p style="margin: 0; font-weight: 600; color: {color};">Good luck with your application!</p>
  </div>
</div>"""


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
    plain = _build_forward_body(body_text or "", to_email, original_from)
    rich_html = _build_forward_html(body_text or "", to_email, original_from)

    try:
        if await _send_via_resend(
            to_email=to_email,
            reply_to_email=original_from,
            subject=prefixed_subject,
            plain=plain,
            attachments=[],
            from_email=INBOX_FORWARD_FROM,
            html=rich_html,
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
            html=rich_html,
        ):
            return {"ok": True, "transport": "smtp", "error": None}
    except Exception as exc:
        logger.exception("SMTP inbound-forward raised: %s", exc)
        return {"ok": False, "transport": "smtp", "error": str(exc)[:300]}

    return {"ok": False, "transport": None, "error": "No email transport is configured (RESEND_API_KEY or SMTP_* env vars)"}
