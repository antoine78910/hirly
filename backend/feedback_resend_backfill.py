"""Recover historical feedback rows from Resend sent-email history."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx

from feedback_service import FEEDBACK_TO_EMAIL, RESEND_API_KEY
from feedback_store import (
    FEEDBACK_FEATURE_CREATOR,
    FEEDBACK_FEATURE_USER,
    FEEDBACK_TRAINING_COMPLETION,
    _has_feedback_db,
    _upsert_row_db,
)

logger = logging.getLogger(__name__)

HIRLY_SUBJECT_PREFIX = "[Hirly]"
CATEGORY_LABEL_TO_KEY = {
    "feature idea": "feature",
    "problem / bug": "problem",
    "other": "other",
}


def _strip_html(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _normalize_body(text: Optional[str], html: Optional[str]) -> str:
    raw = (text or "").strip()
    if raw:
        return raw
    if html:
        return _strip_html(html)
    return ""


def _parse_from_line(line: str) -> Tuple[str, str]:
    match = re.match(r"^From:\s*(.*?)\s*<([^>]+)>\s*$", line.strip())
    if match:
        name = (match.group(1) or "").strip()
        email = (match.group(2) or "").strip()
        if name in {"—", "-"}:
            name = ""
        if email in {"—", "-"}:
            email = ""
        return name, email
    return "", ""


def _field_value(lines: List[str], prefix: str) -> str:
    for line in lines:
        if line.startswith(prefix):
            return line.split(":", 1)[1].strip()
    return ""


def _extract_message(lines: List[str]) -> str:
    try:
        user_idx = next(i for i, line in enumerate(lines) if line.startswith("User ID:"))
    except StopIteration:
        return ""
    body_lines: List[str] = []
    started = False
    for line in lines[user_idx + 1 :]:
        if not started:
            if not line.strip():
                started = True
            continue
        if line.startswith("Attachments:"):
            break
        body_lines.append(line)
    message = "\n".join(body_lines).strip()
    if message == "(no additional comments)":
        return ""
    return message


def _subject_tail(subject: str) -> str:
    if " — " in subject:
        return subject.rsplit(" — ", 1)[-1].strip()
    if " - " in subject:
        return subject.rsplit(" - ", 1)[-1].strip()
    return ""


def _parse_feature_record(subject: str, body: str) -> Optional[Dict[str, Any]]:
    lines = [line.strip() for line in body.splitlines()]
    category_label = ""
    if "]" in subject:
        middle = subject.split("]", 1)[1].strip()
        if " — " in middle:
            category_label = middle.rsplit(" — ", 1)[0].strip()
        elif " - " in middle:
            category_label = middle.rsplit(" - ", 1)[0].strip()
        else:
            category_label = middle.strip()
    category = CATEGORY_LABEL_TO_KEY.get(category_label.lower(), "feature")
    user_name, user_email = _parse_from_line(_field_value(lines, "From:"))
    user_id = _field_value(lines, "User ID:")
    if not user_email:
        user_email = _subject_tail(subject)
    message = _extract_message(lines)
    if not message and not user_email and not user_id:
        return None
    return {
        "feedback_type": FEEDBACK_FEATURE_USER,
        "category": category,
        "user_name": user_name,
        "user_email": user_email,
        "user_id": user_id,
        "message": message,
    }


def _parse_training_record(subject: str, body: str) -> Optional[Dict[str, Any]]:
    lines = [line.strip() for line in body.splitlines()]
    user_name, user_email = _parse_from_line(_field_value(lines, "From:"))
    user_id = _field_value(lines, "User ID:")
    if not user_email:
        user_email = _subject_tail(subject)
    beneficial = _field_value(lines, "Beneficial:").lower()
    rating_raw = _field_value(lines, "Rating:")
    rating_match = re.search(r"(\d+)", rating_raw)
    rating = int(rating_match.group(1)) if rating_match else None
    course_id = _field_value(lines, "Course:")
    message = _extract_message(lines)
    if not course_id and not message and not user_email:
        return None
    return {
        "feedback_type": FEEDBACK_TRAINING_COMPLETION,
        "user_name": user_name,
        "user_email": user_email,
        "user_id": user_id,
        "beneficial": beneficial or None,
        "rating": rating,
        "course_id": course_id or None,
        "message": message,
    }


def _is_feedback_email(subject: str, recipients: List[str]) -> bool:
    if not subject or not subject.startswith(HIRLY_SUBJECT_PREFIX):
        return False
    target = FEEDBACK_TO_EMAIL.lower()
    return any(str(recipient).lower() == target for recipient in recipients or [])


async def _list_sent_resend_emails(client: httpx.AsyncClient) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    after: Optional[str] = None
    while True:
        params: Dict[str, Any] = {"limit": 100}
        if after:
            params["after"] = after
        response = await client.get("https://api.resend.com/emails", params=params)
        if response.status_code >= 400:
            logger.warning("resend list emails failed: %s %s", response.status_code, response.text)
            break
        payload = response.json()
        batch = payload.get("data") or []
        if not batch:
            break
        rows.extend(batch)
        if not payload.get("has_more"):
            break
        after = batch[-1].get("id")
        if not after:
            break
    return rows


async def _fetch_resend_email(client: httpx.AsyncClient, email_id: str) -> Dict[str, Any]:
    response = await client.get(f"https://api.resend.com/emails/{email_id}")
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


async def _resolve_feature_feedback_type(db, user_id: str) -> str:
    if not user_id or db is None or not hasattr(db, "users"):
        return FEEDBACK_FEATURE_USER
    try:
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "training_access": 1})
    except Exception:
        return FEEDBACK_FEATURE_USER
    if user and user.get("training_access"):
        return FEEDBACK_FEATURE_CREATOR
    return FEEDBACK_FEATURE_USER


async def backfill_feedback_from_resend(db) -> Dict[str, int]:
    """Import feedback submissions from Resend sent-email history."""
    stats = {"scanned": 0, "imported": 0, "skipped": 0, "errors": 0}
    if not RESEND_API_KEY:
        logger.info("feedback resend backfill skipped: RESEND_API_KEY missing")
        return stats
    if not _has_feedback_db(db):
        logger.info("feedback resend backfill skipped: user_feedback table unavailable")
        return stats

    headers = {"Authorization": f"Bearer {RESEND_API_KEY}"}
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
        try:
            sent_rows = await _list_sent_resend_emails(client)
        except Exception as exc:
            logger.warning("feedback resend backfill list failed: %s", exc)
            stats["errors"] += 1
            return stats

        for summary in sent_rows:
            subject = str(summary.get("subject") or "")
            recipients = summary.get("to") or []
            if not _is_feedback_email(subject, recipients):
                continue

            stats["scanned"] += 1
            email_id = str(summary.get("id") or "").strip()
            if not email_id:
                stats["skipped"] += 1
                continue

            submission_id = f"resend_{email_id}"
            try:
                existing = await db.user_feedback.find_one({"submission_id": submission_id}, {"_id": 0, "submission_id": 1})
                if existing:
                    stats["skipped"] += 1
                    continue

                detail = await _fetch_resend_email(client, email_id)
                body = _normalize_body(detail.get("text"), detail.get("html"))
                if "Training feedback" in subject:
                    parsed = _parse_training_record(subject, body)
                else:
                    parsed = _parse_feature_record(subject, body)
                if not parsed:
                    stats["skipped"] += 1
                    continue

                if parsed.get("feedback_type") == FEEDBACK_FEATURE_USER:
                    parsed["feedback_type"] = await _resolve_feature_feedback_type(db, parsed.get("user_id") or "")

                created_at = summary.get("created_at") or detail.get("created_at")
                row = {
                    **parsed,
                    "id": submission_id,
                    "submission_id": submission_id,
                    "created_at": created_at,
                    "transport": "resend",
                    "legacy_from_resend": True,
                    "resend_email_id": email_id,
                }
                await _upsert_row_db(db, row)
                stats["imported"] += 1
            except Exception as exc:
                logger.warning("feedback resend import failed id=%s: %s", email_id, exc)
                stats["errors"] += 1

    logger.info("feedback resend backfill complete: %s", stats)
    return stats
