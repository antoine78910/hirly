"""Gmail sync for application-related emails only.

The sync intentionally stores message metadata and snippets, not full mailbox
contents. Queries are derived from submitted applications and each fetched
message is re-scored against the application before it is persisted.
"""
from __future__ import annotations

import base64
import hashlib
import html
import os
import re
import unicodedata
import uuid
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from cryptography.fernet import Fernet, InvalidToken


GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

ATS_SENDER_HINTS = {
    "greenhouse.io",
    "greenhouse-mail.io",
    "lever.co",
    "ashbyhq.com",
    "workday.com",
    "myworkday.com",
    "smartrecruiters.com",
    "icims.com",
    "bamboohr.com",
    "jobvite.com",
    "teamtailor.com",
    "recruitee.com",
    "personio.com",
    "join.com",
    "welcometothejungle.com",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fernet() -> Fernet:
    raw = (
        os.environ.get("GMAIL_TOKEN_ENCRYPTION_KEY")
        or os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("APP_SECRET")
        or ""
    ).strip()
    if not raw:
        raise RuntimeError("GMAIL_TOKEN_ENCRYPTION_KEY or SUPABASE_SECRET_KEY is required for Gmail token storage")
    try:
        if len(raw) == 44:
            return Fernet(raw.encode())
    except Exception:
        pass
    derived = base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest())
    return Fernet(derived)


def _encrypt(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Stored Gmail token could not be decrypted") from exc


def _parse_expiry(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            if isinstance(value, (int, float)):
                parsed = datetime.fromtimestamp(float(value), tz=timezone.utc)
            else:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _normalize_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text.lower()).strip()


def _important_terms(value: Any, limit: int = 5) -> List[str]:
    stop = {
        "and", "the", "for", "with", "senior", "junior", "lead", "manager",
        "of", "to", "a", "an", "de", "du", "des", "la", "le", "les", "en",
        "chez", "stage", "internship", "alternance", "remote", "hybrid",
    }
    terms = []
    for term in re.findall(r"[a-zA-ZÀ-ÿ0-9][a-zA-ZÀ-ÿ0-9+#.-]{2,}", str(value or "")):
        norm = _normalize_text(term)
        if norm and norm not in stop and norm not in terms:
            terms.append(norm)
        if len(terms) >= limit:
            break
    return terms


def _domain(value: Any) -> str:
    text = str(value or "").strip()
    if "@" in text and "://" not in text:
        match = re.search(r"@([A-Za-z0-9.-]+\.[A-Za-z]{2,})", text)
        return (match.group(1).lower() if match else "").removeprefix("www.")
    parsed = urlparse(text if "://" in text else f"https://{text}")
    return (parsed.netloc or "").lower().removeprefix("www.")


def _date_header_to_iso(value: Any) -> str:
    try:
        parsed = parsedate_to_datetime(str(value or ""))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except Exception:
        return _now_iso()


def _submitted_at(app: Dict[str, Any]) -> datetime:
    for key in ("submitted_at", "manual_status_updated_at", "updated_at", "created_at"):
        parsed = _parse_expiry(app.get(key))
        if parsed:
            return parsed
    return datetime.now(timezone.utc) - timedelta(days=30)


def _gmail_query_for_application(app: Dict[str, Any], job: Dict[str, Any]) -> str:
    submitted = _submitted_at(app) - timedelta(days=1)
    after = submitted.strftime("%Y/%m/%d")
    company = str(job.get("company") or "").strip()
    title = str(job.get("title") or "").strip()
    quoted_terms = []
    if company:
        quoted_terms.append(f'"{company[:80]}"')
    if title:
        quoted_terms.append(f'"{title[:80]}"')
    for term in _important_terms(title, limit=3):
        quoted_terms.append(term)
    if not quoted_terms:
        quoted_terms.append("application")
    return f"after:{after} ({' OR '.join(quoted_terms[:5])})"


def _message_headers(payload: Dict[str, Any]) -> Dict[str, str]:
    headers = {}
    for item in (payload.get("headers") or []):
        name = str(item.get("name") or "").lower()
        if name:
            headers[name] = str(item.get("value") or "")
    return headers


# Priority order for which classification "wins" when multiple matched
# emails exist for the same application (e.g. a confirmation followed later
# by an interview invite) -- higher index overwrites lower. Deliberately
# written to a *new* field (email_confirmed_outcome), never to
# submission_status: that field means "did our own submit attempt succeed",
# a different question from "what happened afterward", and other code
# (Tracker UI, admin flows) depends on its existing value set.
_OUTCOME_PRIORITY = ["primary", "verification", "confirmation", "status", "interview", "offer"]


def _outcome_rank(classification: str) -> int:
    try:
        return _OUTCOME_PRIORITY.index(classification)
    except ValueError:
        return -1


_CONFIRMATION_TERMS = (
    "thank you for applying",
    "application received",
    "we have received your application",
    "candidature recue",
    "candidature bien recue",
    "merci pour votre candidature",
    "merci de votre candidature",
    "accuse de reception",
    "avons bien recu votre candidature",
    "bien recu votre candidature",
)


def _classify_email(subject: str, snippet: str) -> str:
    subject_only = _normalize_text(subject)
    text = _normalize_text(f"{subject} {snippet}")

    if any(term in text for term in ("offer", "offre", "proposition d'embauche", "job offer")):
        return "offer"
    # Standard ATS acknowledgment subject lines ("Merci pour votre
    # candidature au poste de X", "Accusé de réception...") are a far more
    # reliable signal than scanning the full body: these emails routinely
    # contain generic "we'll reach out for an interview if your profile
    # matches" boilerplate later on, which would otherwise false-positive
    # into the interview/verification checks below and hide plain
    # acknowledgment emails from the default inbox tab.
    if any(term in subject_only for term in _CONFIRMATION_TERMS):
        return "confirmation"
    if any(term in text for term in ("interview", "entretien", "schedule", "calendly", "meet with", "recruiter")):
        return "interview"
    if any(term in text for term in ("assessment", "test", "complete", "verify", "action required", "a completer", "verification")):
        return "verification"
    if any(term in text for term in ("unfortunately", "regret", "not selected", "not move forward", "rejet", "retenu")):
        return "status"
    if any(term in text for term in _CONFIRMATION_TERMS):
        return "confirmation"
    return "primary"


# Public alias -- this classifier has no Gmail-specific state, so the Resend
# inbound pipeline (inbound_email_service.py) reuses it directly rather than
# duplicating the keyword lists.
classify_email = _classify_email


def _match_score(app: Dict[str, Any], job: Dict[str, Any], message: Dict[str, Any]) -> int:
    subject = message.get("subject") or ""
    snippet = message.get("snippet") or ""
    sender = message.get("from") or ""
    haystack = _normalize_text(f"{subject} {snippet} {sender}")
    score = 0

    company = _normalize_text(job.get("company"))
    if company and company in haystack:
        score += 6
    else:
        for term in _important_terms(job.get("company"), limit=3):
            if term in haystack:
                score += 2

    title_hits = sum(1 for term in _important_terms(job.get("title"), limit=6) if term in haystack)
    score += min(title_hits, 4)

    sender_domain = _domain(sender)
    job_domain = _domain(job.get("external_url") or job.get("selected_apply_url") or "")
    if job_domain and (sender_domain == job_domain or sender_domain.endswith(f".{job_domain}")):
        score += 3
    if any(sender_domain == hint or sender_domain.endswith(f".{hint}") for hint in ATS_SENDER_HINTS):
        score += 2
    if _normalize_text(app.get("application_id")) and _normalize_text(app.get("application_id")) in haystack:
        score += 4
    return score


async def store_gmail_tokens(
    db: Any,
    *,
    user_id: str,
    email: str,
    provider_token: Optional[str],
    provider_refresh_token: Optional[str],
    expires_at: Optional[Any],
) -> bool:
    """Persist Google provider tokens when Supabase returns them.

    Existing refresh tokens are preserved because Google often returns a refresh
    token only on the first consent.
    """
    if not provider_token and not provider_refresh_token:
        return False
    existing = await db.gmail_connections.find_one({"user_id": user_id}, {"_id": 0})
    now = _now_iso()
    update: Dict[str, Any] = {
        "user_id": user_id,
        "email": email,
        "provider": "gmail",
        "scope": GMAIL_READONLY_SCOPE,
        "connected": True,
        "provider_token_received": bool(provider_token),
        "provider_refresh_token_received": bool(provider_refresh_token),
        "token_capture_updated_at": now,
        "updated_at": now,
    }
    if provider_token:
        update["access_token_encrypted"] = _encrypt(provider_token)
    if provider_refresh_token:
        update["refresh_token_encrypted"] = _encrypt(provider_refresh_token)
    elif existing and existing.get("refresh_token_encrypted"):
        update["refresh_token_encrypted"] = existing.get("refresh_token_encrypted")
    parsed_expiry = _parse_expiry(expires_at)
    if parsed_expiry:
        update["access_token_expires_at"] = parsed_expiry.isoformat()
    update.setdefault("created_at", (existing or {}).get("created_at") or now)
    await db.gmail_connections.update_one(
        {"user_id": user_id},
        {"$set": update},
        upsert=True,
    )
    return True


def gmail_connected_payload(connection: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not connection:
        return {"connected": False, "email": None, "last_synced_at": None}
    return {
        "connected": bool(connection.get("connected") and (connection.get("access_token_encrypted") or connection.get("refresh_token_encrypted"))),
        "email": connection.get("email"),
        "last_synced_at": connection.get("last_synced_at"),
        "last_sync_error": connection.get("last_sync_error"),
    }


async def _get_access_token(db: Any, connection: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    expires_at = _parse_expiry(connection.get("access_token_expires_at"))
    access_token = _decrypt(connection.get("access_token_encrypted"))
    if access_token and expires_at and expires_at > datetime.now(timezone.utc) + timedelta(seconds=90):
        return access_token, connection

    refresh_token = _decrypt(connection.get("refresh_token_encrypted"))
    if not refresh_token:
        if access_token:
            return access_token, connection
        raise RuntimeError("Gmail refresh token is missing; reconnect Google with Gmail permission")

    client_id = (os.environ.get("GOOGLE_OAUTH_CLIENT_ID") or os.environ.get("GOOGLE_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET") or os.environ.get("GOOGLE_CLIENT_SECRET") or "").strip()
    if not client_id or not client_secret:
        raise RuntimeError("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required to refresh Gmail tokens")

    async with httpx.AsyncClient(timeout=20.0) as http:
        response = await http.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
    if response.status_code != 200:
        raise RuntimeError(f"Gmail token refresh failed: HTTP {response.status_code} {response.text[:200]}")
    payload = response.json()
    new_access = payload.get("access_token")
    if not new_access:
        raise RuntimeError("Gmail token refresh response did not include access_token")
    expires = datetime.now(timezone.utc) + timedelta(seconds=int(payload.get("expires_in") or 3600))
    await db.gmail_connections.update_one(
        {"user_id": connection["user_id"]},
        {"$set": {
            "access_token_encrypted": _encrypt(new_access),
            "access_token_expires_at": expires.isoformat(),
            "updated_at": _now_iso(),
        }},
    )
    updated = {**connection, "access_token_encrypted": _encrypt(new_access), "access_token_expires_at": expires.isoformat()}
    return new_access, updated


async def _gmail_list_messages(access_token: str, query: str, limit: int) -> List[Dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20.0) as http:
        response = await http.get(
            f"{GMAIL_API_BASE}/messages",
            params={"q": query, "maxResults": max(1, min(limit, 10))},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code == 403:
        raise RuntimeError("Gmail permission is missing; reconnect Google with Gmail read access")
    if response.status_code != 200:
        raise RuntimeError(f"Gmail message list failed: HTTP {response.status_code} {response.text[:200]}")
    return list((response.json() or {}).get("messages") or [])


async def _gmail_get_metadata(access_token: str, message_id: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as http:
        response = await http.get(
            f"{GMAIL_API_BASE}/messages/{message_id}",
            params={"format": "metadata", "metadataHeaders": ["From", "To", "Subject", "Date"]},
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if response.status_code != 200:
        raise RuntimeError(f"Gmail message metadata failed: HTTP {response.status_code} {response.text[:200]}")
    payload = response.json() or {}
    headers = _message_headers(payload.get("payload") or {})
    return {
        "gmail_message_id": payload.get("id"),
        "gmail_thread_id": payload.get("threadId"),
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "subject": headers.get("subject", "(no subject)"),
        "received_at": _date_header_to_iso(headers.get("date")),
        "snippet": html.unescape(payload.get("snippet") or ""),
    }


async def sync_gmail_application_emails(
    db: Any,
    *,
    user_id: str,
    max_applications: Optional[int] = None,
    per_application_limit: Optional[int] = None,
) -> Dict[str, Any]:
    connection = await db.gmail_connections.find_one({"user_id": user_id}, {"_id": 0})
    if not connection or not gmail_connected_payload(connection)["connected"]:
        return {"ok": True, "connected": False, "checked_applications": 0, "stored": 0}

    max_apps = max(1, min(int(max_applications or os.environ.get("GMAIL_SYNC_MAX_APPLICATIONS", 25)), 50))
    per_app = max(1, min(int(per_application_limit or os.environ.get("GMAIL_SYNC_MESSAGES_PER_APPLICATION", 5)), 10))

    try:
        access_token, connection = await _get_access_token(db, connection)
        apps = await db.applications.find({"user_id": user_id}, {"_id": 0}).sort("submitted_at", -1).to_list(200)
        submitted_apps = [
            app for app in apps
            if app.get("submission_status") == "submitted" or app.get("manual_status") == "manually_submitted"
        ][:max_apps]
        job_ids = list({app.get("job_id") for app in submitted_apps if app.get("job_id")})
        jobs = await db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0}).to_list(len(job_ids)) if job_ids else []
        job_map = {job.get("job_id"): job for job in jobs}

        stored = 0
        checked_messages = 0
        for app in submitted_apps:
            job = job_map.get(app.get("job_id")) or {}
            if not job:
                continue
            query = _gmail_query_for_application(app, job)
            best_classification = ""
            best_rank = -1
            best_message: Dict[str, Any] = {}
            for row in await _gmail_list_messages(access_token, query, per_app):
                gmail_id = row.get("id")
                if not gmail_id:
                    continue
                checked_messages += 1
                metadata = await _gmail_get_metadata(access_token, gmail_id)
                score = _match_score(app, job, metadata)
                if score < 6:
                    continue
                email_id = f"gmail_{hashlib.sha1(f'{user_id}:{gmail_id}'.encode()).hexdigest()[:28]}"
                existing = await db.application_emails.find_one({"email_id": email_id}, {"_id": 0})
                if existing and int(existing.get("match_score") or 0) > score:
                    continue
                now = _now_iso()
                classification = _classify_email(metadata.get("subject") or "", metadata.get("snippet") or "")
                document = {
                    "email_id": email_id,
                    "user_id": user_id,
                    "application_id": app.get("application_id"),
                    "job_id": app.get("job_id"),
                    "provider": "gmail",
                    "gmail_message_id": gmail_id,
                    "gmail_thread_id": metadata.get("gmail_thread_id"),
                    "from": metadata.get("from"),
                    "to": metadata.get("to"),
                    "subject": metadata.get("subject"),
                    "snippet": metadata.get("snippet"),
                    "received_at": metadata.get("received_at"),
                    "company": job.get("company"),
                    "job_title": job.get("title"),
                    "classification": classification,
                    "match_score": score,
                    "created_at": (existing or {}).get("created_at") or now,
                    "updated_at": now,
                }
                await db.application_emails.update_one({"email_id": email_id}, {"$set": document}, upsert=True)
                if not existing:
                    stored += 1
                if _outcome_rank(classification) > best_rank:
                    best_rank = _outcome_rank(classification)
                    best_classification = classification
                    best_message = document

            if best_classification and best_classification != app.get("email_confirmed_outcome"):
                await db.applications.update_one(
                    {"application_id": app.get("application_id"), "user_id": user_id},
                    {"$set": {
                        "email_confirmed_outcome": best_classification,
                        "email_confirmed_at": _now_iso(),
                        "email_confirmed_subject": best_message.get("subject"),
                        "email_confirmed_from": best_message.get("from"),
                    }},
                )

        await db.gmail_connections.update_one(
            {"user_id": user_id},
            {"$set": {"last_synced_at": _now_iso(), "last_sync_error": None, "updated_at": _now_iso()}},
        )
        return {
            "ok": True,
            "connected": True,
            "checked_applications": len(submitted_apps),
            "checked_messages": checked_messages,
            "stored": stored,
        }
    except Exception as exc:
        await db.gmail_connections.update_one(
            {"user_id": user_id},
            {"$set": {"last_sync_error": str(exc)[:300], "updated_at": _now_iso()}},
        )
        raise


def public_email_message(row: Dict[str, Any]) -> Dict[str, Any]:
    classification = row.get("classification") or "primary"
    return {
        "id": row.get("email_id") or f"email_{uuid.uuid4().hex[:12]}",
        "application_id": row.get("application_id"),
        "job_id": row.get("job_id"),
        "company": row.get("company"),
        "job_title": row.get("job_title"),
        "from": row.get("from") or "Unknown sender",
        "to": row.get("to") or "",
        "subject": row.get("subject") or "(no subject)",
        "preview": row.get("snippet") or "",
        "body": row.get("snippet") or "",
        "html": row.get("html") or None,
        "date": row.get("received_at"),
        "received_at": row.get("received_at"),
        "filter": "interview" if classification == "interview" else "offer" if classification == "offer" else "verification" if classification == "verification" else "primary",
        "category": classification,
        "provider": row.get("provider") or "gmail",
    }
