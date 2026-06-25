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

import feedback_store as store
from feedback_store import (
    FEEDBACK_FEATURE_CREATOR,
    FEEDBACK_FEATURE_USER,
    FEEDBACK_TRAINING_COMPLETION,
)


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


def _persist_feature_submission(
    *,
    user_email: str,
    user_name: str,
    user_id: str,
    category: str,
    message: str,
    audience: str,
    attachments: List[Tuple[str, bytes, str]],
    transport: str,
) -> str:
    submission_id = uuid.uuid4().hex
    folder = store.STORAGE_ROOT / submission_id
    folder.mkdir(parents=True, exist_ok=True)
    attachment_rows = []
    for name, content, mime in attachments:
        safe_name = Path(name).name or "attachment"
        path = folder / safe_name
        path.write_bytes(content)
        attachment_rows.append({"filename": safe_name, "mime": mime, "bytes": len(content)})

    feedback_type = FEEDBACK_FEATURE_CREATOR if audience == "creator" else FEEDBACK_FEATURE_USER
    saved = store.save_submission({
        "feedback_type": feedback_type,
        "audience": audience,
        "user_email": user_email,
        "user_name": user_name,
        "user_id": user_id,
        "category": category,
        "message": message,
        "attachments": attachment_rows,
        "transport": transport,
    })
    return saved["id"]


def _archive_submission(
    *,
    user_email: str,
    user_name: str,
    user_id: str,
    category: str,
    message: str,
    audience: str,
    attachments: List[Tuple[str, bytes, str]],
) -> str:
    archive_id = _persist_feature_submission(
        user_email=user_email,
        user_name=user_name,
        user_id=user_id,
        category=category,
        message=message,
        audience=audience,
        attachments=attachments,
        transport="archive",
    )
    logger.warning("Feature suggestion archived locally (email transport not configured): %s", archive_id)
    return archive_id


async def send_feature_suggestion(
    *,
    user_email: str,
    user_name: str,
    user_id: str,
    category: str,
    message: str,
    attachments: List[Tuple[str, bytes, str]],
    audience: str = "user",
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

    audience_norm = (audience or "user").strip().lower()
    if audience_norm not in {"user", "creator"}:
        audience_norm = "user"

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
            transport = "archive"

    if not sent:
        archive_id = _archive_submission(
            user_email=user_email,
            user_name=user_name,
            user_id=user_id,
            category=category,
            message=text,
            audience=audience_norm,
            attachments=cleaned,
        )
        return {"ok": True, "transport": "archive", "archive_id": archive_id, "submission_id": archive_id}

    submission_id = _persist_feature_submission(
        user_email=user_email,
        user_name=user_name,
        user_id=user_id,
        category=category,
        message=text,
        audience=audience_norm,
        attachments=cleaned,
        transport=transport,
    )
    return {"ok": True, "transport": transport, "submission_id": submission_id}


async def submit_training_completion_feedback(
    *,
    user_email: str,
    user_name: str,
    user_id: str,
    course_id: str,
    beneficial: str,
    rating: int,
    message: str,
) -> dict:
    beneficial_norm = (beneficial or "").strip().lower()
    if beneficial_norm not in {"very", "somewhat", "not_really"}:
        raise ValueError("Invalid beneficial value")

    rating_value = int(rating or 0)
    if rating_value < 1 or rating_value > 5:
        raise ValueError("Rating must be between 1 and 5")

    text = (message or "").strip()
    subject = f"[Hirly] Training feedback — {user_email or user_id}"
    plain = "\n".join([
        "Training completion feedback",
        f"Course: {course_id}",
        f"Beneficial: {beneficial_norm}",
        f"Rating: {rating_value}/5",
        f"From: {user_name or '—'} <{user_email or '—'}>",
        f"User ID: {user_id}",
        "",
        text or "(no additional comments)",
    ])
    html = f"""
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b">
      <p><strong>Training completion feedback</strong></p>
      <p><strong>Course:</strong> {course_id}</p>
      <p><strong>Beneficial:</strong> {beneficial_norm}</p>
      <p><strong>Rating:</strong> {rating_value}/5</p>
      <p><strong>From:</strong> {user_name or "—"} &lt;{user_email or "—"}&gt;</p>
      <p><strong>User ID:</strong> {user_id}</p>
      <hr />
      <p style="white-space:pre-wrap">{text or "(no additional comments)"}</p>
    </div>
    """
    sent = await _send_via_resend(subject, plain, html, [])
    transport = "resend"
    if not sent:
        try:
            sent = _send_via_smtp(subject, plain, html, [])
            transport = "smtp"
        except Exception as exc:
            logger.exception("SMTP training feedback failed: %s", exc)
            sent = False
            transport = "none"

    saved = store.save_submission({
        "feedback_type": FEEDBACK_TRAINING_COMPLETION,
        "user_email": user_email,
        "user_name": user_name,
        "user_id": user_id,
        "course_id": course_id,
        "beneficial": beneficial_norm,
        "rating": rating_value,
        "message": text,
        "transport": transport if sent else "store_only",
    })
    return {"ok": True, "submission_id": saved["id"], "transport": transport if sent else "store_only"}
