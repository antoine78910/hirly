"""Feature suggestion emails with optional image attachments."""

from __future__ import annotations

import base64
import json
import logging
import os
import smtplib
import uuid
from datetime import datetime, timezone
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import List, Tuple

import httpx

logger = logging.getLogger(__name__)

FEEDBACK_TO_EMAIL = (os.environ.get("FEEDBACK_TO_EMAIL") or "anto.delbos@gmail.com").strip()
FEEDBACK_FROM_EMAIL = (os.environ.get("FEEDBACK_FROM_EMAIL") or "Hirly <feedback@tryhirly.com>").strip()
RESEND_API_KEY = (os.environ.get("RESEND_API_KEY") or "").strip()
SMTP_HOST = (os.environ.get("FEEDBACK_SMTP_HOST") or os.environ.get("SMTP_HOST") or "").strip()
SMTP_PORT = int(os.environ.get("FEEDBACK_SMTP_PORT") or os.environ.get("SMTP_PORT") or "587")
SMTP_USER = (os.environ.get("FEEDBACK_SMTP_USER") or os.environ.get("SMTP_USER") or "").strip()
SMTP_PASSWORD = (os.environ.get("FEEDBACK_SMTP_PASSWORD") or os.environ.get("SMTP_PASSWORD") or "").strip()

MAX_ATTACHMENTS = 5
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
ALLOWED_MIME = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}

STORAGE_DIR = Path(__file__).parent / "storage" / "feature_suggestions"


def _category_label(category: str) -> str:
    mapping = {
        "feature": "Feature idea",
        "problem": "Problem / bug",
        "other": "Other",
    }
    return mapping.get(category, category or "Suggestion")


def _build_email_body(
    *,
    user_email: str,
    user_name: str,
    user_id: str,
    category: str,
    message: str,
    attachment_names: List[str],
) -> Tuple[str, str, str]:
    subject = f"[Hirly] {_category_label(category)} — {user_email or user_id}"
    plain = "\n".join([
        f"Category: {_category_label(category)}",
        f"From: {user_name or '—'} <{user_email or '—'}>",
        f"User ID: {user_id}",
        "",
        message.strip(),
        "",
        f"Attachments: {', '.join(attachment_names) if attachment_names else 'none'}",
    ])
    html = f"""
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b">
      <p><strong>Category:</strong> {_category_label(category)}</p>
      <p><strong>From:</strong> {user_name or "—"} &lt;{user_email or "—"}&gt;</p>
      <p><strong>User ID:</strong> {user_id}</p>
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:16px 0" />
      <p style="white-space:pre-wrap">{message.strip()}</p>
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:16px 0" />
      <p style="font-size:12px;color:#71717a">
        Attachments: {", ".join(attachment_names) if attachment_names else "none"}
      </p>
    </div>
    """
    return subject, plain, html


async def _send_via_resend(
    subject: str,
    plain: str,
    html: str,
    attachments: List[Tuple[str, bytes, str]],
) -> bool:
    if not RESEND_API_KEY:
        return False

    payload = {
        "from": FEEDBACK_FROM_EMAIL,
        "to": [FEEDBACK_TO_EMAIL],
        "subject": subject,
        "text": plain,
        "html": html,
    }
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
            logger.error("Resend feature suggestion failed: %s %s", response.status_code, response.text)
            return False
    return True


def _send_via_smtp(
    subject: str,
    plain: str,
    html: str,
    attachments: List[Tuple[str, bytes, str]],
) -> bool:
    if not SMTP_HOST or not SMTP_USER or not SMTP_PASSWORD:
        return False

    msg = MIMEMultipart("related")
    msg["Subject"] = subject
    msg["From"] = FEEDBACK_FROM_EMAIL
    msg["To"] = FEEDBACK_TO_EMAIL

    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(plain, "plain", "utf-8"))
    alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)

    for index, (name, content, mime) in enumerate(attachments):
        subtype = mime.split("/")[-1] if "/" in mime else "png"
        if subtype == "jpg":
            subtype = "jpeg"
        part = MIMEImage(content, _subtype=subtype)
        part.add_header("Content-Disposition", "attachment", filename=name)
        part.add_header("Content-ID", f"<attach-{index}>")
        msg.attach(part)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, [FEEDBACK_TO_EMAIL], msg.as_string())
    return True


def _archive_submission(
    *,
    user_email: str,
    user_name: str,
    user_id: str,
    category: str,
    message: str,
    attachments: List[Tuple[str, bytes, str]],
) -> str:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    submission_id = uuid.uuid4().hex
    folder = STORAGE_DIR / submission_id
    folder.mkdir(parents=True, exist_ok=True)

    meta = {
        "id": submission_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "to": FEEDBACK_TO_EMAIL,
        "user_email": user_email,
        "user_name": user_name,
        "user_id": user_id,
        "category": category,
        "message": message,
        "attachments": [],
    }
    for name, content, mime in attachments:
        safe_name = Path(name).name or "attachment"
        path = folder / safe_name
        path.write_bytes(content)
        meta["attachments"].append({"filename": safe_name, "mime": mime, "bytes": len(content)})

    (folder / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    logger.warning("Feature suggestion archived locally at %s (email transport not configured)", folder)
    return submission_id


async def send_feature_suggestion(
    *,
    user_email: str,
    user_name: str,
    user_id: str,
    category: str,
    message: str,
    attachments: List[Tuple[str, bytes, str]],
) -> dict:
    text = (message or "").strip()
    if not text:
        raise ValueError("Message is required")

    if len(attachments) > MAX_ATTACHMENTS:
        raise ValueError(f"At most {MAX_ATTACHMENTS} attachments allowed")

    cleaned: List[Tuple[str, bytes, str]] = []
    for name, content, mime in attachments:
        mime_type = (mime or "").lower()
        if mime_type not in ALLOWED_MIME:
            raise ValueError("Only image attachments are allowed")
        if len(content) > MAX_ATTACHMENT_BYTES:
            raise ValueError("Each attachment must be 5 MB or smaller")
        cleaned.append((Path(name).name or "screenshot.png", content, mime_type))

    subject, plain, html = _build_email_body(
        user_email=user_email,
        user_name=user_name,
        user_id=user_id,
        category=category,
        message=text,
        attachment_names=[name for name, _, _ in cleaned],
    )

    sent = await _send_via_resend(subject, plain, html, cleaned)
    transport = "resend"
    if not sent:
        try:
            sent = _send_via_smtp(subject, plain, html, cleaned)
            transport = "smtp"
        except Exception as exc:
            logger.exception("SMTP feature suggestion failed: %s", exc)
            sent = False

    if sent:
        return {"ok": True, "transport": transport}

    archive_id = _archive_submission(
        user_email=user_email,
        user_name=user_name,
        user_id=user_id,
        category=category,
        message=text,
        attachments=cleaned,
    )
    return {"ok": True, "transport": "archive", "archive_id": archive_id}
