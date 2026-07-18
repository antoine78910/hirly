"""Supabase/Postgres adapter skeleton.

This is intentionally not wired into routes in Phase 1. The eventual adapter
will translate the collection-port methods into Supabase/PostgREST calls while
preserving API response shapes.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import date, datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from job_normalization import extract_normalized_job_columns

from .base import CollectionPort, CursorPort, DatabaseAdapter, Document, Filter, Projection


MIGRATED_TABLES = {
    "users",
    "user_sessions",
    "jobs",
    "ats_company_sources",
    "geo_places",
    "company_boards",
    "profiles",
    "swipes",
    "applications",
    "gmail_connections",
    "application_emails",
    "browser_submission_runs",
    "analytics_events",
    "stripe_events",
    "training_creators",
    "training_courses",
    "training_modules",
    "training_enrollments",
    "training_crm_leads",
    "creator_invites",
    "user_feedback",
    "rome_profiles",
    "interview_simulator_templates",
    "friend_referral_codes",
    "friend_referral_redemptions",
    "auto_apply_attempts",
    "notifications",
    "creator_applications",
}
TABLE_PRIMARY_KEYS = {
    "users": "user_id",
    "user_sessions": "session_token",
    "jobs": "job_id",
    "ats_company_sources": "id",
    "geo_places": "geoname_id",
    "company_boards": "board_id",
    "profiles": "user_id",
    "swipes": "swipe_id",
    "applications": "application_id",
    "gmail_connections": "user_id",
    "application_emails": "email_id",
    "browser_submission_runs": "run_id",
    "analytics_events": "event_id",
    "stripe_events": "event_id",
    "training_creators": "creator_id",
    "training_courses": "course_id",
    "training_modules": "module_id",
    "training_enrollments": "enrollment_id",
    "training_crm_leads": "lead_id",
    "creator_invites": "invite_id",
    "user_feedback": "submission_id",
    "rome_profiles": "rome_code",
    "interview_simulator_templates": "template_id",
    "friend_referral_codes": "code",
    "friend_referral_redemptions": "redemption_id",
    "auto_apply_attempts": "id",
    "notifications": "notification_id",
    "creator_applications": "creator_application_id",
}
TABLE_FILTER_COLUMNS = {
    "users": {"user_id", "email", "name", "created_at"},
    "user_sessions": {"session_token", "user_id", "expires_at", "created_at"},
    "jobs": {
        "job_id",
        "provider",
        "external_id",
        "title",
        "normalized_title",
        "company",
        "normalized_company",
        "location",
        "city",
        "region",
        "country_code",
        "remote",
        "salary_min",
        "salary_max",
        "currency",
        "posted_at",
        "imported_at",
        "last_seen_at",
        "provider_search_key",
        "ats_provider",
        "auto_apply_supported",
        "manual_fulfillment_ready",
        "apply_fulfillment_status",
        "apply_url_provider",
        "selected_apply_url",
        "validation_status",
        "validation_reason",
        "validation_checked_at",
        "requires_login",
        "requires_account_creation",
        "captcha_detected",
        "has_cv_upload",
        "has_cover_letter",
        "has_custom_questions",
        "applyability_score",
        "applyability_tier",
        "rejection_reason",
        "fingerprint",
    },
    "ats_company_sources": {
        "id",
        "ats_provider",
        "source_key",
        "company_name",
        "careers_url",
        "country_code",
        "discovered_from_url",
        "discovered_from_job_id",
        "is_active",
        "last_checked_at",
        "last_success_at",
        "last_error",
        "failure_count",
        "created_at",
        "updated_at",
    },
    "friendly_company_career_pages": {
        "id",
        "company_name",
        "career_page_url",
        "domain",
        "country_code",
        "discovered_from_url",
        "discovered_from_job_id",
        "is_friendly",
        "requires_login",
        "captcha_detected",
        "has_file_upload",
        "last_checked_at",
        "created_at",
        "updated_at",
    },
    "apply_agent_recipes": {
        "id",
        "provider",
        "field_recipes",
        "success_count",
        "failure_count",
        "submit_success_count",
        "submit_failure_count",
        "last_used_at",
        "last_success_at",
        "created_at",
        "updated_at",
    },
    "geo_places": {
        "id",
        "geoname_id",
        "name",
        "normalized_name",
        "ascii_name",
        "alternate_names",
        "country_code",
        "admin1_code",
        "admin2_code",
        "feature_class",
        "feature_code",
        "latitude",
        "longitude",
        "population",
        "timezone",
        "source",
        "created_at",
        "updated_at",
    },
    "company_boards": {"board_id", "ats_provider", "company", "board_token", "enabled", "priority", "last_synced_at"},
    "profiles": {"user_id", "target_role", "target_location", "updated_at"},
    "swipes": {"swipe_id", "user_id", "job_id", "direction", "created_at"},
    "applications": {"application_id", "user_id", "job_id", "status", "package_status", "submission_status", "created_at", "updated_at"},
    "gmail_connections": {"user_id", "email", "connected", "last_synced_at", "updated_at"},
    "application_emails": {"email_id", "user_id", "application_id", "job_id", "provider", "gmail_message_id", "gmail_thread_id", "received_at", "classification"},
    "browser_submission_runs": {"run_id", "application_id", "job_id", "user_id", "provider", "status", "dry_run", "created_at"},
    "analytics_events": {"event_id", "user_id", "anonymous_id", "event", "page", "source", "created_at"},
    "stripe_events": {"event_id", "type", "created_at", "processed_at"},
    "training_creators": {"creator_id", "user_id", "email", "display_name", "created_at"},
    "training_courses": {"course_id", "creator_id", "title", "status", "published", "created_at", "updated_at"},
    "training_modules": {"module_id", "course_id", "title", "sort_order", "duration_seconds", "created_at"},
    "training_enrollments": {"enrollment_id", "user_id", "course_id", "progress_percent", "enrolled_at", "updated_at"},
    "training_crm_leads": {"lead_id", "creator_id", "email", "name", "stage", "source", "created_at", "updated_at"},
    "creator_invites": {"invite_id", "code", "influencer_id", "invite_type", "course_id", "redeemed_by_user_id", "created_at", "updated_at"},
    "user_feedback": {"submission_id", "feedback_type", "user_id", "user_email", "created_at", "updated_at"},
    "rome_profiles": {"rome_code", "fetched_at"},
    "interview_simulator_templates": {"template_id", "created_by_user_id", "created_at", "updated_at"},
    "friend_referral_codes": {"code", "user_id", "created_at", "updated_at"},
    "friend_referral_redemptions": {"redemption_id", "code", "referrer_user_id", "redeemer_user_id", "redeemer_email", "created_at"},
    # Generic, driver-agnostic columns only. Provider/driver-specific detail
    # (evidence, missing_fields, blueprint internals) stays in the JSONB `data`
    # document so new ApplyDrivers (Email, API, Browser) never need a migration.
    "auto_apply_attempts": {
        "id", "user_id", "job_id", "provider", "driver", "driver_version",
        "blueprint_signature", "complexity", "compatibility_score", "eligible",
        "stage_reached", "status", "verdict", "reason",
        "claimed_at", "submitted_at", "verified_at", "created_at", "updated_at",
    },
    "notifications": {"notification_id", "user_id"},
    "creator_applications": {"creator_application_id", "email"},
}
MAX_READ_ROWS = 10000
READ_PAGE_SIZE = 1000
# Jobs keep most feed fields in the JSONB document. Selecting non-column fields
# through PostgREST raises a 400 and makes /jobs/feed fail, so read the document.
JOB_FEED_SELECT = "data"

_shared_http_client: Optional[httpx.AsyncClient] = None


def _get_shared_http_client(timeout: float = 30.0) -> httpx.AsyncClient:
    global _shared_http_client
    if _shared_http_client is None or _shared_http_client.is_closed:
        # Separate connect/read budgets: PostgREST can be slow under load while
        # Bright Data / auto-apply runs; a flat 30s ReadTimeout on auth breaks the lab.
        timeout_cfg = httpx.Timeout(
            connect=min(15.0, timeout),
            read=max(60.0, timeout),
            write=30.0,
            pool=60.0,
        )
        _shared_http_client = httpx.AsyncClient(
            timeout=timeout_cfg,
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
        )
    return _shared_http_client


async def _http_get_with_retries(
    client: httpx.AsyncClient,
    url: str,
    *,
    params: Any,
    headers: Dict[str, str],
    attempts: int = 3,
) -> httpx.Response:
    last_exc: Optional[BaseException] = None
    for attempt in range(max(1, attempts)):
        try:
            return await client.get(url, params=params, headers=headers)
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError) as exc:
            last_exc = exc
            if attempt >= attempts - 1:
                raise
            await asyncio.sleep(0.35 * (attempt + 1))
    assert last_exc is not None
    raise last_exc


class SupabaseWriteResult(dict):
    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


def _supabase_headers(secret_key: str) -> Dict[str, str]:
    return {
        "apikey": secret_key,
        "Authorization": f"Bearer {secret_key}",
    }


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is not None and value.__class__.__name__ == "ObjectId":
        return str(value)
    return value


def _document_key(table: str, doc: Document) -> str:
    if table == "swipes":
        return str(doc.get("swipe_id") or f"{doc.get('user_id')}:{doc.get('job_id')}:{doc.get('direction')}:{doc.get('created_at')}")
    key = TABLE_PRIMARY_KEYS.get(table)
    value = doc.get(key) if key else None
    if not value:
        raise ValueError(f"{table} documents must contain {key}")
    return str(value)


def _supabase_row(table: str, document: Document) -> Dict[str, Any]:
    doc = _json_safe(document)
    if table == "users":
        return {
            "user_id": _document_key(table, doc),
            "email": doc.get("email"),
            "name": doc.get("name"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "user_sessions":
        return {
            "session_token": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "expires_at": doc.get("expires_at"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "jobs":
        columns = extract_normalized_job_columns(doc)
        return {
            "job_id": _document_key(table, doc),
            "provider": doc.get("provider"),
            "external_id": doc.get("external_id"),
            **columns,
            "data": doc,
        }
    if table == "ats_company_sources":
        now = datetime.now(timezone.utc).isoformat()
        doc.setdefault("id", f"{doc.get('ats_provider')}:{doc.get('source_key')}")
        doc.setdefault("created_at", now)
        doc.setdefault("updated_at", now)
        return {
            "id": _document_key(table, doc),
            "ats_provider": doc.get("ats_provider"),
            "source_key": doc.get("source_key"),
            "company_name": doc.get("company_name"),
            "careers_url": doc.get("careers_url"),
            "country_code": doc.get("country_code"),
            "discovered_from_url": doc.get("discovered_from_url"),
            "discovered_from_job_id": doc.get("discovered_from_job_id"),
            "is_active": bool(doc.get("is_active", True)),
            "last_checked_at": doc.get("last_checked_at"),
            "last_success_at": doc.get("last_success_at"),
            "last_error": doc.get("last_error"),
            "failure_count": int(doc.get("failure_count") or 0),
            "raw_metadata": doc.get("raw_metadata"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "geo_places":
        now = datetime.now(timezone.utc).isoformat()
        doc.setdefault("created_at", now)
        doc["updated_at"] = doc.get("updated_at") or now
        return {
            "geoname_id": _document_key(table, doc),
            "name": doc.get("name"),
            "normalized_name": doc.get("normalized_name"),
            "ascii_name": doc.get("ascii_name"),
            "alternate_names": doc.get("alternate_names") or [],
            "country_code": str(doc.get("country_code") or "").lower(),
            "admin1_code": doc.get("admin1_code"),
            "admin2_code": doc.get("admin2_code"),
            "feature_class": doc.get("feature_class"),
            "feature_code": doc.get("feature_code"),
            "latitude": doc.get("latitude"),
            "longitude": doc.get("longitude"),
            "population": int(doc.get("population") or 0),
            "timezone": doc.get("timezone"),
            "source": doc.get("source") or "geonames",
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "company_boards":
        return {
            "board_id": _document_key(table, doc),
            "ats_provider": doc.get("ats_provider"),
            "company": doc.get("company"),
            "board_token": doc.get("board_token"),
            "enabled": bool(doc.get("enabled", True)),
            "priority": doc.get("priority"),
            "last_synced_at": doc.get("last_synced_at"),
            "data": doc,
        }
    if table == "profiles":
        return {
            "user_id": _document_key(table, doc),
            "target_role": doc.get("target_role"),
            "target_location": doc.get("target_location"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "swipes":
        swipe_id = _document_key(table, doc)
        doc.setdefault("swipe_id", swipe_id)
        return {
            "swipe_id": swipe_id,
            "user_id": doc.get("user_id"),
            "job_id": doc.get("job_id"),
            "direction": doc.get("direction"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "applications":
        return {
            "application_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "job_id": doc.get("job_id"),
            "status": doc.get("status"),
            "package_status": doc.get("package_status"),
            "submission_status": doc.get("submission_status"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "gmail_connections":
        return {
            "user_id": _document_key(table, doc),
            "email": doc.get("email"),
            "connected": bool(doc.get("connected", True)),
            "last_synced_at": doc.get("last_synced_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "application_emails":
        return {
            "email_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "application_id": doc.get("application_id"),
            "job_id": doc.get("job_id"),
            "provider": doc.get("provider"),
            "gmail_message_id": doc.get("gmail_message_id"),
            "gmail_thread_id": doc.get("gmail_thread_id"),
            "received_at": doc.get("received_at"),
            "classification": doc.get("classification"),
            "data": doc,
        }
    if table == "browser_submission_runs":
        return {
            "run_id": _document_key(table, doc),
            "application_id": doc.get("application_id"),
            "job_id": doc.get("job_id"),
            "user_id": doc.get("user_id"),
            "provider": doc.get("provider"),
            "status": doc.get("status"),
            "dry_run": bool(doc.get("dry_run")),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "analytics_events":
        return {
            "event_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "anonymous_id": doc.get("anonymous_id"),
            "event": doc.get("event"),
            "page": doc.get("page"),
            "source": doc.get("source"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "stripe_events":
        return {
            "event_id": _document_key(table, doc),
            "type": doc.get("type"),
            "created_at": doc.get("created_at"),
            "processed_at": doc.get("processed_at"),
            "data": doc,
        }
    if table == "training_creators":
        return {
            "creator_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "email": doc.get("email"),
            "display_name": doc.get("display_name"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "training_courses":
        return {
            "course_id": _document_key(table, doc),
            "creator_id": doc.get("creator_id"),
            "title": doc.get("title"),
            "status": doc.get("status"),
            "published": bool(doc.get("published")),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "training_modules":
        return {
            "module_id": _document_key(table, doc),
            "course_id": doc.get("course_id"),
            "title": doc.get("title"),
            "sort_order": int(doc.get("sort_order") or 0),
            "duration_seconds": doc.get("duration_seconds"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "training_enrollments":
        return {
            "enrollment_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "course_id": doc.get("course_id"),
            "progress_percent": int(doc.get("progress_percent") or 0),
            "completed_module_ids": doc.get("completed_module_ids") or [],
            "enrolled_at": doc.get("enrolled_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "training_crm_leads":
        return {
            "lead_id": _document_key(table, doc),
            "creator_id": doc.get("creator_id"),
            "email": doc.get("email"),
            "name": doc.get("name"),
            "stage": doc.get("stage"),
            "source": doc.get("source"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "creator_invites":
        return {
            "invite_id": _document_key(table, doc),
            "code": doc.get("code"),
            "influencer_id": doc.get("influencer_id"),
            "invite_type": doc.get("invite_type"),
            "course_id": doc.get("course_id"),
            "redeemed_by_user_id": doc.get("redeemed_by_user_id"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "user_feedback":
        return {
            "submission_id": _document_key(table, doc),
            "feedback_type": doc.get("feedback_type"),
            "user_id": doc.get("user_id"),
            "user_email": doc.get("user_email"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "rome_profiles":
        return {
            "rome_code": _document_key(table, doc),
            "fetched_at": doc.get("fetched_at"),
            "data": doc,
        }
    if table == "interview_simulator_templates":
        return {
            "template_id": _document_key(table, doc),
            "created_by_user_id": doc.get("created_by_user_id"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "friend_referral_codes":
        now = datetime.now(timezone.utc).isoformat()
        doc.setdefault("created_at", now)
        doc["updated_at"] = doc.get("updated_at") or now
        return {
            "code": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "friend_referral_redemptions":
        doc.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        return {
            "redemption_id": _document_key(table, doc),
            "code": doc.get("code"),
            "referrer_user_id": doc.get("referrer_user_id"),
            "redeemer_user_id": doc.get("redeemer_user_id"),
            "redeemer_email": doc.get("redeemer_email"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "auto_apply_attempts":
        # Only generic, driver-agnostic columns are promoted; everything else
        # (evidence, missing_fields, provider-specific detail) stays in `data`.
        return {
            "id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "job_id": doc.get("job_id"),
            "provider": doc.get("provider"),
            "driver": doc.get("driver"),
            "driver_version": doc.get("driver_version"),
            "blueprint_signature": doc.get("blueprint_signature"),
            "complexity": doc.get("complexity"),
            "compatibility_score": doc.get("compatibility_score"),
            "eligible": doc.get("eligible"),
            "stage_reached": doc.get("stage_reached"),
            "status": doc.get("status"),
            "verdict": doc.get("verdict"),
            "reason": doc.get("reason"),
            "claimed_at": doc.get("claimed_at"),
            "submitted_at": doc.get("submitted_at"),
            "verified_at": doc.get("verified_at"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "notifications":
        return {
            "notification_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "data": doc,
        }
    if table == "creator_applications":
        return {
            "creator_application_id": _document_key(table, doc),
            "email": doc.get("email"),
            "data": doc,
        }
    raise ValueError(f"Unsupported Supabase table: {table}")


def _restore_document(row: Dict[str, Any]) -> Document:
    data = row.get("data")
    if isinstance(data, dict):
        return dict(data)
    restored = dict(row)
    restored.pop("data", None)
    restored.pop("migrated_at", None)
    return restored


def _project_document(document: Document, projection: Projection) -> Document:
    if not projection:
        return dict(document)
    if projection.get("_id") == 0 and len(projection) == 1:
        return dict(document)

    include_keys = {key for key, value in projection.items() if value and key != "_id"}
    exclude_keys = {key for key, value in projection.items() if not value}
    if include_keys:
        projected: Document = {}
        for key in include_keys:
            value = _get_document_path(document, key)
            if value is not None:
                _set_document_path(projected, key, value)
        if projection.get("_id", 1) and "_id" in document:
            projected["_id"] = document["_id"]
        return projected
    projected = dict(document)
    for key in exclude_keys:
        projected.pop(key, None)
    return projected


def _comparable(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value


def _match_operator(value: Any, operator: str, expected: Any, condition: Dict[str, Any]) -> bool:
    if operator == "$in":
        expected_values = expected or []
        if isinstance(value, list):
            return any(item in expected_values for item in value)
        return value in expected_values
    if operator == "$nin":
        expected_values = expected or []
        if isinstance(value, list):
            return all(item not in expected_values for item in value)
        return value not in expected_values
    if operator == "$gte":
        if value is None:
            return False
        left = _comparable(value)
        right = _comparable(expected)
        try:
            return left >= right
        except TypeError:
            return False
    if operator == "$lte":
        if value is None:
            return False
        left = _comparable(value)
        right = _comparable(expected)
        try:
            return left <= right
        except TypeError:
            return False
    if operator == "$exists":
        exists = value is not None
        return exists is bool(expected)
    if operator == "$regex":
        flags = re.IGNORECASE if "i" in str(condition.get("$options", "")) else 0
        return re.search(str(expected), str(value or ""), flags) is not None
    if operator == "$not":
        if isinstance(expected, dict):
            return not _match_condition(value, expected)
        return value != expected
    if operator == "$options":
        return True
    return False


def _match_condition(value: Any, condition: Any) -> bool:
    if isinstance(condition, dict):
        for operator, expected in condition.items():
            if operator.startswith("$"):
                if not _match_operator(value, operator, expected, condition):
                    return False
            elif value != condition:
                return False
        return True
    return value == condition


def _matches_filter(document: Document, filter: Optional[Filter]) -> bool:
    if not filter:
        return True
    for key, condition in filter.items():
        if key == "$or":
            clauses = condition or []
            if not any(_matches_filter(document, clause) for clause in clauses):
                return False
            continue
        if key == "$and":
            clauses = condition or []
            if not all(_matches_filter(document, clause) for clause in clauses):
                return False
            continue
        if not _match_condition(_get_document_path(document, key), condition):
            return False
    return True


def _get_document_path(document: Document, dotted_key: str) -> Any:
    target: Any = document
    for part in dotted_key.split("."):
        if not isinstance(target, dict) or part not in target:
            return None
        target = target[part]
    return target


def _set_document_path(document: Document, dotted_key: str, value: Any) -> None:
    parts = dotted_key.split(".")
    target = document
    for part in parts[:-1]:
        existing = target.get(part)
        if not isinstance(existing, dict):
            existing = {}
            target[part] = existing
        target = existing
    target[parts[-1]] = value


def _postgrest_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _postgrest_in_value(value: Any) -> str:
    if isinstance(value, bool):
        return _postgrest_value(value)
    text = str(value)
    if any(char in text for char in (",", "(", ")", ":", " ")):
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def _postgrest_filter_key(table: str, key: str) -> str:
    return key


def _postgrest_filter_params(table: str, filter: Optional[Filter]) -> Optional[Dict[str, str]]:
    if not filter:
        return {}
    columns = TABLE_FILTER_COLUMNS.get(table, set())
    params: Dict[str, str] = {}
    for key, condition in filter.items():
        if key.startswith("$") or "." in key or key not in columns:
            return None
        param_key = _postgrest_filter_key(table, key)
        if isinstance(condition, dict):
            if "$in" in condition and len(condition) == 1:
                values = ",".join(_postgrest_in_value(item) for item in (condition.get("$in") or []))
                params[param_key] = f"in.({values})"
            elif "$gte" in condition and len(condition) == 1:
                params[param_key] = f"gte.{_postgrest_value(condition.get('$gte'))}"
            elif "$lte" in condition and len(condition) == 1:
                params[param_key] = f"lte.{_postgrest_value(condition.get('$lte'))}"
            else:
                return None
        else:
            params[param_key] = f"eq.{_postgrest_value(condition)}"
    return params


class SupabaseCursorAdapter(CursorPort):
    def __init__(self, collection: "SupabaseCollectionAdapter", filter: Optional[Filter] = None, projection: Projection = None):
        self.collection = collection
        self.filter = filter or {}
        self.projection = projection
        self._sort_spec: List[tuple[str, int]] = []
        self._limit: Optional[int] = None
        self._iter_items: Optional[List[Document]] = None
        self._iter_index = 0

    def sort(self, key_or_list: Any, direction: Optional[int] = None) -> "SupabaseCursorAdapter":
        if direction is None and isinstance(key_or_list, list):
            self._sort_spec = [(key, int(dir_value)) for key, dir_value in key_or_list]
        elif direction is None and isinstance(key_or_list, tuple):
            self._sort_spec = [(key_or_list[0], int(key_or_list[1]))]
        else:
            self._sort_spec = [(str(key_or_list), int(direction or 1))]
        return self

    def limit(self, count: int) -> "SupabaseCursorAdapter":
        self._limit = count
        return self

    async def to_list(self, length: Optional[int]):
        limit = length if length is not None else self._limit
        # A sort on columns PostgREST can order by natively (real promoted
        # columns, not nested JSONB) can be pushed down alongside the limit —
        # letting Postgres do an indexed ORDER BY ... LIMIT N instead of this
        # adapter fetching up to MAX_READ_ROWS full rows via deep-offset
        # pagination just to re-sort a handful of them in Python.
        pushable_columns = TABLE_FILTER_COLUMNS.get(self.collection.table_name, set())
        order_param = None
        if self._sort_spec and all(key in pushable_columns for key, _ in self._sort_spec):
            order_param = ",".join(
                f"{key}.{'desc.nullslast' if direction < 0 else 'asc'}"
                for key, direction in self._sort_spec
            )
            pushed_limit = limit
        else:
            pushed_limit = limit if not self._sort_spec else None
        rows = await self.collection._read_documents(self.filter, pushed_limit, order=order_param)
        if self._sort_spec:
            for key, direction in reversed(self._sort_spec):
                rows.sort(key=lambda item: (item.get(key) is None, item.get(key)), reverse=direction < 0)
        if self._limit is not None:
            rows = rows[: self._limit]
        if limit is not None:
            rows = rows[:limit]
        return [_project_document(row, self.projection) for row in rows]

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._iter_items is None:
            self._iter_items = await self.to_list(self._limit)
        if self._iter_index >= len(self._iter_items):
            raise StopAsyncIteration
        item = self._iter_items[self._iter_index]
        self._iter_index += 1
        return item


class SupabaseCollectionAdapter(CollectionPort):
    def __init__(self, table_name: str, supabase_url: Optional[str] = None, secret_key: Optional[str] = None):
        self.table_name = table_name
        self.supabase_url = supabase_url
        self.secret_key = secret_key

    @property
    def _read_supported(self) -> bool:
        return self.table_name in MIGRATED_TABLES and bool(self.supabase_url and self.secret_key)

    def _require_read_supported(self) -> None:
        if self.table_name not in MIGRATED_TABLES:
            raise RuntimeError(f"Supabase path is only implemented for {sorted(MIGRATED_TABLES)}.")
        if not self.supabase_url or not self.secret_key:
            raise RuntimeError("Supabase URL or secret key is missing.")

    async def _read_documents(
        self,
        filter: Optional[Filter] = None,
        read_limit: Optional[int] = None,
        *,
        select: str = "data",
        order: Optional[str] = None,
    ) -> List[Document]:
        self._require_read_supported()
        assert self.supabase_url is not None
        assert self.secret_key is not None

        url = self.supabase_url.rstrip("/") + f"/rest/v1/{self.table_name}"
        headers = _supabase_headers(self.secret_key)
        documents: List[Document] = []
        offset = 0
        remote_filter_params = _postgrest_filter_params(self.table_name, filter)
        can_push_filter = remote_filter_params is not None
        client = _get_shared_http_client()
        while offset < MAX_READ_ROWS:
            page_limit = READ_PAGE_SIZE
            if read_limit is not None and can_push_filter:
                remaining = max(0, read_limit - len(documents))
                if remaining <= 0:
                    break
                page_limit = min(page_limit, remaining)
            request_params: Dict[str, str] = {
                "select": select,
                "limit": str(page_limit),
                "offset": str(offset),
            }
            if order:
                request_params["order"] = order
            elif self.table_name == "jobs":
                request_params["order"] = "imported_at.desc.nullslast"
            if remote_filter_params is not None:
                request_params.update(remote_filter_params)
            response = await _http_get_with_retries(
                client,
                url,
                params=request_params,
                headers=headers,
            )
            if response.status_code not in (200, 206):
                raise RuntimeError(
                    f"Supabase {self.table_name} read returned HTTP {response.status_code}: {response.text[:300]}"
                )
            rows = response.json()
            if not isinstance(rows, list) or not rows:
                break
            documents.extend(_restore_document(row) for row in rows)
            if len(rows) < page_limit:
                break
            offset += page_limit
        if can_push_filter:
            return documents
        filtered = [document for document in documents if _matches_filter(document, filter)]
        return filtered[:read_limit] if read_limit is not None else filtered

    async def find_one(self, filter: Filter, projection: Projection = None, sort: Optional[List[tuple[str, int]]] = None):
        cursor = SupabaseCursorAdapter(self, filter, projection)
        if sort:
            cursor.sort(sort)
        rows = await cursor.limit(1).to_list(1)
        return rows[0] if rows else None

    def find(self, filter: Optional[Filter] = None, projection: Projection = None):
        self._require_read_supported()
        return SupabaseCursorAdapter(self, filter, projection)

    async def read_with_select(
        self,
        filter: Optional[Filter],
        limit: int,
        *,
        select: str = JOB_FEED_SELECT,
    ) -> List[Document]:
        """Read rows with an explicit PostgREST select list."""
        return await self._read_documents(filter, read_limit=limit, select=select)

    async def find_geo_places_by_bounding_box(
        self,
        *,
        min_lat: float,
        max_lat: float,
        min_lng: float,
        max_lng: float,
        min_population: int = 0,
        country_codes: Optional[List[str]] = None,
        limit: int = 500,
    ) -> List[Document]:
        """Read geo_places within a bounding box using repeated PostgREST params."""
        if self.table_name != "geo_places":
            raise RuntimeError("find_geo_places_by_bounding_box is only available for geo_places")
        self._require_read_supported()
        assert self.supabase_url is not None
        assert self.secret_key is not None

        params: List[tuple[str, str]] = [
            ("select", "data"),
            ("latitude", f"gte.{_postgrest_value(min_lat)}"),
            ("latitude", f"lte.{_postgrest_value(max_lat)}"),
            ("longitude", f"gte.{_postgrest_value(min_lng)}"),
            ("longitude", f"lte.{_postgrest_value(max_lng)}"),
            ("population", f"gte.{_postgrest_value(min_population)}"),
            ("order", "population.desc.nullslast"),
            ("limit", str(max(1, min(int(limit), 5000)))),
        ]
        codes = [str(code).lower() for code in (country_codes or []) if code]
        if codes:
            params.append(("country_code", f"in.({','.join(_postgrest_in_value(code) for code in codes)})"))

        client = _get_shared_http_client()
        response = await client.get(
            self.supabase_url.rstrip("/") + "/rest/v1/geo_places",
            params=params,
            headers=_supabase_headers(self.secret_key),
        )
        if response.status_code not in (200, 206):
            raise RuntimeError(f"Supabase geo_places bbox read returned HTTP {response.status_code}: {response.text[:300]}")
        rows = response.json()
        if not isinstance(rows, list):
            return []
        return [_restore_document(row) for row in rows]

    async def insert_one(self, document: Document):
        result = await upsert_supabase_documents(self.supabase_url or "", self.secret_key or "", self.table_name, [document])
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or f"Supabase {self.table_name} insert failed")
        return SupabaseWriteResult(inserted_id=_document_key(self.table_name, _json_safe(document)))

    async def insert_many(self, documents):
        docs = list(documents)
        result = await upsert_supabase_documents(self.supabase_url or "", self.secret_key or "", self.table_name, docs)
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or f"Supabase {self.table_name} insert_many failed")
        return SupabaseWriteResult(inserted_count=result.get("rows", 0))

    async def update_one(self, filter: Filter, update: Document, upsert: bool = False):
        if upsert and self._can_fast_upsert(filter, update):
            document: Document = {}
            for key, value in filter.items():
                if not key.startswith("$") and not isinstance(value, dict):
                    _set_document_path(document, key, value)
            if "$setOnInsert" in update:
                for key, value in (update.get("$setOnInsert") or {}).items():
                    _set_document_path(document, key, value)
            if "$set" in update:
                for key, value in (update.get("$set") or {}).items():
                    _set_document_path(document, key, value)
            result = await upsert_supabase_documents(self.supabase_url or "", self.secret_key or "", self.table_name, [document])
            if not result.get("ok"):
                raise RuntimeError(result.get("error") or f"Supabase {self.table_name} update failed")
            return SupabaseWriteResult(matched_count=0, modified_count=1, upserted_id=_document_key(self.table_name, _json_safe(document)))

        existing = await self.find_one(filter, {"_id": 0})
        if not existing and not upsert:
            return SupabaseWriteResult(matched_count=0, modified_count=0, upserted_id=None)
        document = dict(existing or {})
        if "$set" in update:
            for key, value in (update.get("$set") or {}).items():
                _set_document_path(document, key, value)
        if "$setOnInsert" in update and not existing:
            for key, value in (update.get("$setOnInsert") or {}).items():
                _set_document_path(document, key, value)
        if "$inc" in update:
            for key, value in (update.get("$inc") or {}).items():
                document[key] = int(document.get(key) or 0) + int(value)
        if not any(key.startswith("$") for key in update):
            document.update(update)
        for key, value in filter.items():
            if not key.startswith("$") and not isinstance(value, dict):
                document.setdefault(key, value)
        result = await upsert_supabase_documents(self.supabase_url or "", self.secret_key or "", self.table_name, [document])
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or f"Supabase {self.table_name} update failed")
        return SupabaseWriteResult(matched_count=1 if existing else 0, modified_count=1, upserted_id=None if existing else _document_key(self.table_name, _json_safe(document)))

    def _can_fast_upsert(self, filter: Filter, update: Document) -> bool:
        if self.table_name == "profiles":
            return False
        if "$inc" in update:
            return False
        if any(key.startswith("$") for key in filter):
            return False
        if any(isinstance(value, dict) for value in filter.values()):
            return False
        allowed_update_keys = {"$set", "$setOnInsert"}
        if any(key.startswith("$") and key not in allowed_update_keys for key in update):
            return False
        if not any(key in update for key in allowed_update_keys):
            return not any(key.startswith("$") for key in update)
        return True

    async def update_many(self, filter: Filter, update: Document, upsert: bool = False):
        docs = await self._read_documents(filter)
        modified = 0
        for doc in docs:
            await self.update_one({TABLE_PRIMARY_KEYS[self.table_name]: _document_key(self.table_name, doc)}, update, upsert=False)
            modified += 1
        return SupabaseWriteResult(matched_count=len(docs), modified_count=modified)

    async def delete_one(self, filter: Filter):
        docs = await self._read_documents(filter)
        if not docs:
            return SupabaseWriteResult(deleted_count=0)
        await self._delete_by_key(_document_key(self.table_name, docs[0]))
        return SupabaseWriteResult(deleted_count=1)

    async def delete_many(self, filter: Filter):
        docs = await self._read_documents(filter)
        for doc in docs:
            await self._delete_by_key(_document_key(self.table_name, doc))
        return SupabaseWriteResult(deleted_count=len(docs))

    async def _delete_by_key(self, key_value: str) -> None:
        self._require_read_supported()
        key = TABLE_PRIMARY_KEYS[self.table_name]
        url = (self.supabase_url or "").rstrip("/") + f"/rest/v1/{self.table_name}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                url,
                params={key: f"eq.{key_value}"},
                headers=_supabase_headers(self.secret_key or ""),
            )
        if response.status_code not in (200, 202, 204):
            raise RuntimeError(f"Supabase {self.table_name} delete returned HTTP {response.status_code}: {response.text[:300]}")

    async def count_documents(self, filter: Filter) -> int:
        self._require_read_supported()
        remote_filter_params = _postgrest_filter_params(self.table_name, filter)
        if remote_filter_params is not None:
            assert self.supabase_url is not None
            assert self.secret_key is not None
            result = await count_supabase_table(self.supabase_url, self.secret_key, self.table_name, remote_filter_params)
            if result.get("ok"):
                return int(result.get("count") or 0)
        if not filter:
            assert self.supabase_url is not None
            assert self.secret_key is not None
            result = await count_supabase_table(self.supabase_url, self.secret_key, self.table_name)
            if result.get("ok"):
                return int(result.get("count") or 0)
        return len(await self._read_documents(filter))

    async def create_index(self, keys: Any, **kwargs: Any):
        raise RuntimeError("Supabase indexes are managed through SQL migrations, not runtime create_index calls.")


class SupabaseDatabaseAdapter(DatabaseAdapter):
    def __init__(self, supabase_url: str, secret_key: str, db_url: Optional[str] = None):
        self.supabase_url = supabase_url
        self.secret_key = secret_key
        self.db_url = db_url
        self.users = SupabaseCollectionAdapter("users", supabase_url, secret_key)
        self.user_sessions = SupabaseCollectionAdapter("user_sessions", supabase_url, secret_key)
        self.profiles = SupabaseCollectionAdapter("profiles", supabase_url, secret_key)
        self.jobs = SupabaseCollectionAdapter("jobs", supabase_url, secret_key)
        self.ats_company_sources = SupabaseCollectionAdapter("ats_company_sources", supabase_url, secret_key)
        self.friendly_company_career_pages = SupabaseCollectionAdapter("friendly_company_career_pages", supabase_url, secret_key)
        self.auto_apply_attempts = SupabaseCollectionAdapter("auto_apply_attempts", supabase_url, secret_key)
        self.apply_agent_recipes = SupabaseCollectionAdapter("apply_agent_recipes", supabase_url, secret_key)
        self.geo_places = SupabaseCollectionAdapter("geo_places", supabase_url, secret_key)
        self.applications = SupabaseCollectionAdapter("applications", supabase_url, secret_key)
        self.gmail_connections = SupabaseCollectionAdapter("gmail_connections", supabase_url, secret_key)
        self.application_emails = SupabaseCollectionAdapter("application_emails", supabase_url, secret_key)
        self.swipes = SupabaseCollectionAdapter("swipes", supabase_url, secret_key)
        self.company_boards = SupabaseCollectionAdapter("company_boards", supabase_url, secret_key)
        self.browser_submission_runs = SupabaseCollectionAdapter("browser_submission_runs", supabase_url, secret_key)
        self.analytics_events = SupabaseCollectionAdapter("analytics_events", supabase_url, secret_key)
        self.stripe_events = SupabaseCollectionAdapter("stripe_events", supabase_url, secret_key)
        self.training_creators = SupabaseCollectionAdapter("training_creators", supabase_url, secret_key)
        self.training_courses = SupabaseCollectionAdapter("training_courses", supabase_url, secret_key)
        self.training_modules = SupabaseCollectionAdapter("training_modules", supabase_url, secret_key)
        self.training_enrollments = SupabaseCollectionAdapter("training_enrollments", supabase_url, secret_key)
        self.training_crm_leads = SupabaseCollectionAdapter("training_crm_leads", supabase_url, secret_key)
        self.creator_invites = SupabaseCollectionAdapter("creator_invites", supabase_url, secret_key)
        self.user_feedback = SupabaseCollectionAdapter("user_feedback", supabase_url, secret_key)
        self.rome_profiles = SupabaseCollectionAdapter("rome_profiles", supabase_url, secret_key)
        self.friend_referral_codes = SupabaseCollectionAdapter("friend_referral_codes", supabase_url, secret_key)
        self.friend_referral_redemptions = SupabaseCollectionAdapter("friend_referral_redemptions", supabase_url, secret_key)
        self.notifications = SupabaseCollectionAdapter("notifications", supabase_url, secret_key)
        self.creator_applications = SupabaseCollectionAdapter("creator_applications", supabase_url, secret_key)

    async def close(self) -> None:
        return None


async def test_supabase_connection(
    supabase_url: str,
    secret_key: str,
    timeout: float = 10.0,
) -> dict:
    """Probe Supabase REST connectivity without reading or writing app data."""
    if not supabase_url or not secret_key:
        return {"ok": False, "error": "Supabase URL or secret key is missing."}

    url = supabase_url.rstrip("/") + "/rest/v1/"
    headers = _supabase_headers(secret_key)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url, headers=headers)
        if 200 <= response.status_code < 300:
            return {"ok": True, "error": None}
        return {
            "ok": False,
            "error": f"Supabase REST returned HTTP {response.status_code}: {response.text[:300]}",
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"{exc.__class__.__name__}: {str(exc)[:300]}",
        }


async def count_supabase_table(
    supabase_url: str,
    secret_key: str,
    table: str,
    filter_params: Optional[Dict[str, str]] = None,
    timeout: float = 10.0,
) -> Dict[str, Any]:
    """Return an exact Supabase row count through PostgREST without exposing secrets."""
    if table not in MIGRATED_TABLES:
        raise ValueError(f"Unsupported Supabase count table: {table}")
    if not supabase_url or not secret_key:
        return {"ok": False, "count": None, "error": "Supabase URL or secret key is missing."}

    url = supabase_url.rstrip("/") + f"/rest/v1/{table}"
    headers = {
        **_supabase_headers(secret_key),
        "Prefer": "count=exact",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            request_params = {"select": "*", "limit": "0"}
            if filter_params:
                request_params.update(filter_params)
            response = await client.get(url, params=request_params, headers=headers)
        if response.status_code not in (200, 206):
            return {
                "ok": False,
                "count": None,
                "error": f"Supabase {table} count returned HTTP {response.status_code}: {response.text[:300]}",
            }
        content_range = response.headers.get("content-range", "")
        count_text = content_range.rsplit("/", 1)[-1] if "/" in content_range else ""
        return {"ok": True, "count": int(count_text), "error": None}
    except Exception as exc:
        return {"ok": False, "count": None, "error": f"{exc.__class__.__name__}: {str(exc)[:300]}"}


async def upsert_supabase_documents(
    supabase_url: str,
    secret_key: str,
    table: str,
    documents: List[Document],
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """Upsert application documents into Supabase jsonb-backed tables."""
    if table not in MIGRATED_TABLES:
        raise ValueError(f"Unsupported Supabase migration table: {table}")
    if not documents:
        return {"ok": True, "rows": 0, "error": None}
    if not supabase_url or not secret_key:
        return {"ok": False, "rows": 0, "error": "Supabase URL or secret key is missing."}

    conflict_key = TABLE_PRIMARY_KEYS[table]
    rows = [_supabase_row(table, document) for document in documents]
    url = supabase_url.rstrip("/") + f"/rest/v1/{table}"
    headers = {
        **_supabase_headers(secret_key),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                params={"on_conflict": conflict_key},
                headers=headers,
                content=json.dumps(rows),
            )
        if response.status_code not in (200, 201, 204):
            return {
                "ok": False,
                "rows": 0,
                "error": f"Supabase {table} upsert returned HTTP {response.status_code}: {response.text[:500]}",
            }
        return {"ok": True, "rows": len(rows), "error": None}
    except Exception as exc:
        return {"ok": False, "rows": 0, "error": f"{exc.__class__.__name__}: {str(exc)[:500]}"}
