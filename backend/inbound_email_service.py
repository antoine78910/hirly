"""Ingest employer replies received on our own managed inbound address.

Applications submitted while INBOUND_MANAGED_EMAIL_ENABLED is on use a
per-application address (see email_addresses.managed_reply_address) instead
of the candidate's real email, so employer/ATS replies land on our own Resend
inbound domain. This module turns a Resend "email.received" webhook event
into an application_emails row (the same table/shape the Gmail-sync pipeline
already writes, so the existing GET /emails endpoint and frontend need no
changes) and forwards a copy of the reply to the candidate's real email.
"""
from __future__ import annotations

import html as html_unescape
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from application_email_service import forward_inbound_reply
from email_addresses import INBOUND_DOMAIN
from gmail_sync import classify_email

logger = logging.getLogger(__name__)

RESEND_API_KEY = (os.environ.get("RESEND_API_KEY") or "").strip()
RESEND_RECEIVING_EMAIL_URL = "https://api.resend.com/emails/receiving"

_ADDRESS_RE = re.compile(r"([^\s<>@]+@[^\s<>@]+)")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_html(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _normalize_body(text: Optional[str], html: Optional[str]) -> str:
    # Some ATS senders' plain-text MIME part is itself HTML-entity-encoded
    # (literal "&eacute;" instead of "é") rather than genuine plain text --
    # unescape defensively so the stored snippet (used as the fallback
    # display whenever no HTML body is captured) reads correctly.
    raw = html_unescape.unescape((text or "").strip())
    if raw:
        return raw
    if html:
        return html_unescape.unescape(_strip_html(html))
    return ""


def _extract_application_id(to_addresses: Any) -> Optional[str]:
    """Pull the application_id local-part out of whichever recipient address
    is on our inbound domain. Handles bare addresses, "Name <addr>" forms,
    and multiple recipients (only one of which is typically ours)."""
    if isinstance(to_addresses, str):
        candidates = [to_addresses]
    elif isinstance(to_addresses, list):
        candidates = [str(item) for item in to_addresses]
    else:
        return None

    domain_suffix = f"@{INBOUND_DOMAIN}".lower()
    for candidate in candidates:
        match = _ADDRESS_RE.search(candidate)
        address = (match.group(1) if match else candidate).strip().lower()
        if address.endswith(domain_suffix):
            return address[: -len(domain_suffix)]
    return None


async def _fetch_resend_email(resend_email_id: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{RESEND_RECEIVING_EMAIL_URL}/{resend_email_id}",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
        )
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else {}


async def process_inbound_resend_email(db, resend_email_id: str, webhook_data: Dict[str, Any]) -> Dict[str, Any]:
    """Store one received email as an application_emails row and forward a
    copy to the candidate. Every failure mode returns a result dict instead
    of raising -- the caller (the webhook route) isolates this per-event so
    one bad payload can never break the rest of Resend's delivery."""
    email_id = f"resend_{resend_email_id}"
    existing = await db.application_emails.find_one({"email_id": email_id}, {"_id": 0})
    if existing:
        return {"duplicate": True}

    application_id = _extract_application_id(webhook_data.get("to"))
    if not application_id:
        return {"ok": False, "reason": "no_matching_application_address"}

    app_doc = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    if not app_doc:
        return {"ok": False, "reason": "application_not_found"}

    detail: Dict[str, Any] = {}
    if RESEND_API_KEY:
        try:
            detail = await _fetch_resend_email(resend_email_id)
        except Exception as exc:
            logger.warning("resend_inbound_fetch_failed email_id=%s error=%s", resend_email_id, str(exc)[:200])

    subject = detail.get("subject") or webhook_data.get("subject") or "(no subject)"
    text_body = detail.get("text") or ""
    html_body = detail.get("html") or ""
    snippet = _normalize_body(text_body, html_body)[:2000]
    sender = detail.get("from") or webhook_data.get("from") or ""
    to_addresses = webhook_data.get("to") or []

    classification = classify_email(subject, snippet)
    job = await db.jobs.find_one({"job_id": app_doc.get("job_id")}, {"_id": 0}) or {}

    now = _now_iso()
    document = {
        "email_id": email_id,
        "user_id": app_doc.get("user_id"),
        "application_id": application_id,
        "job_id": app_doc.get("job_id"),
        "provider": "resend_inbound",
        "resend_email_id": resend_email_id,
        "from": sender,
        "to": ", ".join(to_addresses) if isinstance(to_addresses, list) else str(to_addresses),
        "subject": subject,
        "snippet": snippet,
        "html": html_body or None,
        "received_at": detail.get("created_at") or now,
        "company": job.get("company"),
        "job_title": job.get("title"),
        "classification": classification,
        "forwarded_at": None,
        "created_at": now,
        "updated_at": now,
    }
    # Write before forwarding: application_emails' own primary key is the
    # dedupe mechanism (both storage backends' update_one(upsert=True) are
    # true upserts, not insert-or-raise, so the find_one check above -- not a
    # duplicate-key exception -- is what prevents forwarding twice).
    await db.application_emails.update_one({"email_id": email_id}, {"$set": document}, upsert=True)

    user_doc = await db.users.find_one({"user_id": app_doc.get("user_id")}, {"_id": 0}) or {}
    real_email = user_doc.get("email")
    if real_email:
        forward_result = await forward_inbound_reply(
            to_email=real_email,
            original_from=sender,
            subject=subject,
            body_text=text_body or snippet,
            body_html=html_body or None,
            company=job.get("company"),
            job_title=job.get("title"),
        )
        if forward_result.get("ok"):
            await db.application_emails.update_one({"email_id": email_id}, {"$set": {"forwarded_at": _now_iso()}})
        else:
            logger.warning(
                "resend_inbound_forward_failed application_id=%s error=%s",
                application_id,
                forward_result.get("error"),
            )

    return {"ok": True, "classification": classification}
