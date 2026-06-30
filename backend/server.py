"""
Tinder for Jobs - FastAPI backend.

Features:
- Supabase Google OAuth exchange (access_token -> session_token cookie)
- CV upload (PDF/DOCX/TXT) -> Claude Sonnet 4.5 extracts profile JSON
- Job feed with AI-computed match score & reasons (Claude)
- Swipe right -> creates Application with tailored CV + cover letter (Claude)
- Application tracker with status updates
"""
import sys
import asyncio

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, UploadFile, File, Depends, Cookie, Header, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import io
import json
import logging
import inspect
import random
import uuid
import re
import base64
import time
import hashlib
import unicodedata
from pathlib import Path
from urllib.parse import quote as url_quote, urlparse
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timezone, timedelta
import httpx
import stripe

# Optional file parsing libs
from pypdf import PdfReader
import docx as docx_lib
from application_documents import DOCX_MIME, build_application_package, cover_letter_to_text, sanitize_docx_text
from browser_submission.base import BrowserSubmissionError, browser_submit_dry_run_enabled
from browser_submission.greenhouse import GreenhouseBrowserSubmissionEngine
from browser_submission.lever import LeverBrowserSubmissionEngine
from browser_submission.matching import suggested_profile_key as browser_suggested_profile_key
from db import create_database_adapter
from db.supabase_adapter import count_supabase_table, test_supabase_connection
from influencer_store import create_influencer, get_influencer, list_influencers, update_influencer
from creator_invite_store import (
    INVITE_TYPE_CREATOR,
    INVITE_TYPE_DEMO,
    INVITE_TYPE_TRAINING,
    create_demo_invitation,
    create_invitation,
    create_standalone_invitation,
    ensure_dev_test_invites,
    get_invite_by_code,
    list_demo_invites,
    list_invites_for_influencer,
    list_training_invites,
    mark_invite_clicked,
    mark_invite_redeemed,
    enrich_invite_rows,
    migrate_file_invites_to_db,
    bootstrap_invites_from_influencers,
    backfill_invites_from_users,
    materialize_invite_from_link,
    resolve_invite_type,
    validate_invite,
)
from jobs_service import (
    refresh_greenhouse_boards,
    refresh_jobs_for_profile_if_needed,
    refresh_lever_boards,
    seed_greenhouse_company_boards,
    seed_lever_company_boards,
)
from job_providers import get_board_provider, get_job_provider
from job_providers.apply_eligibility import classify_apply_link, is_manual_fulfillment_ready
from job_providers.base import JobSearchQuery
from job_cache_maintenance import (
    env_bool as job_cache_env_bool,
    expire_stale_jobs,
    job_cache_status,
    refresh_jobs_for_query_or_filters,
    revalidate_cached_jobs,
    run_job_cache_maintenance,
)
from ats_source_service import (
    discover_ats_sources_from_cached_jobs,
    refresh_ats_source,
    refresh_known_ats_sources,
)
from job_validation import cheap_validate_job_applyability
from location_search import search_locations
from llm_client import LLMProviderNotConfigured, complete_json_text
from onboarding_suggestions import suggest_categories, suggest_roles
from feedback_routes import register_feedback_routes
from gmail_sync import (
    GMAIL_READONLY_SCOPE,
    gmail_connected_payload,
    public_email_message,
    store_gmail_tokens,
    sync_gmail_application_emails,
)
from training_routes import register_training_routes, register_training_admin_routes
from training_service import (
    SEED_COURSE_ID,
    admin_training_analytics as compute_training_analytics,
    enroll_user,
    ensure_training_enrollments_for_access_users,
    is_training_creator,
    seed_training_content,
    sync_training_locale_content,
)
from training_access import require_training_access, training_access_payload

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')


def _normalize_supabase_url(value: str | None) -> str:
    url = (value or "").strip().rstrip("/")
    for suffix in ("/rest/v1", "/auth/v1"):
        if url.endswith(suffix):
            return url[: -len(suffix)]
    return url


def _cors_origins() -> List[str]:
    configured = [
        origin.strip().rstrip("/")
        for origin in os.environ.get("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]
    defaults = [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://www.tryhirly.com",
        "https://tryhirly.com",
        "https://hirly-two.vercel.app",
    ]
    for env_name in ("FRONTEND_URL", "REACT_APP_FRONTEND_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"):
        value = (os.environ.get(env_name) or "").strip().rstrip("/")
        if not value:
            continue
        defaults.append(value if value.startswith(("http://", "https://")) else f"https://{value}")
    origins = configured or defaults
    return list(dict.fromkeys([origin for origin in [*origins, *defaults] if origin and origin != "*"]))


DATABASE_PROVIDER = "supabase"
db = create_database_adapter()
_application_generation_locks: Dict[str, asyncio.Lock] = {}
_application_generation_tasks: Dict[str, asyncio.Task] = {}

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

_feed_job_pool_cache: Dict[str, Any] = {"query_key": "", "rows": [], "fetched_at": 0.0}
_FEED_JOB_POOL_TTL_SECONDS = 90.0
_feed_sync_refresh_cooldown_until = 0.0


async def _get_feed_job_candidates(base_query: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    cache_key = json.dumps(base_query, sort_keys=True, default=str)
    now = time.monotonic()
    if (
        _feed_job_pool_cache["query_key"] == cache_key
        and _feed_job_pool_cache["rows"]
        and len(_feed_job_pool_cache["rows"]) >= limit
        and (now - float(_feed_job_pool_cache["fetched_at"])) < _FEED_JOB_POOL_TTL_SECONDS
    ):
        return list(_feed_job_pool_cache["rows"][:limit])
    jobs_col = db.jobs
    if hasattr(jobs_col, "read_with_select"):
        rows = await jobs_col.read_with_select(base_query, limit)
    else:
        rows = await jobs_col.find(base_query, {"_id": 0}).limit(limit).to_list(limit)
    _feed_job_pool_cache["query_key"] = cache_key
    _feed_job_pool_cache["rows"] = rows
    _feed_job_pool_cache["fetched_at"] = now
    return rows


async def _hydrate_feed_jobs(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Load full job payloads (descriptions) only for jobs shown in the feed."""
    job_ids = [job.get("job_id") for job in jobs if job.get("job_id")]
    if not job_ids:
        return jobs
    full_rows = await db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0}).to_list(len(job_ids))
    by_id = {row.get("job_id"): row for row in full_rows if row.get("job_id")}
    hydrated: List[Dict[str, Any]] = []
    for job in jobs:
        full = by_id.get(job.get("job_id"))
        merged = {**job, **(full or {})}
        for key, value in job.items():
            if key.startswith("_"):
                merged[key] = value
        hydrated.append(merged)
    return hydrated


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _apply_fulfillment_fields(job: Dict[str, Any]) -> Dict[str, Any]:
    if job.get("apply_fulfillment_status") and job.get("manual_fulfillment_ready") is not None:
        return {
            "apply_fulfillment_status": job.get("apply_fulfillment_status"),
            "apply_fulfillment_reason": job.get("apply_fulfillment_reason"),
            "apply_url_source": job.get("apply_url_source"),
            "apply_url_provider": job.get("apply_url_provider"),
            "selected_apply_url": job.get("selected_apply_url") or job.get("external_url"),
            "manual_fulfillment_ready": bool(job.get("manual_fulfillment_ready")),
            "job_board_account_required": bool(job.get("job_board_account_required")),
        }
    return classify_apply_link(
        job.get("external_url") or job.get("apply_url") or job.get("hosted_url"),
        source=job.get("source") or job.get("provider"),
        apply_options=job.get("apply_options") or [],
    )


def _job_is_applyable(job: Dict[str, Any]) -> bool:
    validation_status = str(job.get("validation_status") or "").strip().lower()
    applyability_tier = str(job.get("applyability_tier") or "").strip().upper()
    if validation_status == "invalid" or applyability_tier in {"D", "E"}:
        return False
    if validation_status or applyability_tier:
        if not (job.get("selected_apply_url") or job.get("external_url") or job.get("apply_url") or job.get("hosted_url")):
            return False
        if job.get("requires_login") is True or job.get("requires_account_creation") is True or job.get("captcha_detected") is True:
            return False
    return is_manual_fulfillment_ready(job)


def _with_apply_fulfillment_fields(job: Dict[str, Any]) -> Dict[str, Any]:
    fields = _apply_fulfillment_fields(job)
    external_url = fields.get("selected_apply_url") or job.get("external_url")
    return {**job, **fields, "external_url": external_url}


async def validate_job_before_application(job: Dict[str, Any]) -> Dict[str, Any]:
    """Revalidate and persist a job before credits or application creation."""
    job_id = job.get("job_id")
    latest_job = job
    if job_id:
        latest_job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0}) or job
    validation = cheap_validate_job_applyability(latest_job)
    updated_job = {**latest_job, **validation}
    if job_id:
        await db.jobs.update_one({"job_id": job_id}, {"$set": validation})

    tier = str(validation.get("applyability_tier") or "").upper()
    status = str(validation.get("validation_status") or "").lower()
    allow_unknown = _env_bool("JOBS_ALLOW_UNKNOWN_TIER_APPLICATION", False)
    selected_apply_url = validation.get("selected_apply_url")
    blocked_reason = None

    if status == "invalid" or tier in {"D", "E"}:
        blocked_reason = validation.get("validation_reason") or validation.get("rejection_reason") or "Job is not applyable."
    elif not selected_apply_url:
        blocked_reason = "No apply URL is available."
    elif validation.get("requires_login") is True or validation.get("requires_account_creation") is True:
        blocked_reason = "This job requires a candidate login or account creation."
    elif validation.get("captcha_detected") is True:
        blocked_reason = "This job appears protected by CAPTCHA or bot protection."
    elif tier == "C":
        if not allow_unknown:
            blocked_reason = "This job needs additional validation before applications can be submitted."
        elif updated_job.get("manual_fulfillment_ready") is not True:
            blocked_reason = "This job is not ready for manual fulfillment."
    elif tier not in {"A", "B"} or status != "valid":
        blocked_reason = validation.get("validation_reason") or "Job validation did not confirm an applyable job."

    allowed = blocked_reason is None
    return {
        "allowed": allowed,
        "reason": "Job passed pre-application validation." if allowed else blocked_reason,
        "validation_status": validation.get("validation_status"),
        "applyability_tier": validation.get("applyability_tier"),
        "selected_apply_url": selected_apply_url,
        "requires_login": bool(validation.get("requires_login")),
        "requires_account_creation": bool(validation.get("requires_account_creation")),
        "captcha_detected": bool(validation.get("captcha_detected")),
        "job": updated_job,
        "validation": validation,
    }


# ===================== Models =====================

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    demo_account: bool = False
    training_access: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Profile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    cv_text: Optional[str] = None
    cv_filename: Optional[str] = None
    summary: Optional[str] = None
    skills: List[str] = []
    experience: List[Dict[str, Any]] = []
    education: List[Dict[str, Any]] = []
    target_roles: List[str] = []
    target_role: Optional[str] = None
    target_location: Optional[str] = None
    remote_preference: Optional[str] = "any"   # remote | onsite | hybrid | any
    seniority: Optional[str] = None
    application_answers_profile: Dict[str, Any] = Field(default_factory=dict)
    application_defaults: Dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Job(BaseModel):
    model_config = ConfigDict(extra="ignore")
    job_id: str
    title: str
    company: str
    company_logo: Optional[str] = None
    location: str
    remote: str  # remote | hybrid | onsite
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    currency: str = "USD"
    description: str
    requirements: List[str] = []
    tech_stack: List[str] = []
    seniority: Optional[str] = None
    posted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SwipeRequest(BaseModel):
    job_id: str
    direction: Literal["left", "right"]


class AdminJobsRefreshRequest(BaseModel):
    search_role: Optional[str] = None
    location: Optional[str] = None
    country_code: Optional[str] = None
    remote: Optional[bool] = None
    limit: Optional[int] = None
    pages: Optional[int] = None
    dry_run: bool = False


class AdminJobsRevalidateRequest(BaseModel):
    validation_status: Optional[str] = None
    applyability_tier: Optional[str] = None
    older_than_hours: Optional[int] = None
    country_code: Optional[str] = None
    limit: Optional[int] = None
    dry_run: bool = False


class AdminJobsExpireStaleRequest(BaseModel):
    older_than_days: Optional[int] = None
    provider: Optional[str] = None
    country_code: Optional[str] = None
    limit: Optional[int] = None
    dry_run: bool = False


class AdminJobsMaintenanceRequest(BaseModel):
    dry_run: bool = False
    refresh_popular: Optional[bool] = None


class AdminAtsDiscoverSourcesRequest(BaseModel):
    provider: Optional[Literal["greenhouse", "lever", "ashby"]] = None
    country_code: Optional[str] = None
    limit: Optional[int] = 500
    dry_run: bool = False


class AdminAtsRefreshSourceRequest(BaseModel):
    ats_provider: Literal["greenhouse", "lever", "ashby"]
    source_key: str
    limit: Optional[int] = None
    dry_run: bool = False


class AdminAtsRefreshKnownSourcesRequest(BaseModel):
    provider: Optional[Literal["greenhouse", "lever", "ashby"]] = None
    country_code: Optional[str] = None
    limit: Optional[int] = 25
    older_than_hours: Optional[int] = 12
    dry_run: bool = False


class GreenhousePrepareSubmitRequest(BaseModel):
    job_id: str


class LeverBrowserFillRequest(BaseModel):
    job_id: str


class LeverSubmissionBenchmarkRequest(BaseModel):
    job_ids: List[str]
    run_browser_submit: bool = True
    allow_real_submit: bool = False


class SupabaseSessionRequest(BaseModel):
    access_token: str
    provider_token: Optional[str] = None
    provider_refresh_token: Optional[str] = None
    provider_token_expires_at: Optional[Any] = None


class InviteEmailAuthRequest(BaseModel):
    email: str
    password: str
    code: str
    mode: Literal["signup", "login"] = "signup"


class AnalyticsEventRequest(BaseModel):
    event: str
    properties: Dict[str, Any] = Field(default_factory=dict)
    anonymous_id: Optional[str] = None
    page: Optional[str] = None
    source: Optional[str] = None


class BillingCheckoutRequest(BaseModel):
    plan: Literal["basic", "pro", "ultra", "monthly", "quarterly"]
    interval: Optional[Literal["weekly", "monthly", "quarterly"]] = None
    source: Optional[Literal["app", "credits", "onboarding"]] = None


class BillingMasterCodeRequest(BaseModel):
    code: str
    plan: Literal["basic", "pro", "ultra", "monthly", "quarterly"] = "ultra"
    interval: Optional[Literal["weekly", "monthly", "quarterly"]] = None
    source: Optional[Literal["app", "credits", "onboarding"]] = None


class ResolveMissingInfoRequest(BaseModel):
    answers: Dict[str, Any] = Field(default_factory=dict)
    save_to_profile: bool = False


class Application(BaseModel):
    model_config = ConfigDict(extra="ignore")
    application_id: str
    user_id: str
    job_id: str
    status: Literal["applied", "viewed", "interview", "rejected", "offer"] = "applied"
    package_status: Literal["not_generated", "generated", "generated_text_only", "failed", "pending_generation", "needs_profile_data", "needs_job_data"] = "not_generated"
    generation_status: Optional[Literal["pending_generation", "generating", "generated", "failed"]] = None
    generation_error: Optional[str] = None
    submission_status: Literal["not_submitted", "ready", "prepared", "submitted", "failed", "blocked", "action_required", "blocked_captcha", "prepare_failed", "unknown"] = "not_submitted"
    submitted_at: Optional[str] = None
    submission_provider: Optional[str] = None
    submission_response_id: Optional[str] = None
    submission_error: Optional[str] = None
    prepared_application_payload: Optional[Dict[str, Any]] = None
    prepared_generated_answers: List[Dict[str, Any]] = Field(default_factory=list)
    prepared_missing_information: List[Any] = Field(default_factory=list)
    prepared_blockers: List[str] = Field(default_factory=list)
    prepared_at: Optional[str] = None
    submission_response_metadata: Optional[Dict[str, Any]] = None
    tailored_resume: Optional[Dict[str, Any]] = None
    cover_letter: Optional[Dict[str, Any]] = None
    match_score: Optional[int] = None
    match_reasons: List[str] = []
    interview_prep: List[str] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusUpdate(BaseModel):
    status: Literal["applied", "viewed", "interview", "rejected", "offer"]


class AdminNoteCreate(BaseModel):
    note: str


class AdminStatusUpdate(BaseModel):
    status: Literal["submitted", "needs_user_input", "blocked", "escalated"]


class AdminManualStatusUpdate(BaseModel):
    manual_status: Literal["manual_review_needed", "manual_in_progress", "manually_submitted", "manual_blocked", "needs_user_input"]
    note: Optional[str] = None


class PreferencesUpdate(BaseModel):
    target_role: Optional[str] = None
    target_roles: Optional[List[str]] = None
    target_location: Optional[str] = None
    target_location_data: Optional[Dict[str, Any]] = None
    remote_preference: Optional[str] = None
    seniority: Optional[str] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None       # always overridden server-side with authenticated user's email
    phone: Optional[str] = None
    location: Optional[str] = None
    location_data: Optional[Dict[str, Any]] = None
    linkedin: Optional[str] = None
    website: Optional[str] = None


class ApplicationDefaultsUpdate(BaseModel):
    application_defaults: Dict[str, Any] = Field(default_factory=dict)


class StructuredProfileDataUpdate(BaseModel):
    contact: Dict[str, Any] = Field(default_factory=dict)
    education: List[Dict[str, Any]] = Field(default_factory=list)
    experience_summary: Dict[str, Any] = Field(default_factory=dict)
    skills: List[str] = Field(default_factory=list)
    application_defaults: Dict[str, Any] = Field(default_factory=dict)


class OnboardingCategoryItem(BaseModel):
    id: str
    label: str


class OnboardingSuggestCategoriesRequest(BaseModel):
    location: str = ""
    contract_type: str = ""
    location_data: Optional[Dict[str, Any]] = None


class OnboardingSuggestRolesRequest(BaseModel):
    location: str = ""
    contract_type: str = ""
    categories: List[OnboardingCategoryItem] = Field(default_factory=list)
    location_data: Optional[Dict[str, Any]] = None


# ===================== Auth helpers =====================

async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> User:
    bearer_token = None
    if authorization and authorization.lower().startswith("bearer "):
        bearer_token = authorization.split(" ", 1)[1].strip()

    candidates: List[tuple[str, str]] = []
    if bearer_token:
        candidates.append(("bearer", bearer_token))
    if session_token:
        source = "bearer_failed_cookie_fallback" if bearer_token else "cookie"
        candidates.append((source, session_token))

    if not candidates:
        logger.info("auth_me token_missing path=%s", request.url.path)
        raise HTTPException(status_code=401, detail="Not authenticated")

    last_failure = "Invalid session"
    for token_source, token in candidates:
        logger.info("auth_me token_received source=%s path=%s", token_source, request.url.path)
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if not session:
            logger.info("auth_me invalid_token reason=session_not_found source=%s", token_source)
            last_failure = "Invalid session"
            continue

        expires_at = session.get("expires_at")
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at < datetime.now(timezone.utc):
            logger.info("auth_me invalid_token reason=session_expired source=%s user_id=%s", token_source, session.get("user_id"))
            last_failure = "Session expired"
            continue

        user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
        if not user_doc:
            logger.info("auth_me invalid_token reason=user_not_found source=%s user_id=%s", token_source, session.get("user_id"))
            last_failure = "User not found"
            continue
        return User(**user_doc)

    raise HTTPException(status_code=401, detail=last_failure)


# ===================== Auth routes =====================

async def _upsert_auth_user(email: str, name: str, picture: Optional[str], extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        update = {"name": name, "picture": picture}
        if extra:
            update.update(extra)
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": update},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if extra:
            user_doc.update(extra)
        await db.users.insert_one(user_doc)
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return user_doc


async def _create_app_session(user_id: str, source: str, session_token: Optional[str] = None) -> str:
    token = session_token or f"sess_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
    })
    return token


def _set_app_session_cookie(response: Response, session_token: str) -> None:
    is_dev = os.environ.get("ENVIRONMENT", "").strip().lower() == "development"
    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=not is_dev,
        samesite="lax" if is_dev else "none",
        path="/",
    )


def _supabase_admin_config() -> tuple[str, str]:
    supabase_url = _normalize_supabase_url(os.environ.get("SUPABASE_URL"))
    supabase_secret = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not supabase_url or not supabase_secret:
        raise HTTPException(status_code=503, detail="Supabase auth is not configured")
    return supabase_url, supabase_secret


async def _supabase_admin_request(
    method: str,
    path: str,
    json_body: Optional[Dict[str, Any]] = None,
) -> httpx.Response:
    supabase_url, supabase_secret = _supabase_admin_config()
    headers = {
        "apikey": supabase_secret,
        "Authorization": f"Bearer {supabase_secret}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15.0) as http:
        return await http.request(
            method,
            f"{supabase_url}{path}",
            headers=headers,
            json=json_body,
        )


async def _supabase_password_access_token(email: str, password: str) -> str:
    response = await _supabase_admin_request(
        "POST",
        "/auth/v1/token?grant_type=password",
        {"email": email.strip().lower(), "password": password},
    )
    if response.status_code != 200:
        payload = response.json() if response.content else {}
        detail = payload.get("error_description") or payload.get("msg") or "Invalid email or password"
        raise HTTPException(status_code=401, detail=detail)
    access_token = (response.json() or {}).get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Authentication failed")
    return access_token


async def _supabase_admin_find_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    normalized = email.strip().lower()
    response = await _supabase_admin_request(
        "GET",
        f"/auth/v1/admin/users?email={url_quote(normalized)}",
    )
    if response.status_code != 200:
        return None
    users = (response.json() or {}).get("users") or []
    return users[0] if users else None


async def _supabase_admin_ensure_confirmed_user(email: str, password: str) -> None:
    normalized = email.strip().lower()
    create_response = await _supabase_admin_request(
        "POST",
        "/auth/v1/admin/users",
        {
            "email": normalized,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": normalized.split("@")[0]},
        },
    )
    if create_response.status_code in (200, 201):
        return

    existing = await _supabase_admin_find_user_by_email(normalized)
    if not existing:
        payload = create_response.json() if create_response.content else {}
        detail = payload.get("msg") or payload.get("error_description") or "Could not create account"
        raise HTTPException(status_code=400, detail=detail)

    user_id = existing.get("id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Could not resolve existing account")

    update_response = await _supabase_admin_request(
        "PUT",
        f"/auth/v1/admin/users/{user_id}",
        {"email_confirm": True, "password": password},
    )
    if update_response.status_code not in (200, 201):
        payload = update_response.json() if update_response.content else {}
        detail = payload.get("msg") or payload.get("error_description") or "Could not update account"
        raise HTTPException(status_code=400, detail=detail)


async def _session_payload_from_supabase_token(
    access_token: str,
    response: Response,
    *,
    source: str = "supabase",
    provider_token: Optional[str] = None,
    provider_refresh_token: Optional[str] = None,
    provider_token_expires_at: Optional[Any] = None,
) -> Dict[str, Any]:
    supabase_url, supabase_secret = _supabase_admin_config()
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.get(
            f"{supabase_url}/auth/v1/user",
            headers={
                "apikey": supabase_secret,
                "Authorization": f"Bearer {access_token}",
            },
        )
    if r.status_code != 200:
        logger.info("supabase_session invalid_token status=%s body=%s", r.status_code, r.text[:200])
        raise HTTPException(status_code=401, detail="Invalid Supabase access token")

    data = r.json()
    email = data.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Supabase user email is missing")
    metadata = data.get("user_metadata") or {}
    identities = data.get("identities") or []
    identity_data = (identities[0].get("identity_data") if identities and isinstance(identities[0], dict) else {}) or {}
    name = (
        metadata.get("full_name")
        or metadata.get("name")
        or identity_data.get("full_name")
        or identity_data.get("name")
        or email.split("@")[0]
    )
    picture = metadata.get("avatar_url") or metadata.get("picture") or identity_data.get("avatar_url") or identity_data.get("picture")
    user_doc = await _upsert_auth_user(
        email=email,
        name=name,
        picture=picture,
        extra={
            "auth_provider": "supabase",
            "supabase_user_id": data.get("id"),
            "last_login_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    session_token = await _create_app_session(user_doc["user_id"], source)
    _set_app_session_cookie(response, session_token)

    gmail_connection = {"connected": False, "email": None, "last_synced_at": None}
    if provider_token or provider_refresh_token:
        try:
            await store_gmail_tokens(
                db,
                user_id=user_doc["user_id"],
                email=email,
                provider_token=provider_token,
                provider_refresh_token=provider_refresh_token,
                expires_at=provider_token_expires_at,
            )
            gmail_connection = gmail_connected_payload(
                await db.gmail_connections.find_one({"user_id": user_doc["user_id"]}, {"_id": 0})
            )
        except Exception as exc:
            logger.warning("gmail_token_store_failed user_id=%s error=%s", user_doc["user_id"], str(exc)[:200])
            gmail_connection = {
                "connected": False,
                "email": email,
                "last_synced_at": None,
                "last_sync_error": str(exc)[:200],
            }

    profile = await db.profiles.find_one({"user_id": user_doc["user_id"]}, {"_id": 0, "cv_text": 1, "target_role": 1})
    creator_flag, training_access = await asyncio.gather(
        is_training_creator(db, user_doc["user_id"]),
        _resolve_training_access_from_user_doc(user_doc),
    )
    logger.info("supabase_session success user_id=%s email=%s", user_doc["user_id"], email)
    return {
        "user": user_doc,
        "has_profile": profile is not None and bool(profile.get("cv_text")),
        "has_preferences": profile is not None and bool(profile.get("target_role")),
        "is_training_creator": creator_flag,
        "has_training_access": training_access,
        "gmail": gmail_connection,
        "session_token": session_token,
    }


async def _resolve_training_access_from_user_doc(user_doc: Dict[str, Any]) -> bool:
    from training_access import training_open_access_enabled

    if training_open_access_enabled():
        return True
    user_id = user_doc.get("user_id")
    if not user_id:
        return False
    if user_doc.get("training_access"):
        return True
    if user_id == TUTORIAL_FILMING_USER_ID:
        return True
    if _is_admin_email(user_doc.get("email")):
        return True
    return await is_training_creator(db, user_id)


@api_router.post("/auth/supabase-session")
async def auth_supabase_session(body: SupabaseSessionRequest, response: Response):
    """Exchange a verified Supabase access token for the app's session_token."""
    access_token = (body.access_token or "").strip()
    if not access_token:
        raise HTTPException(status_code=400, detail="access_token required")
    return await _session_payload_from_supabase_token(
        access_token,
        response,
        source="supabase_google",
        provider_token=(body.provider_token or "").strip() or None,
        provider_refresh_token=(body.provider_refresh_token or "").strip() or None,
        provider_token_expires_at=body.provider_token_expires_at,
    )


@api_router.post("/auth/invite-email")
async def auth_invite_email(body: InviteEmailAuthRequest, response: Response):
    """Sign up or sign in via email for creator invites — no Supabase confirmation email."""
    email = (body.email or "").strip().lower()
    password = body.password or ""
    code = (body.code or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=400, detail="Enter a valid 6-digit invitation code")

    check = await validate_invite(db, code)
    if not check.get("valid"):
        reason = check.get("reason")
        if reason == "revoked":
            raise HTTPException(status_code=410, detail="This invitation is no longer valid")
        raise HTTPException(status_code=400, detail="Invalid invitation code")

    if body.mode == "signup":
        await _supabase_admin_ensure_confirmed_user(email, password)

    access_token = await _supabase_password_access_token(email, password)
    source = "supabase_invite_signup" if body.mode == "signup" else "supabase_invite_login"
    return await _session_payload_from_supabase_token(access_token, response, source=source)


@api_router.post("/dev/login")
async def dev_login(response: Response):
    """Development-only local login that bypasses Emergent OAuth."""
    if not _dev_tools_enabled():
        raise HTTPException(status_code=404, detail="Not found")

    user_doc = await db.users.find_one({}, {"_id": 0})
    if not user_doc:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": "dev@swiipr.local",
            "name": "Dev User",
            "picture": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user_doc)
    else:
        user_id = user_doc["user_id"]

    session_token = f"dev_session_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "dev_login",
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=False,
        samesite="lax",
        path="/",
    )

    profile = await db.profiles.find_one({"user_id": user_id}, {"_id": 0})
    logger.info(
        "dev_login success user_id=%s has_profile=%s token_prefix=%s",
        user_id,
        bool(profile),
        session_token[:12],
    )
    return {
        "session_token": session_token,
        "token": session_token,
        "user": user_doc,
        "profile": profile,
        "has_profile": profile is not None and bool(profile.get("cv_text")),
        "has_preferences": profile is not None and bool(profile.get("target_role")),
    }


TUTORIAL_FILMING_USER_ID = "tutorial_filming"

TUTORIAL_FILMING_PROFILE = {
    "cv_text": """Alex Martin
Senior Software Engineer — Paris, France

EXPERIENCE
Senior Software Engineer, ProductCo (2022–Present)
- React/TypeScript product used by 200k+ users
- Shipped hiring workflows and candidate tooling

Software Engineer, StartupXYZ (2019–2022)
- Node.js APIs, PostgreSQL, CI/CD

SKILLS
React, TypeScript, Node.js, Python, system design

EDUCATION
MSc Computer Science, 2019
""",
    "cv_filename": "alex-martin-cv.pdf",
    "summary": "Senior software engineer focused on React, TypeScript, and product delivery.",
    "target_role": "Software Engineer",
    "target_roles": ["Software Engineer", "Frontend Engineer", "Full Stack Engineer"],
    "target_location": "Paris, France",
    "target_location_data": {
        "location_label": "Paris, France",
        "country": "France",
        "country_code": "FR",
    },
    "remote_preference": "hybrid",
    "seniority": "mid",
    "skills": ["React", "TypeScript", "Node.js", "Python", "PostgreSQL"],
}


def _demo_profile_for_feed(user_id: str, profile: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Demo creators can swipe without uploading a CV — use a seeded profile for feed scoring."""
    base = dict(profile or {})
    merged = {**TUTORIAL_FILMING_PROFILE, **base, "user_id": user_id}
    if not merged.get("cv_text"):
        merged["cv_text"] = TUTORIAL_FILMING_PROFILE["cv_text"]
    if not merged.get("target_role"):
        merged["target_role"] = TUTORIAL_FILMING_PROFILE["target_role"]
    if not merged.get("target_roles"):
        merged["target_roles"] = TUTORIAL_FILMING_PROFILE["target_roles"]
    if not merged.get("target_location"):
        merged["target_location"] = TUTORIAL_FILMING_PROFILE["target_location"]
    if not merged.get("target_location_data"):
        merged["target_location_data"] = TUTORIAL_FILMING_PROFILE["target_location_data"]
    return merged


async def _ensure_demo_feed_profile(user_id: str) -> None:
    existing = await db.profiles.find_one({"user_id": user_id}, {"_id": 0, "cv_text": 1})
    if existing and existing.get("cv_text"):
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.profiles.update_one(
        {"user_id": user_id},
        {"$set": {**TUTORIAL_FILMING_PROFILE, "user_id": user_id, "updated_at": now}},
        upsert=True,
    )


@api_router.post("/tutorial/session")
async def tutorial_session(response: Response):
    """Temporary filming endpoint: demo account + seeded profile for real job feed."""
    now = datetime.now(timezone.utc).isoformat()
    user_doc = await db.users.find_one({"user_id": TUTORIAL_FILMING_USER_ID}, {"_id": 0})
    if not user_doc:
        user_doc = {
            "user_id": TUTORIAL_FILMING_USER_ID,
            "email": "tutorial@hirly.app",
            "name": "Alex Martin",
            "picture": None,
            "demo_account": True,
            "training_access": True,
            "created_at": now,
        }
        await db.users.insert_one(user_doc)
    else:
        await db.users.update_one(
            {"user_id": TUTORIAL_FILMING_USER_ID},
            {"$set": {
                "demo_account": True,
                "training_access": True,
                "name": user_doc.get("name") or "Alex Martin",
            }},
        )
        user_doc["demo_account"] = True
        user_doc["training_access"] = True

    profile_payload = {
        **TUTORIAL_FILMING_PROFILE,
        "user_id": TUTORIAL_FILMING_USER_ID,
        "updated_at": now,
    }
    await db.profiles.update_one(
        {"user_id": TUTORIAL_FILMING_USER_ID},
        {"$set": profile_payload},
        upsert=True,
    )

    session_token = f"tutorial_session_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": TUTORIAL_FILMING_USER_ID,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": now,
        "source": "tutorial_filming",
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=os.environ.get("ENVIRONMENT", "").strip().lower() != "development",
        samesite="lax",
        path="/",
    )

    return {
        "session_token": session_token,
        "token": session_token,
        "user": user_doc,
        "has_profile": True,
        "has_preferences": True,
    }


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    profile, creator, training_access = await asyncio.gather(
        db.profiles.find_one({"user_id": user.user_id}, {"_id": 0}),
        is_training_creator(db, user.user_id),
        _resolve_training_access(user),
    )
    logger.info(
        "auth_me cv_readiness user_id=%s profile_exists=%s has_cv_text=%s has_cv_filename=%s has_preferences=%s",
        user.user_id,
        profile is not None,
        bool((profile or {}).get("cv_text")),
        bool((profile or {}).get("cv_filename")),
        bool((profile or {}).get("target_role")),
    )
    return {
        "user": user.model_dump(),
        "has_profile": profile is not None and bool(profile.get("cv_text")),
        "has_preferences": profile is not None and bool(profile.get("target_role")),
        "is_training_creator": creator,
        "has_training_access": training_access,
    }


async def _optional_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> Optional[User]:
    try:
        return await get_current_user(request, session_token=session_token, authorization=authorization)
    except HTTPException:
        return None


def _hash_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("x-forwarded-for", "")
    raw_ip = forwarded.split(",", 1)[0].strip() if forwarded else (request.client.host if request.client else "")
    if not raw_ip:
        return None
    salt = os.environ.get("ANALYTICS_IP_HASH_SALT", "hirly-analytics")
    return hashlib.sha256(f"{salt}:{raw_ip}".encode("utf-8")).hexdigest()[:24]


@api_router.post("/analytics/event")
async def track_analytics_event(
    body: AnalyticsEventRequest,
    request: Request,
    user: Optional[User] = Depends(_optional_current_user),
):
    event_name = (body.event or "").strip()
    if not event_name:
        raise HTTPException(status_code=400, detail="event required")
    if len(event_name) > 120:
        raise HTTPException(status_code=400, detail="event too long")
    now = datetime.now(timezone.utc).isoformat()
    event_doc = {
        "event_id": f"evt_{uuid.uuid4().hex}",
        "user_id": user.user_id if user else None,
        "anonymous_id": (body.anonymous_id or "").strip()[:160] or None,
        "event": event_name,
        "properties": body.properties or {},
        "page": (body.page or "").strip()[:300] or None,
        "source": (body.source or "").strip()[:120] or None,
        "created_at": now,
        "user_agent": request.headers.get("user-agent"),
        "ip_hash": _hash_ip(request),
    }
    try:
        await db.analytics_events.insert_one(event_doc)
    except Exception as exc:
        logger.warning("analytics_event_store_failed event=%s error=%s", event_name, str(exc)[:200])
        return {"ok": False, "stored": False}
    return {"ok": True, "stored": True, "event_id": event_doc["event_id"]}


@api_router.post("/auth/logout")
async def auth_logout(
    response: Response,
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
):
    token = session_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if token:
        await db.user_sessions.delete_many({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ===================== Billing =====================

def _stripe_secret_key() -> str:
    key = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    stripe.api_key = key
    return key


def _frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "http://localhost:3000").strip().rstrip("/")


def _canonical_billing_plan(plan: str) -> str:
    aliases = {
        "monthly": "pro",
        "quarterly": "ultra",
    }
    return aliases.get((plan or "").strip().lower(), (plan or "").strip().lower())


def _stripe_price_env_for_plan(plan: str, *, interval: Optional[str] = None, source: Optional[str] = None) -> str:
    raw_plan = (plan or "").strip().lower()
    if source == "onboarding":
        if raw_plan not in {"monthly", "quarterly"}:
            raise HTTPException(status_code=400, detail="Unsupported onboarding billing plan")
        return f"STRIPE_PRICE_ONBOARDING_{raw_plan.upper()}"

    canonical_plan = _canonical_billing_plan(plan)
    if canonical_plan not in {"basic", "pro", "ultra"}:
        raise HTTPException(status_code=400, detail="Unsupported billing plan")
    if interval == "weekly":
        return f"STRIPE_PRICE_{canonical_plan.upper()}_WEEKLY"
    return f"STRIPE_PRICE_{canonical_plan.upper()}"


def _stripe_price_for_plan(plan: str, *, interval: Optional[str] = None, source: Optional[str] = None) -> str:
    env_name = _stripe_price_env_for_plan(plan, interval=interval, source=source)
    price_id = os.environ.get(env_name, "").strip()
    if not price_id:
        raise HTTPException(status_code=503, detail=f"{env_name} is not configured")
    return price_id


def _master_billing_code() -> str:
    return os.environ.get("MASTER_BILLING_CODE", "424242").strip()


def _is_master_billing_code(code: str) -> bool:
    expected = _master_billing_code()
    return bool(expected) and (code or "").strip().casefold() == expected.casefold()


def _plan_from_price(price_id: Optional[str]) -> Optional[str]:
    for plan in ("basic", "pro", "ultra"):
        for env_name in (f"STRIPE_PRICE_{plan.upper()}", f"STRIPE_PRICE_{plan.upper()}_WEEKLY"):
            if price_id and price_id == os.environ.get(env_name, "").strip():
                return plan
    for plan in ("monthly", "quarterly"):
        if price_id and price_id == os.environ.get(f"STRIPE_PRICE_ONBOARDING_{plan.upper()}", "").strip():
            return plan
    return "unknown" if price_id else None


def _billing_from_user(user_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return dict((user_doc or {}).get("billing") or {})


def _billing_status_payload(user_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    billing = _billing_from_user(user_doc)
    status = billing.get("subscription_status") or "none"
    return {
        "subscription_status": status,
        "plan": billing.get("plan"),
        "interval": billing.get("interval"),
        "source": billing.get("source"),
        "current_period_end": billing.get("current_period_end"),
        "stripe_customer_id_exists": bool(billing.get("stripe_customer_id")),
        "is_premium": status in {"active", "trialing"},
        "credits_total": int(billing.get("credits_total") or 0),
        "credits_remaining": int(billing.get("credits_remaining") or 0),
    }


_PLAN_CREDIT_LIMITS = {
    "monthly": 200,
    "quarterly": 600,
    "ultra": 600,
    "pro": 200,
    "basic": 80,
}


def _billing_credit_limit(
    plan: Optional[str],
    is_premium: bool,
    *,
    interval: Optional[str] = None,
    source: Optional[str] = None,
) -> int:
    if not is_premium:
        return 0
    normalized_plan = (plan or "").strip().lower()
    normalized_interval = (interval or "").strip().lower()
    normalized_source = (source or "").strip().lower()
    if normalized_source == "onboarding":
        return {"monthly": 80, "quarterly": 200}.get(normalized_plan, 80)
    if normalized_interval == "weekly":
        return {"basic": 15, "pro": 35, "ultra": 100}.get(normalized_plan, 35)
    return _PLAN_CREDIT_LIMITS.get(normalized_plan, 200)


def _billing_period_bounds(billing: Dict[str, Any]) -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    period_end = _parse_dt(billing.get("current_period_end")) or now
    if period_end.tzinfo is None:
        period_end = period_end.replace(tzinfo=timezone.utc)
    period_start = period_end - timedelta(days=7)
    return period_start, period_end


def _billing_credit_period_key(billing: Dict[str, Any]) -> str:
    return "|".join(str(billing.get(key) or "") for key in (
        "stripe_subscription_id",
        "current_period_start",
        "current_period_end",
        "plan",
        "interval",
        "source",
    ))


def _merge_billing_credit_state(existing_billing: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = {**existing_billing, **updates}
    is_premium = (merged.get("subscription_status") or "none") in {"active", "trialing"}
    if not is_premium:
        merged["credits_total"] = 0
        merged["credits_remaining"] = 0
        merged["credits_period_key"] = _billing_credit_period_key(merged)
        return merged

    allowance = _billing_credit_limit(
        merged.get("plan"),
        True,
        interval=merged.get("interval"),
        source=merged.get("source"),
    )
    period_key = _billing_credit_period_key(merged)
    if (
        existing_billing.get("credits_period_key") != period_key
        or not isinstance(existing_billing.get("credits_remaining"), int)
        or int(existing_billing.get("credits_total") or 0) != allowance
    ):
        merged["credits_total"] = allowance
        merged["credits_remaining"] = allowance
        merged["credits_period_key"] = period_key
    else:
        merged["credits_total"] = allowance
        merged["credits_remaining"] = max(0, min(int(existing_billing.get("credits_remaining") or 0), allowance))
        merged["credits_period_key"] = period_key
    return merged


def _count_records_in_period(
    records: List[Dict[str, Any]],
    period_start: datetime,
    period_end: datetime,
    *,
    date_field: str = "created_at",
) -> int:
    count = 0
    for record in records:
        created_at = _parse_dt(record.get(date_field))
        if not created_at:
            continue
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if period_start <= created_at <= period_end:
            count += 1
    return count


async def _get_user_doc(user: User) -> Dict[str, Any]:
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    return user_doc


async def _grant_master_billing_access(
    user_id: str,
    plan: str,
    *,
    interval: Optional[str] = None,
    source: Optional[str] = None,
) -> Dict[str, Any]:
    checkout_source = source or "app"
    billing_plan = plan if checkout_source == "onboarding" else _canonical_billing_plan(plan)
    if checkout_source == "onboarding":
        if billing_plan not in {"monthly", "quarterly"}:
            raise HTTPException(status_code=400, detail="Unsupported onboarding billing plan")
        billing_interval = interval or billing_plan
    else:
        if billing_plan not in {"basic", "pro", "ultra"}:
            raise HTTPException(status_code=400, detail="Unsupported billing plan")
        billing_interval = interval or "monthly"

    now = datetime.now(timezone.utc)
    period_days = 7 if billing_interval == "weekly" else 90 if billing_interval == "quarterly" else 30
    updates = {
        "subscription_status": "active",
        "plan": billing_plan,
        "interval": billing_interval,
        "source": checkout_source,
        "stripe_subscription_id": f"master_code_{user_id}_{uuid.uuid4().hex[:12]}",
        "last_payment_status": "master_code",
        "current_period_start": now.isoformat(),
        "current_period_end": (now + timedelta(days=period_days)).isoformat(),
    }
    await _update_user_billing_by_user_id(user_id, updates)
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return _billing_status_payload(user_doc)


async def _update_user_billing_by_user_id(user_id: str, updates: Dict[str, Any]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    existing_user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "billing": 1}) or {}
    merged_billing = _merge_billing_credit_state(_billing_from_user(existing_user), updates)
    update_fields = {f"billing.{key}": value for key, value in merged_billing.items()}
    update_fields["billing.updated_at"] = now
    result = await db.users.update_one({"user_id": user_id}, {"$set": update_fields})
    if getattr(result, "matched_count", 0) == 0:
        logger.warning("stripe_billing_user_update_no_match user_id=%s keys=%s", user_id, sorted(updates.keys()))


async def _update_user_billing_by_customer_id(customer_id: str, updates: Dict[str, Any]) -> None:
    if not customer_id:
        logger.warning("stripe_billing_customer_update_missing_customer keys=%s", sorted(updates.keys()))
        return
    now = datetime.now(timezone.utc).isoformat()
    existing_user = await db.users.find_one({"billing.stripe_customer_id": customer_id}, {"_id": 0, "billing": 1}) or {}
    merged_billing = _merge_billing_credit_state(_billing_from_user(existing_user), updates)
    update_fields = {f"billing.{key}": value for key, value in merged_billing.items()}
    update_fields["billing.updated_at"] = now
    result = await db.users.update_one({"billing.stripe_customer_id": customer_id}, {"$set": update_fields})
    if getattr(result, "matched_count", 0) == 0:
        logger.warning("stripe_billing_customer_update_no_match customer_id=%s keys=%s", customer_id, sorted(updates.keys()))


async def _stripe_customer_for_user(user_doc: Dict[str, Any]) -> str:
    _stripe_secret_key()
    billing = _billing_from_user(user_doc)
    existing_customer_id = billing.get("stripe_customer_id")
    if existing_customer_id:
        return existing_customer_id
    customer = stripe.Customer.create(
        email=user_doc.get("email"),
        name=user_doc.get("name") or user_doc.get("email"),
        metadata={"user_id": user_doc.get("user_id", "")},
    )
    customer_id = customer["id"]
    await _update_user_billing_by_user_id(user_doc["user_id"], {"stripe_customer_id": customer_id})
    return customer_id


def _period_end_iso(subscription: Any) -> Optional[str]:
    value = subscription.get("current_period_end") if isinstance(subscription, dict) else getattr(subscription, "current_period_end", None)
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _period_start_iso(subscription: Any) -> Optional[str]:
    value = subscription.get("current_period_start") if isinstance(subscription, dict) else getattr(subscription, "current_period_start", None)
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _subscription_plan(subscription: Any) -> Optional[str]:
    try:
        items = subscription["items"]["data"]
        price_id = items[0]["price"]["id"] if items else None
    except Exception:
        price_id = None
    return _plan_from_price(price_id)


def _subscription_metadata(subscription: Any) -> Dict[str, Any]:
    metadata = subscription.get("metadata", {}) if isinstance(subscription, dict) else getattr(subscription, "metadata", {}) or {}
    return dict(metadata or {})


def _subscription_interval(subscription: Any) -> Optional[str]:
    metadata = _subscription_metadata(subscription)
    if metadata.get("interval"):
        return str(metadata.get("interval"))
    try:
        recurring = subscription["items"]["data"][0]["price"].get("recurring") or {}
        return recurring.get("interval")
    except Exception:
        return None


def _subscription_source(subscription: Any) -> Optional[str]:
    metadata = _subscription_metadata(subscription)
    return str(metadata.get("source") or "") or None


def _subscription_billing_updates(subscription: Any, *, last_payment_status: Optional[str] = None) -> Dict[str, Any]:
    metadata = _subscription_metadata(subscription)
    updates = {
        "stripe_customer_id": subscription.get("customer"),
        "stripe_subscription_id": subscription.get("id"),
        "subscription_status": subscription.get("status"),
        "plan": _subscription_plan(subscription) or metadata.get("plan") or "unknown",
        "interval": _subscription_interval(subscription),
        "source": _subscription_source(subscription),
        "current_period_start": _period_start_iso(subscription),
        "current_period_end": _period_end_iso(subscription),
    }
    if last_payment_status:
        updates["last_payment_status"] = last_payment_status
    return {key: value for key, value in updates.items() if value is not None}


def _stripe_configured() -> bool:
    return bool(os.environ.get("STRIPE_SECRET_KEY", "").strip())


async def _refresh_billing_from_stripe(user_doc: Dict[str, Any]) -> tuple[Dict[str, Any], Optional[str]]:
    billing = _billing_from_user(user_doc)
    subscription_id = billing.get("stripe_subscription_id")
    if str(subscription_id or "").startswith("master_code_"):
        return user_doc, None
    if not subscription_id or not _stripe_configured():
        return user_doc, None
    try:
        _stripe_secret_key()
        subscription = stripe.Subscription.retrieve(subscription_id)
        updates = _subscription_billing_updates(subscription)
        await _update_user_billing_by_user_id(user_doc["user_id"], updates)
        refreshed = await db.users.find_one({"user_id": user_doc["user_id"]}, {"_id": 0})
        return refreshed or {**user_doc, "billing": {**billing, **updates}}, None
    except Exception as exc:
        logger.warning("stripe_billing_status_refresh_failed user_id=%s subscription_id=%s error=%s", user_doc.get("user_id"), subscription_id, str(exc)[:200])
        return user_doc, "stripe_refresh_failed"


async def _billing_apply_credit_status(user: User) -> Dict[str, Any]:
    user_doc = await _get_user_doc(user)
    user_doc, _warning = await _refresh_billing_from_stripe(user_doc)
    payload = _billing_status_payload(user_doc)
    return payload


async def _consume_application_credit(user_id: str) -> Dict[str, int]:
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "billing": 1})
    billing = _billing_from_user(user_doc)
    remaining = max(0, int(billing.get("credits_remaining") or 0) - 1)
    total = int(billing.get("credits_total") or 0)
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "billing.credits_remaining": remaining,
            "billing.updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"credits_remaining": remaining, "credits_total": total}


@api_router.post("/billing/create-checkout-session")
async def create_billing_checkout_session(body: BillingCheckoutRequest, user: User = Depends(get_current_user)):
    _stripe_secret_key()
    checkout_source = body.source or "app"
    billing_plan = body.plan if checkout_source == "onboarding" else _canonical_billing_plan(body.plan)
    billing_interval = body.interval or ("quarterly" if checkout_source == "onboarding" and billing_plan == "quarterly" else "monthly")
    user_doc = await _get_user_doc(user)
    customer_id = await _stripe_customer_for_user(user_doc)
    frontend_url = _frontend_url()
    if checkout_source == "onboarding":
        success_url = f"{frontend_url}/onboarding?step=creatorAccessCode&checkout=success"
        cancel_url = f"{frontend_url}/onboarding?step=showcasePricing&checkout=cancelled"
    else:
        success_url = f"{frontend_url}/credits?checkout=success"
        cancel_url = f"{frontend_url}/credits?checkout=cancelled"
    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": _stripe_price_for_plan(billing_plan, interval=billing_interval, source=checkout_source), "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=user.user_id,
        metadata={"user_id": user.user_id, "plan": billing_plan, "interval": billing_interval, "source": checkout_source},
        subscription_data={"metadata": {"user_id": user.user_id, "plan": billing_plan, "interval": billing_interval, "source": checkout_source}},
    )
    return {"url": session["url"]}


@api_router.post("/billing/redeem-master-code")
async def redeem_billing_master_code(body: BillingMasterCodeRequest, user: User = Depends(get_current_user)):
    code = (body.code or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=400, detail="Enter a valid 6-digit access code")
    if not _is_master_billing_code(code):
        raise HTTPException(status_code=404, detail="Access code not found")

    billing = await _grant_master_billing_access(
        user.user_id,
        body.plan,
        interval=body.interval,
        source=body.source,
    )
    return {
        "ok": True,
        "master_code": True,
        "billing": billing,
    }


@api_router.get("/billing/status")
async def billing_status(user: User = Depends(get_current_user)):
    user_doc = await _get_user_doc(user)
    user_doc, warning = await _refresh_billing_from_stripe(user_doc)
    payload = _billing_status_payload(user_doc)
    if warning:
        payload["warning"] = warning
    return payload


@api_router.get("/billing/usage")
async def billing_usage(user: User = Depends(get_current_user)):
    user_doc = await _get_user_doc(user)
    user_doc, _warning = await _refresh_billing_from_stripe(user_doc)
    billing = _billing_from_user(user_doc)
    status_payload = _billing_status_payload(user_doc)
    is_premium = bool(status_payload.get("is_premium"))
    plan = status_payload.get("plan")
    credits_total = int(status_payload.get("credits_total") or _billing_credit_limit(
        plan,
        is_premium,
        interval=status_payload.get("interval"),
        source=status_payload.get("source"),
    ))
    credits_remaining = int(status_payload.get("credits_remaining") or 0)
    period_start, period_end = _billing_period_bounds(billing)

    usage_rows = await db.swipes.find(
        {"user_id": user.user_id, "direction": "right"},
        {"_id": 0, "created_at": 1},
    ).to_list(5000)
    credits_used = max(0, credits_total - credits_remaining) if credits_total else 0
    usage_pct = round((credits_used / credits_total) * 100) if credits_total else 0

    return {
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "credits_used": credits_used,
        "credits_total": credits_total,
        "credits_remaining": credits_remaining,
        "usage_percent": usage_pct,
        "is_premium": is_premium,
        "plan": plan,
        "interval": status_payload.get("interval"),
        "source": status_payload.get("source"),
        "daily_usage": {
            "7d": _series_counts(usage_rows, 7, lambda item: item.get("created_at")),
            "14d": _series_counts(usage_rows, 14, lambda item: item.get("created_at")),
            "30d": _series_counts(usage_rows, 30, lambda item: item.get("created_at")),
        },
    }


@api_router.post("/billing/create-portal-session")
async def create_billing_portal_session(user: User = Depends(get_current_user)):
    _stripe_secret_key()
    user_doc = await _get_user_doc(user)
    customer_id = _billing_from_user(user_doc).get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer found")
    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{_frontend_url()}/billing",
    )
    return {"url": session["url"]}


async def _handle_subscription_event(subscription: Any, *, last_payment_status: Optional[str] = None) -> None:
    customer_id = str(subscription.get("customer") or "")
    if not customer_id:
        logger.warning("stripe_subscription_event_missing_customer subscription_id=%s", subscription.get("id"))
        return
    await _update_user_billing_by_customer_id(customer_id, _subscription_billing_updates(subscription, last_payment_status=last_payment_status))


async def _stripe_event_already_processed(event_id: str) -> bool:
    if not event_id:
        return False
    existing = await db.stripe_events.find_one({"event_id": event_id}, {"_id": 0, "event_id": 1})
    return bool(existing)


async def _record_processed_stripe_event(event: Any) -> None:
    event_id = event.get("id")
    if not event_id:
        return
    created = event.get("created")
    created_at = None
    if created:
        try:
            created_at = datetime.fromtimestamp(int(created), tz=timezone.utc).isoformat()
        except Exception:
            created_at = None
    try:
        await db.stripe_events.insert_one({
            "event_id": event_id,
            "type": event.get("type"),
            "created_at": created_at,
            "processed_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.info("stripe_event_record_duplicate_or_failed event_id=%s error=%s", event_id, str(exc)[:160])


@api_router.post("/stripe/webhook")
async def stripe_webhook(request: Request):
    _stripe_secret_key()
    webhook_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
    if not webhook_secret:
        raise HTTPException(status_code=503, detail="Stripe webhook is not configured")
    payload = await request.body()
    signature = request.headers.get("Stripe-Signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    event_type = event["type"]
    event_id = event.get("id")
    if await _stripe_event_already_processed(event_id):
        logger.info("stripe_webhook_duplicate_ignored event_id=%s type=%s", event_id, event_type)
        return {"received": True, "duplicate": True}

    obj = event["data"]["object"]
    if event_type == "checkout.session.completed":
        customer_id = obj.get("customer")
        subscription_id = obj.get("subscription")
        if not customer_id:
            logger.warning("stripe_checkout_completed_missing_customer event_id=%s", event_id)
        updates = {"stripe_customer_id": customer_id, "stripe_subscription_id": subscription_id, "last_payment_status": obj.get("payment_status")}
        if subscription_id:
            try:
                subscription = stripe.Subscription.retrieve(subscription_id)
                updates.update(_subscription_billing_updates(subscription, last_payment_status=obj.get("payment_status")))
            except Exception as exc:
                logger.warning("stripe_checkout_subscription_retrieve_failed event_id=%s subscription_id=%s error=%s", event_id, subscription_id, str(exc)[:200])
        user_id = obj.get("client_reference_id") or obj.get("metadata", {}).get("user_id")
        if user_id:
            if not await db.users.find_one({"user_id": user_id}, {"_id": 0, "user_id": 1}):
                logger.warning("stripe_checkout_client_reference_user_not_found event_id=%s user_id=%s", event_id, user_id)
            await _update_user_billing_by_user_id(user_id, {key: value for key, value in updates.items() if value})
        elif customer_id:
            await _update_user_billing_by_customer_id(customer_id, {key: value for key, value in updates.items() if value})
        else:
            logger.warning("stripe_checkout_completed_no_user_or_customer event_id=%s", event_id)
    elif event_type in {"customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"}:
        await _handle_subscription_event(obj)
    elif event_type in {"invoice.payment_succeeded", "invoice.payment_failed"}:
        subscription_id = obj.get("subscription")
        customer_id = obj.get("customer")
        payment_status = "failed" if event_type == "invoice.payment_failed" else "succeeded"
        if subscription_id:
            try:
                subscription = stripe.Subscription.retrieve(subscription_id)
                await _handle_subscription_event(subscription, last_payment_status=payment_status)
            except Exception:
                if customer_id:
                    await _update_user_billing_by_customer_id(customer_id, {"last_payment_status": payment_status})
                else:
                    logger.warning("stripe_invoice_event_missing_customer event_id=%s type=%s", event_id, event_type)
        elif customer_id:
            await _update_user_billing_by_customer_id(customer_id, {"last_payment_status": payment_status})
        else:
            logger.warning("stripe_invoice_event_missing_subscription_customer event_id=%s type=%s", event_id, event_type)
    else:
        logger.info("stripe_webhook ignored event_type=%s", event_type)

    await _record_processed_stripe_event(event)
    return {"received": True}


# ===================== CV parsing =====================

def extract_text_from_upload(filename: str, content: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    if name.endswith(".docx"):
        document = docx_lib.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs)
    # txt or anything else
    try:
        return content.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def _parse_json_from_llm(text: str) -> Dict[str, Any]:
    """Extract JSON object from Claude response (handles ```json fences)."""
    text = text.strip()
    # remove code fences
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    # find first { ... last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


async def claude_extract_profile(cv_text: str) -> Dict[str, Any]:
    system_message = (
        "You are an expert resume parser. Return ONLY valid JSON. "
        "No prose, no markdown fences, no commentary."
    )

    prompt = f"""Extract the candidate profile from this CV. Return JSON with this exact schema:
{{
  "contact": {{
    "name": "Full name or empty string",
    "email": "email or empty",
    "phone": "phone or empty",
    "location": "city, country or empty",
    "city": "city explicitly listed or empty",
    "country": "country explicitly listed or empty",
    "linkedin": "linkedin url or empty",
    "website": "personal site url or empty",
    "portfolio": "portfolio url or empty"
  }},
  "summary": "1-2 sentence professional summary",
  "skills": ["skill1", "skill2", ...max 15],
  "experience": [{{"role": "...", "company": "...", "duration": "...", "location": "...", "highlights": ["...", "..."]}}],
  "education": [{{"degree": "...", "school": "...", "discipline": "field of study/major or empty", "field_of_study": "same if explicit or empty", "graduation_year": "YYYY or empty", "year": "YYYY or empty"}}],
  "target_roles": ["job title 1", "job title 2", "job title 3"],
  "seniority": "junior" | "mid" | "senior" | "lead" | "principal",
  "template_style": "modern" | "classic" | "minimal" | "two_column"
}}

For template_style, infer the layout aesthetic of the original CV: "two_column" if sidebar+main, "classic" if centered headers/serif feel, "minimal" if heavy whitespace and thin dividers, otherwise "modern".
Extract only facts explicitly present in the CV. Do not infer work authorization, sponsorship, demographic data, pronouns, or legal eligibility.

CV:
---
{cv_text[:8000]}
---
Return ONLY the JSON object."""
    response = await complete_json_text(system_message, prompt)
    return _parse_json_from_llm(response)


def _clean_string(value: Any, max_len: int = 300) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:max_len]


def _valid_email(value: Any) -> str:
    text = _clean_string(value, 200)
    return text if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", text) else ""


def _normalize_profile_url(value: Any, *, linkedin: bool = False) -> str:
    text = _clean_string(value, 400)
    if not text:
        return ""
    if re.search(r"\s", text):
        return ""
    if linkedin and "linkedin." not in text.lower():
        return ""
    if not re.match(r"^https?://", text, flags=re.I):
        text = "https://" + text
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or "." not in parsed.netloc:
        return ""
    return text


def _graduation_year(value: Any) -> str:
    match = re.search(r"\b(19|20)\d{2}\b", str(value or ""))
    return match.group(0) if match else ""


def _split_location(value: Any) -> tuple[str, str]:
    text = _clean_string(value, 160)
    if not text:
        return "", ""
    parts = [part.strip() for part in text.split(",") if part.strip()]
    if len(parts) >= 2:
        return parts[0], parts[-1]
    return text, ""


def _phone_country_code_from_explicit(phone: str) -> str:
    text = _clean_string(phone, 80)
    match = re.match(r"^\s*(\+\d{1,4})\b", text)
    return match.group(1) if match else ""


def _first_education_item(education: Any) -> Dict[str, Any]:
    items = education if isinstance(education, list) else []
    for item in items:
        if isinstance(item, dict):
            return item
    return {}


def _cv_lines(cv_text: str) -> List[str]:
    return [_clean_string(line, 500) for line in (cv_text or "").splitlines() if _clean_string(line, 500)]


def _fallback_extract_profile_from_cv(cv_text: str) -> Dict[str, Any]:
    lines = _cv_lines(cv_text)
    first_lines = lines[:12]
    text = cv_text or ""
    email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text, flags=re.I)
    phone_match = re.search(r"(?:\+\d{1,4}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}", text)
    linkedin_match = re.search(r"(?:https?://)?(?:www\.)?linkedin\.com/[^\s,;]+", text, flags=re.I)
    website_match = re.search(r"https?://(?![^/\s]*linkedin\.com)[^\s,;]+", text, flags=re.I)

    name = ""
    for line in first_lines:
        lower = line.lower()
        if "@" in line or "linkedin" in lower or re.search(r"\d{3,}", line):
            continue
        words = [part for part in re.split(r"\s+", line) if part]
        if 2 <= len(words) <= 5:
            name = line
            break

    location = ""
    for line in first_lines:
        if any(marker in line.lower() for marker in ("remote", "linkedin", "@")):
            continue
        if "," in line and not re.search(r"\d{3,}", line):
            location = line
            break

    known_skills = [
        "Python", "JavaScript", "TypeScript", "React", "Node.js", "FastAPI", "Django",
        "SQL", "PostgreSQL", "MongoDB", "Supabase", "AWS", "GCP", "Azure", "Docker",
        "Kubernetes", "Excel", "Power BI", "Tableau", "Salesforce", "Figma",
        "Marketing", "Sales", "Finance", "Accounting", "Operations", "Project Management",
        "Product Management", "Customer Success", "Data Analysis", "Machine Learning",
    ]
    lower_text = text.lower()
    skills = [skill for skill in known_skills if skill.lower() in lower_text][:15]
    contact = {
        "name": name,
        "email": email_match.group(0) if email_match else "",
        "phone": phone_match.group(0).strip() if phone_match else "",
        "location": location,
        "linkedin": linkedin_match.group(0) if linkedin_match else "",
        "website": website_match.group(0) if website_match else "",
        "portfolio": "",
        "city": "",
        "country": "",
    }
    return {
        "contact": contact,
        "summary": "",
        "skills": skills,
        "experience": [],
        "education": [],
        "target_roles": [],
        "seniority": None,
        "template_style": "modern",
        "extraction_fallback_reason": "no_ai_provider",
    }


def _line_evidence(lines: List[str], value: Any, *, window: int = 1) -> str:
    needle = _clean_string(value, 200).lower()
    if not needle:
        return ""
    for idx, line in enumerate(lines):
        if needle in line.lower():
            start = max(0, idx - window)
            end = min(len(lines), idx + window + 1)
            return " | ".join(lines[start:end])
    return ""


def _normalize_country_name(value: Any) -> str:
    text = _clean_string(value, 120)
    key = text.lower()
    aliases = {
        "royaume-uni": "United Kingdom",
        "royaume uni": "United Kingdom",
        "uk": "United Kingdom",
        "u.k.": "United Kingdom",
        "united kingdom": "United Kingdom",
        "usa": "United States",
        "us": "United States",
        "u.s.": "United States",
        "united states": "United States",
    }
    return aliases.get(key, text)


def _education_degree_parts(value: Any) -> tuple[str, str]:
    text = _clean_string(value, 200)
    if not text:
        return "", ""
    patterns = [
        (r"\b(bsc|b\.sc\.?|bachelor(?:'s)?|ba|b\.a\.?)\b\s*(?:in|of)?\s*(.*)", "Bachelor"),
        (r"\b(msc|m\.sc\.?|master(?:'s)?|ma|m\.a\.?)\b\s*(?:in|of)?\s*(.*)", "Master"),
        (r"\b(phd|ph\.d\.?|doctorate)\b\s*(?:in|of)?\s*(.*)", "PhD"),
    ]
    for pattern, degree in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            discipline = _clean_string(match.group(2), 160)
            return degree, discipline
    return text, ""


def _education_candidate_from_cv(cv_text: str) -> Optional[Dict[str, Any]]:
    lines = _cv_lines(cv_text)
    lower_lines = [line.lower() for line in lines]
    try:
        start = lower_lines.index("education") + 1
    except ValueError:
        return None
    end = len(lines)
    for marker in ("work experience", "experience", "skills", "certificates"):
        if marker in lower_lines[start:]:
            end = min(end, start + lower_lines[start:].index(marker))
    edu_lines = lines[start:end]
    candidates: List[Dict[str, Any]] = []
    school_terms = ("university", "college", "lycée", "lycee", "school", "institute", "academy")
    degree_terms = ("bsc", "b.sc", "bachelor", "ba ", "msc", "m.sc", "master", "phd", "doctorate", "degree")
    low_level_terms = ("primary school", "middle school", "high school", "hight school")
    for idx, line in enumerate(edu_lines):
        lower = line.lower()
        if re.search(r"\d{2}/\d{4}|present|^\W*$", lower):
            continue
        next_line = edu_lines[idx + 1] if idx + 1 < len(edu_lines) else ""
        following = " | ".join(edu_lines[idx:idx + 5])
        has_degree = any(term in lower for term in degree_terms)
        low_level = any(term in lower for term in low_level_terms)
        next_is_institution = any(term in next_line.lower() for term in school_terms)
        if not (has_degree or next_is_institution):
            continue
        score = 0.35
        if has_degree:
            score += 0.35
        if "present" in following.lower():
            score += 0.2
        if low_level:
            score -= 0.45
        degree, discipline = _education_degree_parts(line)
        if low_level and not has_degree:
            degree = ""
        candidates.append({
            "school": next_line if next_is_institution else "",
            "degree": degree,
            "discipline": discipline,
            "field_of_study": discipline,
            "graduation_year": "" if "present" in following.lower() else _graduation_year(following),
            "year": "" if "present" in following.lower() else _graduation_year(following),
            "confidence": min(max(score, 0.0), 0.98),
            "evidence": following,
        })
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.get("confidence", 0.0))


def _build_profile_intelligence(extracted: Dict[str, Any], cv_text: str) -> Dict[str, Any]:
    contact_raw = extracted.get("contact") or {}
    if not isinstance(contact_raw, dict):
        contact_raw = {}
    fields_extracted: List[str] = []
    fields_skipped: List[str] = []
    field_confidence: Dict[str, float] = {}
    field_evidence: Dict[str, str] = {}
    review_suggestions: Dict[str, Dict[str, Any]] = {}
    auto_saved_fields: List[str] = []
    lines = _cv_lines(cv_text)

    def save_field(field: str, value: Any, confidence: float, evidence: str = "") -> bool:
        if value in (None, ""):
            return False
        field_confidence[field] = round(float(confidence), 2)
        field_evidence[field] = evidence or _line_evidence(lines, value)
        if confidence >= 0.8:
            fields_extracted.append(field)
            auto_saved_fields.append(field)
            return True
        review_suggestions[field] = {
            "value": value,
            "confidence": round(float(confidence), 2),
            "evidence": field_evidence[field],
            "reason": "below_auto_save_threshold",
        }
        fields_skipped.append(f"{field}_low_confidence")
        return False

    contact: Dict[str, Any] = {}
    for key in ("name", "phone", "location"):
        value = _clean_string(contact_raw.get(key))
        confidence = 0.9 if key in ("name", "phone") else 0.82
        if save_field(f"contact.{key}", value, confidence):
            contact[key] = value
    email = _valid_email(contact_raw.get("email"))
    if email and save_field("contact.email", email, 0.95):
        contact["email"] = email
    elif contact_raw.get("email"):
        fields_skipped.append("contact.email_invalid")
    linkedin = _normalize_profile_url(contact_raw.get("linkedin"), linkedin=True)
    if linkedin and save_field("contact.linkedin", linkedin, 0.9):
        contact["linkedin"] = linkedin
    elif contact_raw.get("linkedin"):
        review_suggestions["contact.linkedin"] = {
            "value": _clean_string(contact_raw.get("linkedin")),
            "confidence": 0.3,
            "evidence": _line_evidence(lines, contact_raw.get("linkedin")),
            "reason": "invalid_url_or_contains_whitespace",
        }
        fields_skipped.append("contact.linkedin_invalid")
    website = _normalize_profile_url(contact_raw.get("website") or contact_raw.get("portfolio"))
    if website and save_field("contact.website", website, 0.85):
        contact["website"] = website
    elif contact_raw.get("website") or contact_raw.get("portfolio"):
        fields_skipped.append("contact.website_invalid")

    city = _clean_string(contact_raw.get("city"))
    country = _normalize_country_name(contact_raw.get("country"))
    if not city or not country:
        loc_city, loc_country = _split_location(contact.get("location"))
        city = city or loc_city
        country = country or _normalize_country_name(loc_country)
    location_data = {}
    if save_field("location.city", city, 0.82):
        location_data["city"] = city
    if save_field("location.country", country, 0.82):
        location_data["country"] = country

    education_item = _education_candidate_from_cv(cv_text) or _first_education_item(extracted.get("education"))
    education_confidence = float(education_item.get("confidence") or 0.6) if education_item else 0.0
    education: List[Dict[str, Any]] = []
    if education_item:
        degree, discipline_from_degree = _education_degree_parts(education_item.get("degree") or education_item.get("qualification"))
        edu = {
            "school": _clean_string(education_item.get("school") or education_item.get("institution") or education_item.get("university")),
            "degree": _clean_string(degree),
            "discipline": _clean_string(education_item.get("discipline") or education_item.get("field_of_study") or education_item.get("major") or discipline_from_degree),
            "field_of_study": _clean_string(education_item.get("field_of_study") or education_item.get("discipline") or education_item.get("major") or discipline_from_degree),
            "graduation_year": _graduation_year(education_item.get("graduation_year") or education_item.get("year") or education_item.get("end_date")),
            "year": _graduation_year(education_item.get("year") or education_item.get("graduation_year") or education_item.get("end_date")),
        }
        evidence = education_item.get("evidence") or ""
        clean_edu = {}
        for key, value in edu.items():
            confidence = education_confidence
            if key in ("graduation_year", "year") and not value:
                continue
            if key in ("graduation_year", "year") and "present" in evidence.lower():
                confidence = 0.2
            if save_field(f"education.{key}", value, confidence, evidence):
                clean_edu[key] = value
        if clean_edu:
            education.append(clean_edu)

    experience_items = extracted.get("experience") if isinstance(extracted.get("experience"), list) else []
    first_exp = next((item for item in experience_items if isinstance(item, dict)), {})
    experience_summary = {
        "current_title": _clean_string(first_exp.get("role") or first_exp.get("title")),
        "current_company": _clean_string(first_exp.get("company")),
    }
    experience_summary = {key: value for key, value in experience_summary.items() if value}
    if experience_summary:
        fields_extracted.extend([f"experience_summary.{key}" for key in experience_summary])
        auto_saved_fields.extend([f"experience_summary.{key}" for key in experience_summary])

    skills = [
        _clean_string(skill, 80)
        for skill in (extracted.get("skills") or [])
        if _clean_string(skill, 80)
    ][:30]
    if skills:
        fields_extracted.append("skills")

    defaults: Dict[str, Any] = {}
    if education:
        edu = education[0]
        mapping = {
            "education_school": edu.get("school"),
            "education_degree": edu.get("degree"),
            "education_discipline": edu.get("discipline") or edu.get("field_of_study"),
            "education_graduation_year": edu.get("graduation_year") or edu.get("year"),
        }
        defaults.update({key: value for key, value in mapping.items() if value})
    if website:
        defaults["website_url"] = website
    if linkedin:
        defaults["linkedin_url"] = linkedin
    if city:
        defaults["city"] = city
        defaults["current_location_city"] = city
    if country:
        defaults["country"] = country
        defaults["current_location_country"] = country
    phone_code = _phone_country_code_from_explicit(contact.get("phone", ""))
    if phone_code:
        defaults["phone_country_code"] = phone_code

    cv_extraction = {
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "fields_extracted": sorted(set(fields_extracted)),
        "fields_skipped": sorted(set(fields_skipped)),
        "field_confidence": field_confidence,
        "field_evidence": field_evidence,
        "auto_saved_fields": sorted(set(auto_saved_fields)),
        "review_suggestions": review_suggestions,
        "confidence_summary": {
            "mode": "explicit_cv_facts_with_confidence_thresholds",
            "saved_defaults": sorted(defaults.keys()),
            "suggested_defaults": sorted(review_suggestions.keys()),
            "cv_text_length": len(cv_text or ""),
        },
    }
    return {
        "contact": contact,
        "location_data": location_data,
        "education": education,
        "experience_summary": experience_summary,
        "skills": skills,
        "application_defaults": defaults,
        "cv_extraction": cv_extraction,
        "extraction_suggestions": review_suggestions,
    }


async def claude_score_jobs(profile: Dict[str, Any], jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Score a batch of jobs in a single LLM call. Returns list of {job_id, score, reasons}."""
    system_message = (
        "You are a job matching expert. For each job, score fit 0-100 and give "
        "2-3 short bullet reasons why this candidate is a great fit. "
        "Return ONLY valid JSON, no prose."
    )

    candidate = {
        "summary": profile.get("summary", ""),
        "skills": profile.get("skills", []),
        "experience": [
            {"role": e.get("role"), "company": e.get("company")} for e in profile.get("experience", [])
        ][:5],
        "seniority": profile.get("seniority"),
        "target_role": profile.get("target_role"),
        "target_location": profile.get("target_location"),
        "remote_preference": profile.get("remote_preference"),
    }
    job_summaries = [
        {
            "job_id": j["job_id"],
            "title": j["title"],
            "company": j["company"],
            "location": j["location"],
            "remote": j["remote"],
            "tech_stack": j.get("tech_stack", []),
            "requirements": j.get("requirements", [])[:6],
            "seniority": j.get("seniority"),
        }
        for j in jobs
    ]

    prompt = f"""Candidate:
{json.dumps(candidate, indent=2)}

Jobs:
{json.dumps(job_summaries, indent=2)}

Return JSON: {{"matches": [{{"job_id": "...", "score": 0-100, "reasons": ["...", "..."]}}]}}"""
    response = await complete_json_text(system_message, prompt)
    parsed = _parse_json_from_llm(response)
    return parsed.get("matches", [])


async def claude_generate_application(profile: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    system_message = (
        "You are an elite career coach and resume tailoring specialist. "
        "Return ONLY valid JSON. Do not invent facts, companies, dates, degrees, "
        "certifications, metrics, work authorization, or tools not present in the candidate data."
    )

    job_description = job.get("clean_description") or job.get("description") or ""
    job_requirements = job.get("requirements") or []
    prompt = f"""Create a tailored application package for this job.

Rules:
- Use the uploaded CV text, structured profile, full job description, and requirements.
- Keep every factual claim truthful and grounded in the candidate data.
- Preserve candidate identity/contact details.
- Rewrite summary, reorder skills, and rewrite existing bullets to emphasize relevant experience.
- Do not add employers, roles, degrees, dates, certifications, tools, or achievements not supported by the CV/profile.
- Generate likely/common application question answers only when answerable from candidate data. If unknown, answer conservatively.

Candidate profile:
{json.dumps({
  "contact": profile.get("contact", {}),
  "cv_text": profile.get("cv_text", "")[:12000],
  "summary": profile.get("summary"),
  "skills": profile.get("skills", []),
  "experience": profile.get("experience", []),
  "education": profile.get("education", []),
  "seniority": profile.get("seniority"),
  "target_role": profile.get("target_role"),
  "target_roles": profile.get("target_roles", []),
  "target_location": profile.get("target_location"),
  "remote_preference": profile.get("remote_preference"),
  "template_style": profile.get("template_style", "modern"),
}, indent=2)}

Job:
- Title: {job.get('title')}
- Company: {job.get('company')}
- Location: {job.get('location')} ({job.get('remote')})
- Description: {job_description}
- Requirements: {json.dumps(job_requirements)}
- Tech: {json.dumps(job.get('tech_stack', []))}

Return JSON with this exact schema:
{{
  "tailored_resume_structured": {{
    "contact": {{"name": "...", "email": "...", "phone": "...", "location": "...", "linkedin": "...", "website": "..."}},
    "summary": "Rewritten 2-3 sentence summary tailored for the role",
    "skills": ["skill1", "skill2", "max 12, most relevant first"],
    "experience": [{{"role": "...", "company": "...", "duration": "...", "location": "...", "highlights": ["rewritten bullet 1", "rewritten bullet 2", "rewritten bullet 3"]}}],
    "education": [{{"degree": "...", "school": "...", "year": "..."}}],
    "content_plan": ["short instruction for how the original CV should be adjusted"]
  }},
  "tailored_cover_letter": {{
    "greeting": "Dear {job['company']} team,",
    "paragraphs": ["concise opener specific to role/company", "fit paragraph grounded in CV/profile", "closing paragraph with call to action"],
    "sign_off": "Warm regards,"
  }},
  "application_answers": [{{"question": "Why are you interested in this role?", "answer": "truthful concise answer grounded in candidate data"}}],
  "match_score": 0-100,
  "match_reasons": ["short reason 1", "short reason 2", "short reason 3"],
  "interview_prep": ["likely question 1", "likely question 2", "likely question 3"]
}}"""
    response = await complete_json_text(system_message, prompt)
    parsed = _parse_json_from_llm(response)
    if "tailored_resume_structured" in parsed and "tailored_resume" not in parsed:
        parsed["tailored_resume"] = parsed["tailored_resume_structured"]
    if "tailored_cover_letter" in parsed and "cover_letter" not in parsed:
        parsed["cover_letter"] = parsed["tailored_cover_letter"]
    return parsed


async def _generate_application_doc(user: User, profile: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    try:
        gen = await claude_generate_application(profile, job)
    except Exception as exc:
        logger.exception("Application generation failed")
        return _pending_application_doc(user, job, exc)

    return _build_generated_application_doc(user, profile, job, gen)


def _build_generated_application_doc(
    user: User,
    profile: Dict[str, Any],
    job: Dict[str, Any],
    gen: Dict[str, Any],
    package_builder: Any = build_application_package,
) -> Dict[str, Any]:
    gen = sanitize_docx_text(gen)
    profile = sanitize_docx_text(profile)
    cv_text = str(profile.get("cv_text") or "")
    job_description = str(job.get("clean_description") or job.get("description") or "")
    tailored_resume = gen.get("tailored_resume_structured") or gen.get("tailored_resume") or {}
    cover_letter = gen.get("tailored_cover_letter") or gen.get("cover_letter") or {}
    tailored_resume_length = len(json.dumps(tailored_resume, default=str))
    cover_letter_length = len(cover_letter_to_text(cover_letter))
    generation_mode = "ai" if gen else "fallback"
    logger.info(
        "application_generation_quality user_id=%s job_id=%s has_cv_text=%s cv_text_length=%s job_description_length=%s tailored_resume_length=%s cover_letter_length=%s match_score=%s generation_mode=%s",
        user.user_id,
        job.get("job_id"),
        bool(cv_text),
        len(cv_text),
        len(job_description),
        tailored_resume_length,
        cover_letter_length,
        gen.get("match_score"),
        generation_mode,
    )
    package_status = "generated"
    generation_status = "generated"
    generation_error = None
    application_package: Dict[str, Any]
    data_quality_status = None
    if len(cv_text) < 300:
        data_quality_status = "needs_profile_data"
    elif len(job_description) < 300:
        data_quality_status = "needs_job_data"

    try:
        if data_quality_status:
            application_package = {
                "tailored_resume_structured": tailored_resume,
                "tailored_cover_letter": cover_letter,
                "application_answers": gen.get("application_answers") or [],
                "tailored_cv_file_b64": None,
                "tailored_cv_filename": None,
                "tailored_cv_mime": None,
                "template_preservation_status": "not_supported",
                "template_preservation_notes": (
                    "Application text was generated, but inputs were too thin to claim a tailored CV package."
                ),
            }
            package_status = data_quality_status
            generation_error = data_quality_status
        else:
            application_package = package_builder(profile, gen)
    except Exception as exc:
        logger.exception("DOCX_BUILD_FAILED")
        generation_error = "docx_build_failed"
        application_package = {
            "tailored_resume_structured": tailored_resume,
            "tailored_cover_letter": cover_letter,
            "application_answers": gen.get("application_answers") or [],
            "tailored_cv_file_b64": None,
            "tailored_cv_filename": None,
            "tailored_cv_mime": None,
            "template_preservation_status": "not_supported",
            "template_preservation_notes": (
                "DOCX generation failed after sanitizing AI output. "
                "Generated text content was saved without a tailored file."
            ),
        }
        package_status = "generated_text_only"

    now = datetime.now(timezone.utc).isoformat()
    return {
        "application_id": f"app_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "job_id": job["job_id"],
        "status": "applied",
        "admin_status": "manual_review_needed",
        "manual_status": "manual_review_needed",
        "manual_status_updated_at": now,
        "admin_timeline": [{
            "event_id": f"timeline_{uuid.uuid4().hex[:12]}",
            "type": "manual_status",
            "manual_status": "manual_review_needed",
            "note": "Queued for manual fulfillment after user swipe.",
            "created_at": now,
        }],
        "package_status": package_status,
        "generation_status": generation_status,
        "generation_error": generation_error,
        "submission_status": "not_submitted",
        "submitted_at": None,
        "submission_provider": None,
        "submission_response_id": None,
        "submission_error": None,
        "tailored_resume": tailored_resume,
        "cover_letter": cover_letter,
        **application_package,
        "match_score": gen.get("match_score", 75),
        "match_reasons": gen.get("match_reasons", []),
        "interview_prep": gen.get("interview_prep", []),
        "created_at": now,
        "updated_at": now,
    }


def _pending_application_doc(user: User, job: Dict[str, Any], error: Optional[Exception] = None) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    error_message = None
    if error is not None:
        message = str(error).strip() or error.__class__.__name__
        error_message = message[:500]
    return {
        "application_id": f"app_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "job_id": job["job_id"],
        "status": "applied",
        "admin_status": "manual_review_needed",
        "manual_status": "manual_review_needed",
        "manual_status_updated_at": now,
        "admin_timeline": [{
            "event_id": f"timeline_{uuid.uuid4().hex[:12]}",
            "type": "manual_status",
            "manual_status": "manual_review_needed",
            "note": "Queued for manual fulfillment after user swipe; package generation is pending.",
            "created_at": now,
        }],
        "package_status": "pending_generation",
        "submission_status": "not_submitted",
        "submitted_at": None,
        "submission_provider": None,
        "submission_response_id": None,
        "submission_error": error_message,
        "tailored_resume": {},
        "cover_letter": {},
        "tailored_resume_structured": {},
        "tailored_cover_letter": {},
        "application_answers": [],
        "match_score": None,
        "match_reasons": [],
        "interview_prep": [],
        "generation_status": "pending_generation",
        "generation_error": error_message,
        "created_at": now,
        "updated_at": now,
    }


def _normalize_application_status_fields(app_doc: Dict[str, Any]) -> Dict[str, Any]:
    app = dict(app_doc)
    if not app.get("package_status"):
        has_package = any([
            app.get("tailored_resume_structured"),
            app.get("tailored_cover_letter"),
            app.get("tailored_cv_file_b64"),
        ])
        app["package_status"] = "generated" if has_package else "not_generated"
    if not app.get("submission_status"):
        app["submission_status"] = "not_submitted"
    app.setdefault("submitted_at", None)
    app.setdefault("submission_provider", None)
    app.setdefault("submission_response_id", None)
    app.setdefault("submission_error", None)
    if app.get("prepared_missing_information"):
        payload = app.get("prepared_application_payload") or {}
        app["prepared_missing_information"] = _normalize_missing_information(
            app.get("prepared_missing_information") or [],
            _all_payload_fields(payload),
        )
    return app


def _application_text_lengths(app_doc: Dict[str, Any]) -> Dict[str, int]:
    tailored_resume = app_doc.get("tailored_resume_structured") or app_doc.get("tailored_resume") or {}
    cover_letter = app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {}
    return {
        "tailored_resume_length": len(json.dumps(tailored_resume, default=str)) if tailored_resume else 0,
        "cover_letter_length": len(cover_letter_to_text(cover_letter)) if cover_letter else 0,
    }


def _application_generation_update(generated_doc: Dict[str, Any], existing_app: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    timeline = _append_admin_timeline(existing_app, {
        "event_id": f"timeline_{uuid.uuid4().hex[:12]}",
        "type": "generation_completed",
        "package_status": generated_doc.get("package_status"),
        "generation_status": generated_doc.get("generation_status"),
        "generation_error": generated_doc.get("generation_error"),
        "created_at": now,
    })
    preserved = {
        "application_id": existing_app.get("application_id"),
        "user_id": existing_app.get("user_id"),
        "job_id": existing_app.get("job_id"),
        "created_at": existing_app.get("created_at"),
        "admin_status": existing_app.get("admin_status") or "manual_review_needed",
        "manual_status": existing_app.get("manual_status") or "manual_review_needed",
        "manual_status_updated_at": existing_app.get("manual_status_updated_at") or now,
        "admin_timeline": timeline,
        "updated_at": now,
    }
    update_doc = {
        key: value
        for key, value in generated_doc.items()
        if key not in {"application_id", "user_id", "job_id", "created_at", "admin_status", "manual_status", "manual_status_updated_at", "admin_timeline"}
    }
    if update_doc.get("generation_status") == "pending_generation" and update_doc.get("generation_error"):
        update_doc["generation_status"] = "failed"
        update_doc["package_status"] = "failed"
    return {**update_doc, **preserved}


async def _process_application_generation_queue(user_id: str) -> None:
    lock = _application_generation_locks.setdefault(user_id, asyncio.Lock())
    async with lock:
        while True:
            pending = await db.applications.find(
                {"user_id": user_id, "generation_status": {"$in": ["pending_generation", "generating"]}},
                {"_id": 0},
            ).sort("created_at", 1).limit(1).to_list(1)
            if not pending:
                return

            app_doc = pending[0]
            application_id = app_doc.get("application_id")
            job_id = app_doc.get("job_id")
            now = datetime.now(timezone.utc).isoformat()
            await db.applications.update_one(
                {"application_id": application_id, "user_id": user_id},
                {"$set": {"generation_status": "generating", "generation_started_at": now, "updated_at": now}},
            )
            try:
                user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
                profile = await db.profiles.find_one({"user_id": user_id}, {"_id": 0})
                job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
                if not user_doc or not profile or not job:
                    raise RuntimeError("Missing user, profile, or job for queued application generation")
                queued_user = User(
                    user_id=user_doc.get("user_id"),
                    email=user_doc.get("email") or "",
                    name=user_doc.get("name") or "",
                    picture=user_doc.get("picture"),
                    demo_account=bool(user_doc.get("demo_account")),
                    training_access=bool(user_doc.get("training_access")),
                )
                generated_doc = await _generate_application_doc(queued_user, profile, job)
                latest_app = await db.applications.find_one({"application_id": application_id, "user_id": user_id}, {"_id": 0}) or app_doc
                update_doc = _application_generation_update(generated_doc, latest_app)
                await db.applications.update_one(
                    {"application_id": application_id, "user_id": user_id},
                    {"$set": update_doc},
                )
                logger.info(
                    "queued_application_generation_complete user_id=%s application_id=%s job_id=%s package_status=%s",
                    user_id,
                    application_id,
                    job_id,
                    update_doc.get("package_status"),
                )
            except Exception as exc:
                logger.exception("queued_application_generation_failed user_id=%s application_id=%s job_id=%s", user_id, application_id, job_id)
                failed_at = datetime.now(timezone.utc).isoformat()
                latest_app = await db.applications.find_one({"application_id": application_id, "user_id": user_id}, {"_id": 0}) or app_doc
                timeline = _append_admin_timeline(latest_app, {
                    "event_id": f"timeline_{uuid.uuid4().hex[:12]}",
                    "type": "generation_failed",
                    "generation_error": (str(exc).strip() or exc.__class__.__name__)[:500],
                    "created_at": failed_at,
                })
                await db.applications.update_one(
                    {"application_id": application_id, "user_id": user_id},
                    {"$set": {
                        "generation_status": "failed",
                        "generation_error": (str(exc).strip() or exc.__class__.__name__)[:500],
                        "package_status": "failed",
                        "submission_error": (str(exc).strip() or exc.__class__.__name__)[:500],
                        "admin_timeline": timeline,
                        "updated_at": failed_at,
                    }},
                )


def _schedule_application_generation(user_id: str) -> None:
    task = _application_generation_tasks.get(user_id)
    if task and not task.done():
        return
    _application_generation_tasks[user_id] = asyncio.create_task(_process_application_generation_queue(user_id))


async def _resume_pending_application_generation() -> None:
    try:
        rows = await db.applications.find(
            {"generation_status": {"$in": ["pending_generation", "generating"]}},
            {"_id": 0, "user_id": 1},
        ).limit(500).to_list(500)
        for user_id in sorted({row.get("user_id") for row in rows if row.get("user_id")}):
            _schedule_application_generation(user_id)
        if rows:
            logger.info("resumed_pending_application_generation users=%s applications=%s", len({row.get("user_id") for row in rows if row.get("user_id")}), len(rows))
    except Exception as exc:
        logger.warning("resume_pending_application_generation_failed: %s", exc)


# ===================== Career Coach (Interviews + Improve) =====================
from coach import (  # noqa: E402
    claude_interview_prep, claude_interview_score, claude_improve_analysis,
    is_fresh, stamp,
)


async def _require_profile(user: User) -> Dict[str, Any]:
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "cv_original_b64": 0})
    if not profile or not profile.get("cv_text"):
        raise HTTPException(status_code=400, detail="Upload your CV first to unlock coaching.")
    return profile


async def _save_coach(user_id: str, key: str, stamped: Dict[str, Any]) -> None:
    """Persist an already-stamped payload to profile.coach.<key>."""
    await db.profiles.update_one(
        {"user_id": user_id},
        {"$set": {f"coach.{key}": stamped, "updated_at": stamped.get("_cached_at") or datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


@api_router.get("/coach/interview")
async def coach_interview_prep(refresh: bool = False, user: User = Depends(get_current_user)):
    profile = await _require_profile(user)
    cached = (profile.get("coach") or {}).get("interview")
    if not refresh and is_fresh(cached):
        return cached
    try:
        data = await claude_interview_prep(profile)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("interview prep failed")
        raise HTTPException(status_code=502, detail=f"AI coach is unavailable: {e}")
    stamped = stamp(data)
    await _save_coach(user.user_id, "interview", stamped)
    return stamped


class InterviewScoreBody(BaseModel):
    questions: List[str]
    answers: List[str]


@api_router.post("/coach/interview/score")
async def coach_interview_score(body: InterviewScoreBody, user: User = Depends(get_current_user)):
    if len(body.questions) != len(body.answers) or not body.questions:
        raise HTTPException(status_code=400, detail="questions and answers must be same non-empty length")
    profile = await _require_profile(user)
    try:
        result = await claude_interview_score(profile, body.questions, body.answers)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("interview scoring failed")
        raise HTTPException(status_code=502, detail=f"AI coach is unavailable: {e}")

    # streak — count distinct days a mock was completed
    now = datetime.now(timezone.utc).isoformat()
    history = (profile.get("coach") or {}).get("interview_history") or []
    history.append({"finished_at": now, "overall": result.get("overall", 0)})
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": {"coach.interview_history": history[-30:]}},
        upsert=True,
    )
    return result


@api_router.get("/coach/improve")
async def coach_improve(refresh: bool = False, user: User = Depends(get_current_user)):
    profile = await _require_profile(user)
    cached = (profile.get("coach") or {}).get("improve")
    if not refresh and is_fresh(cached):
        return cached
    try:
        data = await claude_improve_analysis(profile)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("improve analysis failed")
        raise HTTPException(status_code=502, detail=f"AI coach is unavailable: {e}")
    stamped = stamp(data)
    await _save_coach(user.user_id, "improve", stamped)
    return stamped


@api_router.get("/coach/streak")
async def coach_streak(user: User = Depends(get_current_user)):
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "coach.interview_history": 1})
    history = ((profile or {}).get("coach") or {}).get("interview_history") or []
    if not history:
        return {"streak": 0, "sessions_total": 0, "sessions_week": 0, "best": 0}
    today = datetime.now(timezone.utc).date()
    days = set()
    for h in history:
        try:
            d = datetime.fromisoformat(h["finished_at"]).date()
            days.add(d)
        except (KeyError, ValueError):
            pass
    streak = 0
    cursor = today
    while cursor in days:
        streak += 1
        cursor = cursor - timedelta(days=1)
    sessions_week = sum(1 for h in history if (today - datetime.fromisoformat(h["finished_at"]).date()).days < 7)
    best = max((h.get("overall", 0) for h in history), default=0)
    return {"streak": streak, "sessions_total": len(history), "sessions_week": sessions_week, "best": best}




@api_router.post("/profile/cv")
async def upload_cv(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    import base64
    content = await file.read()
    cv_text = extract_text_from_upload(file.filename, content)
    if not cv_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from CV")

    try:
        extracted = await claude_extract_profile(cv_text)
    except LLMProviderNotConfigured as e:
        logger.warning("cv_upload_ai_provider_not_configured user_id=%s error=%s", user.user_id, str(e))
        extracted = _fallback_extract_profile_from_cv(cv_text)
    except Exception as e:
        logger.exception("CV extraction failed")
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {e}")

    # Determine mime type from filename
    name_lower = (file.filename or "").lower()
    if name_lower.endswith(".pdf"):
        mime = "application/pdf"
    elif name_lower.endswith(".docx"):
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        mime = "text/plain"

    intelligence = _build_profile_intelligence(extracted, cv_text)
    if extracted.get("extraction_fallback_reason"):
        intelligence.setdefault("cv_extraction", {}).setdefault("confidence_summary", {})["mode"] = "fallback_no_ai_provider"
        intelligence.setdefault("cv_extraction", {}).setdefault("fields_skipped", []).append("ai_provider_not_configured")
    existing_profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "application_defaults": 1, "contact": 1}) or {}
    existing_defaults = existing_profile.get("application_defaults") or {}
    cv_managed_default_keys = {
        "city",
        "country",
        "current_location_city",
        "current_location_country",
        "education_school",
        "education_degree",
        "education_discipline",
        "education_graduation_year",
        "linkedin_url",
        "website_url",
        "portfolio_url",
    }
    retained_defaults = {
        key: value
        for key, value in existing_defaults.items()
        if key not in cv_managed_default_keys
    }
    merged_defaults = {**retained_defaults, **(intelligence.get("application_defaults") or {})}
    contact = intelligence.get("contact") or {}
    if user.email:
        contact["email"] = user.email

    profile_doc = {
        "user_id": user.user_id,
        "cv_text": cv_text,
        "cv_filename": file.filename,
        "cv_original_b64": base64.b64encode(content).decode("ascii"),
        "cv_mime": mime,
        "contact": contact,
        "summary": extracted.get("summary", ""),
        "skills": intelligence.get("skills") or extracted.get("skills", []),
        "experience": extracted.get("experience", []),
        "education": intelligence.get("education") or extracted.get("education", []),
        "experience_summary": intelligence.get("experience_summary") or {},
        "location_data": intelligence.get("location_data") or {},
        "application_defaults": merged_defaults,
        "cv_extraction": intelligence.get("cv_extraction") or {},
        "extraction_suggestions": intelligence.get("extraction_suggestions") or {},
        "target_roles": extracted.get("target_roles", []),
        "seniority": extracted.get("seniority"),
        "template_style": extracted.get("template_style", "modern"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": profile_doc},
        upsert=True,
    )
    # don't ship the heavy fields back
    profile_doc.pop("cv_text", None)
    profile_doc.pop("cv_original_b64", None)
    return profile_doc


@api_router.get("/profile/cv/original")
async def download_original_cv(user: User = Depends(get_current_user)):
    """Stream back the user's original CV file."""
    import base64
    from fastapi.responses import Response as FastAPIResponse
    profile = await db.profiles.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "cv_original_b64": 1, "cv_mime": 1, "cv_filename": 1},
    )
    if not profile or not profile.get("cv_original_b64"):
        raise HTTPException(status_code=404, detail="No original CV stored")
    content = base64.b64decode(profile["cv_original_b64"])
    filename = profile.get("cv_filename") or "cv"
    return FastAPIResponse(
        content=content,
        media_type=profile.get("cv_mime", "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


MAX_PROFILE_DOCUMENT_BYTES = 10 * 1024 * 1024
PROFILE_DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".webp"}


def _mime_from_profile_document_filename(filename: str) -> str:
    name_lower = (filename or "").lower()
    if name_lower.endswith(".pdf"):
        return "application/pdf"
    if name_lower.endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if name_lower.endswith(".png"):
        return "image/png"
    if name_lower.endswith(".jpg") or name_lower.endswith(".jpeg"):
        return "image/jpeg"
    if name_lower.endswith(".webp"):
        return "image/webp"
    return "text/plain"


def _public_profile_document(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc.get("id"),
        "name": doc.get("name"),
        "mime": doc.get("mime"),
        "uploaded_at": doc.get("uploaded_at"),
        "size": doc.get("size"),
    }


def _sanitize_profile_for_client(profile: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not profile:
        return profile
    docs = profile.get("additional_documents") or []
    if docs:
        profile = {**profile, "additional_documents": [_public_profile_document(doc) for doc in docs if isinstance(doc, dict)]}
    return profile


@api_router.post("/profile/documents")
async def upload_profile_document(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    import base64

    content = await file.read()
    if len(content) > MAX_PROFILE_DOCUMENT_BYTES:
        raise HTTPException(status_code=400, detail="File must be 10MB or smaller")
    filename = file.filename or "document"
    ext = filename.lower()[filename.rfind("."):] if "." in filename else ""
    if ext not in PROFILE_DOCUMENT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    entry = {
        "id": str(uuid.uuid4()),
        "name": filename,
        "mime": _mime_from_profile_document_filename(filename),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "size": len(content),
        "file_b64": base64.b64encode(content).decode("ascii"),
    }
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {
            "$push": {"additional_documents": entry},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
        upsert=True,
    )
    return {"ok": True, "document": _public_profile_document(entry)}


@api_router.get("/profile/documents/{document_id}")
async def download_profile_document(document_id: str, user: User = Depends(get_current_user)):
    import base64
    from fastapi.responses import Response as FastAPIResponse

    profile = await db.profiles.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "additional_documents": 1},
    )
    for doc in (profile or {}).get("additional_documents") or []:
        if doc.get("id") != document_id:
            continue
        payload = doc.get("file_b64")
        if not payload:
            raise HTTPException(status_code=404, detail="Document not found")
        content = base64.b64decode(payload)
        filename = doc.get("name") or "document"
        mime = doc.get("mime") or "application/octet-stream"
        disposition = "inline" if mime.startswith("image/") or mime == "application/pdf" else "attachment"
        return FastAPIResponse(
            content=content,
            media_type=mime,
            headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
        )
    raise HTTPException(status_code=404, detail="Document not found")


@api_router.delete("/profile/documents/{document_id}")
async def delete_profile_document(document_id: str, user: User = Depends(get_current_user)):
    profile = await db.profiles.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "additional_documents.id": 1},
    )
    docs = (profile or {}).get("additional_documents") or []
    if not any(doc.get("id") == document_id for doc in docs):
        raise HTTPException(status_code=404, detail="Document not found")
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {
            "$pull": {"additional_documents": {"id": document_id}},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )
    return {"ok": True}


@api_router.get("/profile")
async def get_profile(user: User = Depends(get_current_user)):
    profile = await db.profiles.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "cv_original_b64": 0},
    )
    if not profile:
        return None
    profile = _sanitize_profile_for_client(profile)
    profile["profile_completion"] = _profile_completion(profile)
    return profile


def _profile_completion(profile: Dict[str, Any]) -> Dict[str, Any]:
    defaults = profile.get("application_defaults") or {}
    contact = profile.get("contact") or {}
    checks = [
        ("cv_uploaded", bool(profile.get("cv_text") or profile.get("cv_filename"))),
        ("target_roles", bool(profile.get("target_role") or profile.get("target_roles"))),
        ("location", bool(profile.get("target_location") or profile.get("target_location_data"))),
        ("linkedin_or_portfolio", bool(contact.get("linkedin") or contact.get("website") or contact.get("github"))),
        ("application_defaults", all(
            defaults.get(key) not in (None, "")
            for key in (
                "work_authorized_countries",
                "requires_sponsorship",
                "current_location_city",
                "former_employer_restriction_or_noncompete",
            )
        ) or bool(defaults.get("prefer_not_to_say_demographics"))),
    ]
    completed = sum(1 for _, ok in checks if ok)
    return {
        "percentage": round((completed / len(checks)) * 100),
        "completed": completed,
        "total": len(checks),
        "items": {key: ok for key, ok in checks},
    }


@api_router.delete("/profile")
async def delete_account(user: User = Depends(get_current_user)):
    """Wipe everything the user created. Sessions are revoked too."""
    await db.profiles.delete_many({"user_id": user.user_id})
    await db.swipes.delete_many({"user_id": user.user_id})
    await db.applications.delete_many({"user_id": user.user_id})
    await db.user_sessions.delete_many({"user_id": user.user_id})
    await db.users.delete_one({"user_id": user.user_id})
    return {"ok": True}


@api_router.put("/profile/application-defaults")
async def update_application_defaults(body: ApplicationDefaultsUpdate, user: User = Depends(get_current_user)):
    defaults = body.application_defaults or {}
    if not isinstance(defaults, dict):
        raise HTTPException(status_code=400, detail="application_defaults must be an object")
    allowed_keys = {
        "country",
        "city",
        "phone_country_code",
        "linkedin_url",
        "website_url",
        "portfolio_url",
        "education_school",
        "education_degree",
        "education_discipline",
        "education_graduation_year",
        "work_authorized_countries",
        "requires_sponsorship",
        "willing_to_relocate",
        "current_location_country",
        "current_location_city",
        "referral_source",
        "privacy_consent",
        "eeo_gender",
        "eeo_race",
        "eeo_veteran",
        "eeo_disability",
        "eeo_lgbtq",
        "prefer_not_to_say_demographics",
        "former_company_history",
        "former_employer_restriction_or_noncompete",
    }
    clean = {key: value for key, value in defaults.items() if key in allowed_keys}
    now = datetime.now(timezone.utc).isoformat()
    update_fields = {f"application_defaults.{key}": value for key, value in clean.items()}
    update_fields["updated_at"] = now
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": update_fields},
        upsert=True,
    )
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "cv_original_b64": 0})
    if profile:
        profile["profile_completion"] = _profile_completion(profile)
    return {"ok": True, "application_defaults": (profile or {}).get("application_defaults") or {}, "profile": profile}


@api_router.put("/profile/structured-data")
async def update_structured_profile_data(body: StructuredProfileDataUpdate, user: User = Depends(get_current_user)):
    existing = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    contact_payload = body.contact or {}
    contact = {**(existing.get("contact") or {})}
    for key in ("name", "phone", "location", "linkedin", "website"):
        value = contact_payload.get(key)
        if value is not None:
            contact[key] = _clean_string(value)
    if contact.get("linkedin"):
        normalized = _normalize_profile_url(contact.get("linkedin"), linkedin=True)
        if normalized:
            contact["linkedin"] = normalized
    if contact.get("website"):
        normalized = _normalize_profile_url(contact.get("website"))
        if normalized:
            contact["website"] = normalized
    contact["email"] = user.email

    education = []
    for item in body.education or []:
        if not isinstance(item, dict):
            continue
        clean_item = {
            "school": _clean_string(item.get("school")),
            "degree": _clean_string(item.get("degree")),
            "discipline": _clean_string(item.get("discipline") or item.get("field_of_study")),
            "field_of_study": _clean_string(item.get("field_of_study") or item.get("discipline")),
            "graduation_year": _graduation_year(item.get("graduation_year") or item.get("year")),
            "year": _graduation_year(item.get("year") or item.get("graduation_year")),
        }
        clean_item = {key: value for key, value in clean_item.items() if value}
        if clean_item:
            education.append(clean_item)
    if not education:
        education = existing.get("education") or []

    defaults = {**(existing.get("application_defaults") or {})}
    incoming_defaults = body.application_defaults or {}
    allowed_default_keys = {
        "linkedin_url",
        "website_url",
        "portfolio_url",
        "education_school",
        "education_degree",
        "education_discipline",
        "education_graduation_year",
        "phone_country_code",
        "city",
        "country",
        "current_location_city",
        "current_location_country",
    }
    for key, value in incoming_defaults.items():
        if key in allowed_default_keys:
            defaults[key] = value
    if education:
        edu = education[0]
        for key, value in {
            "education_school": edu.get("school"),
            "education_degree": edu.get("degree"),
            "education_discipline": edu.get("discipline") or edu.get("field_of_study"),
            "education_graduation_year": edu.get("graduation_year") or edu.get("year"),
        }.items():
            if value:
                defaults[key] = value
    if contact.get("linkedin"):
        defaults["linkedin_url"] = contact["linkedin"]
    if contact.get("website"):
        defaults["website_url"] = contact["website"]
    if contact.get("phone"):
        code = _phone_country_code_from_explicit(contact["phone"])
        if code:
            defaults["phone_country_code"] = code
    city, country = _split_location(contact.get("location"))
    if city:
        defaults["city"] = city
        defaults["current_location_city"] = city
    if country:
        defaults["country"] = country
        defaults["current_location_country"] = country

    update = {
        "contact": contact,
        "education": education,
        "application_defaults": defaults,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.skills:
        update["skills"] = [_clean_string(skill, 80) for skill in body.skills if _clean_string(skill, 80)][:30]
    if body.experience_summary:
        update["experience_summary"] = {
            key: _clean_string(value)
            for key, value in body.experience_summary.items()
            if key in {"current_title", "current_company", "years_experience"} and value not in (None, "")
        }
    await db.profiles.update_one({"user_id": user.user_id}, {"$set": update}, upsert=True)
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "cv_original_b64": 0})
    if profile:
        profile["profile_completion"] = _profile_completion(profile)
    return {"ok": True, "profile": profile}


@api_router.patch("/profile/extras")
async def patch_profile_extras(payload: Dict[str, Any], user: User = Depends(get_current_user)):
    """Merge-update the `profile.extras` dict — holds user-managed CV sections that AI
    didn't extract automatically (volunteer, projects, references, languages, …)."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    existing = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "extras": 1}) or {}
    merged = {**(existing.get("extras") or {}), **payload}
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": {"extras": merged, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "extras": merged}


@api_router.get("/locations/search")
async def locations_search(q: str = Query("", min_length=0), limit: int = Query(10, ge=1, le=15)):
    """Worldwide city/region search via OpenStreetMap + optional Google Places."""
    query = (q or "").strip()
    if len(query) < 1:
        raise HTTPException(status_code=400, detail="Query parameter q is required")
    return await search_locations(query, limit=limit)


@api_router.post("/onboarding/suggest-categories")
async def onboarding_suggest_categories(body: OnboardingSuggestCategoriesRequest):
    """Region + contract-aware job categories for onboarding."""
    if not body.location.strip():
        raise HTTPException(status_code=400, detail="Location is required")
    if not body.contract_type.strip():
        raise HTTPException(status_code=400, detail="Contract type is required")
    return await suggest_categories(
        body.location.strip(),
        body.contract_type.strip(),
        body.location_data,
    )


@api_router.post("/onboarding/suggest-roles")
async def onboarding_suggest_roles(body: OnboardingSuggestRolesRequest):
    """Specific role titles for selected onboarding categories."""
    if not body.categories:
        raise HTTPException(status_code=400, detail="At least one category is required")
    categories = [category.model_dump() for category in body.categories]
    return await suggest_roles(
        body.location.strip(),
        body.contract_type.strip(),
        categories,
        body.location_data,
    )


@api_router.put("/profile/preferences")
async def update_preferences(prefs: PreferencesUpdate, user: User = Depends(get_current_user)):
    payload = prefs.model_dump(exclude_unset=True)
    update = {
        k: v
        for k, v in payload.items()
        if v is not None or k == "target_location_data"
    }
    target_role = update.get("target_role")
    target_roles = update.get("target_roles")
    if isinstance(target_roles, list) and target_roles:
        cleaned = [role.strip() for role in target_roles if isinstance(role, str) and role.strip()]
        if cleaned:
            update["target_roles"] = cleaned
            update["target_role"] = cleaned[0]
    elif isinstance(target_role, str) and target_role.strip():
        update["target_role"] = target_role.strip()
        update["target_roles"] = [target_role.strip()]
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": update},
        upsert=True,
    )
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    return profile


@api_router.put("/profile/contact")
async def update_contact(contact: ContactUpdate, user: User = Depends(get_current_user)):
    """Update the contact block. Email is ALWAYS forced to the authenticated user's
    registered email — the UI never allows changing it, per product spec."""
    data = {k: v for k, v in contact.model_dump().items() if v is not None}
    data["email"] = user.email  # force-overwrite
    existing = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "contact": 1}) or {}
    merged = {**(existing.get("contact") or {}), **data}
    first_name = _clean_string(merged.get("first_name"))
    last_name = _clean_string(merged.get("last_name"))
    if first_name or last_name:
        merged["name"] = " ".join(part for part in (first_name, last_name) if part).strip()
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": {"contact": merged, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "contact": merged}


# ===================== Jobs / Swipe =====================

@api_router.get("/jobs/feed")
async def get_feed(
    user: User = Depends(get_current_user),
    limit: int = 5,
    min_salary: int = 0,
    posted_within: Optional[str] = None,            # any | 1d | 7d | 30d
    work_location: Optional[List[str]] = Query(None),   # remote | hybrid | onsite
    job_type: Optional[List[str]] = Query(None),        # full_time | part_time | internship  (placeholder)
    experience: Optional[List[str]] = Query(None),      # entry | mid | senior | executive
    location: Optional[List[str]] = Query(None),        # free-text city/country tokens, OR-matched on `location` field
    only_company: Optional[List[str]] = Query(None),
    hide_company: Optional[List[str]] = Query(None),
    only_industry: Optional[List[str]] = Query(None),   # placeholder (jobs lack industry field today)
    hide_industry: Optional[List[str]] = Query(None),   # placeholder
    include_unknown_location: bool = True,
    include_unknown_salary: bool = True,
    include_non_auto_apply: bool = False,
    search_radius: str = "50km",
    locations_json: Optional[str] = None,
    only_my_country: bool = False,
    location_label: Optional[str] = None,
    place_id: Optional[str] = None,
    country: Optional[str] = None,
    country_code: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    score: bool = False,                                  # opt-in AI scoring (slow); default off for snappy UX
    search_role: Optional[str] = None,                    # override profile target_role for this feed request
):
    started_at = time.perf_counter()
    logger.info(
        "jobs/feed start: user_id=%s limit=%s search_radius=%s include_non_auto_apply=%s locations_json=%s location=%s",
        user.user_id,
        limit,
        search_radius,
        include_non_auto_apply,
        bool(locations_json),
        location,
    )
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    if user.demo_account:
        profile = _demo_profile_for_feed(user.user_id, profile)
    elif not profile or not profile.get("cv_text"):
        logger.info(
            "jobs/feed cv_readiness_failed user_id=%s profile_exists=%s has_cv_text=%s has_cv_filename=%s profile_keys=%s",
            user.user_id,
            profile is not None,
            bool((profile or {}).get("cv_text")),
            bool((profile or {}).get("cv_filename")),
            sorted(list((profile or {}).keys()))[:30],
        )
        raise HTTPException(status_code=400, detail="Upload CV first")

    feed_target_role = (
        (search_role or "").strip()
        or profile.get("target_role")
        or ((profile.get("target_roles") or [None])[0])
        or ""
    ).strip()

    max_elapsed_seconds = 8.0
    ats_supported = ["greenhouse", "lever", "ashby"]

    def _elapsed_ms() -> int:
        return int((time.perf_counter() - started_at) * 1000)

    def _timed_out() -> bool:
        return (time.perf_counter() - started_at) >= max_elapsed_seconds

    def _tokens(value: str) -> List[str]:
        value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
        stop = {
            "and", "or", "the", "a", "an", "of", "for", "to", "in", "with",
            "remote", "jobs", "job", "cdi", "cdd", "full", "time",
        }
        return [
            token
            for token in re.findall(r"[a-z0-9]+", (value or "").lower())
            if len(token) > 2 and token not in stop
        ]

    def _role_family_tokens(role: str) -> List[str]:
        tokens = _tokens(role)
        role_lower = (role or "").lower()
        family = list(tokens)
        if any(token in tokens for token in ("developer", "engineer", "javascript", "node", "frontend", "backend")):
            family.extend(["developer", "developpeur", "ingenieur", "logiciel", "software", "engineer", "frontend", "backend", "fullstack", "full-stack", "javascript", "node"])
        if "analyst" in tokens:
            family.extend(["analyst", "analyste", "analytics", "analysis", "insights", "business", "market", "etudes", "charge"])
        if "manager" in tokens:
            family.extend(["manager", "management", "responsable", "chef", "lead", "operations", "product", "produit", "projet"])
        if "full-stack" in role_lower or "full stack" in role_lower:
            family.extend(["fullstack", "full-stack", "frontend", "backend"])
        if any(token in tokens for token in ("research", "researcher")):
            family.extend(["research", "researcher", "recherche", "etudes", "charge", "r&d", "rd"])
        if any(token in tokens for token in ("sales", "commercial")):
            family.extend(["sales", "commercial", "vente", "vendeur", "conseiller"])
        if "marketing" in tokens:
            family.extend(["marketing", "communication", "community", "seo", "contenu", "content", "digital", "charge", "assistant", "responsable"])
        if any(token in tokens for token in ("hr", "human", "resources", "recruiter", "talent")):
            family.extend(["hr", "rh", "ressources", "humaines", "recrutement", "recruteur", "talent", "paie", "formation", "assistant", "charge"])
        if any(token in tokens for token in ("administrative", "receptionist", "office", "executive")):
            family.extend(["administrative", "administratif", "assistant", "direction", "reception", "receptionniste", "office"])
        if any(token in tokens for token in ("finance", "accountant", "bookkeeper", "payroll")):
            family.extend(["finance", "comptable", "paie", "assistant"])
        if any(token in tokens for token in ("customer", "support", "success")):
            family.extend(["customer", "support", "success", "client", "clientele", "charge"])
        if any(token in tokens for token in ("driver", "delivery")):
            family.extend(["driver", "delivery", "chauffeur", "livreur"])
        if any(token in tokens for token in ("warehouse", "logistics")):
            family.extend(["warehouse", "logistics", "logistique", "magasinier", "preparateur"])
        if any(token in tokens for token in ("retail", "store", "waiter", "barista", "chef", "kitchen")):
            family.extend(["retail", "store", "vendeur", "serveur", "barista", "cuisinier", "employe polyvalent"])
        return list(dict.fromkeys(token for token in family if token))

    def _job_text(job: Dict[str, Any]) -> str:
        text = " ".join([
            str(job.get("title") or ""),
            str(job.get("company") or ""),
            str(job.get("description") or ""),
            str(job.get("clean_description") or ""),
            " ".join(str(item) for item in (job.get("requirements") or [])),
        ]).lower()
        return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")

    role_category_keywords = {
        "technology": {"software", "developer", "developpeur", "engineer", "ingenieur", "frontend", "backend", "fullstack", "javascript", "node", "devops", "cloud", "qa"},
        "marketing": {"marketing", "communication", "community", "seo", "brand", "contenu", "content", "digital", "growth", "social"},
        "hr": {"hr", "rh", "human", "resources", "ressources", "humaines", "recruiter", "recrutement", "talent", "paie", "formation"},
        "sales": {"sales", "commercial", "vente", "vendeur", "account", "business", "clientele", "customer", "support", "success"},
        "admin": {"administrative", "administratif", "assistant", "direction", "reception", "receptionniste", "office"},
        "finance": {"finance", "accountant", "comptable", "payroll", "paie", "auditor", "controleur"},
        "logistics": {"warehouse", "logistics", "logistique", "magasinier", "preparateur", "driver", "chauffeur", "livreur"},
        "service": {"retail", "store", "waiter", "serveur", "barista", "chef", "kitchen", "cuisinier", "cleaner", "security"},
        "healthcare": {"nurse", "infirmier", "medical", "sante", "care", "soignant", "pharmacy"},
        "education": {"teacher", "enseignant", "professeur", "trainer", "formateur", "teaching"},
    }

    def _role_category(tokens: List[str]) -> Optional[str]:
        token_set = set(tokens)
        for category, keywords in role_category_keywords.items():
            if token_set & keywords:
                return category
        return None

    target_role_category = _role_category(_role_family_tokens(feed_target_role))

    def _job_role_category(job: Dict[str, Any]) -> Optional[str]:
        title_tokens = set(_tokens(str(job.get("title") or "")))
        text_tokens = set(_tokens(_job_text(job)))
        for category, keywords in role_category_keywords.items():
            if title_tokens & keywords:
                return category
        for category, keywords in role_category_keywords.items():
            if text_tokens & keywords:
                return category
        return None

    def _category_compatible(job: Dict[str, Any]) -> bool:
        if not target_role_category:
            return True
        job_category = _job_role_category(job)
        if not job_category:
            return True
        if target_role_category == job_category:
            return True
        if target_role_category == "sales" and job_category in {"marketing", "admin"}:
            return True
        if target_role_category == "marketing" and job_category == "sales":
            return True
        if target_role_category == "hr" and job_category == "admin":
            return True
        return False

    def _role_score(job: Dict[str, Any], strict_tokens: List[str], family_tokens: List[str]) -> int:
        title = unicodedata.normalize("NFKD", (job.get("title") or "").lower()).encode("ascii", "ignore").decode("ascii")
        text = _job_text(job)
        if not _category_compatible(job):
            return 0
        if not strict_tokens and not family_tokens:
            return 10
        strict_title_hits = sum(1 for token in strict_tokens if token in title)
        strict_text_hits = sum(1 for token in strict_tokens if token in text)
        family_title_hits = sum(1 for token in family_tokens if token in title)
        family_text_hits = sum(1 for token in family_tokens if token in text)
        return strict_title_hits * 30 + min(strict_text_hits, 4) * 8 + family_title_hits * 14 + min(family_text_hits, 6) * 3

    def _profile_feed_location_data() -> Dict[str, Any]:
        contact = profile.get("contact") or {}
        return profile.get("target_location_data") or contact.get("location_data") or {}

    def _profile_feed_location_label() -> str:
        contact = profile.get("contact") or {}
        return str(profile.get("target_location") or contact.get("location") or "")

    def _location_terms() -> Dict[str, List[str]]:
        raw_locations: List[str] = []
        explicit_request_location = False
        if locations_json:
            try:
                parsed = json.loads(locations_json)
                if isinstance(parsed, list):
                    parsed_labels = [str(item.get("location_label") or "") for item in parsed if isinstance(item, dict)]
                    raw_locations.extend(parsed_labels)
                    explicit_request_location = any(label for label in parsed_labels)
            except json.JSONDecodeError:
                pass
        if location_label:
            raw_locations.append(location_label)
            explicit_request_location = True
        if location:
            raw_locations.extend(location)
            explicit_request_location = True
        target_location_data = _profile_feed_location_data()
        if not explicit_request_location:
            if target_location_data.get("location_label"):
                raw_locations.append(str(target_location_data.get("location_label")))
            elif _profile_feed_location_label():
                raw_locations.append(_profile_feed_location_label())
        country_code_value = (
            (country_code or "")
            or ("" if explicit_request_location else str(target_location_data.get("country_code") or ""))
        ).lower().strip()
        country_value = (
            (country or "")
            or ("" if explicit_request_location else str(target_location_data.get("country") or ""))
        ).lower().strip()
        aliases = {
            "fr": ["france", "paris", "ile de france", "ile-de-france", "île-de-france"],
            "gb": ["united kingdom", "uk", "england", "london"],
            "us": ["united states", "usa", "new york", "san francisco"],
            "ma": ["morocco", "maroc", "casablanca"],
        }
        city_terms = list(dict.fromkeys(token for label in raw_locations for token in _tokens(label)))
        country_terms = list(dict.fromkeys([country_value, *aliases.get(country_code_value, [])]))
        return {"labels": [label for label in raw_locations if label], "city": city_terms, "country": [term for term in country_terms if term]}

    def _location_score(job: Dict[str, Any], terms: Dict[str, List[str]], worldwide: bool = False) -> int:
        if worldwide:
            return 10
        job_location = (job.get("location") or "").lower()
        remote_value = str(job.get("remote") or "").lower()
        score_value = 0
        if any(term and term in job_location for term in terms["city"]):
            score_value += 45
        if any(term and term in job_location for term in terms["country"]):
            score_value += 25
        if remote_value == "remote":
            score_value += 8
        return score_value

    def _recency_score(job: Dict[str, Any]) -> int:
        raw = job.get("posted_at") or job.get("imported_at") or job.get("last_seen_at")
        if not raw:
            return 0
        try:
            parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return 0
        age_days = max(0, (datetime.now(timezone.utc) - parsed).days)
        if age_days <= 7:
            return 20
        if age_days <= 30:
            return 10
        return 0

    async def _fast_cached_feed() -> Dict[str, Any]:
        global _feed_sync_refresh_cooldown_until
        requested_limit = max(1, min(int(limit or 5), 25))
        db_first_enabled = _env_bool("JOBS_DB_FIRST_ENABLED", True)
        db_min_good_results = max(1, _env_int("JOBS_DB_MIN_GOOD_RESULTS_BEFORE_JSEARCH", 30))
        db_weak_results_threshold = max(0, _env_int("JOBS_DB_WEAK_RESULTS_THRESHOLD", 10))
        allow_unknown_tier = _env_bool("JOBS_ALLOW_UNKNOWN_TIER_IN_FEED", False)
        sync_refresh_enabled = _env_bool("JOBS_FEED_SYNC_REFRESH_ENABLED", True)
        sync_refresh_max_seconds = max(1, min(_env_int("JOBS_FEED_SYNC_REFRESH_MAX_SECONDS", 8), 20))
        sync_refresh_max_results = max(1, min(_env_int("JOBS_FEED_SYNC_REFRESH_MAX_RESULTS", 20), 50))
        sync_refresh_max_pages = max(1, min(_env_int("JSEARCH_FEED_FALLBACK_MAX_PAGES", 1), 3))
        sync_refresh_page_size = max(1, min(_env_int("JSEARCH_FEED_FALLBACK_PAGE_SIZE", 10), 50))
        sync_refresh_cooldown_seconds = max(30, min(_env_int("JOBS_FEED_SYNC_REFRESH_COOLDOWN_SECONDS", 300), 1800))
        target_role = feed_target_role
        strict_tokens = _tokens(target_role)
        family_tokens = _role_family_tokens(target_role)
        terms = _location_terms()
        radius_scope = (search_radius or "50km").lower().strip()
        is_worldwide_radius = radius_scope in ("worldwide", "remote/worldwide")
        radius_km_match = re.match(r"^(\d+)\s*km$", radius_scope)
        radius_km = int(radius_km_match.group(1)) if radius_km_match else None

        def _parse_selected_locations() -> List[Dict[str, Any]]:
            selected: List[Dict[str, Any]] = []
            if locations_json:
                try:
                    parsed = json.loads(locations_json)
                    if isinstance(parsed, list):
                        selected.extend(
                            loc
                            for loc in parsed
                            if isinstance(loc, dict) and (loc.get("location_label") or loc.get("country") or loc.get("country_code"))
                        )
                except json.JSONDecodeError:
                    pass
            if location_label:
                selected.append({
                    "location_label": location_label,
                    "place_id": place_id,
                    "country": country,
                    "country_code": country_code,
                    "lat": lat,
                    "lng": lng,
                })
            if location:
                selected.extend({"location_label": item} for item in location if item)
            return selected

        selected_locations = _parse_selected_locations()
        if not selected_locations and _profile_feed_location_data():
            selected_locations = [_profile_feed_location_data()]
        elif not selected_locations and _profile_feed_location_label():
            selected_locations = [{"location_label": _profile_feed_location_label()}]
        explicit_location_filter = bool(
            selected_locations
            or location
            or location_label
            or place_id
            or country
            or country_code
            or lat is not None
            or lng is not None
        )
        explicit_filters = bool(
            min_salary > 0
            or (posted_within and posted_within != "any")
            or work_location
            or job_type
            or experience
            or explicit_location_filter
            or only_company
            or hide_company
            or only_industry
            or hide_industry
            or include_unknown_location is False
            or include_unknown_salary is False
            or only_my_country
            or radius_scope not in ("50km", "50 km")
        )

        base_query: Dict[str, Any] = {}
        candidate_limit = max(80, requested_limit * 16) if explicit_filters else max(120, requested_limit * 24)
        if explicit_location_filter:
            candidate_limit = max(candidate_limit, 1000)
        if is_worldwide_radius:
            candidate_limit = max(candidate_limit, requested_limit * 80, 1000)

        refresh_results = []
        provider_search_keys: List[str] = []
        direct_refresh_jobs: List[Dict[str, Any]] = []

        def _is_current_provider_job(job: Dict[str, Any]) -> bool:
            return (
                bool(provider_search_keys)
                and job.get("provider") == "jsearch"
                and str(job.get("provider_search_key") or "") in provider_search_keys
            )

        def _compact_refresh_result(item: Dict[str, Any]) -> Dict[str, Any]:
            compact: Dict[str, Any] = {}
            for key, value in (item or {}).items():
                if key == "jobs" and isinstance(value, list):
                    compact["jobs_count"] = len(value)
                elif key == "sample_jobs" and isinstance(value, list):
                    compact["sample_jobs_count"] = len(value)
                elif key in ("greenhouse", "lever") and isinstance(value, dict):
                    compact[key] = _compact_refresh_result(value)
                else:
                    compact[key] = value
            return compact

        def _country_terms_from_locations() -> List[str]:
            aliases = {
                "fr": ["france"],
                "gb": ["united kingdom", "uk", "england"],
                "us": ["united states", "usa"],
                "ma": ["morocco", "maroc"],
            }
            values: List[str] = []
            for loc in selected_locations:
                code = str(loc.get("country_code") or "").lower().strip()
                country_name = str(loc.get("country") or "").lower().strip()
                if country_name:
                    values.append(country_name)
                values.extend(aliases.get(code, []))
            if only_my_country:
                profile_location_data = _profile_feed_location_data()
                profile_code = str(profile_location_data.get("country_code") or "").lower().strip()
                profile_country = str(profile_location_data.get("country") or "").lower().strip()
                if profile_country:
                    values.append(profile_country)
                values.extend(aliases.get(profile_code, []))
            return list(dict.fromkeys(value for value in values if value))

        def _city_terms_from_locations() -> List[str]:
            values: List[str] = []
            for loc in selected_locations:
                label = str(loc.get("location_label") or "").strip()
                if not label:
                    continue
                city_part = re.split(r"[,/|-]", label, maxsplit=1)[0]
                values.extend(_tokens(city_part))
            if not selected_locations and location:
                for label in location:
                    city_part = re.split(r"[,/|-]", str(label), maxsplit=1)[0]
                    values.extend(_tokens(city_part))
            return list(dict.fromkeys(values))

        selected_city_terms = _city_terms_from_locations()
        selected_country_terms = _country_terms_from_locations()

        def _country_codes_from_locations() -> List[str]:
            values: List[str] = []
            for loc in selected_locations:
                code = str(loc.get("country_code") or "").lower().strip()
                if code:
                    values.append(code)
            if only_my_country:
                profile_location_data = _profile_feed_location_data()
                code = str(profile_location_data.get("country_code") or "").lower().strip()
                if code:
                    values.append(code)
            return list(dict.fromkeys(values))

        selected_country_codes = _country_codes_from_locations()

        def _validated_cache_query(*, include_unknown: bool = False) -> Dict[str, Any]:
            query: Dict[str, Any] = {
                "applyability_tier": {"$in": ["A", "B", "C"] if include_unknown else ["A", "B"]},
            }
            if not include_unknown:
                query["validation_status"] = "valid"
            if selected_country_codes and radius_scope not in ("worldwide", "remote", "remote/worldwide"):
                query["country_code"] = {"$in": selected_country_codes}
            if posted_within and posted_within != "any":
                days_map = {"1d": 1, "7d": 7, "30d": 30}
                days = days_map.get(posted_within)
                if days:
                    query["posted_at"] = {"$gte": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}
            if min_salary and min_salary > 0 and not include_unknown_salary:
                query["salary_max"] = {"$gte": min_salary}
            if work_location:
                wanted = {
                    ("onsite" if str(item).lower() in ("in-person", "in_person", "on-site", "onsite") else str(item).lower())
                    for item in work_location
                }
                if wanted == {"remote"}:
                    query["remote"] = True
            return query

        def _tier_rank(job: Dict[str, Any]) -> int:
            return {"A": 0, "B": 1, "C": 2}.get(str(job.get("applyability_tier") or "").upper(), 9)

        def _quality_sort_key(job: Dict[str, Any]) -> tuple:
            score_value = job.get("applyability_score")
            try:
                applyability_score = float(score_value if score_value is not None else 0)
            except (TypeError, ValueError):
                applyability_score = 0.0
            return (
                _tier_rank(job),
                -applyability_score,
                0 if job.get("auto_apply_supported") is True else 1,
                0 if job.get("manual_fulfillment_ready") is True else 1,
                -_recency_score(job),
            )

        def _job_work_location(job: Dict[str, Any]) -> str:
            raw = job.get("remote")
            if isinstance(raw, bool):
                return "remote" if raw else "onsite"
            text = " ".join([
                str(raw or ""),
                str(job.get("location") or ""),
                str(job.get("workplace_type") or ""),
                str(job.get("work_location") or ""),
            ]).lower()
            if "hybrid" in text:
                return "hybrid"
            if "remote" in text or "work from home" in text:
                return "remote"
            if "onsite" in text or "on-site" in text or "in person" in text or "office" in text:
                return "onsite"
            return "unknown"

        def _matches_work_location(job: Dict[str, Any]) -> bool:
            if not work_location:
                return True
            wanted = {
                ("onsite" if str(item).lower() in ("in-person", "in_person", "on-site", "onsite") else str(item).lower())
                for item in work_location
            }
            actual = _job_work_location(job)
            if actual == "unknown":
                return include_unknown_location
            if "remote" in wanted and actual == "remote":
                return True
            if "hybrid" in wanted and actual == "hybrid":
                return True
            if "onsite" in wanted and actual == "onsite":
                return True
            return False

        def _matches_location(job: Dict[str, Any]) -> bool:
            if not explicit_location_filter and not only_my_country:
                return True
            job_location = str(job.get("location") or "").lower()
            job_country_code = str(job.get("country_code") or "").lower().strip()
            if not job_location and not job_country_code:
                if explicit_location_filter and radius_km is not None:
                    return False
                return include_unknown_location
            city_match = bool(selected_city_terms and any(term in job_location for term in selected_city_terms))
            country_match = bool(
                (selected_country_terms and any(term in job_location for term in selected_country_terms))
                or any(str(loc.get("country_code") or "").lower().strip() == job_country_code for loc in selected_locations if loc.get("country_code"))
            )
            if only_my_country:
                profile_location_data = _profile_feed_location_data()
                profile_code = str(profile_location_data.get("country_code") or "").lower().strip()
                if profile_code and job_country_code == profile_code:
                    return True
                return country_match
            if radius_scope in ("worldwide", "remote", "remote/worldwide"):
                return True
            if radius_km is not None:
                return city_match if selected_city_terms else country_match
            return city_match or country_match

        def _matches_salary(job: Dict[str, Any]) -> bool:
            if not min_salary or min_salary <= 0:
                return True
            salary_max = job.get("salary_max")
            if salary_max in (None, ""):
                return include_unknown_salary
            try:
                return int(salary_max) >= int(min_salary)
            except (TypeError, ValueError):
                return include_unknown_salary

        def _matches_posted_date(job: Dict[str, Any]) -> bool:
            if not posted_within or posted_within == "any":
                return True
            days_map = {"1d": 1, "7d": 7, "30d": 30}
            days = days_map.get(posted_within)
            if not days:
                return True
            raw = job.get("posted_at") or job.get("imported_at") or job.get("last_seen_at")
            if not raw:
                return False
            try:
                parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
            except ValueError:
                return False
            return parsed >= datetime.now(timezone.utc) - timedelta(days=days)

        def _matches_job_type(job: Dict[str, Any]) -> bool:
            if not job_type:
                return True
            text = " ".join([
                str(job.get("job_type") or ""),
                str(job.get("employment_type") or ""),
                str(job.get("contract_type") or ""),
                str(job.get("title") or ""),
                str(job.get("description") or ""),
            ]).lower()
            aliases = {
                "full_time": ["full time", "full-time", "permanent", "cdi"],
                "part_time": ["part time", "part-time"],
                "internship": ["intern", "internship", "stage"],
            }
            return any(any(alias in text for alias in aliases.get(kind, [kind])) for kind in job_type)

        def _matches_experience(job: Dict[str, Any]) -> bool:
            if not experience:
                return True
            exp_map = {
                "entry": ["junior", "entry"],
                "mid": ["mid", "intermediate"],
                "senior": ["senior"],
                "executive": ["lead", "principal", "executive", "director"],
            }
            wanted: List[str] = []
            for item in experience:
                wanted.extend(exp_map.get(item, [item]))
            seniority = str(job.get("seniority") or "").lower()
            title = str(job.get("title") or "").lower()
            return any(item in seniority or item in title for item in wanted)

        def _matches_company(job: Dict[str, Any]) -> bool:
            company = str(job.get("company") or "").lower()
            if only_company and not any(company == str(item).lower() for item in only_company):
                return False
            if hide_company and any(str(item).lower() in company for item in hide_company):
                return False
            return True

        def _matches_industry(job: Dict[str, Any]) -> bool:
            if not only_industry and not hide_industry:
                return True
            text = " ".join([
                str(job.get("industry") or ""),
                " ".join(str(item) for item in (job.get("industries") or [])),
                str(job.get("company") or ""),
                str(job.get("description") or ""),
                str(job.get("clean_description") or ""),
            ]).lower()
            if only_industry and not any(str(item).lower() in text for item in only_industry):
                return False
            if hide_industry and any(str(item).lower() in text for item in hide_industry):
                return False
            return True

        def _matches_explicit_filters(job: Dict[str, Any]) -> bool:
            return (
                _matches_work_location(job)
                and _matches_location(job)
                and _matches_salary(job)
                and _matches_posted_date(job)
                and _matches_job_type(job)
                and _matches_experience(job)
                and _matches_company(job)
                and _matches_industry(job)
            )

        def _matches_non_location_filters(job: Dict[str, Any]) -> bool:
            return (
                _matches_work_location(job)
                and _matches_salary(job)
                and _matches_posted_date(job)
                and _matches_job_type(job)
                and _matches_experience(job)
                and _matches_company(job)
                and _matches_industry(job)
            )

        def _role_compatible_for_threshold(job: Dict[str, Any]) -> bool:
            if not _category_compatible(job):
                return False
            if not strict_tokens and not family_tokens:
                return True
            return _role_score(job, strict_tokens, family_tokens) > 0

        swiped_rows = await db.swipes.find({"user_id": user.user_id}, {"_id": 0, "job_id": 1}).limit(500).to_list(500)
        swiped_ids = {row.get("job_id") for row in swiped_rows if row.get("job_id")}

        async def _load_db_candidates(*, include_unknown: bool = False) -> tuple[List[Dict[str, Any]], Dict[str, Any], int, int, int]:
            query = _validated_cache_query(include_unknown=include_unknown)
            db_started = time.perf_counter()
            rows = await _get_feed_job_candidates(query, candidate_limit)
            db_elapsed_ms = int((time.perf_counter() - db_started) * 1000)
            rows = [job for job in rows if job.get("job_id") not in swiped_ids]
            unfiltered = len(rows)
            rejected = sum(
                1
                for job in rows
                if str(job.get("validation_status") or "").lower() == "invalid"
                or str(job.get("applyability_tier") or "").upper() in {"D", "E"}
            )
            rows = [_with_apply_fulfillment_fields(job) for job in rows if _job_is_applyable(job)]
            applyable = len(rows)
            rows = [job for job in rows if _matches_explicit_filters(job)]
            rows.sort(key=_quality_sort_key)
            logger.info(
                "jobs/feed db_query_complete: user_id=%s elapsed_ms=%s include_unknown=%s query=%s raw_rows=%s applyable=%s filtered=%s",
                user.user_id,
                db_elapsed_ms,
                include_unknown,
                query,
                unfiltered,
                applyable,
                len(rows),
            )
            return rows, query, unfiltered, applyable, rejected

        async def _load_legacy_direct_ats_candidates() -> tuple[List[Dict[str, Any]], Dict[str, Any], int, int, int]:
            query: Dict[str, Any] = {
                "provider": {"$in": ats_supported},
                "auto_apply_supported": True,
            }
            db_started = time.perf_counter()
            rows = await _get_feed_job_candidates(query, candidate_limit)
            db_elapsed_ms = int((time.perf_counter() - db_started) * 1000)
            rows = [job for job in rows if job.get("job_id") not in swiped_ids]
            unfiltered = len(rows)
            rejected = sum(
                1
                for job in rows
                if str(job.get("validation_status") or "").lower() == "invalid"
                or str(job.get("applyability_tier") or "").upper() in {"D", "E"}
            )
            rows = [
                _with_apply_fulfillment_fields(job)
                for job in rows
                if not job.get("validation_status")
                and str(job.get("applyability_tier") or "").upper() not in {"D", "E"}
                and str(job.get("provider") or "").lower() in set(ats_supported)
                and _job_is_applyable(job)
            ]
            applyable = len(rows)
            rows = [job for job in rows if _matches_explicit_filters(job)]
            rows.sort(key=_quality_sort_key)
            logger.info(
                "jobs/feed legacy_direct_ats_query_complete: user_id=%s elapsed_ms=%s query=%s raw_rows=%s applyable=%s filtered=%s",
                user.user_id,
                db_elapsed_ms,
                query,
                unfiltered,
                applyable,
                len(rows),
            )
            return rows, query, unfiltered, applyable, rejected

        base_query = _validated_cache_query(include_unknown=False)
        candidates: List[Dict[str, Any]] = []
        unfiltered_count = 0
        applyable_count = 0
        pre_filter_candidates: List[Dict[str, Any]] = []
        db_good_count = 0
        db_rejected_count = 0
        feed_source = "db_first_disabled"
        jsearch_fallback_triggered = False

        if db_first_enabled:
            candidates, base_query, unfiltered_count, applyable_count, db_rejected_count = await _load_db_candidates(include_unknown=False)
            db_good_count = sum(1 for job in candidates if _role_compatible_for_threshold(job))
            pre_filter_candidates = list(candidates)
            feed_source = "db_cache"
            logger.info(
                "jobs/feed db_first: user_id=%s elapsed_ms=%s good_count=%s candidate_count=%s unfiltered_count=%s applyable_count=%s rejected_de_count=%s query=%s min_good=%s weak_threshold=%s allow_unknown=%s",
                user.user_id,
                _elapsed_ms(),
                db_good_count,
                len(candidates),
                unfiltered_count,
                applyable_count,
                db_rejected_count,
                base_query,
                db_min_good_results,
                db_weak_results_threshold,
                allow_unknown_tier,
            )
            if allow_unknown_tier and db_good_count < requested_limit:
                c_candidates, c_query, c_unfiltered, c_applyable, c_rejected = await _load_db_candidates(include_unknown=True)
                seen_ids = {job.get("job_id") for job in candidates}
                candidates.extend(job for job in c_candidates if job.get("job_id") not in seen_ids)
                pre_filter_candidates = list(candidates)
                unfiltered_count += c_unfiltered
                applyable_count += c_applyable
                db_rejected_count += c_rejected
                base_query = c_query
                logger.info(
                    "jobs/feed db_first_unknown_tier: user_id=%s elapsed_ms=%s combined_count=%s c_unfiltered=%s",
                    user.user_id,
                    _elapsed_ms(),
                    len(candidates),
                    c_unfiltered,
                )
            if db_good_count == 0 and not allow_unknown_tier:
                legacy_candidates, legacy_query, legacy_unfiltered, legacy_applyable, legacy_rejected = await _load_legacy_direct_ats_candidates()
                if legacy_candidates:
                    candidates = legacy_candidates
                    base_query = legacy_query
                    unfiltered_count = legacy_unfiltered
                    applyable_count = legacy_applyable
                    db_rejected_count += legacy_rejected
                    db_good_count = sum(1 for job in candidates if _role_compatible_for_threshold(job))
                    pre_filter_candidates = list(candidates)
                    feed_source = "legacy_direct_ats_cache"
                    logger.info(
                        "jobs/feed legacy_direct_ats_used: user_id=%s good_count=%s candidate_count=%s",
                        user.user_id,
                        db_good_count,
                        len(candidates),
                    )

        cooldown_active = time.monotonic() < _feed_sync_refresh_cooldown_until
        should_refresh = (
            sync_refresh_enabled
            and not _timed_out()
            and not cooldown_active
            and (not db_first_enabled or db_good_count == 0)
        )
        if db_good_count > 0 and db_good_count < db_weak_results_threshold:
            logger.info(
                "jobs/feed sync_refresh_skipped_db_has_results: user_id=%s db_good_count=%s weak_threshold=%s",
                user.user_id,
                db_good_count,
                db_weak_results_threshold,
            )
        elif cooldown_active:
            logger.info(
                "jobs/feed sync_refresh_skipped_cooldown: user_id=%s cooldown_remaining_seconds=%s",
                user.user_id,
                max(0, int(_feed_sync_refresh_cooldown_until - time.monotonic())),
            )
        if should_refresh:
            jsearch_fallback_triggered = True
            max_refresh_locations = max(1, min(int(os.environ.get("FEED_MAX_REFRESH_LOCATIONS", "1")), 3))
            refresh_locations = [None] if is_worldwide_radius else (selected_locations or [None])[:max_refresh_locations]
            force_provider_refresh = os.environ.get("JOB_FEED_ON_DEMAND_JSEARCH", "true").lower() in ("1", "true", "yes", "on")
            logger.info(
                "jobs/feed jsearch_fallback_start: user_id=%s db_good_count=%s weak_threshold=%s refresh_locations=%s force_provider_refresh=%s max_seconds=%s max_results=%s max_pages=%s page_size=%s",
                user.user_id,
                db_good_count,
                db_weak_results_threshold,
                len(refresh_locations),
                force_provider_refresh,
                sync_refresh_max_seconds,
                sync_refresh_max_results,
                sync_refresh_max_pages,
                sync_refresh_page_size,
            )
            for loc_data in refresh_locations:
                loc_label = loc_data.get("location_label") if isinstance(loc_data, dict) else None
                refresh_started = time.perf_counter()
                try:
                    refresh_result = await asyncio.wait_for(
                        refresh_jobs_for_profile_if_needed(
                            db,
                            profile,
                            require_auto_apply=False,
                            target_auto_apply_count=min(sync_refresh_max_results, max(requested_limit, 1)),
                            location_override=loc_label,
                            location_data_override=loc_data if isinstance(loc_data, dict) else None,
                            search_radius=search_radius,
                            role_override=target_role,
                            force_provider_refresh=force_provider_refresh,
                            query_limit_override=sync_refresh_max_results,
                            provider_max_pages=sync_refresh_max_pages,
                            provider_page_size=sync_refresh_page_size,
                            max_provider_requests_override=1,
                            max_direct_apply_requests_override=0,
                        ),
                        timeout=sync_refresh_max_seconds,
                    )
                except asyncio.TimeoutError:
                    _feed_sync_refresh_cooldown_until = time.monotonic() + sync_refresh_cooldown_seconds
                    refresh_result = {
                        "attempted": True,
                        "ok": False,
                        "reason": "feed_sync_refresh_timeout",
                        "elapsed_ms": int((time.perf_counter() - refresh_started) * 1000),
                    }
                    logger.warning(
                        "jobs/feed jsearch_fallback_timeout: user_id=%s elapsed_ms=%s cooldown_seconds=%s",
                        user.user_id,
                        refresh_result["elapsed_ms"],
                        sync_refresh_cooldown_seconds,
                    )
                except Exception as exc:
                    _feed_sync_refresh_cooldown_until = time.monotonic() + sync_refresh_cooldown_seconds
                    refresh_result = {
                        "attempted": True,
                        "ok": False,
                        "reason": "feed_sync_refresh_error",
                        "error_type": exc.__class__.__name__,
                        "elapsed_ms": int((time.perf_counter() - refresh_started) * 1000),
                    }
                    logger.warning(
                        "jobs/feed jsearch_fallback_error: user_id=%s elapsed_ms=%s error=%s",
                        user.user_id,
                        refresh_result["elapsed_ms"],
                        exc,
                    )
                else:
                    logger.info(
                        "jobs/feed jsearch_fallback_location_complete: user_id=%s elapsed_ms=%s reason=%s imported=%s",
                        user.user_id,
                        int((time.perf_counter() - refresh_started) * 1000),
                        refresh_result.get("reason"),
                        refresh_result.get("jobs_imported", refresh_result.get("count")),
                    )
                refresh_results.append(refresh_result)
                if refresh_result.get("provider_rate_limited"):
                    break
                if refresh_result.get("reason") in {"feed_sync_refresh_timeout", "feed_sync_refresh_error"}:
                    break

            for refresh_result in refresh_results:
                direct_refresh_jobs.extend(job for job in (refresh_result.get("jobs") or []) if isinstance(job, dict))
                for key in refresh_result.get("search_keys") or []:
                    if key:
                        provider_search_keys.append(str(key))
                if refresh_result.get("search_key"):
                    provider_search_keys.append(str(refresh_result.get("search_key")))
            provider_search_keys = list(dict.fromkeys(provider_search_keys))

            candidates, base_query, unfiltered_count, applyable_count, db_rejected_count = await _load_db_candidates(include_unknown=False)
            if allow_unknown_tier and len(candidates) < requested_limit:
                c_candidates, c_query, c_unfiltered, c_applyable, c_rejected = await _load_db_candidates(include_unknown=True)
                seen_ids = {job.get("job_id") for job in candidates}
                candidates.extend(job for job in c_candidates if job.get("job_id") not in seen_ids)
                unfiltered_count += c_unfiltered
                applyable_count += c_applyable
                db_rejected_count += c_rejected
                base_query = c_query
            pre_filter_candidates = list(candidates)
            feed_source = "db_after_jsearch_fallback"
            logger.info(
                "jobs/feed jsearch_fallback_complete: user_id=%s imported_results=%s provider_search_keys=%s db_after_count=%s db_after_role_good_count=%s unfiltered_count=%s applyable_count=%s rejected_de_count=%s",
                user.user_id,
                [item.get("jobs_imported", item.get("count")) for item in refresh_results if isinstance(item, dict)],
                len(provider_search_keys),
                len(candidates),
                sum(1 for job in candidates if _role_compatible_for_threshold(job)),
                unfiltered_count,
                applyable_count,
                db_rejected_count,
            )
        elif not db_first_enabled:
            candidates, base_query, unfiltered_count, applyable_count, db_rejected_count = await _load_db_candidates(include_unknown=allow_unknown_tier)
            pre_filter_candidates = list(candidates)

        logger.info(
            "feed_filter_stage user_id=%s stage=candidate_pool elapsed_ms=%s source=%s jsearch_fallback=%s query=%s count=%s db_good_count=%s unfiltered_count=%s applyable_count=%s rejected_de_count=%s swiped_count=%s explicit_filters=%s",
            user.user_id,
            _elapsed_ms(),
            feed_source,
            jsearch_fallback_triggered,
            base_query,
            len(candidates),
            db_good_count,
            unfiltered_count,
            applyable_count,
            db_rejected_count,
            len(swiped_ids),
            explicit_filters,
        )

        def rank(pool: List[Dict[str, Any]], *, worldwide: bool, broad: bool, any_role: bool = False) -> List[Dict[str, Any]]:
            ranked = []
            for job in pool:
                if not any_role and not _category_compatible(job):
                    continue
                role_score = 10 if any_role else _role_score(job, strict_tokens if not broad else [], family_tokens)
                location_score = _location_score(job, terms, worldwide=worldwide)
                if not worldwide and _is_current_provider_job(job):
                    location_score = max(location_score, 35)
                if not worldwide and terms["labels"] and location_score <= 0:
                    continue
                if not any_role and role_score <= 0:
                    continue
                ranked.append({
                    **job,
                    "_feed_rank_score": role_score * 3 + location_score * 2 + _recency_score(job) + max(0, 30 - _tier_rank(job) * 10),
                    "_role_match_score": role_score,
                    "_location_match_score": location_score,
                })
            ranked.sort(key=lambda row: row.get("_feed_rank_score", 0), reverse=True)
            diverse: List[Dict[str, Any]] = []
            deferred: List[Dict[str, Any]] = []
            seen_companies = set()
            for job in ranked:
                company_key = (job.get("company") or "").strip().lower()
                if len(diverse) < min(5, requested_limit) and company_key in seen_companies:
                    deferred.append(job)
                    continue
                diverse.append(job)
                if company_key:
                    seen_companies.add(company_key)
                if len(diverse) >= requested_limit:
                    break
            for job in deferred:
                if len(diverse) >= requested_limit:
                    break
                diverse.append(job)
            return diverse[:requested_limit]

        fallback_used = "none"
        if is_worldwide_radius:
            fallback_used = "worldwide_radius"
            jobs = rank(candidates, worldwide=True, broad=False)
            logger.info("feed_filter_stage user_id=%s stage=worldwide_radius_strict_role elapsed_ms=%s count=%s", user.user_id, _elapsed_ms(), len(jobs))
            if len(jobs) < requested_limit and not _timed_out():
                fallback_used = "worldwide_radius_role_family"
                jobs = rank(candidates, worldwide=True, broad=True)
                logger.info("feed_filter_stage user_id=%s stage=worldwide_radius_role_family elapsed_ms=%s count=%s", user.user_id, _elapsed_ms(), len(jobs))
            if len(jobs) < requested_limit and not _timed_out():
                fallback_used = "worldwide_radius_auto_apply"
                jobs = rank(candidates, worldwide=True, broad=True, any_role=True)
                logger.info(
                    "feed_filter_stage user_id=%s stage=worldwide_radius_auto_apply elapsed_ms=%s count=%s candidate_pool=%s source=%s",
                    user.user_id,
                    _elapsed_ms(),
                    len(jobs),
                    len(candidates),
                    feed_source,
                )
        else:
            jobs = rank(candidates, worldwide=False, broad=False)
            logger.info("feed_filter_stage user_id=%s stage=strict_role_location elapsed_ms=%s count=%s", user.user_id, _elapsed_ms(), len(jobs))
            if len(jobs) < requested_limit and direct_refresh_jobs and not _timed_out():
                fallback_used = "direct_provider_relaxed_role"
                jobs = rank(candidates, worldwide=False, broad=True)
                logger.info(
                    "feed_filter_stage user_id=%s stage=direct_provider_relaxed_role elapsed_ms=%s count=%s direct_refresh_jobs=%s",
                    user.user_id,
                    _elapsed_ms(),
                    len(jobs),
                    len(direct_refresh_jobs),
                )
        allow_location_widening = not explicit_location_filter or radius_km is None
        if not is_worldwide_radius and explicit_filters and allow_location_widening and len(jobs) < requested_limit and explicit_location_filter and selected_country_terms:
            relaxed = [
                job for job in pre_filter_candidates
                if _matches_non_location_filters(job)
                and _role_score(job, strict_tokens, family_tokens) > 0
                and (
                    _matches_location(job)
                    or bool(selected_country_terms and any(term in str(job.get("location") or "").lower() for term in selected_country_terms))
                    or str(job.get("remote") or "").lower() == "remote"
                )
            ]
            if relaxed:
                relaxed_jobs = rank(relaxed, worldwide=True, broad=False)
                if len(relaxed_jobs) < requested_limit:
                    relaxed_jobs = rank(relaxed, worldwide=True, broad=True)
                if relaxed_jobs:
                    fallback_used = "relaxed_country"
                    jobs = relaxed_jobs
                logger.info(
                    "feed_filter_stage user_id=%s stage=relaxed_country elapsed_ms=%s count=%s",
                    user.user_id,
                    _elapsed_ms(),
                    len(jobs),
                )
        if not is_worldwide_radius and explicit_filters and allow_location_widening and len(jobs) < requested_limit and not _timed_out():
            widened = [
                job for job in pre_filter_candidates
                if _matches_non_location_filters(job)
                and _role_score(job, strict_tokens, family_tokens) > 0
            ]
            widened_jobs = rank(widened, worldwide=True, broad=True)
            if widened_jobs:
                fallback_used = "explicit_filters_worldwide_role_family"
                jobs = widened_jobs
            logger.info("feed_filter_stage user_id=%s stage=explicit_filters_worldwide_role_family elapsed_ms=%s count=%s", user.user_id, _elapsed_ms(), len(jobs))
        if explicit_filters and len(jobs) < requested_limit:
            fallback_used = "none_due_to_explicit_filters" if fallback_used == "none" else fallback_used
        if not is_worldwide_radius and not explicit_filters and len(jobs) < requested_limit and not _timed_out():
            fallback_used = "worldwide_role_family"
            jobs = rank(candidates, worldwide=True, broad=True)
            logger.info("feed_filter_stage user_id=%s stage=worldwide_role_family elapsed_ms=%s count=%s", user.user_id, _elapsed_ms(), len(jobs))
        if not is_worldwide_radius and not explicit_filters and len(jobs) < requested_limit and not _timed_out():
            fallback_used = "worldwide_auto_apply"
            jobs = rank(candidates, worldwide=True, broad=True, any_role=not bool(strict_tokens or family_tokens))
            logger.info("feed_filter_stage user_id=%s stage=worldwide_auto_apply elapsed_ms=%s count=%s", user.user_id, _elapsed_ms(), len(jobs))

        jobs = await _hydrate_feed_jobs(jobs)

        clean_jobs = []
        for job in jobs[:requested_limit]:
            clean = {key: value for key, value in job.items() if not key.startswith("_")}
            clean_jobs.append({
                **clean,
                "match_score": clean.get("match_score") or random.randint(78, 96),
                "match_reasons": clean.get("match_reasons") or ["Auto-apply compatible role from a supported ATS."],
            })
        elapsed = _elapsed_ms()
        logger.info(
            "jobs/feed fast complete: user_id=%s feed_elapsed_ms=%s returned=%s fallback_used=%s timed_out=%s direct_refresh_jobs=%s provider_search_keys=%s unfiltered_count=%s candidates=%s",
            user.user_id,
            elapsed,
            len(clean_jobs),
            fallback_used,
            _timed_out(),
            len(direct_refresh_jobs),
            len(provider_search_keys),
            unfiltered_count,
            len(candidates),
        )
        safe_refresh_results = [_compact_refresh_result(item) for item in refresh_results if isinstance(item, dict)]
        return {
            "jobs": clean_jobs,
            "total": len(clean_jobs),
            "feed_mode": "mixed",
            "auto_apply_count": sum(1 for job in clean_jobs if job.get("auto_apply_supported") is True),
            "total_count": len(candidates),
            "fallback_reason": None if fallback_used == "none" else fallback_used,
            "searched_location": terms["labels"][0] if terms["labels"] else profile.get("target_location"),
            "searched_locations": terms["labels"],
            "search_radius": search_radius,
            "suggested_next_radius": None if clean_jobs else "worldwide",
            "only_my_country": only_my_country,
            "widened_search": fallback_used.startswith("worldwide"),
            "original_location": terms["labels"][0] if terms["labels"] else profile.get("target_location"),
            "final_location_used": "worldwide" if fallback_used.startswith("worldwide") else (terms["labels"][0] if terms["labels"] else profile.get("target_location")),
            "provider_rate_limited": any(item.get("provider_rate_limited") for item in refresh_results),
            "provider_cooldown_until": next((item.get("provider_cooldown_until") for item in refresh_results if item.get("provider_cooldown_until")), None),
            "refresh_results": safe_refresh_results,
            "matched_role": target_role or None,
            "matched_location": terms["labels"],
            "companies_returned": sorted({job.get("company") for job in clean_jobs if job.get("company")}),
            "filters_applied": {
                "target_role": target_role or None,
                "role_tokens": strict_tokens,
                "broader_role_tokens": family_tokens,
                "auto_apply_supported": None,
                "ats_provider": None,
                "auto_apply_fallback": False,
                "provider_search_keys": provider_search_keys,
                "search_radius": search_radius,
                "explicit_filters": explicit_filters,
                "manual_fulfillment_ready": True,
                "work_location": work_location,
                "locations": [loc.get("location_label") for loc in selected_locations if loc.get("location_label")],
                "selected_city_terms": selected_city_terms,
                "selected_country_terms": selected_country_terms,
                "selected_country_codes": selected_country_codes,
                "only_my_country": only_my_country,
                "min_salary": min_salary,
                "posted_within": posted_within,
                "job_type": job_type,
                "experience": experience,
                "only_company": only_company,
                "hide_company": hide_company,
                "only_industry": only_industry,
                "hide_industry": hide_industry,
                "include_unknown_location": include_unknown_location,
                "include_unknown_salary": include_unknown_salary,
            },
            "feed_elapsed_ms": elapsed,
            "fallback_used": fallback_used,
            "explicit_filters": explicit_filters,
        }

    return await _fast_cached_feed()

    provider_enabled = os.environ.get("JSEARCH_ENABLED", "true").lower() in ("1", "true", "yes", "on")
    provider_configured = bool(os.environ.get("JSEARCH_API_KEY"))
    fallback_mock = os.environ.get("JOB_PROVIDER_FALLBACK_MOCK", "false").lower() in ("1", "true", "yes", "on")
    profile_location_data = profile.get("target_location_data") or {}
    profile_country_code = (profile_location_data.get("country_code") or "").strip().lower()
    profile_country = profile_location_data.get("country")

    selected_locations: List[Dict[str, Any]] = []
    if locations_json:
        try:
            parsed_locations = json.loads(locations_json)
            if isinstance(parsed_locations, list):
                selected_locations = [loc for loc in parsed_locations if isinstance(loc, dict) and loc.get("location_label")]
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="locations_json must be a JSON array")

    request_location_data = None
    if location_label:
        request_location_data = {
            "location_label": location_label,
            "place_id": place_id,
            "country": country,
            "country_code": country_code,
            "lat": lat,
            "lng": lng,
        }
        selected_locations = [request_location_data]

    if only_my_country:
        if profile_country_code:
            selected_locations = [
                {**loc, "country_code": profile_country_code, "country": profile_country or loc.get("country")}
                for loc in selected_locations
            ]
            if not selected_locations and profile_location_data:
                selected_locations = [profile_location_data]
        elif not selected_locations and profile_location_data:
            selected_locations = [profile_location_data]

    if not selected_locations and profile_location_data:
        selected_locations = [profile_location_data]

    request_location = (
        selected_locations[0].get("location_label")
        if selected_locations
        else (location[0] if location else None)
    )

    async def _count_auto_for_labels(labels: List[str]) -> int:
        count_query: Dict[str, Any] = {"auto_apply_supported": True}
        if labels and search_radius not in ("worldwide", "remote", "remote/worldwide"):
            count_query["$or"] = [{"location": {"$regex": re.escape(label), "$options": "i"}} for label in labels]
        return await db.jobs.count_documents(count_query)

    refresh_results = []
    max_feed_refresh_locations = max(1, min(int(os.environ.get("FEED_MAX_REFRESH_LOCATIONS", "3")), 10))
    refresh_locations = (selected_locations or [None])[:max_feed_refresh_locations]
    for loc_data in refresh_locations:
        loc_label = loc_data.get("location_label") if loc_data else None
        refresh_result = await refresh_jobs_for_profile_if_needed(
            db,
            profile,
            require_auto_apply=not include_non_auto_apply,
            target_auto_apply_count=limit,
            location_override=loc_label,
            location_data_override=loc_data,
            search_radius=search_radius,
        )
        refresh_results.append(refresh_result)
        if refresh_result.get("provider_rate_limited"):
            break
        refreshed_labels = [
            item.get("location_label")
            for item in refresh_locations[:len(refresh_results)]
            if isinstance(item, dict) and item.get("location_label")
        ]
        if refreshed_labels and await _count_auto_for_labels(refreshed_labels) >= limit:
            break
    refresh_result = refresh_results[-1] if refresh_results else {"attempted": False, "reason": "no_refresh"}
    logger.info(
        "jobs/feed refresh complete: user_id=%s elapsed_ms=%s refresh_results=%s",
        user.user_id,
        int((time.perf_counter() - started_at) * 1000),
        refresh_results,
    )

    # exclude jobs already swiped
    swiped = await db.swipes.find({"user_id": user.user_id}, {"_id": 0, "job_id": 1}).to_list(2000)
    swiped_ids = {s["job_id"] for s in swiped}

    query: Dict[str, Any] = {}

    if swiped_ids:
        query["job_id"] = {"$nin": list(swiped_ids)}

    # Work location filter
    if work_location:
        if include_unknown_location:
            query["$or"] = [
                {"remote": {"$in": work_location}},
                {"remote": {"$in": [None, ""]}},
            ]
        else:
            query["remote"] = {"$in": work_location}

    # Experience / seniority filter (entry→junior, executive→principal/lead)
    if experience:
        exp_map = {
            "entry": ["junior"],
            "mid": ["mid"],
            "senior": ["senior"],
            "executive": ["lead", "principal"],
        }
        wanted: List[str] = []
        for e in experience:
            wanted.extend(exp_map.get(e, [e]))
        query["seniority"] = {"$in": wanted}

    # Location free-text filter - case-insensitive substring OR across tokens
    location_filter_clause = None
    selected_location_labels = [
        loc.get("location_label")
        for loc in selected_locations
        if isinstance(loc, dict) and loc.get("location_label")
    ]
    if search_radius in ("worldwide", "remote", "remote/worldwide"):
        filter_locations = None
    elif selected_location_labels:
        filter_locations = selected_location_labels
    elif location:
        filter_locations = location
    elif only_my_country and profile_country:
        filter_locations = [profile_country]
    else:
        filter_locations = None
    if filter_locations:
        expanded_filter_locations = set()
        for loc in filter_locations:
            expanded_filter_locations.add(loc)
            for part in re.split(r"[,/|-]", loc):
                part = part.strip()
                if len(part) >= 3:
                    expanded_filter_locations.add(part)
        loc_clauses = [{"location": {"$regex": re.escape(loc), "$options": "i"}} for loc in expanded_filter_locations]
        location_filter_clause = {"$or": loc_clauses}
        query.setdefault("$and", []).append(location_filter_clause)

    # Posted within
    if posted_within and posted_within != "any":
        days_map = {"1d": 1, "7d": 7, "30d": 30}
        days = days_map.get(posted_within)
        if days:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            query["posted_at"] = {"$gte": cutoff}

    # Min salary filter — match any job whose top-of-range >= min_salary
    if min_salary and min_salary > 0:
        salary_clause: Dict[str, Any] = {"salary_max": {"$gte": min_salary}}
        if include_unknown_salary:
            query.setdefault("$and", []).append({
                "$or": [salary_clause, {"salary_max": {"$in": [None, 0]}}, {"salary_max": {"$exists": False}}],
            })
        else:
            query["salary_max"] = {"$gte": min_salary}

    # Only / hide companies
    if only_company:
        regexes = [{"company": {"$regex": f"^{re.escape(c)}$", "$options": "i"}} for c in only_company]
        query.setdefault("$and", []).append({"$or": regexes})
    if hide_company:
        query["company"] = {"$nin": []}  # init
        query["company"] = {"$not": {"$regex": "|".join(re.escape(c) for c in hide_company), "$options": "i"}}

    remote_pref = profile.get("remote_preference") or "any"
    target_role = feed_target_role
    radius_scope = (search_radius or "50km").lower().strip()

    def _tokens(value: str) -> List[str]:
        stop = {"and", "or", "the", "a", "an", "of", "for", "to", "in", "with", "remote", "jobs", "job"}
        return [token for token in re.findall(r"[a-z0-9]+", (value or "").lower()) if len(token) > 2 and token not in stop]

    role_tokens = _tokens(target_role)
    broader_role_tokens = []
    if role_tokens:
        broader_role_tokens = role_tokens[-1:]
        if "analyst" in role_tokens:
            broader_role_tokens = list(dict.fromkeys([*role_tokens, "analytics", "analysis", "insights", "scientist"]))
        if "software" in role_tokens and "engineer" in role_tokens:
            broader_role_tokens = ["software", "engineer"]

    selected_country_codes = [
        (loc.get("country_code") or "").strip().lower()
        for loc in selected_locations
        if isinstance(loc, dict) and loc.get("country_code")
    ]
    selected_countries = [
        (loc.get("country") or "").strip().lower()
        for loc in selected_locations
        if isinstance(loc, dict) and loc.get("country")
    ]
    country_aliases = {
        "gb": ["united kingdom", "uk", "england", "london"],
        "us": ["united states", "usa", "new york", "san francisco"],
        "ma": ["morocco", "maroc", "casablanca"],
    }
    selected_country_terms = set(selected_countries)
    for code in selected_country_codes or ([profile_country_code] if profile_country_code else []):
        selected_country_terms.update(country_aliases.get(code, []))
    location_terms = set()
    for label in selected_location_labels or (location or []):
        location_terms.update(_tokens(label))
    if profile_country:
        selected_country_terms.add(profile_country.lower())

    def _role_score(job: Dict[str, Any], tokens: List[str]) -> int:
        if not tokens:
            return 0
        title = (job.get("title") or "").lower()
        body = " ".join([
            job.get("description") or "",
            job.get("clean_description") or "",
            " ".join(job.get("requirements") or []),
        ]).lower()
        title_hits = sum(1 for token in tokens if token in title)
        body_hits = sum(1 for token in tokens if token in body)
        exact_bonus = 25 if target_role and target_role.lower() in title else 0
        return exact_bonus + title_hits * 20 + min(body_hits, len(tokens)) * 5

    def _location_score(job: Dict[str, Any]) -> int:
        if radius_scope in ("worldwide", "remote/worldwide"):
            return 10
        job_location = (job.get("location") or "").lower()
        job_remote = (job.get("remote") or "").lower()
        if radius_scope == "remote" or remote_pref == "remote":
            return 35 if job_remote == "remote" else 5
        score = 0
        if location_terms and any(term in job_location for term in location_terms):
            score += 40
        if selected_country_terms and any(term and term in job_location for term in selected_country_terms):
            score += 25
        if not location_terms and selected_country_terms and score:
            score += 10
        if job_remote == "remote":
            score += 8
        return score

    def _recency_score(job: Dict[str, Any]) -> int:
        raw = job.get("posted_at") or job.get("imported_at")
        if not raw:
            return 0
        try:
            parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return 0
        age_days = max(0, (datetime.now(timezone.utc) - parsed).days)
        if age_days <= 7:
            return 20
        if age_days <= 30:
            return 10
        return 0

    def _rank_jobs(candidates: List[Dict[str, Any]], wanted: int) -> List[Dict[str, Any]]:
        strict_matches = []
        broader_matches = []
        for job in candidates:
            strict_role_score = _role_score(job, role_tokens)
            broad_role_score = _role_score(job, broader_role_tokens)
            location_match_score = _location_score(job)
            recency = _recency_score(job)
            base_score = strict_role_score * 3 + location_match_score * 2 + recency
            ranked_job = {
                **job,
                "_feed_rank_score": base_score,
                "_role_match_score": strict_role_score,
                "_location_match_score": location_match_score,
            }
            if not role_tokens or strict_role_score >= max(20, len(role_tokens) * 12):
                strict_matches.append(ranked_job)
            elif broad_role_score >= 20:
                ranked_job["_feed_rank_score"] = broad_role_score * 2 + location_match_score * 2 + recency
                broader_matches.append(ranked_job)

        strict_matches.sort(key=lambda j: j["_feed_rank_score"], reverse=True)
        broader_matches.sort(key=lambda j: j["_feed_rank_score"], reverse=True)
        ranked = strict_matches if len(strict_matches) >= wanted else [*strict_matches, *broader_matches]

        diverse = []
        deferred = []
        seen_companies = set()
        for job in ranked:
            company_key = (job.get("company") or "").strip().lower()
            if len(diverse) < min(5, wanted) and company_key in seen_companies:
                deferred.append(job)
                continue
            diverse.append(job)
            if company_key:
                seen_companies.add(company_key)
            if len(diverse) >= wanted:
                break
        if len(diverse) < wanted:
            for job in deferred:
                diverse.append(job)
                if len(diverse) >= wanted:
                    break
        return diverse[:wanted]

    def _without_location_filter(src: Dict[str, Any]) -> Dict[str, Any]:
        widened = {**src}
        if location_filter_clause and "$and" in widened:
            remaining = [clause for clause in widened["$and"] if clause != location_filter_clause]
            if remaining:
                widened["$and"] = remaining
            else:
                widened.pop("$and", None)
        return widened

    async def _fetch(q: Dict[str, Any], wanted: int) -> List[Dict[str, Any]]:
        candidate_limit = max(wanted * 100, 500)
        rows = await db.jobs.find(q, {"_id": 0}).limit(candidate_limit).to_list(candidate_limit)
        rows = [_with_apply_fulfillment_fields(row) for row in rows if _job_is_applyable(row)]
        return _rank_jobs(rows, wanted)

    base_query = {**query}
    total_all = await db.jobs.count_documents(base_query)
    auto_query = {
        **base_query,
        "auto_apply_supported": True,
        "ats_provider": {"$in": ["greenhouse", "lever", "ashby"]},
    }

    feed_mode = "auto_apply_only"
    fallback_reason = None
    widened_search = False
    final_location_used = request_location or profile.get("target_location")
    provider_rate_limited = bool(refresh_result.get("provider_rate_limited"))
    provider_cooldown_until = refresh_result.get("provider_cooldown_until")

    if include_non_auto_apply:
        feed_mode = "mixed"
        jobs = await _fetch(base_query, limit)
    else:
        jobs = await _fetch(auto_query, limit)

    jobs = jobs[:limit]
    auto_apply_count = sum(1 for j in jobs if j.get("auto_apply_supported") is True)
    total = await db.jobs.count_documents(auto_query if not include_non_auto_apply else base_query)
    companies_returned = sorted({j.get("company") for j in jobs if j.get("company")})
    filters_applied = {
        "target_role": target_role or None,
        "role_tokens": role_tokens,
        "broader_role_tokens": broader_role_tokens,
        "locations": selected_location_labels,
        "country_code": selected_country_codes or ([profile_country_code] if profile_country_code else []),
        "search_radius": search_radius,
        "remote_preference": remote_pref,
        "auto_apply_supported": not include_non_auto_apply,
        "ats_provider": ["greenhouse", "lever", "ashby"] if not include_non_auto_apply else None,
        "manual_fulfillment_ready": True,
    }
    if provider_rate_limited:
        fallback_reason = "provider_rate_limited"

    if not jobs:
        if include_non_auto_apply and provider_enabled and provider_configured and fallback_mock:
            mock_query = {**base_query}
            mock_query.pop("provider", None)
            jobs = await _fetch(mock_query, limit)
            total = await db.jobs.count_documents(mock_query)
            auto_apply_count = sum(1 for j in jobs if j.get("auto_apply_supported") is True)
        if not jobs:
            logger.info("No jobs found for feed; provider refresh result=%s", refresh_result)
            empty_fallback_reason = (
                "provider_rate_limited"
                if provider_rate_limited
                else "no_auto_apply_jobs_found" if not include_non_auto_apply else "No jobs found with these filters. Try widening your search distance or changing your location."
            )
            return {
                "jobs": [],
                "total": 0,
                "feed_mode": "auto_apply_only" if not include_non_auto_apply else "mixed",
                "auto_apply_count": 0,
                "total_count": 0,
                "fallback_reason": empty_fallback_reason,
                "searched_location": refresh_result.get("searched_location") or request_location or profile.get("target_location"),
                "searched_locations": selected_location_labels,
                "search_radius": search_radius,
                "suggested_next_radius": refresh_result.get("suggested_next_radius"),
                "only_my_country": only_my_country,
                "widened_search": widened_search or bool(refresh_result.get("widened_search")),
                "original_location": request_location or profile.get("target_location"),
                "final_location_used": final_location_used,
                "provider_rate_limited": provider_rate_limited,
                "provider_cooldown_until": provider_cooldown_until,
                "matched_role": target_role or None,
                "matched_location": selected_location_labels or ([request_location] if request_location else []),
                "companies_returned": [],
                "filters_applied": filters_applied,
            }

    # AI scoring batch — slow (5-12s for Claude). Off by default for snappy UX.
    score_map: Dict[str, Dict[str, Any]] = {}
    if score:
        try:
            matches = await claude_score_jobs(profile, jobs)
            score_map = {m["job_id"]: m for m in matches}
        except LLMProviderNotConfigured as e:
            raise HTTPException(status_code=502, detail=str(e))
        except Exception as e:
            logger.exception("Match scoring failed")
            raise HTTPException(status_code=502, detail="AI job scoring failed")

    enriched = []
    for j in jobs:
        m = score_map.get(j["job_id"], {})
        clean_job = {k: v for k, v in j.items() if not k.startswith("_feed_") and not k.startswith("_role_") and not k.startswith("_location_")}
        enriched.append({
            **clean_job,
            "match_score": m.get("score") or random.randint(78, 96),
            "match_reasons": m.get("reasons") or ["Strong alignment with your skills."],
        })
    if fallback_reason is None and feed_mode == "auto_apply_only":
        fallback_reason = None
    logger.info(
        "jobs/feed complete: user_id=%s elapsed_ms=%s returned=%s total=%s feed_mode=%s fallback_reason=%s",
        user.user_id,
        int((time.perf_counter() - started_at) * 1000),
        len(enriched),
        total,
        feed_mode,
        fallback_reason,
    )
    return {
        "jobs": enriched,
        "total": total,
        "feed_mode": feed_mode,
        "auto_apply_count": auto_apply_count,
        "total_count": total_all,
        "fallback_reason": fallback_reason,
        "searched_location": refresh_result.get("searched_location") or request_location or profile.get("target_location"),
        "searched_locations": selected_location_labels,
        "search_radius": search_radius,
        "suggested_next_radius": refresh_result.get("suggested_next_radius"),
        "only_my_country": only_my_country,
        "widened_search": widened_search or bool(refresh_result.get("widened_search")),
        "original_location": request_location or profile.get("target_location"),
        "final_location_used": final_location_used,
        "provider_rate_limited": provider_rate_limited,
        "provider_cooldown_until": provider_cooldown_until,
        "matched_role": target_role or None,
        "matched_location": selected_location_labels or ([request_location] if request_location else []),
        "companies_returned": companies_returned,
        "filters_applied": filters_applied,
    }


@api_router.post("/swipe")
async def swipe(req: SwipeRequest, user: User = Depends(get_current_user)):
    phase = "swipe_start"

    def log_phase(name: str, **extra: Any) -> None:
        safe_extra = {
            key: value
            for key, value in extra.items()
            if key not in {"cv_text", "cover_letter", "tailored_cover_letter", "prompt", "tokens"}
        }
        logger.info(
            "swipe_phase=%s user_id=%s job_id=%s direction=%s provider=%s extra=%s",
            name,
            user.user_id,
            req.job_id,
            req.direction,
            DATABASE_PROVIDER,
            safe_extra,
        )

    def safe_error(exc: Exception) -> HTTPException:
        message = str(exc).strip() or "Swipe failed"
        if len(message) > 500:
            message = message[:500]
        logger.exception(
            "swipe_failed phase=%s user_id=%s job_id=%s direction=%s exception=%s",
            phase,
            user.user_id,
            req.job_id,
            req.direction,
            exc.__class__.__name__,
        )
        return HTTPException(
            status_code=getattr(exc, "status_code", 500) if isinstance(exc, HTTPException) else 500,
            detail={
                "phase": phase,
                "exception_class": exc.__class__.__name__,
                "message": message,
            },
        )

    try:
        log_phase("swipe_start")
        phase = "auth_ok"
        log_phase("auth_ok")

        if req.direction == "right" and user.demo_account:
            existing = await db.swipes.find_one(
                {"user_id": user.user_id, "job_id": req.job_id},
                {"_id": 0, "swipe_id": 1},
            )
            if not existing:
                await db.swipes.insert_one({
                    "user_id": user.user_id,
                    "job_id": req.job_id,
                    "direction": req.direction,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            log_phase("demo_account_apply_blocked")
            return {
                "ok": True,
                "applied": True,
                "submitted": False,
                "demo_account": True,
                "duplicate": bool(existing),
            }

        phase = "job_loaded"
        job = await db.jobs.find_one({"job_id": req.job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job = _with_apply_fulfillment_fields(job)
        log_phase(
            "job_loaded",
            job_provider=job.get("provider"),
            ats_provider=job.get("ats_provider"),
            apply_fulfillment_status=job.get("apply_fulfillment_status"),
            has_description=bool(job.get("description") or job.get("clean_description")),
            job_keys=sorted(list(job.keys()))[:60],
        )

        billing_credit_status = None
        if req.direction == "right":
            phase = "pre_apply_validation"
            log_phase("pre_apply_validation_start")
            pre_apply = await validate_job_before_application(job)
            job = _with_apply_fulfillment_fields(pre_apply.get("job") or job)
            if not pre_apply.get("allowed"):
                log_phase(
                    "pre_apply_validation_blocked",
                    reason=pre_apply.get("reason"),
                    validation_status=pre_apply.get("validation_status"),
                    applyability_tier=pre_apply.get("applyability_tier"),
                    selected_apply_url=pre_apply.get("selected_apply_url"),
                    requires_login=pre_apply.get("requires_login"),
                    requires_account_creation=pre_apply.get("requires_account_creation"),
                    captcha_detected=pre_apply.get("captcha_detected"),
                    credit_skipped=True,
                    application_skipped=True,
                )
                raise HTTPException(
                    status_code=422,
                    detail={
                        "success": False,
                        "ok": False,
                        "blocked": True,
                        "reason": pre_apply.get("reason"),
                        "message": pre_apply.get("reason"),
                        "job_id": req.job_id,
                        "validation_status": pre_apply.get("validation_status"),
                        "applyability_tier": pre_apply.get("applyability_tier"),
                        "selected_apply_url": pre_apply.get("selected_apply_url"),
                        "requires_login": pre_apply.get("requires_login"),
                        "requires_account_creation": pre_apply.get("requires_account_creation"),
                        "captcha_detected": pre_apply.get("captcha_detected"),
                    },
                )
            log_phase(
                "pre_apply_validation_allowed",
                validation_status=pre_apply.get("validation_status"),
                applyability_tier=pre_apply.get("applyability_tier"),
                selected_apply_url=pre_apply.get("selected_apply_url"),
            )
            if not _job_is_applyable(job):
                log_phase(
                    "apply_fulfillment_blocked",
                    apply_fulfillment_status=job.get("apply_fulfillment_status"),
                    apply_fulfillment_reason=job.get("apply_fulfillment_reason"),
                    source=job.get("source"),
                    external_url=job.get("external_url"),
                )
                raise HTTPException(
                    status_code=422,
                    detail={
                        "message": "This job cannot be fulfilled by Hirly.",
                        "apply_fulfillment_status": job.get("apply_fulfillment_status"),
                        "apply_fulfillment_reason": job.get("apply_fulfillment_reason"),
                    },
                )
            phase = "billing_credit_check"
            billing_credit_status = await _billing_apply_credit_status(user)
            if not billing_credit_status.get("is_premium") or int(billing_credit_status.get("credits_remaining") or 0) <= 0:
                log_phase("billing_credit_blocked", billing=billing_credit_status)
                raise HTTPException(
                    status_code=402,
                    detail={
                        "message": "No application credits remaining",
                        "billing": billing_credit_status,
                    },
                )
            log_phase("billing_credit_ok", billing=billing_credit_status)

        phase = "swipe_record_insert_start"
        existing = await db.swipes.find_one({"user_id": user.user_id, "job_id": req.job_id}, {"_id": 0})
        log_phase("swipe_record_insert_start", duplicate=bool(existing))
        if not existing:
            await db.swipes.insert_one({
                "user_id": user.user_id,
                "job_id": req.job_id,
                "direction": req.direction,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        phase = "swipe_record_insert_done"
        log_phase("swipe_record_insert_done", duplicate=bool(existing))

        if req.direction != "right":
            phase = "response_build_start"
            log_phase("response_build_start")
            response = {"ok": True, "applied": False, "duplicate": bool(existing)}
            phase = "response_build_done"
            log_phase("response_build_done")
            phase = "swipe_complete"
            log_phase("swipe_complete")
            return response

        profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
        if not profile:
            raise HTTPException(status_code=400, detail="Profile required")

        existing_app = await db.applications.find_one({"user_id": user.user_id, "job_id": req.job_id}, {"_id": 0})
        if existing_app:
            normalized = _normalize_application_status_fields(existing_app)
            if normalized.get("generation_status") in {"pending_generation", "generating"}:
                _schedule_application_generation(user.user_id)
            duplicate_lengths = _application_text_lengths(normalized)
            phase = "response_build_start"
            log_phase(
                "response_build_start",
                duplicate_application=True,
                application_id=normalized.get("application_id"),
                ats_provider=job.get("ats_provider"),
                package_status=normalized.get("package_status"),
                submission_status=normalized.get("submission_status"),
                **duplicate_lengths,
            )
            response = {
                "ok": True,
                "applied": True,
                "submitted": normalized.get("submission_status") == "submitted",
                "duplicate": bool(existing),
                "application_id": normalized["application_id"],
                "package_status": normalized["package_status"],
                "application_status": normalized["package_status"],
                "submission_status": normalized["submission_status"],
                "manual_status": _effective_manual_status(normalized),
                "manual_fulfillment": _manual_application_fulfillment_enabled(),
                "queued_for_generation": normalized.get("generation_status") in {"pending_generation", "generating"},
                "generation_status": normalized.get("generation_status"),
                "billing": billing_credit_status,
            }
            phase = "response_build_done"
            log_phase(
                "response_build_done",
                duplicate_application=True,
                application_id=normalized.get("application_id"),
                status_returned_to_frontend=normalized.get("submission_status"),
            )
            phase = "swipe_complete"
            log_phase(
                "swipe_complete",
                duplicate_application=True,
                application_id=normalized.get("application_id"),
                status_returned_to_frontend=normalized.get("submission_status"),
            )
            return response

        phase = "application_queue_start"
        log_phase("application_queue_start")
        doc = _pending_application_doc(user, job)

        phase = "application_upsert_start"
        log_phase("application_upsert_start", application_id=doc.get("application_id"))
        await db.applications.update_one(
            {"user_id": user.user_id, "job_id": req.job_id},
            {"$setOnInsert": doc},
            upsert=True,
        )
        saved_doc = None
        application_id_doc = None
        user_job_doc = None
        if doc.get("application_id"):
            application_id_doc = await db.applications.find_one({"application_id": doc["application_id"]}, {"_id": 0})
        log_phase(
            "application_verify_by_application_id_found",
            application_id=doc.get("application_id"),
            found=bool(application_id_doc),
        )
        user_job_doc = await db.applications.find_one({"user_id": user.user_id, "job_id": req.job_id}, {"_id": 0})
        log_phase(
            "application_verify_by_user_job_found",
            application_id=(user_job_doc or {}).get("application_id"),
            found=bool(user_job_doc),
        )
        if application_id_doc:
            saved_doc = application_id_doc
            log_phase("application_verify_fallback_used", fallback="application_id_primary")
        elif user_job_doc:
            saved_doc = user_job_doc
            log_phase("application_verify_fallback_used", fallback="user_job_secondary")
        if not saved_doc:
            logger.warning(
                "application_verification_failed user_id=%s job_id=%s application_id=%s insert_returned_without_readback=true",
                user.user_id,
                req.job_id,
                doc.get("application_id"),
            )
            log_phase("verification_failed", application_id=doc.get("application_id"))
            saved_doc = doc
        saved_doc = _normalize_application_status_fields(saved_doc)
        browser_prepare_started = False

        phase = "application_upsert_done"
        credit_result = await _consume_application_credit(user.user_id)
        _schedule_application_generation(user.user_id)
        log_phase(
            "application_upsert_done",
            application_id=saved_doc.get("application_id"),
            ats_provider=job.get("ats_provider"),
            package_status=saved_doc.get("package_status"),
            **_application_text_lengths(saved_doc),
            browser_prepare_started=browser_prepare_started,
            final_submission_status_saved=saved_doc.get("submission_status"),
            submission_status=saved_doc.get("submission_status"),
            credits_remaining=credit_result.get("credits_remaining"),
            manual_fulfillment=_manual_application_fulfillment_enabled(),
            queued_for_generation=True,
        )

        phase = "response_build_start"
        log_phase(
            "response_build_start",
            application_id=saved_doc.get("application_id"),
            package_status=saved_doc.get("package_status"),
            submission_status=saved_doc.get("submission_status"),
        )
        response = {
            "ok": True,
            "applied": True,
            "submitted": False,
            "duplicate": bool(existing),
            "application_id": saved_doc["application_id"],
            "package_status": saved_doc["package_status"],
            "application_status": saved_doc["package_status"],
            "submission_status": saved_doc["submission_status"],
            "generation_status": saved_doc.get("generation_status"),
            "queued_for_generation": True,
            "manual_status": _effective_manual_status(saved_doc),
            "manual_fulfillment": _manual_application_fulfillment_enabled(),
            "billing": credit_result,
        }
        phase = "response_build_done"
        log_phase(
            "response_build_done",
            application_id=saved_doc.get("application_id"),
            status_returned_to_frontend=response.get("submission_status"),
        )
        phase = "swipe_complete"
        log_phase(
            "swipe_complete",
            application_id=saved_doc.get("application_id"),
            status_returned_to_frontend=response.get("submission_status"),
        )
        return response
    except LLMProviderNotConfigured as exc:
        phase = "application_generation_start"
        raise HTTPException(
            status_code=502,
            detail={
                "phase": phase,
                "exception_class": exc.__class__.__name__,
                "message": str(exc),
            },
        ) from exc
    except HTTPException as exc:
        if exc.status_code == 402 or (exc.status_code == 422 and isinstance(exc.detail, dict) and exc.detail.get("blocked") is True):
            raise exc
        raise safe_error(exc) from exc
    except Exception as exc:
        raise safe_error(exc) from exc


@api_router.get("/swipes/history")
async def swipes_history(
    user: User = Depends(get_current_user),
    direction: Optional[str] = None,  # "left" | "right" | None=all
    limit: int = 100,
):
    """Return the user's swipe history with the joined job doc.
    direction='left' → SKIP (we'll surface as 'Skipped Jobs')
    direction='right' → APPLY (alias for /applications minimal)."""
    q: Dict[str, Any] = {"user_id": user.user_id}
    if direction in ("left", "right"):
        q["direction"] = direction
    rows = await db.swipes.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    if not rows:
        return {"swipes": []}
    job_ids = list({r["job_id"] for r in rows})
    jobs = await db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0}).to_list(len(job_ids))
    job_map = {j["job_id"]: j for j in jobs}
    return {
        "swipes": [
            {**r, "job": job_map.get(r["job_id"])} for r in rows
        ],
    }


@api_router.delete("/swipes/{job_id}")
async def delete_swipe(job_id: str, user: User = Depends(get_current_user)):
    """Remove a swipe so the job can re-enter the feed (used by 'Apply Now' from history)."""
    res = await db.swipes.delete_one({"user_id": user.user_id, "job_id": job_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No such swipe")
    return {"ok": True}


@api_router.post("/swipe/undo")
async def undo_swipe(user: User = Depends(get_current_user)):
    last = await db.swipes.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).limit(1).to_list(1)
    if not last:
        return {"ok": False}
    last = last[0]
    await db.swipes.delete_one({"user_id": user.user_id, "job_id": last["job_id"]})
    if last["direction"] == "right":
        await db.applications.delete_one({"user_id": user.user_id, "job_id": last["job_id"]})
    return {"ok": True, "job_id": last["job_id"]}


# ===================== Applications =====================

def _application_effective_timestamp(app_doc: Dict[str, Any]) -> datetime:
    for key in ("submitted_at", "manual_status_updated_at", "updated_at", "created_at"):
        value = app_doc.get(key)
        if not value:
            continue
        if isinstance(value, datetime):
            parsed = value
        else:
            try:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError:
                continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    return datetime.min.replace(tzinfo=timezone.utc)


def _sort_applications_newest_first(apps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(apps, key=_application_effective_timestamp, reverse=True)


@api_router.get("/applications")
async def list_applications(user: User = Depends(get_current_user)):
    apps = await db.applications.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    apps = _sort_applications_newest_first(apps)
    # join job data
    job_ids = list({a["job_id"] for a in apps if a.get("job_id")})
    jobs = await db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0}).to_list(500) if job_ids else []
    job_map = {j["job_id"]: j for j in jobs}
    result = []
    for a in apps:
        a = _normalize_application_status_fields(a)
        result.append(_public_application_doc(a, job_map.get(a["job_id"])))
    return {"applications": result}


async def require_admin_user(user: User = Depends(get_current_user)) -> User:
    if _is_admin_email(user.email):
        return user

    raise HTTPException(status_code=403, detail="Admin access denied")


def _env_email_set(name: str) -> set[str]:
    return {
        item.strip().lower()
        for item in os.environ.get(name, "").split(",")
        if item.strip()
    }


def _env_enabled(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


def _greenhouse_real_submit_allowed_emails() -> set[str]:
    explicit = _env_email_set("REAL_SUBMIT_ALLOWED_EMAILS")
    return explicit or _env_email_set("ADMIN_EMAILS")


def _manual_application_fulfillment_enabled() -> bool:
    return _env_enabled("MANUAL_APPLICATION_FULFILLMENT", "true")


def _require_job_maintenance_enabled() -> None:
    if not job_cache_env_bool("JOBS_MAINTENANCE_ENABLED", True):
        raise HTTPException(status_code=403, detail="Job maintenance endpoints are disabled.")


def _require_ats_direct_enabled() -> None:
    _require_job_maintenance_enabled()
    if not job_cache_env_bool("JOBS_ATS_DIRECT_ENABLED", True):
        raise HTTPException(status_code=403, detail="Direct ATS refresh endpoints are disabled.")


@api_router.post("/admin/jobs/refresh")
async def admin_jobs_refresh(body: AdminJobsRefreshRequest, admin: User = Depends(require_admin_user)):
    _require_job_maintenance_enabled()
    logger.info(
        "admin_jobs_refresh_requested admin=%s role=%s location=%s country_code=%s dry_run=%s",
        admin.email,
        body.search_role,
        body.location,
        body.country_code,
        body.dry_run,
    )
    return await refresh_jobs_for_query_or_filters(
        db,
        search_role=body.search_role,
        location=body.location,
        country_code=body.country_code,
        remote=body.remote,
        limit=body.limit,
        dry_run=body.dry_run,
    )


@api_router.post("/admin/jobs/revalidate")
async def admin_jobs_revalidate(body: AdminJobsRevalidateRequest, admin: User = Depends(require_admin_user)):
    _require_job_maintenance_enabled()
    logger.info(
        "admin_jobs_revalidate_requested admin=%s validation_status=%s tier=%s country_code=%s dry_run=%s",
        admin.email,
        body.validation_status,
        body.applyability_tier,
        body.country_code,
        body.dry_run,
    )
    return await revalidate_cached_jobs(
        db,
        validation_status=body.validation_status,
        applyability_tier=body.applyability_tier,
        older_than_hours=body.older_than_hours,
        country_code=body.country_code,
        limit=body.limit,
        dry_run=body.dry_run,
    )


@api_router.post("/admin/jobs/expire-stale")
async def admin_jobs_expire_stale(body: AdminJobsExpireStaleRequest, admin: User = Depends(require_admin_user)):
    _require_job_maintenance_enabled()
    logger.info(
        "admin_jobs_expire_stale_requested admin=%s older_than_days=%s provider=%s country_code=%s dry_run=%s",
        admin.email,
        body.older_than_days,
        body.provider,
        body.country_code,
        body.dry_run,
    )
    return await expire_stale_jobs(
        db,
        older_than_days=body.older_than_days,
        provider=body.provider,
        country_code=body.country_code,
        limit=body.limit,
        dry_run=body.dry_run,
    )


@api_router.post("/admin/jobs/maintenance")
async def admin_jobs_maintenance(body: AdminJobsMaintenanceRequest, admin: User = Depends(require_admin_user)):
    _require_job_maintenance_enabled()
    logger.info(
        "admin_jobs_maintenance_requested admin=%s dry_run=%s refresh_popular=%s",
        admin.email,
        body.dry_run,
        body.refresh_popular,
    )
    return await run_job_cache_maintenance(
        db,
        dry_run=body.dry_run,
        refresh_popular=body.refresh_popular,
    )


@api_router.get("/admin/jobs/cache-status")
async def admin_jobs_cache_status(admin: User = Depends(require_admin_user)):
    _require_job_maintenance_enabled()
    logger.info("admin_jobs_cache_status_requested admin=%s", admin.email)
    return await job_cache_status(db)


@api_router.post("/admin/jobs/ats/discover-sources")
async def admin_jobs_ats_discover_sources(body: AdminAtsDiscoverSourcesRequest, admin: User = Depends(require_admin_user)):
    _require_ats_direct_enabled()
    logger.info(
        "admin_jobs_ats_discover_requested admin=%s provider=%s country_code=%s limit=%s dry_run=%s",
        admin.email,
        body.provider,
        body.country_code,
        body.limit,
        body.dry_run,
    )
    return await discover_ats_sources_from_cached_jobs(
        db,
        provider=body.provider,
        country_code=body.country_code,
        limit=body.limit,
        dry_run=body.dry_run,
    )


@api_router.post("/admin/jobs/ats/refresh-source")
async def admin_jobs_ats_refresh_source(body: AdminAtsRefreshSourceRequest, admin: User = Depends(require_admin_user)):
    _require_ats_direct_enabled()
    logger.info(
        "admin_jobs_ats_refresh_source_requested admin=%s provider=%s source_key=%s limit=%s dry_run=%s",
        admin.email,
        body.ats_provider,
        body.source_key,
        body.limit,
        body.dry_run,
    )
    return await refresh_ats_source(
        db,
        ats_provider=body.ats_provider,
        source_key=body.source_key,
        limit=body.limit,
        dry_run=body.dry_run,
    )


@api_router.post("/admin/jobs/ats/refresh-known-sources")
async def admin_jobs_ats_refresh_known_sources(body: AdminAtsRefreshKnownSourcesRequest, admin: User = Depends(require_admin_user)):
    _require_ats_direct_enabled()
    logger.info(
        "admin_jobs_ats_refresh_known_requested admin=%s provider=%s country_code=%s limit=%s older_than_hours=%s dry_run=%s",
        admin.email,
        body.provider,
        body.country_code,
        body.limit,
        body.older_than_hours,
        body.dry_run,
    )
    return await refresh_known_ats_sources(
        db,
        provider=body.provider,
        country_code=body.country_code,
        limit=body.limit,
        older_than_hours=body.older_than_hours,
        dry_run=body.dry_run,
    )


def _require_greenhouse_real_submit_allowed(user: User) -> None:
    if not _env_enabled("GREENHOUSE_REAL_SUBMIT_ENABLED", "false"):
        raise HTTPException(status_code=403, detail="Real Greenhouse submit is disabled.")
    allowed_emails = _greenhouse_real_submit_allowed_emails()
    user_email = (user.email or "").strip().lower()
    if not user_email or user_email not in allowed_emails:
        logger.warning("greenhouse_real_submit_denied user_id=%s email=%s", user.user_id, user.email)
        raise HTTPException(status_code=403, detail="Real Greenhouse submit is not allowed for this account.")


def _admin_status_filter(filter_value: Optional[str]) -> Optional[set[str]]:
    if not filter_value or filter_value == "all":
        return None
    mapping = {
        "action_required": {"action_required"},
        "blocked": {"blocked"},
        "blocked_captcha": {"blocked_captcha"},
        "prepare_failed": {"prepare_failed"},
        "prepared": {"prepared", "ready"},
        "submitted": {"submitted"},
    }
    return mapping.get(filter_value)


MANUAL_STATUSES = {"manual_review_needed", "manual_in_progress", "manually_submitted", "manual_blocked", "needs_user_input"}


def _has_remaining_user_questions(app_doc: Dict[str, Any]) -> bool:
    return bool(app_doc.get("prepared_missing_information") or app_doc.get("required_questions"))


def _effective_manual_status(app_doc: Dict[str, Any]) -> Optional[str]:
    manual_status = app_doc.get("manual_status") or app_doc.get("admin_status")
    if manual_status in MANUAL_STATUSES:
        return manual_status
    if app_doc.get("submission_status") in {"prepare_failed", "blocked", "blocked_captcha", "failed"} and not _has_remaining_user_questions(app_doc):
        return "manual_review_needed"
    return None


def _user_facing_submission_status(app_doc: Dict[str, Any]) -> str:
    if app_doc.get("submission_status") == "submitted" or _effective_manual_status(app_doc) == "manually_submitted":
        return "submitted"
    if _effective_manual_status(app_doc) in {"manual_review_needed", "manual_in_progress", "manual_blocked"}:
        return "pending"
    return app_doc.get("submission_status") or "not_submitted"


def _public_application_doc(app_doc: Dict[str, Any], job_doc: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    public_doc = dict(_normalize_application_status_fields(app_doc))
    public_doc["user_facing_submission_status"] = _user_facing_submission_status(public_doc)
    for key in (
        "admin_status",
        "manual_status",
        "assigned_to",
        "assigned_to_user_id",
        "assigned_at",
        "admin_notes",
        "admin_timeline",
        "admin_status_updated_by",
        "admin_status_updated_at",
        "manual_status_updated_by",
        "manual_status_updated_at",
    ):
        public_doc.pop(key, None)
    if job_doc is not None:
        public_doc["job"] = job_doc
    return public_doc


def _job_application_url(job_doc: Optional[Dict[str, Any]]) -> Optional[str]:
    if not job_doc:
        return None
    for key in ("application_url", "external_url", "source_url", "url", "absolute_url", "job_url"):
        value = job_doc.get(key)
        if value:
            return value
    data = job_doc.get("data") if isinstance(job_doc.get("data"), dict) else {}
    for key in ("application_url", "external_url", "source_url", "url", "absolute_url", "job_url"):
        value = data.get(key)
        if value:
            return value
    return None


def _append_admin_timeline(app_doc: Dict[str, Any], event: Dict[str, Any]) -> List[Dict[str, Any]]:
    timeline = list(app_doc.get("admin_timeline") or [])
    timeline.append(event)
    return timeline[-100:]


def _admin_doc_metadata(app_doc: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tailored_cv_available": bool(app_doc.get("tailored_cv_file_b64") or app_doc.get("tailored_resume_structured") or app_doc.get("tailored_resume")),
        "tailored_cv_filename": app_doc.get("tailored_cv_filename"),
        "tailored_cv_mime": app_doc.get("tailored_cv_mime"),
        "cover_letter_available": bool(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter")),
        "cover_letter_format": "text" if (app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter")) else None,
        **_application_text_lengths(app_doc),
    }


def _admin_application_row(app_doc: Dict[str, Any], user_doc: Optional[Dict[str, Any]], job_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    app_doc = _normalize_application_status_fields(app_doc)
    return {
        "application_id": app_doc.get("application_id"),
        "user_id": app_doc.get("user_id"),
        "user_email": (user_doc or {}).get("email"),
        "company": (job_doc or {}).get("company") or app_doc.get("company"),
        "title": (job_doc or {}).get("title") or app_doc.get("title"),
        "ats_provider": (job_doc or {}).get("ats_provider") or app_doc.get("submission_provider"),
        "submission_status": app_doc.get("submission_status"),
        "user_facing_submission_status": _user_facing_submission_status(app_doc),
        "package_status": app_doc.get("package_status"),
        "admin_status": app_doc.get("admin_status"),
        "manual_status": _effective_manual_status(app_doc),
        "assigned_to": app_doc.get("assigned_to"),
        "assigned_at": app_doc.get("assigned_at"),
        "created_at": app_doc.get("created_at"),
        "updated_at": app_doc.get("updated_at") or app_doc.get("created_at"),
    }


def _parse_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _is_today(value: Any) -> bool:
    dt = _parse_dt(value)
    if not dt:
        return False
    return dt.astimezone(timezone.utc).date() == datetime.now(timezone.utc).date()


def _profile_completion(profile: Optional[Dict[str, Any]]) -> int:
    if not profile:
        return 0
    checks = [
        bool(profile.get("cv_text")),
        bool(profile.get("target_role") or profile.get("target_roles")),
        bool(profile.get("target_location") or profile.get("target_location_data")),
        bool((profile.get("application_answers_profile") or {}) or (profile.get("application_defaults") or {})),
    ]
    return int(round((sum(1 for item in checks if item) / len(checks)) * 100))


def _attention_status(status: Optional[str]) -> bool:
    return status in {"action_required", "blocked", "blocked_captcha", "prepare_failed", "failed"}


def _ats_bucket(value: Optional[str]) -> str:
    normalized = (value or "unknown").strip().lower()
    if normalized in {"greenhouse", "lever", "ashby"}:
        return normalized
    return "unknown"


def _admin_blocker_labels(app_doc: Dict[str, Any]) -> List[str]:
    raw = app_doc.get("prepared_missing_information") or app_doc.get("prepared_blockers")
    if raw is None:
        fallback = app_doc.get("submission_error") or app_doc.get("submission_status") or "Unknown blocker"
        return [str(fallback).strip() or "Unknown blocker"]
    if isinstance(raw, str):
        return [raw.strip() or "Unknown blocker"]
    if isinstance(raw, dict):
        label = raw.get("label") or raw.get("field_label") or raw.get("field_name") or raw.get("reason")
        return [str(label or raw).strip() or "Unknown blocker"]
    if not isinstance(raw, list):
        return [str(raw).strip() or "Unknown blocker"]
    labels: List[str] = []
    for blocker in raw:
        if isinstance(blocker, dict):
            label = blocker.get("label") or blocker.get("field_label") or blocker.get("field_name") or blocker.get("reason")
        else:
            label = str(blocker or "")
        label = (label or "Unknown blocker").strip()
        labels.append(label)
    return labels or ["Unknown blocker"]


async def _admin_safe_find(
    collection,
    filter: Optional[Dict[str, Any]] = None,
    limit: int = 10000,
    sort: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    name = getattr(collection, "name", None) or getattr(collection, "table_name", "unknown")
    try:
        cursor = collection.find(filter or {}, {"_id": 0})
        if sort is not None and hasattr(cursor, "sort"):
            cursor = cursor.sort(sort)
        if hasattr(cursor, "limit"):
            cursor = cursor.limit(limit)
        return await cursor.to_list(limit)
    except Exception as exc:
        logger.warning("admin_safe_find_failed collection=%s error=%s", name, str(exc)[:200])
        return []


async def _admin_safe_find_one(collection, filter: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    name = getattr(collection, "name", None) or getattr(collection, "table_name", "unknown")
    try:
        return await collection.find_one(filter, {"_id": 0})
    except Exception as exc:
        logger.warning("admin_safe_find_one_failed collection=%s error=%s", name, str(exc)[:200])
        return None


async def _admin_jobs_for_ids(job_ids: List[str]) -> List[Dict[str, Any]]:
    unique_ids = list(dict.fromkeys(job_id for job_id in job_ids if job_id))
    if not unique_ids:
        return []
    jobs: List[Dict[str, Any]] = []
    chunk_size = 80
    for index in range(0, len(unique_ids), chunk_size):
        chunk = unique_ids[index:index + chunk_size]
        jobs.extend(await _admin_safe_find(db.jobs, {"job_id": {"$in": chunk}}, limit=len(chunk)))
    return jobs


async def _admin_base_data(
    *,
    include_swipes: bool = True,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    users = await _admin_safe_find(db.users)
    profiles = await _admin_safe_find(db.profiles)
    swipes = await _admin_safe_find(db.swipes) if include_swipes else []
    applications = await _admin_safe_find(db.applications)
    job_ids = list({app.get("job_id") for app in applications if app.get("job_id")})
    jobs = await _admin_jobs_for_ids(job_ids)
    return users, profiles, swipes, applications, jobs


async def _find_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    normalized = (email or "").strip().lower()
    if not normalized:
        return None
    user_doc = await db.users.find_one({"email": normalized}, {"_id": 0})
    if user_doc:
        return user_doc
    users = await _admin_safe_find(db.users)
    for user_doc in users:
        if (user_doc.get("email") or "").strip().lower() == normalized:
            return user_doc
    return None


async def _set_user_demo_account(user_id: str, demo_account: bool) -> None:
    now = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"demo_account": demo_account, "updated_at": now}},
    )
    if getattr(result, "matched_count", 0) == 0:
        raise HTTPException(status_code=404, detail="User not found")


async def _set_user_training_access(user_id: str, training_access: bool) -> None:
    now = datetime.now(timezone.utc).isoformat()
    result = await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"training_access": training_access, "updated_at": now}},
    )
    if getattr(result, "matched_count", 0) == 0:
        raise HTTPException(status_code=404, detail="User not found")


def _admin_email_set() -> set[str]:
    return {"anto.delbos@gmail.com"} | _env_email_set("ADMIN_EMAILS")


def _is_admin_email(email: Optional[str]) -> bool:
    normalized = (email or "").strip().lower()
    return bool(normalized and normalized in _admin_email_set())


async def _resolve_training_access(user: User) -> bool:
    from training_access import user_has_training_access
    return await user_has_training_access(
        db,
        user,
        is_admin_email=_is_admin_email,
        is_training_creator=is_training_creator,
        tutorial_user_id=TUTORIAL_FILMING_USER_ID,
    )


async def _get_training_access_payload(user: User = Depends(get_current_user)) -> Dict[str, Any]:
    return await training_access_payload(
        db,
        user,
        is_admin_email=_is_admin_email,
        is_training_creator=is_training_creator,
        tutorial_user_id=TUTORIAL_FILMING_USER_ID,
    )


async def _require_training_user(user: User = Depends(get_current_user)) -> User:
    return await require_training_access(
        db,
        user,
        is_admin_email=_is_admin_email,
        is_training_creator=is_training_creator,
        tutorial_user_id=TUTORIAL_FILMING_USER_ID,
    )


async def _analytics_events() -> List[Dict[str, Any]]:
    try:
        return await db.analytics_events.find({}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    except Exception as exc:
        logger.warning("analytics_events_read_failed error=%s", str(exc)[:200])
        return []


def _event_actor(event_doc: Dict[str, Any]) -> str:
    return str(event_doc.get("user_id") or event_doc.get("anonymous_id") or event_doc.get("event_id") or "")


def _unique_event_actors(events: List[Dict[str, Any]], event_name: str) -> set[str]:
    return {_event_actor(item) for item in events if item.get("event") == event_name and _event_actor(item)}


def _event_count(events: List[Dict[str, Any]], event_name: str) -> int:
    return sum(1 for item in events if item.get("event") == event_name)


def _series_counts(items: List[Dict[str, Any]], days: int, date_getter, predicate=lambda item: True) -> List[Dict[str, Any]]:
    today = datetime.now(timezone.utc).date()
    buckets = {(today - timedelta(days=offset)).isoformat(): 0 for offset in range(days - 1, -1, -1)}
    for item in items:
        if not predicate(item):
            continue
        dt = _parse_dt(date_getter(item))
        if not dt:
            continue
        key = dt.astimezone(timezone.utc).date().isoformat()
        if key in buckets:
            buckets[key] += 1
    return [{"date": key, "count": value} for key, value in buckets.items()]


def _rate(numerator: int, denominator: int) -> float:
    if not denominator:
        return 0.0
    return round((numerator / denominator) * 100, 1)


@api_router.get("/admin/overview")
async def admin_overview(admin: User = Depends(require_admin_user)):
    users, profiles, _swipes, applications, jobs = await _admin_base_data(include_swipes=False)
    normalized_apps = [_normalize_application_status_fields(app_doc) for app_doc in applications]
    user_map = {item.get("user_id"): item for item in users}
    job_map = {item.get("job_id"): item for item in jobs}
    prepared_statuses = {"ready", "prepared"}
    failed_blocked_statuses = {"failed", "blocked", "blocked_captcha", "prepare_failed"}
    generated_count = sum(1 for app_doc in normalized_apps if app_doc.get("package_status") in {"generated", "generated_text_only"})
    prepared_count = sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") in prepared_statuses)
    submitted_count = sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") == "submitted")

    blocker_counts: Dict[str, int] = {}
    for app_doc in normalized_apps:
        if not _attention_status(app_doc.get("submission_status")):
            continue
        for label in _admin_blocker_labels(app_doc):
            blocker_counts[label] = blocker_counts.get(label, 0) + 1

    attention_apps = [
        app_doc
        for app_doc in normalized_apps
        if _attention_status(app_doc.get("submission_status"))
    ]
    attention_apps.sort(key=lambda item: _parse_dt(item.get("updated_at") or item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    return {
        "metrics": {
            "total_users": len(users),
            "new_users_today": sum(1 for user in users if _is_today(user.get("created_at"))),
            "applications_today": sum(1 for app_doc in normalized_apps if _is_today(app_doc.get("created_at"))),
            "prepared_applications": prepared_count,
            "action_required": sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") == "action_required"),
            "failed_blocked": sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") in failed_blocked_statuses),
            "submitted": submitted_count,
            "conversion": {
                "generated": generated_count,
                "prepared": prepared_count,
                "submitted": submitted_count,
            },
        },
        "top_blockers": [
            {"label": label, "count": count}
            for label, count in sorted(blocker_counts.items(), key=lambda item: item[1], reverse=True)[:8]
        ],
        "latest_attention": [
            _admin_application_row(app_doc, user_map.get(app_doc.get("user_id")), job_map.get(app_doc.get("job_id")))
            for app_doc in attention_apps[:10]
        ],
    }


@api_router.get("/admin/users")
async def admin_list_users(admin: User = Depends(require_admin_user)):
    users, profiles, _swipes, applications, _jobs = await _admin_base_data(include_swipes=False)
    profile_map = {item.get("user_id"): item for item in profiles}
    app_counts: Dict[str, int] = {}
    last_app_at: Dict[str, Any] = {}
    for app_doc in applications:
        uid = app_doc.get("user_id")
        if not uid:
            continue
        app_counts[uid] = app_counts.get(uid, 0) + 1
        candidate = app_doc.get("updated_at") or app_doc.get("created_at")
        if not last_app_at.get(uid) or (_parse_dt(candidate) or datetime.min.replace(tzinfo=timezone.utc)) > (_parse_dt(last_app_at[uid]) or datetime.min.replace(tzinfo=timezone.utc)):
            last_app_at[uid] = candidate

    rows = []
    for user_doc in users:
        uid = user_doc.get("user_id")
        profile = profile_map.get(uid)
        rows.append({
            "user_id": uid,
            "email": user_doc.get("email"),
            "name": user_doc.get("name"),
            "demo_account": bool(user_doc.get("demo_account")),
            "profile_completion": _profile_completion(profile),
            "cv_uploaded": bool((profile or {}).get("cv_text")),
            "total_applications": app_counts.get(uid, 0),
            "last_active_at": last_app_at.get(uid) or (profile or {}).get("updated_at") or user_doc.get("created_at"),
            "created_at": user_doc.get("created_at"),
            "plan": "Not connected",
        })
    rows.sort(key=lambda item: _parse_dt(item.get("last_active_at")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return {"users": rows}


@api_router.get("/admin/users/{user_id}")
async def admin_get_user(user_id: str, admin: User = Depends(require_admin_user)):
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    profile = await db.profiles.find_one({"user_id": user_id}, {"_id": 0})
    apps = await db.applications.find({"user_id": user_id}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    job_ids = list({app.get("job_id") for app in apps if app.get("job_id")})
    jobs = await db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0}).to_list(500) if job_ids else []
    job_map = {item.get("job_id"): item for item in jobs}
    return {
        "user": {
            **user_doc,
            "profile_completion": _profile_completion(profile),
            "cv_uploaded": bool((profile or {}).get("cv_text")),
            "plan": "Not connected",
        },
        "profile": profile,
        "contact": (profile or {}).get("contact") or {},
        "preferences": {
            "target_role": (profile or {}).get("target_role"),
            "target_roles": (profile or {}).get("target_roles") or [],
            "target_location": (profile or {}).get("target_location"),
            "remote_preference": (profile or {}).get("remote_preference"),
            "seniority": (profile or {}).get("seniority"),
        },
        "application_defaults": (profile or {}).get("application_defaults") or {},
        "applications": [
            _admin_application_row(app_doc, user_doc, job_map.get(app_doc.get("job_id")))
            for app_doc in apps
        ],
        "internal_notes": [],
    }


@api_router.patch("/admin/users/{user_id}/demo-account")
async def admin_set_demo_account(
    user_id: str,
    payload: Dict[str, Any],
    admin: User = Depends(require_admin_user),
):
    if "demo_account" not in payload:
        raise HTTPException(status_code=400, detail="demo_account is required")
    await _set_user_demo_account(user_id, bool(payload.get("demo_account")))
    return {"ok": True, "demo_account": bool(payload.get("demo_account"))}


@api_router.get("/admin/influencers")
async def admin_list_influencers(admin: User = Depends(require_admin_user)):
    rows = list_influencers()
    user_ids = [row.get("user_id") for row in rows if row.get("user_id")]
    user_map: Dict[str, Dict[str, Any]] = {}
    for uid in user_ids:
        user_doc = await _admin_safe_find_one(db.users, {"user_id": uid})
        if user_doc:
            user_map[uid] = user_doc
    enriched = []
    for row in rows:
        linked = user_map.get(row.get("user_id") or "")
        enriched.append({
            **row,
            "linked_email": (linked or {}).get("email"),
            "linked_demo_account": bool((linked or {}).get("demo_account")),
        })
    return {"influencers": enriched}


@api_router.post("/admin/influencers")
async def admin_create_influencer(payload: Dict[str, Any], admin: User = Depends(require_admin_user)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    row = create_influencer(payload)
    return {"ok": True, "influencer": row}


@api_router.patch("/admin/influencers/{influencer_id}")
async def admin_update_influencer(
    influencer_id: str,
    payload: Dict[str, Any],
    admin: User = Depends(require_admin_user),
):
    row = update_influencer(influencer_id, payload)
    if not row:
        raise HTTPException(status_code=404, detail="Influencer not found")
    return {"ok": True, "influencer": row}


async def _enrich_invite_rows_for_admin(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    user_ids = list({row.get("redeemed_by_user_id") for row in rows if row.get("redeemed_by_user_id")})
    users_by_id: Dict[str, Dict[str, Any]] = {}
    if user_ids:
        users = await db.users.find(
            {"user_id": {"$in": user_ids}},
            {"_id": 0, "user_id": 1, "email": 1, "name": 1},
        ).to_list(len(user_ids))
        users_by_id = {user["user_id"]: user for user in users if user.get("user_id")}
    return enrich_invite_rows(rows, users_by_id)


async def _redeem_creator_invite(code: str, user_id: str, user_email: Optional[str] = None) -> Dict[str, Any]:
    normalized = (code or "").strip()
    if not re.fullmatch(r"\d{6}", normalized):
        raise HTTPException(status_code=400, detail="Enter a valid 6-digit invitation code")

    check = await validate_invite(db, normalized)
    invitation = check.get("invitation") or await get_invite_by_code(db, normalized)
    if not invitation:
        invitation = await materialize_invite_from_link(db, normalized)
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.get("redeemed_by_user_id") and invitation.get("redeemed_by_user_id") != user_id:
        raise HTTPException(status_code=409, detail="This invitation was already used by another account")

    if not check.get("valid"):
        reason = check.get("reason")
        if reason == "revoked":
            raise HTTPException(status_code=410, detail="This invitation is no longer valid")
        raise HTTPException(status_code=400, detail="Invalid invitation code")

    influencer_id = invitation.get("influencer_id")
    course_id = invitation.get("course_id") or SEED_COURSE_ID
    invite_type = resolve_invite_type(invitation)
    grant_demo = invite_type in {INVITE_TYPE_DEMO, INVITE_TYPE_CREATOR}
    grant_training = invite_type in {INVITE_TYPE_TRAINING, INVITE_TYPE_CREATOR}

    enrollment = None
    if grant_demo:
        await _set_user_demo_account(user_id, True)
        await _ensure_demo_feed_profile(user_id)
    if grant_training:
        await _set_user_training_access(user_id, True)
        try:
            enrollment = await enroll_user(db, user_id, course_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    if influencer_id:
        influencer_patch: Dict[str, Any] = {
            "user_id": user_id,
            "status": "active",
            **({"email": user_email.strip().lower()} if user_email else {}),
        }
        if grant_demo:
            influencer_patch["demo_granted"] = True
        update_influencer(influencer_id, influencer_patch)

    if not invitation.get("redeemed_at"):
        await mark_invite_redeemed(db, normalized, user_id, user_email)

    return {
        "ok": True,
        "code": normalized,
        "invite_type": invite_type,
        "demo_account": grant_demo,
        "training_access": grant_training,
        "course_id": course_id,
        "enrollment_id": (enrollment or {}).get("enrollment_id"),
        "influencer_id": influencer_id,
    }


@api_router.get("/invites/{code}/validate")
async def validate_creator_invite(code: str):
    normalized = (code or "").strip()
    if re.fullmatch(r"\d{6}", normalized) and _is_master_billing_code(normalized):
        return {
            "valid": True,
            "reason": None,
            "influencer_name": "Hirly test access",
            "course_id": SEED_COURSE_ID,
            "already_redeemed": False,
            "master_code": True,
        }
    await mark_invite_clicked(db, normalized)
    check = await validate_invite(db, code)
    invitation = check.get("invitation") or {}
    return {
        "valid": bool(check.get("valid")),
        "reason": check.get("reason"),
        "influencer_name": check.get("influencer_name"),
        "course_id": check.get("course_id") or invitation.get("course_id") or SEED_COURSE_ID,
        "invite_type": check.get("invite_type") or resolve_invite_type(invitation),
        "already_redeemed": check.get("reason") == "already_redeemed",
    }


@api_router.post("/invites/redeem")
async def redeem_creator_invite(payload: Dict[str, Any], user: User = Depends(get_current_user)):
    code = (payload.get("code") or "").strip()
    if re.fullmatch(r"\d{6}", code) and _is_master_billing_code(code):
        plan = (payload.get("plan") or "monthly").strip().lower()
        source = (payload.get("source") or "onboarding").strip().lower()
        interval = (payload.get("interval") or plan).strip().lower()
        billing = await _grant_master_billing_access(
            user.user_id,
            plan,
            interval=interval,
            source=source,
        )
        return {
            "ok": True,
            "code": code,
            "master_code": True,
            "billing": billing,
        }
    return await _redeem_creator_invite(code, user.user_id, user.email)


@api_router.post("/admin/influencers/{influencer_id}/invite")
async def admin_create_influencer_invite(
    influencer_id: str,
    payload: Dict[str, Any] = None,
    admin: User = Depends(require_admin_user),
):
    row = get_influencer(influencer_id)
    if not row:
        raise HTTPException(status_code=404, detail="Influencer not found")
    payload = payload or {}
    course_id = (payload.get("course_id") or SEED_COURSE_ID).strip()
    try:
        invitation = await create_invitation(db, influencer_id, course_id=course_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "ok": True,
        "invitation": invitation,
        "code": invitation.get("code"),
        "course_id": invitation.get("course_id"),
        "invite_type": resolve_invite_type(invitation),
        "influencer": get_influencer(influencer_id),
    }


@api_router.post("/admin/influencers/{influencer_id}/demo-invite")
async def admin_create_influencer_demo_invite(
    influencer_id: str,
    payload: Dict[str, Any] = None,
    admin: User = Depends(require_admin_user),
):
    row = get_influencer(influencer_id)
    if not row:
        raise HTTPException(status_code=404, detail="Influencer not found")
    try:
        invitation = await create_demo_invitation(db, influencer_id=influencer_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "ok": True,
        "invitation": invitation,
        "code": invitation.get("code"),
        "invite_type": INVITE_TYPE_DEMO,
        "influencer": get_influencer(influencer_id),
    }


@api_router.get("/admin/demo/invites")
async def admin_list_demo_invites(admin: User = Depends(require_admin_user)):
    return {"invites": await _enrich_invite_rows_for_admin(await list_demo_invites(db))}


@api_router.post("/admin/demo/invites")
async def admin_create_demo_invite(
    payload: Dict[str, Any],
    admin: User = Depends(require_admin_user),
):
    payload = payload or {}
    invitation = await create_demo_invitation(
        db,
        email_hint=(payload.get("email_hint") or "").strip(),
        label=(payload.get("label") or "").strip(),
    )
    return {
        "ok": True,
        "invitation": invitation,
        "code": invitation.get("code"),
        "invite_type": INVITE_TYPE_DEMO,
    }


@api_router.get("/admin/influencers/{influencer_id}/invites")
async def admin_list_influencer_invites(
    influencer_id: str,
    admin: User = Depends(require_admin_user),
):
    if not get_influencer(influencer_id):
        raise HTTPException(status_code=404, detail="Influencer not found")
    return {"invites": await _enrich_invite_rows_for_admin(await list_invites_for_influencer(db, influencer_id))}


@api_router.post("/admin/influencers/{influencer_id}/grant-demo")
async def admin_grant_influencer_demo(
    influencer_id: str,
    admin: User = Depends(require_admin_user),
):
    row = get_influencer(influencer_id)
    if not row:
        raise HTTPException(status_code=404, detail="Influencer not found")

    user_doc = None
    if row.get("user_id"):
        user_doc = await db.users.find_one({"user_id": row["user_id"]}, {"_id": 0})
    if not user_doc and row.get("email"):
        user_doc = await _find_user_by_email(row["email"])
    if not user_doc:
        raise HTTPException(status_code=404, detail="No Hirly user found for this influencer. Ask them to sign up first.")

    user_id = user_doc["user_id"]
    await _set_user_demo_account(user_id, True)
    await _ensure_demo_feed_profile(user_id)
    updated = update_influencer(influencer_id, {
        "user_id": user_id,
        "demo_granted": True,
        "status": "active",
    })
    return {
        "ok": True,
        "influencer": updated,
        "user_id": user_id,
        "email": user_doc.get("email"),
        "demo_account": True,
    }


@api_router.get("/admin/creators")
async def admin_list_creators(admin: User = Depends(require_admin_user)):
    creators = await _admin_safe_find(db.training_creators, limit=500)
    courses = await _admin_safe_find(db.training_courses, limit=1000)
    enrollments = await _admin_safe_find(db.training_enrollments, limit=5000)

    course_counts: Dict[str, int] = {}
    course_ids_by_creator: Dict[str, set[str]] = {}
    for course in courses:
        creator_id = course.get("creator_id")
        if not creator_id:
            continue
        course_counts[creator_id] = course_counts.get(creator_id, 0) + 1
        if creator_id not in course_ids_by_creator:
            course_ids_by_creator[creator_id] = set()
        course_id = course.get("course_id")
        if course_id:
            course_ids_by_creator[creator_id].add(course_id)

    enrollment_rows_by_course: Dict[str, List[Dict[str, Any]]] = {}
    for enr in enrollments:
        cid = enr.get("course_id")
        if not cid:
            continue
        if cid not in enrollment_rows_by_course:
            enrollment_rows_by_course[cid] = []
        enrollment_rows_by_course[cid].append(enr)

    rows = []
    for creator in creators:
        creator_id = creator.get("creator_id")
        creator_course_ids = course_ids_by_creator.get(creator_id, set())
        creator_enrollments: List[Dict[str, Any]] = []
        for cid in creator_course_ids:
            creator_enrollments.extend(enrollment_rows_by_course.get(cid, []))

        students = len(creator_enrollments)
        avg_progress = 0
        if creator_enrollments:
            avg_progress = round(
                sum(int(item.get("progress_percent") or 0) for item in creator_enrollments) / students
            )

        first_course_at = None
        creator_courses = [item for item in courses if item.get("creator_id") == creator_id]
        if creator_courses:
            creator_courses.sort(
                key=lambda item: _parse_dt(item.get("created_at")) or datetime.max.replace(tzinfo=timezone.utc)
            )
            first_course_at = creator_courses[0].get("created_at")

        rows.append({
            "creator_id": creator_id,
            "user_id": creator.get("user_id"),
            "email": creator.get("email"),
            "display_name": creator.get("display_name"),
            "joined_at": creator.get("created_at"),
            "courses_count": course_counts.get(creator_id, 0),
            "students_count": students,
            "avg_progress_percent": avg_progress,
            "first_course_at": first_course_at,
            "last_active_at": max(
                [item.get("updated_at") for item in creator_enrollments if item.get("updated_at")]
                + [creator.get("created_at")],
                key=lambda item: _parse_dt(item) or datetime.min.replace(tzinfo=timezone.utc),
            ),
        })

    rows.sort(
        key=lambda item: _parse_dt(item.get("joined_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return {"creators": rows}


@api_router.get("/admin/training/analytics")
async def admin_training_analytics_endpoint(
    admin: User = Depends(require_admin_user),
    course_id: str = Query("course_job_search_mastery"),
):
    return await compute_training_analytics(db, course_id)


@api_router.get("/admin/analytics")
async def admin_analytics(admin: User = Depends(require_admin_user)):
    users, profiles, swipes, applications, jobs = await _admin_base_data(include_swipes=True)
    events = await _analytics_events()
    normalized_apps = [_normalize_application_status_fields(app_doc) for app_doc in applications]
    job_map = {item.get("job_id"): item for item in jobs}
    generated_count = sum(1 for app_doc in normalized_apps if app_doc.get("package_status") in {"generated", "generated_text_only"})
    prepared_count = sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") in {"ready", "prepared"})
    action_required_count = sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") == "action_required")
    submitted_count = sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") == "submitted")
    blocked_failed_count = sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") in {"failed", "blocked", "blocked_captcha", "prepare_failed"})

    breakdown = {
        "greenhouse": {"generated": 0, "prepared": 0, "action_required": 0, "submitted": 0, "failed_blocked": 0},
        "lever": {"generated": 0, "prepared": 0, "action_required": 0, "submitted": 0, "failed_blocked": 0},
        "ashby": {"generated": 0, "prepared": 0, "action_required": 0, "submitted": 0, "failed_blocked": 0},
        "unknown": {"generated": 0, "prepared": 0, "action_required": 0, "submitted": 0, "failed_blocked": 0},
    }
    for app_doc in normalized_apps:
        job = job_map.get(app_doc.get("job_id")) or {}
        bucket = breakdown[_ats_bucket(job.get("ats_provider") or app_doc.get("submission_provider"))]
        if app_doc.get("package_status") in {"generated", "generated_text_only"}:
            bucket["generated"] += 1
        if app_doc.get("submission_status") in {"ready", "prepared"}:
            bucket["prepared"] += 1
        if app_doc.get("submission_status") == "action_required":
            bucket["action_required"] += 1
        if app_doc.get("submission_status") == "submitted":
            bucket["submitted"] += 1
        if app_doc.get("submission_status") in {"failed", "blocked", "blocked_captcha", "prepare_failed"}:
            bucket["failed_blocked"] += 1

    ats_performance = {
        key: {
            **value,
            "prepare_rate": _rate(value["prepared"], value["generated"]),
            "failure_rate": _rate(value["failed_blocked"], value["generated"]),
        }
        for key, value in breakdown.items()
    }

    landing_actors = _unique_event_actors(events, "landing_view")
    signup_actors = _unique_event_actors(events, "auth_success") or {user.get("user_id") for user in users if user.get("user_id")}
    onboarding_started_actors = _unique_event_actors(events, "onboarding_started")
    onboarding_completed_actors = _unique_event_actors(events, "onboarding_completed") or {profile.get("user_id") for profile in profiles if profile.get("target_role")}
    cv_uploaded_actors = _unique_event_actors(events, "cv_upload_completed") or {profile.get("user_id") for profile in profiles if profile.get("cv_text")}
    first_swipe_actors = {swipe.get("user_id") for swipe in swipes if swipe.get("user_id")}
    right_swipe_count = sum(1 for swipe in swipes if swipe.get("direction") == "right")

    cta_names = {
        "cta_start_swiping_clicked": "Start swiping",
        "cta_signup_clicked": "Signup",
        "cta_login_clicked": "Login",
    }
    cta_analytics = []
    for event_name, label in cta_names.items():
        actors = _unique_event_actors(events, event_name)
        cta_analytics.append({
            "cta": label,
            "event": event_name,
            "clicks": _event_count(events, event_name),
            "conversion_to_signup": _rate(len(actors & signup_actors), len(actors)),
            "conversion_to_onboarding": _rate(len(actors & onboarding_started_actors), len(actors)),
            "conversion_to_first_swipe": _rate(len(actors & first_swipe_actors), len(actors)),
        })

    admin_attention = [app_doc for app_doc in normalized_apps if _attention_status(app_doc.get("submission_status"))]
    now = datetime.now(timezone.utc)
    ages = []
    for app_doc in admin_attention:
        dt = _parse_dt(app_doc.get("updated_at") or app_doc.get("created_at"))
        if dt:
            ages.append(max(0, (now - dt).total_seconds() / 3600))

    funnel_steps = [
        {"step": "landing_view", "label": "Landing views", "count": len(landing_actors) or _event_count(events, "landing_view")},
        {"step": "signup", "label": "Signup", "count": len(signup_actors)},
        {"step": "onboarding_started", "label": "Onboarding started", "count": len(onboarding_started_actors)},
        {"step": "onboarding_completed", "label": "Onboarding completed", "count": len(onboarding_completed_actors)},
        {"step": "cv_uploaded", "label": "CV uploaded", "count": len(cv_uploaded_actors)},
        {"step": "first_swipe", "label": "First swipe", "count": len(first_swipe_actors)},
        {"step": "right_swipe", "label": "Right swipes", "count": right_swipe_count},
        {"step": "application_generated", "label": "Applications generated", "count": generated_count},
        {"step": "prepared", "label": "Prepared", "count": prepared_count},
        {"step": "submitted", "label": "Submitted", "count": submitted_count},
    ]
    for index, row in enumerate(funnel_steps):
        row["previous_rate"] = None if index == 0 else _rate(row["count"], funnel_steps[index - 1]["count"])

    return {
        "metrics": {
            "visitors": len(landing_actors) or _event_count(events, "landing_view"),
            "signups": len(users),
            "onboarding_started": len(onboarding_started_actors),
            "onboarding_complete": sum(1 for profile in profiles if profile.get("target_role")),
            "onboarding_completed": len(onboarding_completed_actors),
            "cv_uploaded": len(cv_uploaded_actors),
            "swipe_users": len(first_swipe_actors),
            "swipes": len(swipes),
            "total_swipes": len(swipes),
            "right_swipes": sum(1 for swipe in swipes if swipe.get("direction") == "right"),
            "applications_generated": generated_count,
            "prepared": prepared_count,
            "action_required": action_required_count,
            "submitted": submitted_count,
            "failed_blocked": blocked_failed_count,
            "blocked_or_failed": blocked_failed_count,
        },
        "conversion_funnel": funnel_steps,
        "cta_analytics": cta_analytics,
        "application_funnel": {
            "generated": generated_count,
            "prepared": prepared_count,
            "action_required": action_required_count,
            "blocked_captcha": sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") == "blocked_captcha"),
            "prepare_failed": sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") == "prepare_failed"),
            "submitted": submitted_count,
        },
        "by_ats": breakdown,
        "ats_performance": ats_performance,
        "time_series": {
            "last_7_days": {
                "signups": _series_counts(users, 7, lambda item: item.get("created_at")),
                "swipes": _series_counts(swipes, 7, lambda item: item.get("created_at")),
                "applications": _series_counts(normalized_apps, 7, lambda item: item.get("created_at")),
                "prepared": _series_counts(normalized_apps, 7, lambda item: item.get("updated_at") or item.get("created_at"), lambda item: item.get("submission_status") in {"ready", "prepared"}),
                "submitted": _series_counts(normalized_apps, 7, lambda item: item.get("submitted_at") or item.get("updated_at") or item.get("created_at"), lambda item: item.get("submission_status") == "submitted"),
            },
            "last_30_days": {
                "signups": _series_counts(users, 30, lambda item: item.get("created_at")),
                "swipes": _series_counts(swipes, 30, lambda item: item.get("created_at")),
                "applications": _series_counts(normalized_apps, 30, lambda item: item.get("created_at")),
                "prepared": _series_counts(normalized_apps, 30, lambda item: item.get("updated_at") or item.get("created_at"), lambda item: item.get("submission_status") in {"ready", "prepared"}),
                "submitted": _series_counts(normalized_apps, 30, lambda item: item.get("submitted_at") or item.get("updated_at") or item.get("created_at"), lambda item: item.get("submission_status") == "submitted"),
            },
        },
        "admin_ops": {
            "open_action_required": sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") == "action_required"),
            "open_blocked": sum(1 for app_doc in normalized_apps if app_doc.get("submission_status") in {"blocked", "blocked_captcha", "prepare_failed"}),
            "assigned_applications": sum(1 for app_doc in normalized_apps if app_doc.get("assigned_to")),
            "unassigned_applications": sum(1 for app_doc in admin_attention if not app_doc.get("assigned_to")),
            "average_unresolved_age_hours": round(sum(ages) / len(ages), 1) if ages else 0,
        },
        "events_available": bool(events),
    }


@api_router.get("/admin/applications")
async def admin_list_applications(
    status_filter: Optional[str] = Query(default=None, alias="filter"),
    status: Optional[str] = Query(default=None),
    admin: User = Depends(require_admin_user),
):
    status_filter = status_filter or status
    apps = await _admin_safe_find(db.applications, sort=[("updated_at", -1)], limit=1000)
    allowed_statuses = _admin_status_filter(status_filter)
    if allowed_statuses is not None:
        apps = [
            app_doc
            for app_doc in apps
            if _normalize_application_status_fields(app_doc).get("submission_status") in allowed_statuses
        ]
    elif status_filter in {"manual_review_needed", "manual_in_progress", "manually_submitted", "manual_blocked", "needs_user_input"}:
        apps = [
            app_doc
            for app_doc in apps
            if _effective_manual_status(_normalize_application_status_fields(app_doc)) == status_filter
        ]
    apps = _sort_applications_newest_first(apps)

    user_ids = list({app.get("user_id") for app in apps if app.get("user_id")})
    job_ids = list({app.get("job_id") for app in apps if app.get("job_id")})
    users = await _admin_safe_find(db.users, {"user_id": {"$in": user_ids}}, limit=len(user_ids)) if user_ids else []
    jobs = await _admin_jobs_for_ids(job_ids) if job_ids else []
    user_map = {item.get("user_id"): item for item in users}
    job_map = {item.get("job_id"): item for item in jobs}
    return {
        "applications": [
            _admin_application_row(app_doc, user_map.get(app_doc.get("user_id")), job_map.get(app_doc.get("job_id")))
            for app_doc in apps
        ],
        "filter": status_filter or "all",
    }


@api_router.get("/admin/applications/{application_id}")
async def admin_get_application(application_id: str, admin: User = Depends(require_admin_user)):
    app_doc = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")
    app_doc = _normalize_application_status_fields(app_doc)
    profile = await db.profiles.find_one({"user_id": app_doc.get("user_id")}, {"_id": 0})
    user_doc = await db.users.find_one({"user_id": app_doc.get("user_id")}, {"_id": 0})
    job = await db.jobs.find_one({"job_id": app_doc.get("job_id")}, {"_id": 0})
    runs = await db.browser_submission_runs.find(
        {"application_id": application_id},
        {
            "_id": 0,
            "screenshots": 0,
        },
    ).sort("created_at", -1).to_list(20)
    required_questions = (
        app_doc.get("required_questions")
        or app_doc.get("prepared_missing_information")
        or []
    )
    notes = app_doc.get("admin_notes") or []
    cover_letter = app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {}
    tailored_resume = app_doc.get("tailored_resume_structured") or app_doc.get("tailored_resume") or {}
    app_with_admin = {
        **app_doc,
        "user_email": (user_doc or {}).get("email"),
        "manual_status": _effective_manual_status(app_doc),
        "user_facing_submission_status": _user_facing_submission_status(app_doc),
    }
    application_url = _job_application_url(job)
    return {
        "application": app_with_admin,
        "profile": profile,
        "job": {
            **(job or {}),
            "application_url": application_url,
            "external_url": application_url or (job or {}).get("external_url"),
        } if job else None,
        "job_application_url": application_url,
        "user_contact_info": (profile or {}).get("contact") or {"email": (user_doc or {}).get("email"), "name": (user_doc or {}).get("name")},
        "profile_summary": (profile or {}).get("summary"),
        "application_defaults": (profile or {}).get("application_defaults") or {},
        "prepared_missing_information": app_doc.get("prepared_missing_information") or [],
        "resolved_answers": app_doc.get("resolved_answers") or app_doc.get("prepared_generated_answers") or [],
        "required_questions": required_questions,
        "browser_submission_runs": runs,
        "generated_documents_metadata": _admin_doc_metadata(app_doc),
        "tailored_resume": tailored_resume,
        "tailored_resume_text": json.dumps(tailored_resume, indent=2, default=str) if tailored_resume else "",
        "cover_letter": cover_letter,
        "cover_letter_text": cover_letter_to_text(cover_letter) if cover_letter else "",
        "download_urls": {
            "tailored_cv": f"/api/admin/applications/{application_id}/tailored-cv",
            "cover_letter": f"/api/admin/applications/{application_id}/cover-letter",
        },
        "latest_browser_logs": runs[:5],
        "admin_timeline": app_doc.get("admin_timeline") or [],
        "latest_notes": notes[-20:],
    }


@api_router.post("/admin/applications/{application_id}/notes")
async def admin_add_application_note(
    application_id: str,
    body: AdminNoteCreate,
    admin: User = Depends(require_admin_user),
):
    note = body.note.strip()
    if not note:
        raise HTTPException(status_code=400, detail="note required")
    app_doc = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")
    now = datetime.now(timezone.utc).isoformat()
    notes = list(app_doc.get("admin_notes") or [])
    notes.append({
        "note_id": f"note_{uuid.uuid4().hex[:12]}",
        "note": note,
        "author_user_id": admin.user_id,
        "author_email": admin.email,
        "created_at": now,
    })
    await db.applications.update_one(
        {"application_id": application_id},
        {"$set": {"admin_notes": notes, "updated_at": now}},
    )
    return {"ok": True, "note": notes[-1], "latest_notes": notes[-20:]}


@api_router.post("/admin/applications/{application_id}/assign")
async def admin_assign_application(application_id: str, admin: User = Depends(require_admin_user)):
    app_doc = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.applications.update_one(
        {"application_id": application_id},
        {"$set": {
            "assigned_to": admin.email,
            "assigned_to_user_id": admin.user_id,
            "assigned_at": now,
            "updated_at": now,
        }},
    )
    updated = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    return {"ok": True, "application": _normalize_application_status_fields(updated or {})}


@api_router.post("/admin/applications/{application_id}/unassign")
async def admin_unassign_application(application_id: str, admin: User = Depends(require_admin_user)):
    app_doc = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")
    now = datetime.now(timezone.utc).isoformat()
    await db.applications.update_one(
        {"application_id": application_id},
        {"$set": {
            "assigned_to": None,
            "assigned_to_user_id": None,
            "assigned_at": None,
            "updated_at": now,
        }},
    )
    updated = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    return {"ok": True, "application": _normalize_application_status_fields(updated or {})}


@api_router.patch("/admin/applications/{application_id}/admin-status")
async def admin_update_application_status(
    application_id: str,
    body: AdminStatusUpdate,
    admin: User = Depends(require_admin_user),
):
    app_doc = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")
    submission_status = {
        "submitted": "submitted",
        "needs_user_input": "action_required",
        "blocked": "blocked",
        "escalated": "blocked",
    }[body.status]
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "admin_status": body.status,
        "submission_status": submission_status,
        "updated_at": now,
        "admin_status_updated_by": admin.email,
        "admin_status_updated_at": now,
    }
    if body.status == "submitted":
        update["submitted_at"] = now
    await db.applications.update_one(
        {"application_id": application_id},
        {"$set": update},
    )
    updated = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    return {"ok": True, "application": _normalize_application_status_fields(updated or {})}


@api_router.post("/admin/applications/{application_id}/manual-status")
async def admin_update_application_manual_status(
    application_id: str,
    body: AdminManualStatusUpdate,
    admin: User = Depends(require_admin_user),
):
    app_doc = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")
    now = datetime.now(timezone.utc).isoformat()
    note_text = (body.note or "").strip()
    notes = list(app_doc.get("admin_notes") or [])
    if note_text:
        notes.append({
            "note_id": f"note_{uuid.uuid4().hex[:12]}",
            "note": note_text,
            "author_user_id": admin.user_id,
            "author_email": admin.email,
            "created_at": now,
        })
    timeline = _append_admin_timeline(app_doc, {
        "event_id": f"timeline_{uuid.uuid4().hex[:12]}",
        "type": "manual_status",
        "manual_status": body.manual_status,
        "author_user_id": admin.user_id,
        "author_email": admin.email,
        "note": note_text or None,
        "created_at": now,
    })
    update = {
        "admin_status": body.manual_status,
        "manual_status": body.manual_status,
        "admin_notes": notes,
        "admin_timeline": timeline,
        "manual_status_updated_by": admin.email,
        "manual_status_updated_at": now,
        "updated_at": now,
    }
    if body.manual_status == "manually_submitted":
        update["submission_status"] = "submitted"
        update["submitted_at"] = app_doc.get("submitted_at") or now
    elif body.manual_status == "needs_user_input":
        update["submission_status"] = "action_required"
    await db.applications.update_one(
        {"application_id": application_id},
        {"$set": update},
    )
    updated = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    return {"ok": True, "application": _normalize_application_status_fields(updated or {})}


@api_router.get("/admin/applications/{application_id}/tailored-cv")
async def admin_download_tailored_cv(application_id: str, admin: User = Depends(require_admin_user)):
    from fastapi.responses import Response as FastAPIResponse

    app_doc = await db.applications.find_one(
        {"application_id": application_id},
        {"_id": 0, "tailored_cv_file_b64": 1, "tailored_cv_filename": 1, "tailored_cv_mime": 1},
    )
    if not app_doc or not app_doc.get("tailored_cv_file_b64"):
        raise HTTPException(status_code=404, detail="Tailored CV not found")
    content = base64.b64decode(app_doc["tailored_cv_file_b64"])
    filename = app_doc.get("tailored_cv_filename") or "tailored_cv.docx"
    return FastAPIResponse(
        content=content,
        media_type=app_doc.get("tailored_cv_mime") or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/admin/applications/{application_id}/cover-letter")
async def admin_download_cover_letter(application_id: str, admin: User = Depends(require_admin_user)):
    from fastapi.responses import Response as FastAPIResponse

    app_doc = await db.applications.find_one(
        {"application_id": application_id},
        {"_id": 0, "tailored_cover_letter": 1, "cover_letter": 1},
    )
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")
    cover_letter = app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter")
    if not cover_letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    content = cover_letter_to_text(cover_letter)
    return FastAPIResponse(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{application_id}_cover_letter.txt"'},
    )


@api_router.get("/applications/greenhouse/form-preview")
async def greenhouse_form_preview(job_id: str, user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("ats_provider") != "greenhouse":
        raise HTTPException(status_code=400, detail="Job is not a Greenhouse job")

    board_token = job.get("board_token")
    greenhouse_job_id = job.get("provider_job_id")
    external_id = job.get("external_id") or ""
    if (not board_token or not greenhouse_job_id) and ":" in external_id:
        board_token, greenhouse_job_id = external_id.split(":", 1)
    if not board_token or not greenhouse_job_id:
        raise HTTPException(status_code=400, detail="Greenhouse board token or job id is missing")

    provider = get_board_provider("greenhouse")
    try:
        preview = await provider.inspect_application_form(board_token, greenhouse_job_id)
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Greenhouse form preview failed: job_id=%s board=%s greenhouse_job_id=%s status=%s",
            job_id,
            board_token,
            greenhouse_job_id,
            exc.response.status_code if exc.response else None,
        )
        raise HTTPException(status_code=502, detail="Greenhouse application form is unavailable") from exc
    except Exception as exc:
        logger.warning("Greenhouse form preview failed: job_id=%s error=%s", job_id, exc)
        raise HTTPException(status_code=502, detail="Greenhouse application form preview failed") from exc

    return {
        "job_id": job["job_id"],
        "company": job.get("company"),
        "title": job.get("title"),
        "application_url": preview["application_url"] or job.get("external_url"),
        "ats_provider": "greenhouse",
        "fields": preview["fields"],
        "supports_auto_submit": preview["supports_auto_submit"],
        "blockers": preview["blockers"],
    }


async def _load_or_create_lever_browser_application(job_id: str, user: User) -> tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("ats_provider") != "lever":
        raise HTTPException(status_code=400, detail="Job is not a Lever job")

    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    if not profile or not profile.get("cv_text"):
        raise HTTPException(status_code=400, detail="Upload your CV before preparing a browser submission.")

    app_doc = await db.applications.find_one(
        {"user_id": user.user_id, "job_id": job_id},
        {"_id": 0},
    )
    package_missing = (
        not app_doc
        or not app_doc.get("tailored_resume_structured")
        or not app_doc.get("tailored_cover_letter")
        or not app_doc.get("tailored_cv_file_b64")
    )
    if package_missing:
        generated_doc = await _generate_application_doc(user, profile, job)
        if app_doc:
            generated_doc["application_id"] = app_doc["application_id"]
            generated_doc["created_at"] = app_doc.get("created_at") or generated_doc["created_at"]
            await db.applications.update_one(
                {"user_id": user.user_id, "job_id": job_id, "application_id": app_doc["application_id"]},
                {"$set": generated_doc},
            )
        else:
            await db.applications.insert_one(generated_doc)
        app_doc = await db.applications.find_one(
            {"user_id": user.user_id, "job_id": job_id},
            {"_id": 0},
        )

    if not app_doc:
        raise HTTPException(status_code=500, detail="Application package could not be created")
    return job, profile, app_doc


def _browser_engine_headless() -> bool:
    return os.environ.get("BROWSER_HEADLESS", "true").lower() not in ("0", "false", "no", "off")


def _dev_tools_enabled() -> bool:
    return (
        os.environ.get("ENVIRONMENT", "").strip().lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    )


def _log_browser_exception(message: str, exc: Exception) -> None:
    if _dev_tools_enabled():
        logger.exception(message)
    else:
        logger.warning("%s: %s", message, exc.__class__.__name__)


LEVER_BROWSER_ENDPOINT_VERSION = "lever_prepare_browser_fill_endpoint_v3_runtime_markers_2026_06_05"


def _lever_module_file() -> str:
    module = __import__(LeverBrowserSubmissionEngine.__module__, fromlist=["__file__"])
    return str(getattr(module, "__file__", LeverBrowserSubmissionEngine.__module__))


def _lever_runtime_markers(engine: Optional[LeverBrowserSubmissionEngine] = None) -> Dict[str, Any]:
    engine_obj = engine or LeverBrowserSubmissionEngine(headless=_browser_engine_headless())
    return {
        "endpoint_version": LEVER_BROWSER_ENDPOINT_VERSION,
        "engine_version": getattr(engine_obj, "engine_version", "unknown"),
        "lever_module_file": _lever_module_file(),
        "server_file": __file__,
        "last_launch_marker": getattr(engine_obj, "last_launch_marker", None),
    }


def _lever_marked_detail(detail: Any, engine: Optional[LeverBrowserSubmissionEngine] = None) -> Dict[str, Any]:
    if isinstance(detail, dict):
        return {**_lever_runtime_markers(engine), **detail}
    return {**_lever_runtime_markers(engine), "message": detail}


async def _prepare_lever_browser_fill(job_id: str, user: User, click_submit: bool = False) -> Dict[str, Any]:
    engine = LeverBrowserSubmissionEngine(headless=_browser_engine_headless())
    try:
        job, profile, app_doc = await _load_or_create_lever_browser_application(job_id, user)
    except HTTPException:
        raise
    except Exception as exc:
        _log_browser_exception("Lever browser load_application failed", exc)
        raise HTTPException(
            status_code=502,
            detail=_lever_marked_detail({
                "phase": "load_application",
                "exception_class": exc.__class__.__name__,
                "message": str(exc).strip() or "Failed to load Lever application context.",
            }, engine),
        ) from exc

    logger.info(
        "Lever browser provider class=%s file=%s endpoint_version=%s engine_version=%s",
        engine.__class__.__name__,
        getattr(__import__(engine.__class__.__module__, fromlist=["__file__"]), "__file__", engine.__class__.__module__),
        LEVER_BROWSER_ENDPOINT_VERSION,
        getattr(engine, "engine_version", "unknown"),
    )
    try:
        result = await engine.prepare_fill(
            job=job,
            app_doc=app_doc,
            profile=profile,
            user=user.model_dump(mode="json"),
            click_submit=click_submit,
        )
    except BrowserSubmissionError as exc:
        _log_browser_exception(f"Lever browser failed during {exc.phase}", exc)
        raise HTTPException(status_code=502, detail=_lever_marked_detail(exc.safe_detail(), engine)) from exc
    except ValueError as exc:
        _log_browser_exception("Lever browser validation failed", exc)
        raise HTTPException(
            status_code=400,
            detail=_lever_marked_detail({
                "phase": "load_application",
                "exception_class": exc.__class__.__name__,
                "message": str(exc).strip() or "Invalid Lever browser submission request.",
            }, engine),
        ) from exc
    except RuntimeError as exc:
        _log_browser_exception("Lever browser runtime failure", exc)
        raise HTTPException(
            status_code=502,
            detail=_lever_marked_detail({
                "phase": "open_browser",
                "exception_class": exc.__class__.__name__,
                "message": str(exc).strip() or "Lever browser runtime failure.",
            }, engine),
        ) from exc
    except Exception as exc:
        _log_browser_exception("Lever browser unexpected failure", exc)
        raise HTTPException(
            status_code=502,
            detail=_lever_marked_detail({
                "phase": "open_browser",
                "exception_class": exc.__class__.__name__,
                "message": str(exc).strip() or "Unexpected Lever browser failure.",
            }, engine),
        ) from exc

    result_dict = result.to_dict()
    result_for_storage = _sanitize_browser_result_for_application(result_dict)
    now = datetime.now(timezone.utc).isoformat()
    if not click_submit:
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "lever_browser_fill_result": result_for_storage,
                "lever_browser_prepared_at": now,
                "updated_at": now,
            }},
        )

    return {
        **_lever_runtime_markers(engine),
        "job_id": job["job_id"],
        "application_id": app_doc["application_id"],
        "company": job.get("company"),
        "title": job.get("title"),
        **result_dict,
    }


def _sanitize_browser_result_for_application(result_dict: Dict[str, Any]) -> Dict[str, Any]:
    result_for_storage = dict(result_dict)
    for key in ("screenshot_b64", "submit_screenshot_b64"):
        if result_for_storage.get(key):
            result_for_storage[key] = f"<omitted, {len(result_dict[key])} base64 chars>"
    return result_for_storage


async def _store_lever_browser_submission_run(
    *,
    user: User,
    result: Dict[str, Any],
    dry_run: bool,
) -> str:
    now = datetime.now(timezone.utc).isoformat()
    run_id = f"browser_run_{uuid.uuid4().hex[:16]}"
    success_detected = bool(result.get("success_detected"))
    status = (
        "dry_run"
        if dry_run
        else "submitted"
        if success_detected
        else "blocked_captcha"
        if result.get("captcha_required")
        else "unknown"
        if result.get("submit_clicked") and result.get("failure_reason") == "submission_status_unknown"
        else "failed"
    )
    run_doc = {
        "run_id": run_id,
        "application_id": result.get("application_id"),
        "job_id": result.get("job_id"),
        "user_id": user.user_id,
        "provider": "lever_browser",
        "status": status,
        "dry_run": dry_run,
        "screenshots": {
            "prepared_b64": result.get("screenshot_b64"),
            "submitted_b64": result.get("submit_screenshot_b64"),
        },
        "success_detected": success_detected,
        "captcha_required": bool(result.get("captcha_required")),
        "action_required": bool(result.get("action_required")),
        "failure_reason": result.get("failure_reason"),
        "post_submit_page_text_excerpt": result.get("post_submit_page_text_excerpt"),
        "post_submit_errors": result.get("post_submit_errors"),
        "submit_button_still_visible": result.get("submit_button_still_visible"),
        "confirmation_text_found": result.get("confirmation_text_found"),
        "lever_network_submit_statuses": result.get("lever_network_submit_statuses"),
        "final_url": result.get("final_url") or result.get("application_url"),
        "created_at": now,
        "updated_at": now,
    }
    await db.browser_submission_runs.insert_one(run_doc)
    return run_id


@api_router.post("/applications/lever/prepare-browser-fill")
async def lever_prepare_browser_fill(body: LeverBrowserFillRequest, user: User = Depends(get_current_user)):
    """Fill a Lever hosted application page in Playwright and stop before submit."""
    try:
        return await _prepare_lever_browser_fill(body.job_id, user)
    except HTTPException as exc:
        exc.detail = _lever_marked_detail(exc.detail)
        raise


@api_router.post("/applications/lever/browser-submit")
async def lever_browser_submit(body: LeverBrowserFillRequest, user: User = Depends(get_current_user)):
    """Fill a Lever hosted application page and optionally click submit when dry-run is disabled."""
    try:
        if browser_submit_dry_run_enabled():
            result = await _prepare_lever_browser_fill(body.job_id, user)
            run_id = await _store_lever_browser_submission_run(user=user, result=result, dry_run=True)
            return {
                **result,
                "dry_run": True,
                "browser_submission_run_id": run_id,
                "stopped_before_submit": True,
                "message": "Dry run successful. Application was filled but submit was not clicked.",
            }
        result = await _prepare_lever_browser_fill(body.job_id, user, click_submit=True)
        run_id = await _store_lever_browser_submission_run(user=user, result=result, dry_run=False)
        now = datetime.now(timezone.utc).isoformat()
        if result.get("success_detected"):
            await db.applications.update_one(
                {"application_id": result["application_id"], "user_id": user.user_id},
                {"$set": {
                    "submission_status": "submitted",
                    "submitted_at": now,
                    "submission_provider": "lever_browser",
                    "submission_error": None,
                    "browser_submission_run_id": run_id,
                    "lever_browser_submission_result": _sanitize_browser_result_for_application(result),
                    "updated_at": now,
                }},
            )
            return {
                **result,
                "dry_run": False,
                "browser_submission_run_id": run_id,
                "submission_status": "submitted",
                "message": "Application submitted.",
            }

        if result.get("captcha_required"):
            await db.applications.update_one(
                {"application_id": result["application_id"], "user_id": user.user_id},
                {"$set": {
                    "submission_status": "action_required",
                    "submission_error": "captcha_required",
                    "submission_provider": "lever_browser",
                    "browser_submission_run_id": run_id,
                    "lever_browser_submission_result": _sanitize_browser_result_for_application(result),
                    "updated_at": now,
                }},
            )
            return {
                **result,
                "dry_run": False,
                "browser_submission_run_id": run_id,
                "submission_status": "action_required",
                "captcha_required": True,
                "action_required": True,
                "message": "Human verification required to complete submission.",
            }

        if result.get("submit_clicked") and result.get("failure_reason") == "submission_status_unknown":
            await db.applications.update_one(
                {"application_id": result["application_id"], "user_id": user.user_id},
                {"$set": {
                    "submission_status": "unknown",
                    "submission_error": "submission_status_unknown",
                    "submission_provider": "lever_browser",
                    "browser_submission_run_id": run_id,
                    "lever_browser_submission_result": _sanitize_browser_result_for_application(result),
                    "updated_at": now,
                }},
            )
            return {
                **result,
                "dry_run": False,
                "browser_submission_run_id": run_id,
                "submission_status": "unknown",
                "message": "Submit was clicked, but success confirmation was not detected.",
            }

        await db.applications.update_one(
            {"application_id": result["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "failed",
                "submission_error": result.get("failure_reason") or "Lever submission success was not detected.",
                "submission_provider": "lever_browser",
                "browser_submission_run_id": run_id,
                "lever_browser_submission_result": _sanitize_browser_result_for_application(result),
                "updated_at": now,
            }},
        )
        return {
            **result,
            "dry_run": False,
            "browser_submission_run_id": run_id,
            "submission_status": "failed",
            "message": "Submit was attempted, but success confirmation was not detected.",
        }
    except HTTPException as exc:
        exc.detail = _lever_marked_detail(exc.detail)
        raise


def _lever_benchmark_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "job_id": result.get("job_id"),
        "application_id": result.get("application_id"),
        "company": result.get("company"),
        "title": result.get("title"),
        "captcha_required": bool(result.get("captcha_required")),
        "action_required": bool(result.get("action_required")),
        "ready_for_final_click": bool(result.get("ready_for_final_click")),
        "blockers": result.get("blockers") or [],
        "unfilled_required_fields": result.get("unfilled_required_fields") or [],
        "success_likelihood": result.get("success_likelihood"),
        "final_click_candidate_selector": result.get("final_click_candidate_selector"),
        "submit_clicked": bool(result.get("submit_clicked")),
        "success_detected": bool(result.get("success_detected")),
        "failure_reason": result.get("failure_reason"),
        "final_url": result.get("final_url") or result.get("application_url"),
        "submission_status": result.get("submission_status"),
        "captcha_debug": result.get("captcha_debug") or {},
        "post_submit_errors": result.get("post_submit_errors") or [],
        "submit_button_still_visible": result.get("submit_button_still_visible"),
        "confirmation_text_found": result.get("confirmation_text_found"),
        "lever_network_submit_statuses": result.get("lever_network_submit_statuses") or [],
    }


@api_router.post("/applications/lever/submission-benchmark")
async def lever_submission_benchmark(body: LeverSubmissionBenchmarkRequest, user: User = Depends(get_current_user)):
    unique_job_ids = []
    seen = set()
    for job_id in body.job_ids:
        if job_id and job_id not in seen:
            unique_job_ids.append(job_id)
            seen.add(job_id)

    if not unique_job_ids:
        raise HTTPException(status_code=400, detail="job_ids is required")

    dry_run_enabled = browser_submit_dry_run_enabled()
    real_submit_enabled = bool(body.allow_real_submit and not dry_run_enabled)
    results = []
    for job_id in unique_job_ids:
        logger.info(
            "Lever benchmark job start: user_id=%s job_id=%s run_browser_submit=%s real_submit_enabled=%s",
            user.user_id,
            job_id,
            body.run_browser_submit,
            real_submit_enabled,
        )
        try:
            if body.run_browser_submit and real_submit_enabled:
                result = await _prepare_lever_browser_fill(job_id, user, click_submit=True)
                run_id = await _store_lever_browser_submission_run(user=user, result=result, dry_run=False)
                result = {**result, "browser_submission_run_id": run_id}
            else:
                result = await _prepare_lever_browser_fill(job_id, user, click_submit=False)
                if body.run_browser_submit:
                    run_id = await _store_lever_browser_submission_run(user=user, result=result, dry_run=True)
                    result = {
                        **result,
                        "dry_run": True,
                        "browser_submission_run_id": run_id,
                        "stopped_before_submit": True,
                    }
            results.append({"ok": True, **_lever_benchmark_summary(result)})
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {"message": exc.detail}
            results.append({
                "ok": False,
                "job_id": job_id,
                "error": detail,
                "captcha_required": False,
                "ready_for_final_click": False,
                "blockers": [],
                "success_likelihood": None,
                "final_click_candidate_selector": None,
            })
        except Exception as exc:
            logger.exception("Lever benchmark job failed: user_id=%s job_id=%s", user.user_id, job_id)
            results.append({
                "ok": False,
                "job_id": job_id,
                "error": {
                    "exception_class": exc.__class__.__name__,
                    "message": str(exc)[:500],
                },
                "captcha_required": False,
                "ready_for_final_click": False,
                "blockers": [],
                "success_likelihood": None,
                "final_click_candidate_selector": None,
            })

    clean_ready = [
        item for item in results
        if item.get("ok") and item.get("ready_for_final_click") and not item.get("captcha_required") and not item.get("blockers")
    ]
    return {
        "dry_run": not real_submit_enabled,
        "real_submit_enabled": real_submit_enabled,
        "run_browser_submit": body.run_browser_submit,
        "total": len(results),
        "clean_ready_count": len(clean_ready),
        "captcha_required_count": sum(1 for item in results if item.get("captcha_required")),
        "results": results,
    }


GREENHOUSE_BROWSER_ENDPOINT_VERSION = "greenhouse_prepare_browser_fill_endpoint_v1_experiment_2026_06_06"


def _greenhouse_module_file() -> str:
    module = __import__(GreenhouseBrowserSubmissionEngine.__module__, fromlist=["__file__"])
    return str(getattr(module, "__file__", GreenhouseBrowserSubmissionEngine.__module__))


def _greenhouse_runtime_markers(engine: Optional[GreenhouseBrowserSubmissionEngine] = None) -> Dict[str, Any]:
    engine_obj = engine or GreenhouseBrowserSubmissionEngine(headless=_browser_engine_headless())
    return {
        "endpoint_version": GREENHOUSE_BROWSER_ENDPOINT_VERSION,
        "engine_version": getattr(engine_obj, "engine_version", "unknown"),
        "greenhouse_module_file": _greenhouse_module_file(),
        "server_file": __file__,
        "last_launch_marker": getattr(engine_obj, "last_launch_marker", None),
    }


def _greenhouse_marked_detail(detail: Any, engine: Optional[GreenhouseBrowserSubmissionEngine] = None) -> Dict[str, Any]:
    if isinstance(detail, dict):
        return {**_greenhouse_runtime_markers(engine), **detail}
    return {**_greenhouse_runtime_markers(engine), "message": detail}


def _browser_field_public_name(field: Dict[str, Any]) -> str:
    return str(field.get("id") or field.get("name") or _canonical_field_name(field.get("label") or "field"))


def _greenhouse_browser_required_question(field: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if field.get("safe_to_autofill") or field.get("answer_source"):
        return None
    reason_if_not_fillable = str(field.get("reason_if_not_fillable") or "")
    if reason_if_not_fillable in {"unknown_optional_field", "not_fillable"}:
        return None
    suggested_key = browser_suggested_profile_key(field)
    options = field.get("options") or []
    if (
        not options
        and str(field.get("type") or "").lower() in ("select", "combobox", "radio")
        and suggested_key
        and suggested_key not in {"country", "city", "current_location_city", "current_location_country", "eeo_gender", "eeo_race", "eeo_veteran", "eeo_disability", "eeo_lgbtq"}
    ):
        options = [
            {"value": "Yes", "label": "Yes"},
            {"value": "No", "label": "No"},
        ]
    return {
        "field_name": _browser_field_public_name(field),
        "field_id": field.get("id"),
        "name": field.get("name"),
        "label": str(field.get("label") or field.get("nearby_text") or "Required question"),
        "question": str(field.get("label") or field.get("nearby_text") or "Required question"),
        "reason": "user_answer_required" if suggested_key else "required_answer_missing",
        "field_type": field.get("type") or "input_text",
        "type": field.get("type") or "input_text",
        "options": options,
        "suggested_profile_key": suggested_key,
    }


def _greenhouse_browser_required_questions(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    questions = []
    for field in result.get("unfilled_required_fields") or []:
        if not isinstance(field, dict):
            continue
        question = _greenhouse_browser_required_question(field)
        if question:
            questions.append(question)
    return _dedupe_missing_information(questions)


def _greenhouse_browser_payload_from_required_questions(questions: List[Dict[str, Any]]) -> Dict[str, Any]:
    fields = {}
    payload_questions = []
    for item in questions:
        field_name = item.get("field_name")
        if not field_name:
            continue
        fields[field_name] = ""
        payload_questions.append({
            "name": field_name,
            "label": item.get("label") or item.get("question") or field_name,
            "type": item.get("field_type") or item.get("type") or "input_text",
            "required": True,
            "value": "",
            "options": item.get("options") or [],
            "suggested_profile_key": item.get("suggested_profile_key"),
        })
    return {
        "method": "browser",
        "provider": "greenhouse_browser",
        "fields": fields,
        "questions": payload_questions,
    }


def _greenhouse_hosted_url_validation(url: Any) -> Dict[str, Any]:
    text = str(url or "").strip()
    if not text:
        return {"ok": False, "reason": "empty"}
    try:
        parsed = urlparse(text)
    except Exception as exc:
        return {"ok": False, "reason": f"parse_error:{exc.__class__.__name__}"}
    host = parsed.netloc.lower()
    if parsed.scheme not in ("http", "https") or not host:
        return {"ok": False, "reason": "missing_http_host", "host": host}
    allowed = (
        "greenhouse.io",
        "greenhouse.com",
        "boards.greenhouse",
        "job-boards.greenhouse",
    )
    ok = any(token in host for token in allowed)
    return {
        "ok": ok,
        "reason": "greenhouse_hosted_url" if ok else "non_greenhouse_host",
        "host": host,
    }


def _greenhouse_job_board_parts(job: Dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    board_token = job.get("board_token")
    greenhouse_job_id = job.get("provider_job_id")
    external_id = str(job.get("external_id") or "")
    if (not board_token or not greenhouse_job_id) and ":" in external_id:
        left, right = external_id.split(":", 1)
        board_token = board_token or left
        greenhouse_job_id = greenhouse_job_id or right
    return (str(board_token).strip() if board_token else None, str(greenhouse_job_id).strip() if greenhouse_job_id else None)


def _append_greenhouse_url_candidate(candidates: List[Dict[str, Any]], source: str, url: Any) -> None:
    text = str(url or "").strip()
    if not text:
        return
    if any(item.get("url") == text for item in candidates):
        return
    candidates.append({
        "source": source,
        "url": text,
        "validation": _greenhouse_hosted_url_validation(text),
    })


async def _resolve_greenhouse_browser_application_url(job: Dict[str, Any]) -> Dict[str, Any]:
    candidates: List[Dict[str, Any]] = []
    for key in ("apply_url", "hosted_url", "application_url", "external_url", "source"):
        _append_greenhouse_url_candidate(candidates, f"job.{key}", job.get(key))

    raw = job.get("raw_provider_payload") or {}
    if isinstance(raw, dict):
        for key in (
            "absolute_url",
            "external_url",
            "application_url",
            "apply_url",
            "applyUrl",
            "hosted_url",
            "hostedUrl",
            "url",
        ):
            _append_greenhouse_url_candidate(candidates, f"raw_provider_payload.{key}", raw.get(key))

    board_token, greenhouse_job_id = _greenhouse_job_board_parts(job)
    if board_token and greenhouse_job_id:
        try:
            provider = get_board_provider("greenhouse")
            preview = await provider.inspect_application_form(board_token, greenhouse_job_id)
            _append_greenhouse_url_candidate(candidates, "greenhouse.form_preview.application_url", preview.get("application_url"))
        except Exception as exc:
            logger.warning(
                "greenhouse_url_form_preview_failed job_id=%s board_token=%s greenhouse_job_id=%s exception=%s message=%s",
                job.get("job_id"),
                board_token,
                greenhouse_job_id,
                exc.__class__.__name__,
                str(exc)[:300],
            )
        _append_greenhouse_url_candidate(
            candidates,
            "derived.boards_greenhouse_url",
            f"https://boards.greenhouse.io/{board_token}/jobs/{greenhouse_job_id}",
        )

    selected = next((item for item in candidates if item.get("validation", {}).get("ok")), None)
    result = {
        "selected_url": selected.get("url") if selected else None,
        "selected_source": selected.get("source") if selected else None,
        "candidates": candidates,
        "validation_result": selected.get("validation") if selected else {"ok": False, "reason": "no_valid_greenhouse_url"},
    }
    logger.info(
        "greenhouse_url_candidates job_id=%s candidates=%s",
        job.get("job_id"),
        json.dumps([
            {
                "source": item.get("source"),
                "url": item.get("url"),
                "validation": item.get("validation"),
            }
            for item in candidates
        ], default=str)[:3000],
    )
    logger.info(
        "greenhouse_url_selected job_id=%s selected=%s source=%s",
        job.get("job_id"),
        result["selected_url"],
        result["selected_source"],
    )
    logger.info(
        "greenhouse_url_validation_result job_id=%s result=%s",
        job.get("job_id"),
        result["validation_result"],
    )
    return result


async def _load_or_create_greenhouse_browser_application(job_id: str, user: User) -> tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("ats_provider") != "greenhouse":
        raise HTTPException(status_code=400, detail="Job is not a Greenhouse job")

    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    if not profile or not profile.get("cv_text"):
        raise HTTPException(status_code=400, detail="Upload your CV before preparing a browser submission.")

    app_doc = await db.applications.find_one(
        {"user_id": user.user_id, "job_id": job_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    package_missing = (
        not app_doc
        or not app_doc.get("tailored_resume_structured")
        or not app_doc.get("tailored_cover_letter")
        or not app_doc.get("tailored_cv_file_b64")
    )
    if package_missing:
        generated_doc = await _generate_application_doc(user, profile, job)
        if app_doc:
            generated_doc["application_id"] = app_doc["application_id"]
            generated_doc["created_at"] = app_doc.get("created_at") or generated_doc["created_at"]
            await db.applications.update_one(
                {"user_id": user.user_id, "job_id": job_id, "application_id": app_doc["application_id"]},
                {"$set": generated_doc},
                upsert=True,
            )
        else:
            await db.applications.insert_one(generated_doc)
        app_doc = await db.applications.find_one(
            {"user_id": user.user_id, "job_id": job_id},
            {"_id": 0},
            sort=[("created_at", -1)],
        )

    if not app_doc:
        raise HTTPException(status_code=500, detail="Application package could not be created")
    return job, profile, app_doc


async def _prepare_greenhouse_browser_fill(job_id: str, user: User, click_submit: bool = False) -> Dict[str, Any]:
    engine = GreenhouseBrowserSubmissionEngine(headless=_browser_engine_headless())
    try:
        job, profile, app_doc = await _load_or_create_greenhouse_browser_application(job_id, user)
    except HTTPException:
        raise
    except Exception as exc:
        _log_browser_exception("Greenhouse browser load_application failed", exc)
        raise HTTPException(
            status_code=502,
            detail=_greenhouse_marked_detail({
                "phase": "load_application",
                "exception_class": exc.__class__.__name__,
                "message": str(exc).strip() or "Failed to load Greenhouse application context.",
            }, engine),
        ) from exc

    logger.info(
        "Greenhouse browser provider class=%s file=%s endpoint_version=%s engine_version=%s",
        engine.__class__.__name__,
        getattr(__import__(engine.__class__.__module__, fromlist=["__file__"]), "__file__", engine.__class__.__module__),
        GREENHOUSE_BROWSER_ENDPOINT_VERSION,
        getattr(engine, "engine_version", "unknown"),
    )
    url_resolution = await _resolve_greenhouse_browser_application_url(job)
    selected_url = url_resolution.get("selected_url")
    if not selected_url:
        now = datetime.now(timezone.utc).isoformat()
        blocker_item = {
            "code": "missing_greenhouse_application_url",
            "message": "A valid Greenhouse hosted application URL could not be found for this job.",
            "field": None,
        }
        result_dict = {
            **_greenhouse_runtime_markers(engine),
            "job_id": job["job_id"],
            "application_id": app_doc["application_id"],
            "company": job.get("company"),
            "title": job.get("title"),
            "application_url": None,
            "fields_detected": [],
            "fields_filled": [],
            "blockers": [blocker_item],
            "unfilled_required_fields": [],
            "file_uploads": [],
            "ready_for_final_click": False,
            "captcha_required": False,
            "action_required": False,
            "success_likelihood": 0.0,
            "submission_status": "blocked",
            "failure_reason": "missing_greenhouse_application_url",
            "greenhouse_url_candidates": url_resolution.get("candidates") or [],
            "greenhouse_url_validation_result": url_resolution.get("validation_result"),
        }
        await db.applications.update_one(
            {"application_id": app_doc["application_id"]},
            {"$set": {
                "user_id": user.user_id,
                "job_id": job_id,
                "submission_status": "blocked",
                "submission_error": "missing_greenhouse_application_url",
                "prepared_missing_information": [],
                "prepared_blockers": [blocker_item],
                "greenhouse_browser_fill_result": _sanitize_browser_result_for_application(result_dict),
                "greenhouse_browser_prepared_at": now,
                "updated_at": now,
            }},
        )
        logger.info(
            "greenhouse_url_validation_result job_id=%s application_id=%s blocked_reason=missing_greenhouse_application_url",
            job.get("job_id"),
            app_doc.get("application_id"),
        )
        return result_dict

    job_for_browser = {
        **job,
        "application_url": selected_url,
        "external_url": selected_url,
        "greenhouse_url_candidates": url_resolution.get("candidates") or [],
        "greenhouse_url_selected": selected_url,
        "greenhouse_url_validation_result": url_resolution.get("validation_result"),
    }
    try:
        result = await engine.prepare_fill(
            job=job_for_browser,
            app_doc=app_doc,
            profile=profile,
            user=user.model_dump(mode="json"),
            click_submit=click_submit,
        )
    except BrowserSubmissionError as exc:
        _log_browser_exception(f"Greenhouse browser failed during {exc.phase}", exc)
        raise HTTPException(status_code=502, detail=_greenhouse_marked_detail(exc.safe_detail(), engine)) from exc
    except ValueError as exc:
        _log_browser_exception("Greenhouse browser validation failed", exc)
        raise HTTPException(
            status_code=400,
            detail=_greenhouse_marked_detail({
                "phase": "load_application",
                "exception_class": exc.__class__.__name__,
                "message": str(exc).strip() or "Invalid Greenhouse browser submission request.",
            }, engine),
        ) from exc
    except Exception as exc:
        _log_browser_exception("Greenhouse browser unexpected failure", exc)
        raise HTTPException(
            status_code=502,
            detail=_greenhouse_marked_detail({
                "phase": "open_browser",
                "exception_class": exc.__class__.__name__,
                "message": str(exc).strip() or "Unexpected Greenhouse browser failure.",
            }, engine),
        ) from exc

    result_dict = result.to_dict()
    result_dict["greenhouse_url_candidates"] = url_resolution.get("candidates") or []
    result_dict["greenhouse_url_selected"] = selected_url
    result_dict["greenhouse_url_validation_result"] = url_resolution.get("validation_result")
    result_for_storage = _sanitize_browser_result_for_application(result_dict)
    now = datetime.now(timezone.utc).isoformat()
    if not click_submit:
        required_questions = _greenhouse_browser_required_questions(result_dict)
        recognized_required_names = {item.get("field_name") for item in required_questions}
        unfilled_required_names = {
            _browser_field_public_name(field)
            for field in result_dict.get("unfilled_required_fields") or []
            if isinstance(field, dict)
        }
        action_required = bool(required_questions) and unfilled_required_names == recognized_required_names
        status_updates: Dict[str, Any] = {}
        if action_required:
            payload = _greenhouse_browser_payload_from_required_questions(required_questions)
            result_dict["action_required"] = True
            result_dict["action_required_reason"] = "user_answers_required"
            result_dict["required_questions"] = required_questions
            result_dict["message"] = "A few answers are needed to complete this application."
            status_updates = {
                "submission_status": "action_required",
                "submission_error": "user_answers_required",
                "prepared_application_payload": payload,
                "prepared_missing_information": required_questions,
                "prepared_blockers": [],
            }
        elif result_dict.get("captcha_required"):
            status_updates = {
                "submission_status": "blocked_captcha",
                "submission_error": "captcha_required",
                "prepared_missing_information": [],
                "prepared_blockers": result_dict.get("blockers") or [],
            }
        elif result_dict.get("ready_for_final_click"):
            status_updates = {
                "submission_status": "prepared",
                "submission_error": None,
                "prepared_missing_information": [],
                "prepared_blockers": [],
            }
        elif result_dict.get("blockers"):
            status_updates = {
                "submission_status": "blocked",
                "submission_error": "browser_prepare_blocked",
                "prepared_missing_information": [],
                "prepared_blockers": result_dict.get("blockers") or [],
            }
        prepare_status = status_updates.get("submission_status") or app_doc.get("submission_status") or "not_submitted"
        result_dict["submission_status"] = prepare_status
        logger.info(
            "greenhouse_browser_prepare_status job_id=%s application_id=%s package_status=%s ready_for_final_click=%s action_required=%s captcha_required=%s blockers_count=%s result_status=%s",
            job.get("job_id"),
            app_doc.get("application_id"),
            app_doc.get("package_status"),
            result_dict.get("ready_for_final_click"),
            result_dict.get("action_required"),
            result_dict.get("captcha_required"),
            len(result_dict.get("blockers") or []),
            prepare_status,
        )
        result_for_storage = _sanitize_browser_result_for_application(result_dict)
        await db.applications.update_one(
            {"application_id": app_doc["application_id"]},
            {"$set": {
                "user_id": user.user_id,
                "job_id": job_id,
                "greenhouse_browser_fill_result": result_for_storage,
                "greenhouse_browser_prepared_at": now,
                "updated_at": now,
                **status_updates,
            }},
        )
        persisted = await db.applications.find_one({"application_id": app_doc["application_id"]}, {"_id": 0})
        logger.info(
            "greenhouse_browser_prepare_status_saved job_id=%s application_id=%s result_status=%s saved_status=%s update_filter=application_id",
            job.get("job_id"),
            app_doc.get("application_id"),
            prepare_status,
            (persisted or {}).get("submission_status"),
        )

    return {
        **_greenhouse_runtime_markers(engine),
        "job_id": job["job_id"],
        "application_id": app_doc["application_id"],
        "company": job.get("company"),
        "title": job.get("title"),
        **result_dict,
    }


async def _store_greenhouse_browser_submission_run(
    *,
    user: User,
    result: Dict[str, Any],
    dry_run: bool,
    manual_fallback_triggered: bool = False,
    result_status: Optional[str] = None,
) -> str:
    now = datetime.now(timezone.utc).isoformat()
    run_id = f"browser_run_{uuid.uuid4().hex[:16]}"
    success_detected = bool(result.get("success_detected"))
    status = (
        "dry_run"
        if dry_run
        else "submitted"
        if success_detected
        else "blocked_captcha"
        if result.get("captcha_required")
        else "unknown"
        if result.get("submit_clicked") and result.get("failure_reason") == "submission_status_unknown"
        else "failed"
    )
    run_doc = {
        "run_id": run_id,
        "application_id": result.get("application_id"),
        "job_id": result.get("job_id"),
        "user_id": user.user_id,
        "provider": "greenhouse_browser",
        "status": status,
        "dry_run": dry_run,
        "clicked_submit": bool(result.get("submit_clicked")),
        "result_status": result_status or status,
        "manual_fallback_triggered": bool(manual_fallback_triggered),
        "triggered_by_user_id": user.user_id,
        "triggered_by_email": user.email,
        "screenshots": {
            "prepared_b64": result.get("screenshot_b64"),
            "submitted_b64": result.get("submit_screenshot_b64"),
        },
        "success_detected": success_detected,
        "captcha_required": bool(result.get("captcha_required")),
        "action_required": bool(result.get("action_required")),
        "failure_reason": result.get("failure_reason"),
        "post_submit_page_text_excerpt": result.get("post_submit_page_text_excerpt"),
        "post_submit_errors": result.get("post_submit_errors"),
        "submit_button_still_visible": result.get("submit_button_still_visible"),
        "confirmation_text_found": result.get("confirmation_text_found"),
        "final_url": result.get("final_url") or result.get("application_url"),
        "created_at": now,
        "updated_at": now,
    }
    await db.browser_submission_runs.insert_one(run_doc)
    return run_id


@api_router.post("/applications/greenhouse/prepare-browser-fill")
async def greenhouse_prepare_browser_fill(body: GreenhousePrepareSubmitRequest, user: User = Depends(get_current_user)):
    """Fill a Greenhouse hosted application page in Playwright and stop before submit."""
    try:
        return await _prepare_greenhouse_browser_fill(body.job_id, user)
    except HTTPException as exc:
        exc.detail = _greenhouse_marked_detail(exc.detail)
        raise


@api_router.post("/applications/greenhouse/browser-submit")
async def greenhouse_browser_submit(body: GreenhousePrepareSubmitRequest, user: User = Depends(get_current_user)):
    """Fill a Greenhouse hosted application page and optionally click submit when dry-run is disabled."""
    try:
        if browser_submit_dry_run_enabled():
            result = await _prepare_greenhouse_browser_fill(body.job_id, user)
            run_id = await _store_greenhouse_browser_submission_run(
                user=user,
                result=result,
                dry_run=True,
                result_status=result.get("submission_status") or "dry_run",
            )
            return {
                **result,
                "dry_run": True,
                "browser_submission_run_id": run_id,
                "stopped_before_submit": True,
                "message": "Dry run successful. Application was filled but submit was not clicked.",
            }

        _require_greenhouse_real_submit_allowed(user)
        result = await _prepare_greenhouse_browser_fill(body.job_id, user, click_submit=True)
        now = datetime.now(timezone.utc).isoformat()
        manual_fallback_triggered = False
        result_status = "submitted" if result.get("success_detected") else None

        if result.get("success_detected"):
            run_id = await _store_greenhouse_browser_submission_run(
                user=user,
                result=result,
                dry_run=False,
                result_status="submitted",
                manual_fallback_triggered=False,
            )
            await db.applications.update_one(
                {"application_id": result["application_id"], "user_id": user.user_id},
                {"$set": {
                    "submission_status": "submitted",
                    "submitted_at": now,
                    "submission_provider": "greenhouse_browser",
                    "submission_error": None,
                    "browser_submission_run_id": run_id,
                    "greenhouse_browser_submission_result": _sanitize_browser_result_for_application(result),
                    "updated_at": now,
                }},
            )
            return {
                **result,
                "dry_run": False,
                "browser_submission_run_id": run_id,
                "submission_status": "submitted",
                "message": "Application submitted.",
            }

        manual_update = {
            "manual_status": "manual_review_needed",
            "admin_status": "manual_review_needed",
            "manual_status_updated_by": user.email,
            "manual_status_updated_at": now,
        }

        if result.get("captcha_required"):
            manual_fallback_triggered = True
            run_id = await _store_greenhouse_browser_submission_run(
                user=user,
                result=result,
                dry_run=False,
                result_status="blocked_captcha",
                manual_fallback_triggered=True,
            )
            await db.applications.update_one(
                {"application_id": result["application_id"], "user_id": user.user_id},
                {"$set": {
                    "submission_status": "blocked_captcha",
                    "submission_error": "captcha_required",
                    "submission_provider": "greenhouse_browser",
                    "browser_submission_run_id": run_id,
                    "greenhouse_browser_submission_result": _sanitize_browser_result_for_application(result),
                    "updated_at": now,
                    **manual_update,
                }},
            )
            return {
                **result,
                "dry_run": False,
                "browser_submission_run_id": run_id,
                "submission_status": "blocked_captcha",
                "captcha_required": True,
                "action_required": True,
                "manual_fallback_triggered": manual_fallback_triggered,
                "message": "An additional security check is required before this application can be completed.",
            }

        if result.get("submit_clicked") and result.get("failure_reason") == "submission_status_unknown":
            manual_fallback_triggered = True
            run_id = await _store_greenhouse_browser_submission_run(
                user=user,
                result=result,
                dry_run=False,
                result_status="unknown",
                manual_fallback_triggered=True,
            )
            await db.applications.update_one(
                {"application_id": result["application_id"], "user_id": user.user_id},
                {"$set": {
                    "submission_status": "unknown",
                    "submission_error": "submission_status_unknown",
                    "submission_provider": "greenhouse_browser",
                    "browser_submission_run_id": run_id,
                    "greenhouse_browser_submission_result": _sanitize_browser_result_for_application(result),
                    "updated_at": now,
                    **manual_update,
                }},
            )
            return {
                **result,
                "dry_run": False,
                "browser_submission_run_id": run_id,
                "submission_status": "unknown",
                "manual_fallback_triggered": manual_fallback_triggered,
                "message": "Submit was clicked, but success confirmation was not detected.",
            }

        required_questions = result.get("required_questions") or result.get("prepared_missing_information") or _greenhouse_browser_required_questions(result)
        missing_user_answers = bool(result.get("action_required") or required_questions)
        failed_status = "action_required" if missing_user_answers else "failed"
        manual_fallback_triggered = not missing_user_answers
        run_id = await _store_greenhouse_browser_submission_run(
            user=user,
            result=result,
            dry_run=False,
            result_status=failed_status,
            manual_fallback_triggered=manual_fallback_triggered,
        )
        update_doc = {
            "submission_status": failed_status,
            "submission_error": result.get("failure_reason") or "Greenhouse submission success was not detected.",
            "submission_provider": "greenhouse_browser",
            "browser_submission_run_id": run_id,
            "greenhouse_browser_submission_result": _sanitize_browser_result_for_application(result),
            "updated_at": now,
        }
        if missing_user_answers:
            update_doc.update({
                "submission_error": "user_answers_required",
                "prepared_missing_information": required_questions,
                "prepared_blockers": [],
            })
        if manual_fallback_triggered:
            update_doc.update(manual_update)
        await db.applications.update_one(
            {"application_id": result["application_id"], "user_id": user.user_id},
            {"$set": update_doc},
        )
        return {
            **result,
            "dry_run": False,
            "browser_submission_run_id": run_id,
            "submission_status": failed_status,
            "manual_fallback_triggered": manual_fallback_triggered,
            "message": "Submit was attempted, but success confirmation was not detected.",
        }
    except HTTPException as exc:
        exc.detail = _greenhouse_marked_detail(exc.detail)
        raise


def _greenhouse_benchmark_summary(result: Dict[str, Any]) -> Dict[str, Any]:
    fields_detected = result.get("fields_detected") or []
    fields_filled = result.get("fields_filled") or []
    blockers = result.get("blockers") or []
    unfilled = result.get("unfilled_required_fields") or []
    fill_debug = result.get("field_fill_debug") or []
    verification = result.get("verification_summary") or {}
    action_required_fields = result.get("required_questions") or result.get("prepared_missing_information") or unfilled
    failed_fields = [
        item
        for item in fill_debug
        if item.get("attempted_fill") and not item.get("fill_success")
    ]
    rejected_fills = [item for item in fill_debug if item.get("fill_rejected")]
    invalid_after_fills = [item for item in fill_debug if item.get("invalid_after_fill")]
    suspicious_values = []
    for item in fill_debug:
        label = str(item.get("label") or item.get("field_name") or item.get("id") or "")
        field_type = str(item.get("field_type") or "").lower()
        value = str(item.get("value_after_fill") or item.get("matched_value") or "")
        value_key = value.strip().lower()
        if not value_key:
            continue
        label_key = label.strip().lower()
        reason = item.get("rejection_reason") or item.get("invalid_after_fill_reason")
        suspicious = None
        if ("email" in label_key or field_type == "email") and ("@" not in value_key or "." not in value_key):
            suspicious = "email_field_without_email_value"
        elif ("linkedin" in label_key or field_type == "url") and (" " in value or (value and not value_key.startswith(("http://", "https://")))):
            suspicious = "url_field_with_invalid_url_value"
        elif ("phone" in label_key or field_type == "tel") and value and not any(ch.isdigit() for ch in value):
            suspicious = "phone_field_without_digits"
        elif ("first name" in label_key or "last name" in label_key) and "@" in value:
            suspicious = "name_field_with_email_value"
        elif reason:
            suspicious = reason
        if suspicious:
            suspicious_values.append({
                "field_name": item.get("field_name"),
                "id": item.get("id"),
                "label": item.get("label"),
                "field_type": item.get("field_type"),
                "value_preview": value[:80],
                "reason": suspicious,
                "attempted_fill": item.get("attempted_fill"),
                "fill_success": item.get("fill_success"),
            })
    wrong_fill_count = len([
        item for item in suspicious_values
        if item.get("reason") in {
            "email_field_without_email_value",
            "url_field_with_invalid_url_value",
            "phone_field_without_digits",
            "name_field_with_email_value",
        }
    ])
    return {
        "job_id": result.get("job_id"),
        "application_id": result.get("application_id"),
        "company": result.get("company"),
        "title": result.get("title"),
        "url": result.get("greenhouse_url_selected") or result.get("application_url"),
        "total_fields": len(fields_detected),
        "required_fields": sum(1 for field in fields_detected if field.get("required")),
        "required_fields_detected": verification.get("required_fields_detected", sum(1 for field in fields_detected if field.get("required"))),
        "required_fields_planned": verification.get("required_fields_planned"),
        "required_fields_filled": verification.get("required_fields_filled"),
        "required_fields_verified_complete": verification.get("required_fields_verified_complete"),
        "autofilled_fields": len(fields_filled),
        "action_required_fields": action_required_fields,
        "action_required_count": len(action_required_fields),
        "failed_fields": failed_fields,
        "failed_fields_count": len(failed_fields),
        "wrong_fill_count": wrong_fill_count,
        "rejected_fill_count": len(rejected_fills),
        "invalid_after_fill_count": len(invalid_after_fills),
        "suspicious_values": suspicious_values,
        "final_status": result.get("submission_status"),
        "captcha_required": bool(result.get("captcha_required")),
        "action_required": bool(result.get("action_required")),
        "ready_for_final_click": bool(result.get("ready_for_final_click")),
        "blockers": blockers,
        "unfilled_required_fields": unfilled,
        "success_likelihood": result.get("success_likelihood"),
        "final_click_candidate_selector": result.get("final_click_candidate_selector"),
        "submit_clicked": bool(result.get("submit_clicked")),
        "success_detected": bool(result.get("success_detected")),
        "failure_reason": result.get("failure_reason"),
        "final_url": result.get("final_url") or result.get("application_url"),
        "submission_status": result.get("submission_status"),
        "captcha_debug": result.get("captcha_debug") or {},
        "post_submit_errors": result.get("post_submit_errors") or [],
        "submit_button_still_visible": result.get("submit_button_still_visible"),
        "confirmation_text_found": result.get("confirmation_text_found"),
    }


@api_router.post("/applications/greenhouse/submission-benchmark")
async def greenhouse_submission_benchmark(body: LeverSubmissionBenchmarkRequest, user: User = Depends(get_current_user)):
    unique_job_ids = []
    seen = set()
    for job_id in body.job_ids[:10]:
        if job_id and job_id not in seen:
            unique_job_ids.append(job_id)
            seen.add(job_id)

    if not unique_job_ids:
        raise HTTPException(status_code=400, detail="job_ids is required")

    dry_run_enabled = browser_submit_dry_run_enabled()
    real_submit_enabled = bool(body.allow_real_submit and not dry_run_enabled)
    results = []
    for job_id in unique_job_ids:
        logger.info(
            "Greenhouse benchmark job start: user_id=%s job_id=%s run_browser_submit=%s real_submit_enabled=%s",
            user.user_id,
            job_id,
            body.run_browser_submit,
            real_submit_enabled,
        )
        try:
            if body.run_browser_submit and real_submit_enabled:
                result = await _prepare_greenhouse_browser_fill(job_id, user, click_submit=True)
                run_id = await _store_greenhouse_browser_submission_run(user=user, result=result, dry_run=False)
                result = {**result, "browser_submission_run_id": run_id}
            else:
                result = await _prepare_greenhouse_browser_fill(job_id, user, click_submit=False)
                run_id = await _store_greenhouse_browser_submission_run(user=user, result=result, dry_run=True)
                result = {
                    **result,
                    "dry_run": True,
                    "browser_submission_run_id": run_id,
                    "stopped_before_submit": True,
                }
            results.append({"ok": True, **_greenhouse_benchmark_summary(result)})
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {"message": exc.detail}
            results.append({
                "ok": False,
                "job_id": job_id,
                "error": detail,
                "captcha_required": False,
                "ready_for_final_click": False,
                "blockers": [],
                "success_likelihood": None,
                "final_click_candidate_selector": None,
            })
        except Exception as exc:
            logger.exception("Greenhouse benchmark job failed: user_id=%s job_id=%s", user.user_id, job_id)
            results.append({
                "ok": False,
                "job_id": job_id,
                "error": {
                    "exception_class": exc.__class__.__name__,
                    "message": str(exc)[:500],
                },
                "captcha_required": False,
                "ready_for_final_click": False,
                "blockers": [],
                "success_likelihood": None,
                "final_click_candidate_selector": None,
            })

    clean_ready = [
        item for item in results
        if item.get("ok") and item.get("ready_for_final_click") and not item.get("captcha_required") and not item.get("blockers")
    ]
    total_jobs_tested = len(results)
    ready_count = len(clean_ready)
    captcha_count = sum(1 for item in results if item.get("captcha_required"))
    blocker_count = sum(1 for item in results if item.get("blockers"))
    unfilled_counts = [
        len(item.get("unfilled_required_fields") or [])
        for item in results
        if item.get("ok")
    ]
    likelihoods = [
        float(item.get("success_likelihood"))
        for item in results
        if item.get("success_likelihood") is not None
    ]
    denominator = total_jobs_tested or 1
    return {
        "dry_run": not real_submit_enabled,
        "real_submit_enabled": real_submit_enabled,
        "run_browser_submit": body.run_browser_submit,
        "total": total_jobs_tested,
        "total_jobs_tested": total_jobs_tested,
        "ready_count": ready_count,
        "ready_rate": round(ready_count / denominator, 4),
        "captcha_count": captcha_count,
        "captcha_rate": round(captcha_count / denominator, 4),
        "blocker_count": blocker_count,
        "blocker_rate": round(blocker_count / denominator, 4),
        "average_unfilled_required_fields": round(sum(unfilled_counts) / len(unfilled_counts), 2) if unfilled_counts else 0,
        "average_success_likelihood": round(sum(likelihoods) / len(likelihoods), 4) if likelihoods else 0,
        "submit_selector_found_count": sum(1 for item in results if item.get("final_click_candidate_selector")),
        "results": results,
    }


def _split_name(full_name: Optional[str]) -> Dict[str, str]:
    parts = (full_name or "").strip().split()
    if not parts:
        return {"first_name": "", "last_name": ""}
    if len(parts) == 1:
        return {"first_name": parts[0], "last_name": ""}
    return {"first_name": parts[0], "last_name": " ".join(parts[1:])}


def _field_missing_key(field: Dict[str, Any]) -> Optional[str]:
    text = " ".join([str(field.get("name") or ""), str(field.get("label") or "")]).lower()
    checks = [
        ("visa status", ("visa", "sponsorship", "sponsor")),
        ("work authorization", ("work authorization", "authorized to work", "right to work", "legally authorized")),
        ("salary expectations", ("salary", "compensation", "pay expectation", "expected pay")),
        ("relocation preference", ("relocation", "relocate")),
        ("start date", ("start date", "available to start", "availability")),
    ]
    for key, terms in checks:
        if any(term in text for term in terms):
            return key
    return None


def _field_text(field: Dict[str, Any]) -> str:
    return " ".join([str(field.get("name") or ""), str(field.get("label") or "")]).lower()


def _is_empty_answer(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len([item for item in value if not _is_empty_answer(item)]) == 0
    return False


def _sensitive_field_reason(field: Dict[str, Any]) -> Optional[str]:
    text = _field_text(field)
    category = field.get("field_category")
    checks = [
        ("work authorization", ("work authorization", "authorized to work", "right to work", "legally authorized", "eligible to work")),
        ("visa sponsorship", ("visa", "sponsorship", "sponsor")),
        ("disability status", ("disability", "disabled")),
        ("veteran status", ("veteran", "armed forces", "military service")),
        ("demographic question", ("gender", "race", "ethnicity", "hispanic", "pronouns", "sexual orientation")),
        ("criminal history", ("criminal", "conviction", "felony", "background check")),
        ("salary expectations", ("salary", "compensation", "pay expectation", "expected pay")),
    ]
    if category in ("demographic", "eeoc"):
        return "demographic question"
    for reason, terms in checks:
        if any(term in text for term in terms):
            return reason
    return None


def _profile_answer_key(field: Dict[str, Any]) -> Optional[str]:
    text = _field_text(field)
    if any(term in text for term in ("residence country", "country of residence", "current country")):
        return "residence_country"
    if any(term in text for term in ("authorized to work", "work authorization", "right to work", "legally authorized", "eligible to work")):
        return "work_authorization_countries"
    if any(term in text for term in ("require sponsorship", "need sponsorship", "visa sponsorship", "sponsor")):
        if any(term in text for term in ("future", "later", "eventually")):
            return "requires_sponsorship_future"
        return "requires_sponsorship_now"
    if any(term in text for term in ("desired work countries", "countries would you like", "work countries")):
        return "desired_work_countries"
    if any(term in text for term in ("salary", "compensation", "pay expectation", "expected pay")):
        return "salary_expectation"
    if any(term in text for term in ("start date", "available to start", "availability")):
        return "earliest_start_date"
    if any(term in text for term in ("relocation", "relocate")):
        return "willing_to_relocate"
    return None


def _profile_saved_answer(profile: Dict[str, Any], field: Dict[str, Any]) -> Any:
    key = _profile_answer_key(field)
    if not key:
        return None
    answers_profile = profile.get("application_answers_profile") or {}
    value = answers_profile.get(key)
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if not _is_empty_answer(item))
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return value


def _profile_has_explicit_answer(profile: Dict[str, Any], field: Dict[str, Any]) -> bool:
    if not _is_empty_answer(_profile_saved_answer(profile, field)):
        return True
    text = _field_text(field)
    candidate_sources = [
        profile.get("application_answers"),
        profile.get("application_preferences"),
        profile.get("legal"),
        profile.get("work_authorization"),
        profile.get("candidate_facts"),
    ]
    for source in candidate_sources:
        if not source:
            continue
        serialized = json.dumps(source, default=str).lower()
        if any(term in serialized for term in text.split() if len(term) > 4):
            return True
    return False


def _missing_info_item(field: Dict[str, Any], reason: str) -> Dict[str, Any]:
    return {
        "field_name": _public_missing_field_name(field),
        "field_id": field.get("field_id") or field.get("id"),
        "label": str(field.get("label") or field.get("name") or "Unknown field"),
        "question": str(field.get("question") or field.get("label") or field.get("name") or "Unknown field"),
        "reason": reason,
        "field_type": field.get("type") or "input_text",
        "type": field.get("type") or "input_text",
        "options": field.get("options") or [],
        "suggested_profile_key": field.get("suggested_profile_key"),
    }


def _all_payload_fields(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    fields = [
        {"name": "first_name", "label": "First name", "type": "input_text", "options": []},
        {"name": "last_name", "label": "Last name", "type": "input_text", "options": []},
        {"name": "email", "label": "Email", "type": "input_text", "options": []},
    ]
    fields.extend([q for q in payload.get("questions") or [] if isinstance(q, dict)])
    return fields


def _normalize_missing_information(items: List[Any], known_fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for item in items:
        if not item:
            continue
        if isinstance(item, dict):
            field_name = str(item.get("field_name") or item.get("name") or "")
            label = str(item.get("label") or item.get("question") or field_name or "Unknown field")
            field = next(
                (
                    known
                    for known in known_fields
                    if _canonical_field_key(known) == _canonical_field_name(field_name or label)
                ),
                {},
            )
            normalized.append({
                "field_name": _public_missing_field_name(field or {"name": field_name, "label": label}),
                "field_id": item.get("field_id") or item.get("id"),
                "label": label or str(field.get("label") or "Unknown field"),
                "question": item.get("question") or label or str(field.get("label") or "Unknown field"),
                "reason": item.get("reason") or "missing_information",
                "field_type": item.get("field_type") or field.get("type") or "input_text",
                "type": item.get("type") or item.get("field_type") or field.get("type") or "input_text",
                "options": item.get("options") or field.get("options") or [],
                "suggested_profile_key": item.get("suggested_profile_key") or field.get("suggested_profile_key"),
            })
            continue

        text = str(item).strip()
        if not text:
            continue
        text_lower = text.lower()
        field = next(
            (
                known
                for known in known_fields
                if _canonical_field_key(known) == _canonical_field_name(text_lower)
            ),
            {},
        )
        normalized.append({
            "field_name": _public_missing_field_name(field or {"name": text, "label": text}),
            "label": str(field.get("label") or text),
            "reason": "missing_information",
            "field_type": field.get("type") or "input_text",
            "options": field.get("options") or [],
        })
    return _dedupe_missing_information(normalized)


def _canonical_field_name(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    if "privacy" in text and "policy" in text:
        return "privacy_policy_agreement"
    if "how_did_you_hear" in text or ("hear" in text and "job" in text):
        return "referral_source"
    return text


def _canonical_field_key(field: Dict[str, Any]) -> str:
    combined = " ".join([str(field.get("name") or ""), str(field.get("label") or "")])
    return _canonical_field_name(combined)


def _canonical_value_map(values: Dict[str, Any]) -> Dict[str, Any]:
    mapped = {}
    for key, value in (values or {}).items():
        canonical = _canonical_field_name(key)
        if canonical and canonical not in mapped:
            mapped[canonical] = value
    return mapped


def _public_missing_field_name(field: Dict[str, Any]) -> str:
    canonical = _canonical_field_key(field)
    if canonical in ("privacy_policy_agreement", "referral_source"):
        return canonical
    return str(field.get("name") or canonical)


def _greenhouse_safe_default_answer(field: Dict[str, Any]) -> Optional[str]:
    if not field.get("required"):
        return None
    if _sensitive_field_reason(field):
        return None
    canonical = _canonical_field_key(field)
    text = _field_text(field)
    if canonical == "referral_source" or canonical == "source":
        return "Swiipr"
    if "source" in canonical and "job" in text:
        return "Swiipr"
    if canonical == "privacy_policy_agreement":
        return "I agree"
    if any(term in text for term in ("consent", "acknowledgement", "acknowledgment", "i agree")):
        return "I agree"
    return None


def _missing_information_summary(items: List[Any]) -> str:
    parts = []
    for item in items:
        if isinstance(item, dict):
            label = item.get("label") or item.get("field_name") or "unknown field"
            reason = item.get("reason") or "missing_information"
            parts.append(f"{label}: {reason}")
        elif item:
            parts.append(str(item))
    return "; ".join(sorted(set(parts)))


def _dedupe_missing_information(items: List[Any]) -> List[Any]:
    seen = set()
    result = []
    for item in items:
        if not item:
            continue
        if isinstance(item, dict):
            key = _canonical_field_name(item.get("field_name") or item.get("label") or "")
        else:
            key = _canonical_field_name(item)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _required_empty_payload_fields(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    fields = payload.get("fields") or {}
    canonical_fields = _canonical_value_map(fields)
    missing = []
    for name, label in (("first_name", "First name"), ("last_name", "Last name"), ("email", "Email")):
        if _is_empty_answer(fields.get(name)):
            missing.append({
                "field_name": name,
                "label": label,
                "reason": "required_empty_answer",
                "field_type": "input_text",
                "options": [],
            })
    for question in payload.get("questions") or []:
        if not isinstance(question, dict) or not question.get("required"):
            continue
        name = question.get("name")
        canonical = _canonical_field_key(question)
        value = fields.get(name)
        if _is_empty_answer(value):
            value = canonical_fields.get(canonical)
        if _is_empty_answer(value):
            value = question.get("value")
        if _is_empty_answer(value):
            missing.append(_missing_info_item(question, "required_empty_answer"))
    return missing


def _required_fields_count(payload: Dict[str, Any]) -> int:
    count = 0
    fields = payload.get("fields") or {}
    for name in ("first_name", "last_name", "email"):
        if name in fields:
            count += 1
    count += sum(
        1
        for question in payload.get("questions") or []
        if isinstance(question, dict) and question.get("required")
    )
    return count


def _field_by_name_from_payload(payload: Dict[str, Any], field_name: str) -> Optional[Dict[str, Any]]:
    canonical = _canonical_field_name(field_name)
    for question in payload.get("questions") or []:
        if not isinstance(question, dict):
            continue
        question_names = {
            _canonical_field_key(question),
            _canonical_field_name(question.get("name")),
            _canonical_field_name(question.get("field_name")),
            _canonical_field_name(question.get("field_id")),
        }
        if canonical in question_names:
            return question
    for candidate_field in ("first_name", "last_name", "email", "phone"):
        if _canonical_field_name(candidate_field) == canonical:
            return {"name": candidate_field, "label": candidate_field.replace("_", " ").title(), "type": "input_text", "options": []}
    return None


def _profile_answer_updates_from_resolved_fields(payload: Dict[str, Any], answers: Dict[str, Any]) -> Dict[str, Any]:
    updates = {}
    for field_name, value in answers.items():
        field = _field_by_name_from_payload(payload, field_name)
        if not field or _is_empty_answer(value):
            continue
        suggested_key = field.get("suggested_profile_key")
        if suggested_key:
            updates[f"application_defaults.{suggested_key}"] = value
            if suggested_key.startswith("eeo_") and _is_demographic_decline_answer(value):
                updates["application_defaults.prefer_not_to_say_demographics"] = True
            continue
        key = _profile_answer_key(field)
        if key:
            updates[f"application_answers_profile.{key}"] = value
    return updates


def _is_demographic_decline_answer(value: Any) -> bool:
    text = str(value or "").strip().lower()
    canonical = _canonical_field_name(value)
    return any(token in text for token in (
        "prefer not",
        "decline",
        "do not wish",
        "don't wish",
        "choose not to disclose",
        "do not want to answer",
    )) or any(token in canonical for token in ("prefer_not", "decline", "do_not_wish", "choose_not_to_disclose"))


def _remove_resolved_missing_items(missing_items: List[Any], answers: Dict[str, Any]) -> List[Any]:
    result = []
    for item in missing_items:
        if isinstance(item, dict):
            field_name = item.get("field_name")
            if field_name in answers and not _is_empty_answer(answers.get(field_name)):
                continue
        result.append(item)
    return result


def _greenhouse_submit_dry_run_enabled() -> bool:
    return os.environ.get("GREENHOUSE_SUBMIT_DRY_RUN", "true").lower() not in ("0", "false", "no", "off")


def _payload_for_storage(payload: Dict[str, Any]) -> Dict[str, Any]:
    stored = json.loads(json.dumps(payload))
    files = stored.get("files") or {}
    for file_info in files.values():
        if isinstance(file_info, dict):
            if file_info.get("b64"):
                file_info["b64"] = None
                file_info["b64_stored_on_application"] = True
            if file_info.get("text"):
                file_info["text"] = None
                file_info["text_stored_on_application"] = True
    return stored


def _payload_for_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    safe = json.loads(json.dumps(payload))
    files = safe.get("files") or {}
    for file_info in files.values():
        if isinstance(file_info, dict):
            if file_info.get("b64"):
                file_info["b64"] = f"<base64 omitted, {len(file_info['b64'])} chars>"
            if file_info.get("text"):
                file_info["text"] = f"<text omitted, {len(file_info['text'])} chars>"
    return safe


def _greenhouse_submission_endpoint(payload: Dict[str, Any], job: Dict[str, Any]) -> str:
    url = payload.get("url")
    if url:
        return url
    board_token = job.get("board_token")
    greenhouse_job_id = job.get("provider_job_id")
    external_id = job.get("external_id") or ""
    if (not board_token or not greenhouse_job_id) and ":" in external_id:
        board_token, greenhouse_job_id = external_id.split(":", 1)
    if not board_token or not greenhouse_job_id:
        raise HTTPException(status_code=400, detail="Greenhouse board token or job id is missing")
    return f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{greenhouse_job_id}"


def _coerce_greenhouse_boolean(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value or "").strip().lower()
    if text in ("yes", "y", "true", "1", "i agree", "agree"):
        return "true"
    if text in ("no", "n", "false", "0"):
        return "false"
    return str(value or "")


def _map_greenhouse_option_value(field: Dict[str, Any], raw_value: Any) -> tuple[Any, Optional[Dict[str, Any]]]:
    options = field.get("options") or []
    if not options or _is_empty_answer(raw_value):
        return raw_value, None

    values = raw_value if isinstance(raw_value, list) else [raw_value]
    mapped_values = []
    mappings = []
    for item in values:
        item_text = str(item).strip()
        item_key = _canonical_field_name(item_text)
        match = next(
            (
                option for option in options
                if str(option.get("value") or "").strip() == item_text
                or str(option.get("label") or "").strip().lower() == item_text.lower()
                or _canonical_field_name(option.get("label") or option.get("value")) == item_key
                or (
                    item_text.lower() in ("i agree", "agree", "yes", "true")
                    and str(option.get("label") or option.get("value") or "").strip().lower() in ("i agree", "agree", "yes", "true")
                )
            ),
            None,
        )
        if match:
            mapped = match.get("value") if match.get("value") is not None else match.get("label")
            mapped_values.append(mapped)
            mappings.append({"input": item, "mapped_value": mapped, "label": match.get("label")})
        else:
            mapped_values.append(item)
            mappings.append({"input": item, "mapped_value": item, "error": "option_not_found"})

    mapped_result = mapped_values if isinstance(raw_value, list) else mapped_values[0]
    return mapped_result, {"field_name": field.get("name"), "label": field.get("label"), "mappings": mappings}


def _prepared_question_map(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    question_map = {}
    for question in payload.get("questions") or []:
        if isinstance(question, dict) and question.get("name"):
            question_map[question["name"]] = question
    return question_map


def _build_greenhouse_submission_parts(app_doc: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    raw_fields = payload.get("fields") or {}
    question_map = _prepared_question_map(payload)
    data: Dict[str, Any] = {}
    data_items = []
    option_mappings = []
    validation_errors = []

    for key, value in raw_fields.items():
        field = question_map.get(key)
        field_type = (field or {}).get("type") or "input_text"
        mapped_value = value
        mapping = None

        if field_type in ("select", "radio", "multi_select", "checkbox"):
            mapped_value, mapping = _map_greenhouse_option_value(field or {"name": key, "options": []}, value)
            if mapping:
                option_mappings.append(mapping)
                if any(item.get("error") for item in mapping.get("mappings") or []):
                    validation_errors.append({
                        "type": "option_mapping_error",
                        "field_name": key,
                        "label": (field or {}).get("label"),
                        "value": value,
                        "options": (field or {}).get("options") or [],
                    })
        elif field_type == "boolean":
            mapped_value = _coerce_greenhouse_boolean(value)

        if isinstance(mapped_value, list):
            data[key] = [str(item) for item in mapped_value]
            for item in mapped_value:
                data_items.append((key, str(item)))
        else:
            data[key] = "" if mapped_value is None else str(mapped_value)
            data_items.append((key, data[key]))

    resume_b64 = app_doc.get("tailored_cv_file_b64")
    if not resume_b64:
        validation_errors.append({"type": "missing_file", "field_name": "resume", "message": "Tailored CV file is missing"})
        resume_content = b""
    else:
        try:
            resume_content = base64.b64decode(resume_b64)
        except Exception:
            validation_errors.append({"type": "invalid_file", "field_name": "resume", "message": "Tailored CV file is invalid base64"})
            resume_content = b""

    payload_files = payload.get("files") or {}
    resume_meta = payload_files.get("resume") or {}
    files: Dict[str, tuple] = {}
    if resume_content:
        files["resume"] = (
            resume_meta.get("filename") or app_doc.get("tailored_cv_filename") or "tailored_cv.docx",
            resume_content,
            resume_meta.get("mime") or app_doc.get("tailored_cv_mime") or "application/octet-stream",
        )

    cover_text = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
    if cover_text.strip():
        cover_meta = payload_files.get("cover_letter") or {}
        files["cover_letter"] = (
            cover_meta.get("filename") or f"{app_doc.get('application_id', 'application')}_cover_letter.txt",
            cover_text.encode("utf-8"),
            cover_meta.get("mime") or "text/plain",
        )

    required_empty = _required_empty_payload_fields({"fields": data, "questions": payload.get("questions") or []})
    for item in required_empty:
        validation_errors.append({"type": "required_empty_field", **item})

    return {
        "data": data,
        "data_items": data_items,
        "files": files,
        "option_mappings": option_mappings,
        "validation_errors": validation_errors,
    }


def _greenhouse_submission_preview(app_doc: Dict[str, Any], payload: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    parts = _build_greenhouse_submission_parts(app_doc, payload)
    data = parts["data"]
    files = parts["files"]
    return {
        "submit_url": _greenhouse_submission_endpoint(payload, job),
        "fields": [{"name": key, "value": value} for key, value in data.items()],
        "questions": [
            {
                "name": q.get("name"),
                "label": q.get("label"),
                "type": q.get("type"),
                "required": q.get("required"),
                "value": data.get(q.get("name")),
                "options": q.get("options") or [],
            }
            for q in payload.get("questions") or []
            if isinstance(q, dict)
        ],
        "option_mappings": parts["option_mappings"],
        "files": [
            {"field_name": name, "filename": file_tuple[0], "mime": file_tuple[2], "size_bytes": len(file_tuple[1])}
            for name, file_tuple in files.items()
        ],
        "validation_errors": parts["validation_errors"],
        "is_valid": not parts["validation_errors"],
    }


def _build_greenhouse_multipart(app_doc: Dict[str, Any], payload: Dict[str, Any]) -> tuple[List[tuple], Dict[str, tuple], Dict[str, Any]]:
    parts = _build_greenhouse_submission_parts(app_doc, payload)
    if parts["validation_errors"]:
        raise HTTPException(status_code=400, detail={"message": "Greenhouse submission payload is invalid", "errors": parts["validation_errors"]})
    return parts["data_items"], parts["files"], parts


def _legacy_build_greenhouse_multipart(app_doc: Dict[str, Any], payload: Dict[str, Any]) -> tuple[Dict[str, str], Dict[str, tuple]]:
    fields = payload.get("fields") or {}
    data = {str(key): "" if value is None else str(value) for key, value in fields.items()}

    resume_b64 = app_doc.get("tailored_cv_file_b64")
    if not resume_b64:
        raise HTTPException(status_code=400, detail="Tailored CV file is missing")
    try:
        resume_content = base64.b64decode(resume_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Tailored CV file is invalid") from exc

    payload_files = payload.get("files") or {}
    resume_meta = payload_files.get("resume") or {}
    files: Dict[str, tuple] = {
        "resume": (
            resume_meta.get("filename") or app_doc.get("tailored_cv_filename") or "tailored_cv.docx",
            resume_content,
            resume_meta.get("mime") or app_doc.get("tailored_cv_mime") or "application/octet-stream",
        )
    }

    cover_text = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
    if cover_text.strip():
        cover_meta = payload_files.get("cover_letter") or {}
        files["cover_letter"] = (
            cover_meta.get("filename") or f"{app_doc.get('application_id', 'application')}_cover_letter.txt",
            cover_text.encode("utf-8"),
            cover_meta.get("mime") or "text/plain",
        )
    return data, files


def _greenhouse_response_metadata(response: httpx.Response) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {
        "status_code": response.status_code,
        "headers": {
            key: value
            for key, value in response.headers.items()
            if key.lower() in ("location", "content-type", "x-request-id")
        },
    }
    try:
        body = response.json()
        if isinstance(body, dict):
            metadata["body"] = {
                key: body.get(key)
                for key in ("id", "application_id", "status", "message", "error", "errors", "validation_errors", "invalid_fields")
                if key in body
            }
        else:
            metadata["body_type"] = type(body).__name__
    except Exception:
        metadata["body_snippet"] = response.text[:500]
    return metadata


def _greenhouse_response_submission_id(response: httpx.Response) -> Optional[str]:
    try:
        body = response.json()
        if isinstance(body, dict):
            value = body.get("id") or body.get("application_id")
            return str(value) if value else None
    except Exception:
        pass
    location = response.headers.get("location")
    return location[-120:] if location else None


async def _generate_greenhouse_answers(
    profile: Dict[str, Any],
    job: Dict[str, Any],
    app_doc: Dict[str, Any],
    fields: List[Dict[str, Any]],
) -> Dict[str, Any]:
    custom_fields = [
        field for field in fields
        if field.get("field_category") in ("custom_question", "demographic", "eeoc")
    ]
    if not custom_fields:
        return {"answers": [], "missing_information": []}

    system_message = (
        "You generate truthful job application answers from provided candidate data. "
        "Return ONLY valid JSON. Never invent facts. If required information is missing, "
        "leave answer empty, lower confidence, and add a missing_information item."
    )
    prompt = f"""Prepare answers for Greenhouse application questions.

Candidate profile:
{json.dumps({
    "contact": profile.get("contact", {}),
    "summary": profile.get("summary"),
    "skills": profile.get("skills", []),
    "experience": profile.get("experience", []),
    "education": profile.get("education", []),
    "cv_text": profile.get("cv_text", "")[:12000],
}, indent=2)}

Tailored resume:
{json.dumps(app_doc.get("tailored_resume_structured") or app_doc.get("tailored_resume") or {}, indent=2)}

Tailored cover letter:
{json.dumps(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {}, indent=2)}

Job:
{json.dumps({
    "title": job.get("title"),
    "company": job.get("company"),
    "description": job.get("clean_description") or job.get("description"),
    "requirements": job.get("requirements", []),
}, indent=2)}

Questions:
{json.dumps(custom_fields, indent=2)}

Rules:
- Answer only from the candidate/profile/CV/tailored application context.
- Do not answer visa, work authorization, salary, relocation, or start-date questions unless explicitly present in the candidate data.
- For select/multi_select fields, choose only from provided option labels/values when the answer is clear.
- For unknown required information, return an empty answer and include missing_information.

Return JSON:
{{
  "answers": [
    {{"field_name": "question_123", "question": "...", "answer": "...", "confidence": 0.0}}
  ],
  "missing_information": ["work authorization"]
}}"""
    response = await complete_json_text(system_message, prompt)
    return _parse_json_from_llm(response)


@api_router.post("/applications/greenhouse/prepare-submit")
async def greenhouse_prepare_submit(body: GreenhousePrepareSubmitRequest, user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"job_id": body.job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("ats_provider") != "greenhouse":
        raise HTTPException(status_code=400, detail="Job is not a Greenhouse job")

    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    if not profile or not profile.get("cv_text"):
        raise HTTPException(status_code=400, detail="Upload CV first")

    app_doc = await db.applications.find_one(
        {"user_id": user.user_id, "job_id": body.job_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    package_missing = (
        not app_doc
        or not app_doc.get("tailored_resume_structured")
        or not app_doc.get("tailored_cover_letter")
        or not app_doc.get("application_answers")
        or not app_doc.get("tailored_cv_file_b64")
    )
    if package_missing:
        try:
            generated_doc = await _generate_application_doc(user, profile, job)
        except LLMProviderNotConfigured as e:
            raise HTTPException(status_code=502, detail=str(e))
        if app_doc:
            generated_doc["application_id"] = app_doc.get("application_id") or generated_doc["application_id"]
            generated_doc["created_at"] = app_doc.get("created_at") or generated_doc["created_at"]
            await db.applications.update_one(
                {"user_id": user.user_id, "job_id": body.job_id, "application_id": generated_doc["application_id"]},
                {"$set": generated_doc},
                upsert=True,
            )
        else:
            await db.applications.insert_one(generated_doc)
        app_doc = generated_doc

    board_token = job.get("board_token")
    greenhouse_job_id = job.get("provider_job_id")
    external_id = job.get("external_id") or ""
    if (not board_token or not greenhouse_job_id) and ":" in external_id:
        board_token, greenhouse_job_id = external_id.split(":", 1)
    if not board_token or not greenhouse_job_id:
        raise HTTPException(status_code=400, detail="Greenhouse board token or job id is missing")

    provider = get_board_provider("greenhouse")
    try:
        preview = await provider.inspect_application_form(board_token, greenhouse_job_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="Greenhouse application form is unavailable") from exc
    except LLMProviderNotConfigured:
        raise
    except Exception as exc:
        logger.warning("Greenhouse prepare-submit form preview failed: job_id=%s error=%s", body.job_id, exc)
        raise HTTPException(status_code=502, detail="Greenhouse application form preview failed") from exc

    fields = preview["fields"]

    try:
        generated = await _generate_greenhouse_answers(profile, job, app_doc, fields)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as exc:
        logger.exception("Greenhouse answer generation failed")
        raise HTTPException(status_code=502, detail="AI application answer generation failed") from exc

    generated_answers = generated.get("answers") or []
    answers_by_field = {answer.get("field_name"): answer for answer in generated_answers if answer.get("field_name")}

    contact = profile.get("contact") or {}
    names = _split_name(contact.get("name") or user.name)
    payload_fields: Dict[str, Any] = {
        "first_name": names["first_name"],
        "last_name": names["last_name"],
        "email": user.email,
        "phone": contact.get("phone") or "",
    }
    question_payload = []
    auto_filled_fields = []
    for field in fields:
        category = field.get("field_category")
        name = field.get("name")
        if category in ("candidate", "document"):
            continue
        answer = answers_by_field.get(name, {})
        saved_value = _profile_saved_answer(profile, field)
        value = saved_value if not _is_empty_answer(saved_value) else (answer.get("answer") or "")
        if _is_empty_answer(value):
            default_value = _greenhouse_safe_default_answer(field)
            if default_value is not None:
                value = default_value
                auto_filled_fields.append(_public_missing_field_name(field))
        payload_fields[name] = value
        question_payload.append({
            "name": name,
            "label": field.get("label"),
            "value": value,
            "required": field.get("required"),
            "confidence": answer.get("confidence", 0),
        })
    application_payload = {
        "method": "POST",
        "url": f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{greenhouse_job_id}",
        "content_type": "multipart/form-data",
        "fields": payload_fields,
        "questions": question_payload,
        "files": {
            "resume": {
                "filename": app_doc.get("tailored_cv_filename") or "tailored_cv.docx",
                "mime": app_doc.get("tailored_cv_mime") or "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "b64": app_doc.get("tailored_cv_file_b64"),
            },
            "cover_letter": {
                "filename": f"{body.job_id}_cover_letter.txt",
                "mime": "text/plain",
                "text": cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {}),
            },
        },
    }
    missing_information = _normalize_missing_information(
        _required_empty_payload_fields(application_payload),
        _all_payload_fields(application_payload),
    )
    required_fields_count = _required_fields_count(application_payload)
    current_empty_required_fields = [item["field_name"] for item in missing_information]
    empty_required_fields_count = len(current_empty_required_fields)
    ready_for_submission = not missing_information and not preview.get("blockers")
    submission_status = "ready" if ready_for_submission else "blocked"
    blockers = sorted(set(preview.get("blockers") or []))
    logger.info(
        "Greenhouse prepare-submit validation: job_id=%s auto_filled_fields=%s remaining_empty_required_fields=%s current_empty_required_fields=%s deduped_missing_information_count=%s final_submission_status=%s",
        body.job_id,
        auto_filled_fields,
        current_empty_required_fields,
        current_empty_required_fields,
        len(missing_information),
        submission_status,
    )
    await db.applications.update_one(
        {"application_id": app_doc["application_id"], "user_id": user.user_id},
        {"$set": {
            "package_status": "generated",
            "submission_status": submission_status,
            "submitted_at": None,
            "submission_provider": "greenhouse",
            "submission_response_id": None,
            "submission_error": None if ready_for_submission else _missing_information_summary([*missing_information, *blockers]),
            "prepared_application_payload": _payload_for_storage(application_payload),
            "prepared_generated_answers": generated_answers,
            "prepared_missing_information": missing_information,
            "prepared_blockers": blockers,
            "prepared_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    return {
        "job_id": job["job_id"],
        "company": job.get("company"),
        "title": job.get("title"),
        "ready_for_submission": ready_for_submission,
        "submission_status": submission_status,
        "missing_information": missing_information,
        "blockers": blockers,
        "debug_summary": {
            "required_fields_count": required_fields_count,
            "empty_required_fields_count": empty_required_fields_count,
            "auto_filled_fields": auto_filled_fields,
            "remaining_empty_required_fields": current_empty_required_fields,
        },
        "application_payload": application_payload,
        "generated_answers": [
            {
                "question": answer.get("question"),
                "answer": answer.get("answer") or "",
                "confidence": answer.get("confidence", 0),
            }
            for answer in generated_answers
        ],
    }


async def _load_greenhouse_prepared_application(job_id: str, user: User) -> tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("ats_provider") != "greenhouse":
        raise HTTPException(status_code=400, detail="Job is not a Greenhouse job")

    app_doc = await db.applications.find_one(
        {"user_id": user.user_id, "job_id": job_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not app_doc:
        raise HTTPException(status_code=400, detail="Create and prepare an application package before submission")
    app_doc = _normalize_application_status_fields(app_doc)
    payload = app_doc.get("prepared_application_payload")
    if not payload:
        raise HTTPException(status_code=400, detail="Prepare submission before submitting")
    return job, app_doc, payload


@api_router.get("/applications/greenhouse/submission-preview")
async def greenhouse_submission_preview(job_id: str, user: User = Depends(get_current_user)):
    job, app_doc, payload = await _load_greenhouse_prepared_application(job_id, user)
    preview = _greenhouse_submission_preview(app_doc, payload, job)
    return {
        "job_id": job_id,
        "company": job.get("company"),
        "title": job.get("title"),
        "submission_status": app_doc.get("submission_status"),
        **preview,
    }


@api_router.post("/applications/greenhouse/validate-submit")
async def greenhouse_validate_submit(body: GreenhousePrepareSubmitRequest, user: User = Depends(get_current_user)):
    job, app_doc, payload = await _load_greenhouse_prepared_application(body.job_id, user)
    preview = _greenhouse_submission_preview(app_doc, payload, job)
    now = datetime.now(timezone.utc).isoformat()
    await db.applications.update_one(
        {"application_id": app_doc["application_id"], "user_id": user.user_id},
        {"$set": {
            "submission_validation_errors": preview["validation_errors"],
            "submission_option_mappings": preview["option_mappings"],
            "submission_preview_metadata": {
                "field_count": len(preview["fields"]),
                "file_parts": preview["files"],
                "submit_url": preview["submit_url"],
            },
            "updated_at": now,
        }},
    )
    return {
        "job_id": body.job_id,
        "company": job.get("company"),
        "title": job.get("title"),
        "submission_status": app_doc.get("submission_status"),
        "is_valid": preview["is_valid"],
        "validation_errors": preview["validation_errors"],
        "option_mappings": preview["option_mappings"],
        "files": preview["files"],
        "field_count": len(preview["fields"]),
    }


@api_router.post("/applications/greenhouse/submit")
async def greenhouse_submit(body: GreenhousePrepareSubmitRequest, user: User = Depends(get_current_user)):
    job, app_doc, payload = await _load_greenhouse_prepared_application(body.job_id, user)
    missing_information = app_doc.get("prepared_missing_information") or []
    blockers = app_doc.get("prepared_blockers") or []
    if app_doc.get("package_status") != "generated":
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Application package is not generated",
                "package_status": app_doc.get("package_status"),
                "submission_status": app_doc.get("submission_status"),
                "missing_information": missing_information,
                "blockers": blockers,
            },
        )
    if app_doc.get("submission_status") != "ready":
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Application is not ready for submission",
                "package_status": app_doc.get("package_status"),
                "submission_status": app_doc.get("submission_status"),
                "missing_information": missing_information,
                "blockers": blockers,
                "submission_error": app_doc.get("submission_error"),
            },
        )

    required_empty = _required_empty_payload_fields(payload)
    if required_empty:
        missing_information = _dedupe_missing_information([*missing_information, *required_empty])
        error = _missing_information_summary(missing_information)
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "blocked",
                "submission_error": error,
                "prepared_missing_information": missing_information,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Application has required empty answers",
                "package_status": app_doc.get("package_status"),
                "submission_status": "blocked",
                "missing_information": missing_information,
                "blockers": blockers,
            },
        )

    submit_url = _greenhouse_submission_endpoint(payload, job)
    preview = _greenhouse_submission_preview(app_doc, payload, job)
    if not preview["is_valid"]:
        now = datetime.now(timezone.utc).isoformat()
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "blocked",
                "submission_error": "Greenhouse submission payload is invalid",
                "submission_validation_errors": preview["validation_errors"],
                "submission_option_mappings": preview["option_mappings"],
                "submission_preview_metadata": {
                    "field_count": len(preview["fields"]),
                    "file_parts": preview["files"],
                    "submit_url": preview["submit_url"],
                },
                "updated_at": now,
            }},
        )
        raise HTTPException(status_code=400, detail={"message": "Greenhouse submission payload is invalid", "errors": preview["validation_errors"]})

    data, files, parts = _build_greenhouse_multipart(app_doc, payload)
    dry_run = _greenhouse_submit_dry_run_enabled()
    logger.info(
        "Greenhouse submit%s: user_id=%s job_id=%s company=%s multipart_fields=%s multipart_file_parts=%s questions=%s option_mappings=%s",
        " dry-run" if dry_run else "",
        user.user_id,
        body.job_id,
        job.get("company"),
        [item[0] for item in data],
        [{"field_name": name, "filename": file_tuple[0], "mime": file_tuple[2], "size_bytes": len(file_tuple[1])} for name, file_tuple in files.items()],
        len(payload.get("questions") or []),
        parts.get("option_mappings") or [],
    )

    if dry_run:
        return {
            "job_id": job["job_id"],
            "company": job.get("company"),
            "title": job.get("title"),
            "dry_run": True,
            "would_submit": True,
            "submit_url": submit_url,
            "submission_preview": preview,
            "submission_status": app_doc.get("submission_status"),
        }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(submit_url, data=data, files=files)
    except httpx.RequestError as exc:
        error = f"Greenhouse submission request failed: {exc.__class__.__name__}"
        logger.warning("Greenhouse submit request failed: job_id=%s error=%s", body.job_id, exc)
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "failed",
                "submission_provider": "greenhouse",
                "submission_error": error,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(status_code=502, detail=error) from exc

    metadata = _greenhouse_response_metadata(response)
    if 200 <= response.status_code < 300:
        submitted_at = datetime.now(timezone.utc).isoformat()
        submission_response_id = _greenhouse_response_submission_id(response)
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "submitted",
                "submitted_at": submitted_at,
                "submission_provider": "greenhouse",
                "submission_response_id": submission_response_id,
                "submission_error": None,
                "submission_response_metadata": metadata,
                "submission_validation_errors": [],
                "submission_option_mappings": preview["option_mappings"],
                "submission_preview_metadata": {
                    "field_count": len(preview["fields"]),
                    "file_parts": preview["files"],
                    "submit_url": preview["submit_url"],
                },
                "updated_at": submitted_at,
            }},
        )
        logger.info(
            "Greenhouse submit succeeded: job_id=%s status_code=%s response_id=%s",
            body.job_id,
            response.status_code,
            submission_response_id,
        )
        return {
            "job_id": job["job_id"],
            "company": job.get("company"),
            "title": job.get("title"),
            "dry_run": False,
            "submission_status": "submitted",
            "submitted_at": submitted_at,
            "submission_provider": "greenhouse",
            "submission_response_id": submission_response_id,
            "submission_response_metadata": metadata,
        }

    error = f"Greenhouse submission failed with HTTP {response.status_code}"
    logger.warning(
        "Greenhouse submit failed: job_id=%s status_code=%s body_snippet=%s",
        body.job_id,
        response.status_code,
        response.text[:300],
    )
    await db.applications.update_one(
        {"application_id": app_doc["application_id"], "user_id": user.user_id},
        {"$set": {
            "submission_status": "failed",
            "submission_provider": "greenhouse",
            "submission_error": error,
            "submission_response_metadata": metadata,
            "submission_validation_errors": metadata.get("body", {}).get("validation_errors") or metadata.get("body", {}).get("errors") or [],
            "submission_option_mappings": preview["option_mappings"],
            "submission_preview_metadata": {
                "field_count": len(preview["fields"]),
                "file_parts": preview["files"],
                "submit_url": preview["submit_url"],
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    raise HTTPException(status_code=502, detail={"message": error, "response": metadata})


@api_router.post("/applications/{application_id}/resolve-missing-info")
async def resolve_missing_info(
    application_id: str,
    body: ResolveMissingInfoRequest,
    user: User = Depends(get_current_user),
):
    app_doc = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")

    payload = app_doc.get("prepared_application_payload")
    if not payload:
        raise HTTPException(status_code=400, detail="Prepare submission before resolving missing information")

    answers = body.answers or {}
    current_missing = _normalize_missing_information(
        app_doc.get("prepared_missing_information") or [],
        _all_payload_fields(payload),
    )
    missing_count_before = len(current_missing)
    answers_received_count = len([value for value in answers.values() if not _is_empty_answer(value)])
    answers_by_canonical = _canonical_value_map(answers)
    required_missing_names = [
        item.get("field_name")
        for item in current_missing
        if isinstance(item, dict) and item.get("field_name")
    ]
    invalid = [
        field_name
        for field_name in required_missing_names
        if _is_empty_answer(answers.get(field_name)) and _is_empty_answer(answers_by_canonical.get(_canonical_field_name(field_name)))
    ]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Answers are required for blocked fields",
                "missing_field_names": invalid,
            },
        )

    fields = payload.setdefault("fields", {})
    updated_payload_keys = set()
    for field_name, value in answers.items():
        if _is_empty_answer(value):
            continue
        canonical = _canonical_field_name(field_name)
        fields[field_name] = value
        updated_payload_keys.add(field_name)
        for existing_key in list(fields.keys()):
            if _canonical_field_name(existing_key) == canonical:
                fields[existing_key] = value
                updated_payload_keys.add(existing_key)
        for question in payload.get("questions") or []:
            if not isinstance(question, dict):
                continue
            question_names = {
                _canonical_field_key(question),
                _canonical_field_name(question.get("name")),
                _canonical_field_name(question.get("field_name")),
                _canonical_field_name(question.get("field_id")),
            }
            if canonical in question_names:
                question["value"] = value
                if question.get("name"):
                    fields[question["name"]] = value
                    updated_payload_keys.add(question["name"])

    missing_information = _normalize_missing_information(
        _required_empty_payload_fields(payload),
        _all_payload_fields(payload),
    )
    blockers = app_doc.get("prepared_blockers") or []
    submission_status = "ready" if not missing_information and not blockers else "blocked"
    submission_error = None if submission_status == "ready" else _missing_information_summary([*missing_information, *blockers])
    now = datetime.now(timezone.utc).isoformat()
    logger.info(
        "Resolved missing application info: application_id=%s missing_count_before=%s answers_received_count=%s missing_count_after=%s submission_status_after=%s received_answer_keys=%s updated_payload_keys=%s remaining_empty_required_fields=%s",
        application_id,
        missing_count_before,
        answers_received_count,
        len(missing_information),
        submission_status,
        list(answers.keys()),
        sorted(updated_payload_keys),
        [item.get("field_name") for item in missing_information],
    )

    update_fields = {
        "prepared_application_payload": payload,
        "prepared_missing_information": missing_information,
        "submission_status": submission_status,
        "submission_error": submission_error,
        "updated_at": now,
    }
    await db.applications.update_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"$set": update_fields},
    )

    if body.save_to_profile:
        profile_updates = _profile_answer_updates_from_resolved_fields(payload, answers)
        if profile_updates:
            profile_updates["updated_at"] = now
            await db.profiles.update_one(
                {"user_id": user.user_id},
                {"$set": profile_updates},
                upsert=True,
            )

    updated = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"_id": 0},
    )
    updated = _normalize_application_status_fields(updated or {})
    job = await db.jobs.find_one({"job_id": updated.get("job_id")}, {"_id": 0})
    return {
        "application_id": application_id,
        "submission_status": submission_status,
        "ready_for_submission": submission_status == "ready",
        "missing_information": missing_information,
        "blockers": blockers,
        "resolved_count": len(updated_payload_keys),
        "unresolved_fields": missing_information,
        "application": {**updated, "job": job},
    }


@api_router.get("/applications/{application_id}")
async def get_application(application_id: str, user: User = Depends(get_current_user)):
    app_doc = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id}, {"_id": 0}
    )
    if not app_doc:
        raise HTTPException(status_code=404, detail="Not found")
    app_doc = _normalize_application_status_fields(app_doc)
    job = await db.jobs.find_one({"job_id": app_doc["job_id"]}, {"_id": 0})
    return _public_application_doc(app_doc, job)


@api_router.get("/applications/{application_id}/tailored-cv")
async def download_tailored_cv(application_id: str, user: User = Depends(get_current_user)):
    import base64
    from fastapi.responses import Response as FastAPIResponse

    app_doc = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"_id": 0, "tailored_cv_file_b64": 1, "tailored_cv_filename": 1, "tailored_cv_mime": 1},
    )
    if not app_doc or not app_doc.get("tailored_cv_file_b64"):
        raise HTTPException(status_code=404, detail="Tailored CV not found")

    content = base64.b64decode(app_doc["tailored_cv_file_b64"])
    filename = app_doc.get("tailored_cv_filename") or "tailored_cv.docx"
    return FastAPIResponse(
        content=content,
        media_type=app_doc.get("tailored_cv_mime") or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/applications/{application_id}/cover-letter")
async def download_cover_letter(application_id: str, user: User = Depends(get_current_user)):
    from fastapi.responses import Response as FastAPIResponse

    app_doc = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"_id": 0, "tailored_cover_letter": 1, "cover_letter": 1},
    )
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")

    cover_letter = app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter")
    if not cover_letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")

    content = cover_letter_to_text(cover_letter)
    return FastAPIResponse(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{application_id}_cover_letter.txt"'},
    )


@api_router.patch("/applications/{application_id}/status")
async def update_status(application_id: str, update: StatusUpdate, user: User = Depends(get_current_user)):
    res = await db.applications.update_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"$set": {"status": update.status}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ===================== Application email inbox =====================

@api_router.get("/emails/status")
async def gmail_inbox_status(user: User = Depends(get_current_user)):
    try:
        connection = await db.gmail_connections.find_one({"user_id": user.user_id}, {"_id": 0})
    except Exception as exc:
        logger.warning("gmail_status_failed user_id=%s error=%s", user.user_id, str(exc)[:200])
        return {
            "gmail": {
                "connected": False,
                "email": user.email,
                "last_synced_at": None,
                "last_sync_error": "Gmail inbox storage is not initialized",
            },
            "required_scope": GMAIL_READONLY_SCOPE,
        }
    return {"gmail": gmail_connected_payload(connection), "required_scope": GMAIL_READONLY_SCOPE}


@api_router.post("/emails/sync")
async def sync_application_emails(user: User = Depends(get_current_user)):
    try:
        result = await sync_gmail_application_emails(db, user_id=user.user_id)
        return result
    except Exception as exc:
        logger.warning("gmail_sync_failed user_id=%s error=%s", user.user_id, str(exc)[:300])
        raise HTTPException(status_code=503, detail=str(exc)[:300])


@api_router.get("/emails")
async def list_application_emails(
    sync: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
):
    sync_result: Dict[str, Any] = {"ok": True, "skipped": not sync}
    if sync:
        try:
            sync_result = await sync_gmail_application_emails(db, user_id=user.user_id)
        except Exception as exc:
            logger.warning("gmail_list_sync_failed user_id=%s error=%s", user.user_id, str(exc)[:300])
            sync_result = {"ok": False, "error": str(exc)[:300]}
    try:
        connection = await db.gmail_connections.find_one({"user_id": user.user_id}, {"_id": 0})
        rows = await db.application_emails.find({"user_id": user.user_id}, {"_id": 0}).sort("received_at", -1).to_list(limit)
    except Exception as exc:
        logger.warning("gmail_list_failed user_id=%s error=%s", user.user_id, str(exc)[:300])
        return {
            "messages": [],
            "gmail": {
                "connected": False,
                "email": user.email,
                "last_synced_at": None,
                "last_sync_error": "Gmail inbox storage is not initialized",
            },
            "sync": {"ok": False, "error": str(exc)[:300]},
        }
    return {
        "messages": [public_email_message(row) for row in rows],
        "gmail": gmail_connected_payload(connection),
        "sync": sync_result,
    }


# ===================== Seed =====================

MOCK_JOBS = [
    {
        "title": "Senior Frontend Engineer",
        "company": "Linear",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 140000, "salary_max": 200000,
        "description": "Build the world's fastest issue tracker. Work on perf, animations, complex UI state.",
        "requirements": ["5+ years frontend", "TypeScript expert", "React or similar", "Performance optimization"],
        "tech_stack": ["TypeScript", "React", "GraphQL", "Vite"],
        "seniority": "senior",
    },
    {
        "title": "Full Stack Engineer",
        "company": "Vercel",
        "location": "San Francisco, CA",
        "remote": "hybrid",
        "salary_min": 160000, "salary_max": 240000,
        "description": "Help build the platform powering the modern web. Ship Next.js, Edge runtime, and DX tools.",
        "requirements": ["TypeScript", "Node.js", "Next.js", "Distributed systems"],
        "tech_stack": ["TypeScript", "Next.js", "Rust", "Go"],
        "seniority": "mid",
    },
    {
        "title": "AI Engineer",
        "company": "Anthropic",
        "location": "San Francisco, CA",
        "remote": "onsite",
        "salary_min": 220000, "salary_max": 380000,
        "description": "Work on Claude — train, evaluate, and ship safety-focused LLM products.",
        "requirements": ["ML/AI experience", "Python", "PyTorch", "Research engineering"],
        "tech_stack": ["Python", "PyTorch", "JAX", "CUDA"],
        "seniority": "senior",
    },
    {
        "title": "Product Designer",
        "company": "Raycast",
        "location": "Remote (EU/US)",
        "remote": "remote",
        "salary_min": 120000, "salary_max": 180000,
        "description": "Design extensions and core surfaces for the fastest launcher on Mac.",
        "requirements": ["5+ years product design", "Figma", "Strong portfolio", "Systems thinking"],
        "tech_stack": ["Figma", "Framer"],
        "seniority": "senior",
    },
    {
        "title": "Backend Engineer",
        "company": "Supabase",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 130000, "salary_max": 190000,
        "description": "Build the open-source Firebase alternative. Postgres, realtime, auth, edge functions.",
        "requirements": ["Postgres internals", "TypeScript or Go", "Open-source experience"],
        "tech_stack": ["TypeScript", "Postgres", "Deno", "Go"],
        "seniority": "mid",
    },
    {
        "title": "iOS Engineer",
        "company": "Notion",
        "location": "New York, NY",
        "remote": "hybrid",
        "salary_min": 150000, "salary_max": 230000,
        "description": "Build the Notion mobile experience used by millions.",
        "requirements": ["Swift/SwiftUI", "5+ years iOS", "Performance tuning"],
        "tech_stack": ["Swift", "SwiftUI", "Combine"],
        "seniority": "senior",
    },
    {
        "title": "Growth Engineer",
        "company": "Cal.com",
        "location": "Remote",
        "remote": "remote",
        "salary_min": 110000, "salary_max": 170000,
        "description": "Run experiments across landing, signup, and activation flows. Move metrics, ship fast.",
        "requirements": ["A/B testing", "Next.js", "Analytics tools", "SQL"],
        "tech_stack": ["Next.js", "TypeScript", "PostHog", "Postgres"],
        "seniority": "mid",
    },
    {
        "title": "Staff ML Engineer",
        "company": "Hugging Face",
        "location": "Remote (EU)",
        "remote": "remote",
        "salary_min": 200000, "salary_max": 320000,
        "description": "Open-source ML at scale. Lead transformers, datasets, or inference infrastructure.",
        "requirements": ["Senior ML experience", "Python", "Open-source leadership"],
        "tech_stack": ["Python", "PyTorch", "Transformers"],
        "seniority": "lead",
    },
    {
        "title": "DevRel Engineer",
        "company": "Stripe",
        "location": "Remote (US)",
        "remote": "remote",
        "salary_min": 140000, "salary_max": 210000,
        "description": "Build demos, content, and tooling that helps developers integrate Stripe in minutes.",
        "requirements": ["Strong writing", "Full-stack coding", "Speaking experience"],
        "tech_stack": ["TypeScript", "Node.js", "React"],
        "seniority": "senior",
    },
    {
        "title": "Platform Engineer",
        "company": "Fly.io",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 150000, "salary_max": 220000,
        "description": "Run the global app platform. Linux, networking, distributed systems.",
        "requirements": ["Linux internals", "Rust or Go", "Networking"],
        "tech_stack": ["Rust", "Go", "Linux"],
        "seniority": "senior",
    },
    {
        "title": "Junior Frontend Developer",
        "company": "Framer",
        "location": "Amsterdam, NL",
        "remote": "hybrid",
        "salary_min": 60000, "salary_max": 85000,
        "description": "Join the team building the no-code site builder loved by designers.",
        "requirements": ["1-2 years React", "CSS skills", "Eye for detail"],
        "tech_stack": ["React", "TypeScript", "CSS"],
        "seniority": "junior",
    },
    {
        "title": "Data Engineer",
        "company": "Posthog",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 130000, "salary_max": 200000,
        "description": "Scale ClickHouse, build pipelines, ship product analytics at billions of events.",
        "requirements": ["ClickHouse or BigQuery", "Python", "Streaming systems"],
        "tech_stack": ["Python", "ClickHouse", "Kafka"],
        "seniority": "senior",
    },
    {
        "title": "Founding Engineer",
        "company": "Stealth AI Startup",
        "location": "San Francisco, CA",
        "remote": "onsite",
        "salary_min": 180000, "salary_max": 260000,
        "description": "Build the core product from day 1. Equity-heavy. Wear every hat.",
        "requirements": ["Full-stack expert", "Shipped 0-1 products", "AI experience"],
        "tech_stack": ["TypeScript", "Python", "Next.js", "LLMs"],
        "seniority": "senior",
    },
    {
        "title": "Mobile Engineer",
        "company": "Cash App",
        "location": "Remote (US)",
        "remote": "remote",
        "salary_min": 150000, "salary_max": 230000,
        "description": "Build the simplest way to send money. iOS and Android.",
        "requirements": ["Swift or Kotlin", "Fintech experience", "Strong testing"],
        "tech_stack": ["Swift", "Kotlin"],
        "seniority": "senior",
    },
    {
        "title": "Marketing Engineer",
        "company": "Resend",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 120000, "salary_max": 170000,
        "description": "Build delightful marketing sites and docs for the email API for developers.",
        "requirements": ["Next.js", "Design sense", "Animations"],
        "tech_stack": ["Next.js", "Framer Motion", "TypeScript"],
        "seniority": "mid",
    },
]


@api_router.post("/seed")
async def seed_jobs():
    """Idempotently seed mock job data for development fallback."""
    fallback_mock = os.environ.get("JOB_PROVIDER_FALLBACK_MOCK", "false").lower() in ("1", "true", "yes", "on")
    if not fallback_mock:
        raise HTTPException(status_code=403, detail="Mock seed is disabled")
    count = await db.jobs.count_documents({})
    if count >= len(MOCK_JOBS):
        return {"ok": True, "skipped": True, "count": count}

    now = datetime.now(timezone.utc)
    docs = []
    for j in MOCK_JOBS:
        docs.append({
            "job_id": f"job_{uuid.uuid4().hex[:10]}",
            "currency": "USD",
            "posted_at": now.isoformat(),
            **j,
        })
    await db.jobs.delete_many({})
    await db.jobs.insert_many(docs)
    return {"ok": True, "count": len(docs)}


@api_router.get("/health")
async def health():
    return {"status": "ok"}


@api_router.get("/")
async def root():
    return {"message": "Tinder for Jobs API", "ok": True}


@api_router.get("/dev/jsearch-test")
async def dev_jsearch_test(q: str = "software engineer", location: str = "New York", limit: int = 5):
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    api_key = os.environ.get("JSEARCH_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="JSEARCH_API_KEY is not configured")

    provider = get_job_provider(os.environ.get("JOB_PROVIDER_PRIMARY", "jsearch"), api_key)
    query = JobSearchQuery(
        role=q,
        location=location,
        remote_preference="any",
        country=os.environ.get("JSEARCH_COUNTRY", "us"),
        language=os.environ.get("JSEARCH_LANGUAGE", "en"),
        limit=max(1, min(limit, 20)),
    )
    try:
        result = await provider.search(query)
    except ValueError as exc:
        logger.warning("Dev JSearch response parse failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("Dev JSearch test failed: %s", exc)
        raise HTTPException(status_code=502, detail="JSearch provider request failed") from exc
    return {"jobs": result.jobs, "count": len(result.jobs)}


@api_router.get("/dev/greenhouse-import-test")
async def dev_greenhouse_import_test():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    result = await refresh_greenhouse_boards(db, limit_boards=10, force=True)
    sample_jobs = result.get("sample_jobs", [])
    return {
        "boards_checked": result.get("boards_checked", 0),
        "boards_successful": result.get("boards_successful", 0),
        "jobs_imported": result.get("jobs_imported", 0),
        "sample_jobs": sample_jobs[:5],
    }


@api_router.get("/dev/greenhouse-board-test")
async def dev_greenhouse_board_test(board_token: str = "stripe"):
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    token = board_token.strip().lower()
    if not token:
        raise HTTPException(status_code=400, detail="board_token is required")

    provider = get_board_provider("greenhouse")
    try:
        inspection = await provider.inspect_board(token)
    except Exception as exc:
        logger.warning("Greenhouse board test failed: board_token=%s error=%s", token, exc)
        raise HTTPException(status_code=502, detail="Greenhouse board test failed") from exc

    return {
        "board_token": inspection["board_token"],
        "status_code": inspection["status_code"],
        "jobs_count": inspection["jobs_count"],
        "first_job_title": inspection["first_job_title"],
        "error_snippet": inspection["error_snippet"],
    }


@api_router.get("/dev/lever-import-test")
async def dev_lever_import_test():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    result = await refresh_lever_boards(db, limit_boards=10, force=True)
    sample_jobs = result.get("sample_jobs", [])
    return {
        "boards_checked": result.get("boards_checked", 0),
        "boards_successful": result.get("boards_successful", 0),
        "jobs_imported": result.get("jobs_imported", 0),
        "sample_jobs": sample_jobs[:5],
    }


@api_router.get("/dev/lever-board-test")
async def dev_lever_board_test(site: str = "postman"):
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    board_site = site.strip().lower()
    if not board_site:
        raise HTTPException(status_code=400, detail="site is required")

    provider = get_board_provider("lever")
    try:
        inspection = await provider.inspect_board(board_site)
    except Exception as exc:
        logger.warning("Lever board test failed: site=%s error=%s", board_site, exc)
        raise HTTPException(status_code=502, detail="Lever board test failed") from exc

    return {
        "site": inspection["site"],
        "primary_url": inspection.get("primary_url"),
        "primary_status": inspection.get("primary_status"),
        "primary_error_snippet": inspection.get("primary_error_snippet"),
        "eu_url": inspection.get("eu_url"),
        "eu_status": inspection.get("eu_status"),
        "eu_error_snippet": inspection.get("eu_error_snippet"),
        "jobs_count": inspection["jobs_count"],
        "first_job_title": inspection["first_job_title"],
    }


@api_router.get("/dev/provider-write-test")
async def dev_provider_write_test(
    provider: str = "lever",
    max_boards: int = 1,
    max_jobs_per_board: int = 25,
    timeout_seconds: int = 120,
):
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    provider_name = (provider or "").strip().lower()
    if provider_name not in ("greenhouse", "lever"):
        raise HTTPException(status_code=400, detail="provider must be 'greenhouse' or 'lever'")

    max_boards = max(1, min(int(max_boards or 1), 5))
    max_jobs_per_board = max(1, min(int(max_jobs_per_board or 25), 100))
    timeout_seconds = max(5, min(int(timeout_seconds or 120), 300))
    started_at = time.perf_counter()
    progress: Dict[str, Any] = {
        "boards_checked": 0,
        "jobs_upserted_so_far": 0,
        "last_board": None,
        "sample_jobs": [],
    }

    async def _run_bounded_write_test() -> Dict[str, Any]:
        if provider_name == "greenhouse":
            result = await refresh_greenhouse_boards(
                db,
                limit_boards=max_boards,
                force=True,
                job_limit=max_jobs_per_board,
                progress=progress,
            )
        else:
            result = await refresh_lever_boards(
                db,
                limit_boards=max_boards,
                force=True,
                job_limit=max_jobs_per_board,
                progress=progress,
            )
        return result

    try:
        result = await asyncio.wait_for(_run_bounded_write_test(), timeout=timeout_seconds)
    except asyncio.TimeoutError as exc:
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.warning("provider_write_test timeout provider=%s elapsed_ms=%s", provider_name, elapsed_ms)
        return {
            "active_provider": DATABASE_PROVIDER,
            "jobs_collection_provider": _runtime_collection_provider("jobs"),
            "company_boards_collection_provider": _runtime_collection_provider("company_boards"),
            "provider": provider_name,
            "timed_out": True,
            "phase": "provider_write_test",
            "message": f"Provider write test timed out after {timeout_seconds} seconds.",
            "boards_checked": progress.get("boards_checked", 0),
            "jobs_upserted_so_far": progress.get("jobs_upserted_so_far", 0),
            "last_board": progress.get("last_board"),
            "elapsed_ms": elapsed_ms,
            "timeout_seconds": timeout_seconds,
            "max_boards": max_boards,
            "max_jobs_per_board": max_jobs_per_board,
            "sample_job_id": (progress.get("sample_jobs") or [{}])[0].get("job_id") if progress.get("sample_jobs") else None,
        }

    sample_jobs = result.get("sample_jobs") or []
    sample_job_id = sample_jobs[0].get("job_id") if sample_jobs else None
    sample_db_job = None
    if sample_job_id:
        sample_db_job = await db.jobs.find_one(
            {"job_id": sample_job_id},
            {"_id": 0, "job_id": 1, "title": 1, "company": 1, "provider": 1, "ats_provider": 1},
        )
    return {
        "active_provider": DATABASE_PROVIDER,
        "jobs_collection_provider": _runtime_collection_provider("jobs"),
        "company_boards_collection_provider": _runtime_collection_provider("company_boards"),
        "provider": provider_name,
        "timed_out": False,
        "boards_checked": result.get("boards_checked", 0),
        "boards_successful": result.get("boards_successful", 0),
        "inserted_or_updated_count": result.get("jobs_imported", 0),
        "jobs_upserted_so_far": result.get("jobs_imported", 0),
        "auto_apply_supported_imported": result.get("auto_apply_supported_imported", 0),
        "elapsed_ms": result.get("elapsed_ms"),
        "timeout_seconds": timeout_seconds,
        "max_boards": max_boards,
        "max_jobs_per_board": max_jobs_per_board,
        "last_board": progress.get("last_board"),
        "sample_job_id": sample_job_id,
        "sample_job_persisted": sample_db_job is not None,
        "sample_job": sample_db_job,
    }


@api_router.get("/dev/playwright-launch-test")
async def dev_playwright_launch_test():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        return {
            "ok": False,
            "phase": "import_playwright",
            "exception_class": exc.__class__.__name__,
            "message": str(exc).strip() or "Playwright is not installed.",
        }

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto("about:blank")
                return {"ok": True}
            finally:
                await browser.close()
    except Exception as exc:
        if _dev_tools_enabled():
            logger.exception("Dev Playwright launch test failed")
        return {
            "ok": False,
            "phase": "open_browser",
            "exception_class": exc.__class__.__name__,
            "message": str(exc),
        }


@api_router.get("/dev/asyncio-loop-debug")
async def dev_asyncio_loop_debug():
    loop = asyncio.get_running_loop()
    subprocess_supported = False
    subprocess_error = None
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await process.communicate()
        subprocess_supported = process.returncode == 0
        if process.returncode != 0:
            subprocess_error = f"python --version exited with {process.returncode}"
    except Exception as exc:
        subprocess_error = f"{exc.__class__.__name__}: {str(exc)[:500]}"

    return {
        "platform": sys.platform,
        "event_loop_policy": asyncio.get_event_loop_policy().__class__.__name__,
        "running_loop_class": loop.__class__.__name__,
        "subprocess_supported_test": subprocess_supported,
        "subprocess_error": subprocess_error,
    }


@api_router.get("/dev/lever-runtime-debug")
async def dev_lever_runtime_debug():
    old_error_string = "Playwright browser launch failed." + " Ensure Chromium is installed"
    source = inspect.getsource(LeverBrowserSubmissionEngine.prepare_fill)
    source_lines = source.splitlines()[:40]
    engine = LeverBrowserSubmissionEngine(headless=_browser_engine_headless())
    return {
        "endpoint_version": LEVER_BROWSER_ENDPOINT_VERSION,
        "engine_version": getattr(engine, "engine_version", "unknown"),
        "lever_module_file": _lever_module_file(),
        "lever_class_name": LeverBrowserSubmissionEngine.__name__,
        "prepare_fill_source_first_40_lines": source_lines,
        "contains_old_error_string": old_error_string in source,
    }


@api_router.get("/dev/db-health")
async def dev_db_health():
    dev_tools_enabled_raw = os.environ.get("DEV_TOOLS_ENABLED")
    environment_raw = os.environ.get("ENVIRONMENT")
    env_file_path = ROOT_DIR / ".env"

    supabase_url = _normalize_supabase_url(os.environ.get("SUPABASE_URL"))
    supabase_secret = os.environ.get("SUPABASE_SECRET_KEY", "")
    supabase_config_present = bool(supabase_url and supabase_secret)
    supabase_connection_ok = False
    supabase_error = None

    if supabase_config_present:
        result = await test_supabase_connection(supabase_url, supabase_secret)
        supabase_connection_ok = bool(result.get("ok"))
        supabase_error = result.get("error")
    else:
        supabase_error = "SUPABASE_URL or SUPABASE_SECRET_KEY is missing."

    return {
        "active_provider": DATABASE_PROVIDER,
        "dev_tools_enabled_raw": dev_tools_enabled_raw,
        "environment_raw": environment_raw,
        "env_file_loaded": env_file_path.exists(),
        "current_working_directory": os.getcwd(),
        "server_file": __file__,
        "supabase_config_present": supabase_config_present,
        "supabase_connection_ok": supabase_connection_ok,
        "supabase_error": supabase_error,
    }


@api_router.get("/dev/db-counts")
async def dev_db_counts():
    tables = (
        "users",
        "user_sessions",
        "jobs",
        "company_boards",
        "profiles",
        "swipes",
        "applications",
        "browser_submission_runs",
    )
    counts: Dict[str, Any] = {}
    for table in tables:
        count = None
        error = None
        try:
            count = await getattr(db, table).count_documents({})
        except Exception as exc:
            error = f"{exc.__class__.__name__}: {str(exc)[:300]}"
        counts[table] = {
            "supabase_count": count,
            "supabase_error": error,
        }

    return {
        "active_provider": DATABASE_PROVIDER,
        "supabase_config_present": bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SECRET_KEY")),
        "tables": counts,
    }


@api_router.get("/dev/applications-read-write-test")
async def dev_applications_read_write_test(user: User = Depends(get_current_user)):
    if not _dev_tools_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    now = datetime.now(timezone.utc).isoformat()
    test_doc = {
        "application_id": f"app_rw_test_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "job_id": f"job_rw_test_{uuid.uuid4().hex[:12]}",
        "status": "applied",
        "package_status": "pending_generation",
        "submission_status": "not_submitted",
        "created_at": now,
        "updated_at": now,
        "dev_test": True,
    }
    await db.applications.update_one(
        {"application_id": test_doc["application_id"]},
        {"$set": test_doc},
        upsert=True,
    )
    by_application_id = await db.applications.find_one(
        {"application_id": test_doc["application_id"]},
        {"_id": 0},
    )
    by_user_job = await db.applications.find_one(
        {"user_id": test_doc["user_id"], "job_id": test_doc["job_id"]},
        {"_id": 0},
    )

    backfill_limit = 500
    rows = await db.applications.find({}, {"_id": 0}).limit(backfill_limit).to_list(backfill_limit)
    backfilled = 0
    backfill_errors = []
    for row in rows:
        if not row.get("application_id") or not row.get("user_id") or not row.get("job_id"):
            continue
        try:
            await db.applications.update_one(
                {"application_id": row["application_id"]},
                {"$set": {
                    "application_id": row["application_id"],
                    "user_id": row["user_id"],
                    "job_id": row["job_id"],
                    "status": row.get("status"),
                    "package_status": row.get("package_status"),
                    "submission_status": row.get("submission_status"),
                    "updated_at": row.get("updated_at") or now,
                }},
                upsert=True,
            )
            backfilled += 1
        except Exception as exc:
            if len(backfill_errors) < 5:
                backfill_errors.append({
                    "application_id": row.get("application_id"),
                    "exception_class": exc.__class__.__name__,
                    "message": str(exc)[:300],
                })

    return {
        "active_provider": DATABASE_PROVIDER,
        "created_application_id": test_doc["application_id"],
        "created_job_id": test_doc["job_id"],
        "read_by_application_id_found": by_application_id is not None,
        "read_by_user_id_job_id_found": by_user_job is not None,
        "read_by_application_id": {
            "application_id": (by_application_id or {}).get("application_id"),
            "user_id": (by_application_id or {}).get("user_id"),
            "job_id": (by_application_id or {}).get("job_id"),
        },
        "read_by_user_id_job_id": {
            "application_id": (by_user_job or {}).get("application_id"),
            "user_id": (by_user_job or {}).get("user_id"),
            "job_id": (by_user_job or {}).get("job_id"),
        },
        "backfill_scanned": len(rows),
        "backfilled_top_level_user_job": backfilled,
        "backfill_errors": backfill_errors,
    }


@api_router.get("/dev/docx-fallback-test")
async def dev_docx_fallback_test(user: User = Depends(get_current_user)):
    if not _dev_tools_enabled():
        raise HTTPException(status_code=404, detail="Not found")

    def failing_package_builder(profile: Dict[str, Any], generated: Dict[str, Any]) -> Dict[str, Any]:
        raise ValueError("All strings must be XML compatible: Unicode or ASCII, no NULL bytes or control characters")

    profile = {
        "user_id": user.user_id,
        "contact": {
            "name": f"{user.name}\x00",
            "email": user.email,
        },
        "cv_text": "Profile text\x00 with bad chars\x07",
        "cv_filename": "cv.docx",
        "cv_mime": DOCX_MIME,
    }
    job = {
        "job_id": f"job_docx_fallback_test_{uuid.uuid4().hex[:8]}",
        "title": "DOCX Fallback Test",
        "company": "Swiipr",
    }
    generated = {
        "tailored_resume": {
            "summary": "Summary with null\x00 and bell\x07 chars",
            "skills": ["Python\x01", "FastAPI"],
            "experience": [
                {
                    "role": "Engineer\x02",
                    "company": "Example",
                    "duration": "2020\x03",
                    "highlights": ["Built systems\x0B"],
                }
            ],
        },
        "tailored_cover_letter": {
            "greeting": "Hello\x00",
            "paragraphs": ["Cover letter paragraph\x07"],
            "sign_off": "Regards",
        },
        "application_answers": [],
        "match_score": 80,
        "match_reasons": ["Test"],
        "interview_prep": [],
    }
    try:
        doc = _build_generated_application_doc(user, profile, job, generated, package_builder=failing_package_builder)
    except Exception as exc:
        logger.exception("DOCX fallback test unexpectedly raised")
        return {
            "ok": False,
            "raised": True,
            "exception_class": exc.__class__.__name__,
            "message": str(exc)[:500],
        }
    return {
        "ok": True,
        "raised": False,
        "application_id": doc.get("application_id"),
        "package_status": doc.get("package_status"),
        "generation_status": doc.get("generation_status"),
        "generation_error": doc.get("generation_error"),
        "submission_status": doc.get("submission_status"),
        "tailored_cv_file_b64_is_none": doc.get("tailored_cv_file_b64") is None,
        "has_tailored_resume_text": bool(doc.get("tailored_resume") or doc.get("tailored_resume_structured")),
        "has_cover_letter_text": bool(doc.get("cover_letter") or doc.get("tailored_cover_letter")),
    }


@api_router.get("/dev/db-provider-test")
async def dev_db_provider_test():
    jobs_count = await db.jobs.count_documents({})
    company_boards_count = await db.company_boards.count_documents({})
    sample_jobs = await db.jobs.find({}, {"_id": 0}).limit(1).to_list(1)
    return {
        "active_provider": DATABASE_PROVIDER,
        "jobs_count": jobs_count,
        "company_boards_count": company_boards_count,
        "sample_job": sample_jobs[0] if sample_jobs else None,
    }


@api_router.get("/dev/jobs-query-debug")
async def dev_jobs_query_debug(
    user: User = Depends(get_current_user),
    limit: int = 5,
    search_radius: str = "50km",
    locations_json: Optional[str] = None,
    location: Optional[List[str]] = Query(None),
    location_label: Optional[str] = None,
    country: Optional[str] = None,
    country_code: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    only_my_country: bool = False,
):
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    profile_location_data = profile.get("target_location_data") or {}
    profile_country_code = (profile_location_data.get("country_code") or "").strip().lower()
    profile_country = profile_location_data.get("country")

    selected_locations: List[Dict[str, Any]] = []
    if locations_json:
        try:
            parsed_locations = json.loads(locations_json)
            if isinstance(parsed_locations, list):
                selected_locations = [loc for loc in parsed_locations if isinstance(loc, dict) and loc.get("location_label")]
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="locations_json must be a JSON array")
    if location_label:
        selected_locations = [{
            "location_label": location_label,
            "country": country,
            "country_code": country_code,
            "lat": lat,
            "lng": lng,
        }]
    if only_my_country:
        if profile_country_code:
            selected_locations = [
                {**loc, "country_code": profile_country_code, "country": profile_country or loc.get("country")}
                for loc in selected_locations
            ]
            if not selected_locations and profile_location_data:
                selected_locations = [profile_location_data]
        elif not selected_locations and profile_location_data:
            selected_locations = [profile_location_data]
    if not selected_locations and profile_location_data:
        selected_locations = [profile_location_data]

    selected_location_labels = [
        loc.get("location_label")
        for loc in selected_locations
        if isinstance(loc, dict) and loc.get("location_label")
    ]
    radius_scope = (search_radius or "50km").lower().strip()
    filter_locations = None
    if radius_scope not in ("worldwide", "remote", "remote/worldwide"):
        filter_locations = selected_location_labels or location
        if not filter_locations and only_my_country and profile_country:
            filter_locations = [profile_country]

    location_filter_clause = None
    if filter_locations:
        expanded_filter_locations = set()
        for loc in filter_locations:
            expanded_filter_locations.add(loc)
            for part in re.split(r"[,/|-]", loc):
                part = part.strip()
                if len(part) >= 3:
                    expanded_filter_locations.add(part)
        location_filter_clause = {
            "$or": [
                {"location": {"$regex": re.escape(loc), "$options": "i"}}
                for loc in expanded_filter_locations
            ]
        }

    swiped = await db.swipes.find({"user_id": user.user_id}, {"_id": 0, "job_id": 1}).to_list(2000)
    swiped_ids = {item.get("job_id") for item in swiped if item.get("job_id")}

    target_role = (
        profile.get("target_role")
        or ((profile.get("target_roles") or [None])[0])
        or ""
    ).strip()

    def _tokens(value: str) -> List[str]:
        stop = {"and", "or", "the", "a", "an", "of", "for", "to", "in", "with", "remote", "jobs", "job"}
        return [token for token in re.findall(r"[a-z0-9]+", (value or "").lower()) if len(token) > 2 and token not in stop]

    role_tokens = _tokens(target_role)
    broader_role_tokens = role_tokens[-1:] if role_tokens else []
    if "analyst" in role_tokens:
        broader_role_tokens = list(dict.fromkeys([*role_tokens, "analytics", "analysis", "insights", "scientist"]))
    if "software" in role_tokens and "engineer" in role_tokens:
        broader_role_tokens = ["software", "engineer"]

    def _role_score(job: Dict[str, Any], tokens: List[str]) -> int:
        if not tokens:
            return 0
        title = (job.get("title") or "").lower()
        body = " ".join([
            job.get("description") or "",
            job.get("clean_description") or "",
            " ".join(job.get("requirements") or []),
        ]).lower()
        title_hits = sum(1 for token in tokens if token in title)
        body_hits = sum(1 for token in tokens if token in body)
        exact_bonus = 25 if target_role and target_role.lower() in title else 0
        return exact_bonus + title_hits * 20 + min(body_hits, len(tokens)) * 5

    def _role_matches(job: Dict[str, Any]) -> bool:
        if not role_tokens:
            return True
        strict_score = _role_score(job, role_tokens)
        broad_score = _role_score(job, broader_role_tokens)
        return strict_score >= max(20, len(role_tokens) * 12) or broad_score >= 20

    def _location_matches(job: Dict[str, Any]) -> bool:
        if not location_filter_clause:
            return True
        job_location = (job.get("location") or "").lower()
        for clause in location_filter_clause.get("$or", []):
            regex = (clause.get("location") or {}).get("$regex")
            if regex and re.search(regex, job_location, re.IGNORECASE):
                return True
        return False

    def _sample_jobs(jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [
            {
                "job_id": job.get("job_id"),
                "title": job.get("title"),
                "company": job.get("company"),
                "provider": job.get("provider"),
                "ats_provider": job.get("ats_provider"),
                "auto_apply_supported": job.get("auto_apply_supported"),
                "location": job.get("location"),
            }
            for job in jobs[:5]
        ]

    async def _compare_source(source_name: str, jobs_collection: Any) -> Dict[str, Any]:
        auto_query = {"auto_apply_supported": True}
        ats_query = {**auto_query, "ats_provider": {"$in": ["greenhouse", "lever", "ashby"]}}
        swiped_query = dict(ats_query)
        if swiped_ids:
            swiped_query["job_id"] = {"$nin": list(swiped_ids)}
        location_query = dict(swiped_query)
        if location_filter_clause:
            location_query.setdefault("$and", []).append(location_filter_clause)

        total_jobs = await jobs_collection.count_documents({})
        auto_apply_supported_count = await jobs_collection.count_documents(auto_query)
        ats_provider_supported_count = await jobs_collection.count_documents(ats_query)
        after_swipe_exclusion_count = await jobs_collection.count_documents(swiped_query)

        stage_candidates = await jobs_collection.find(swiped_query, {"_id": 0}).limit(5000).to_list(5000)
        after_role = [job for job in stage_candidates if _role_matches(job)]
        after_location = [job for job in after_role if _location_matches(job)]
        after_location.sort(
            key=lambda job: (
                _role_score(job, role_tokens),
                str(job.get("imported_at") or job.get("posted_at") or ""),
            ),
            reverse=True,
        )
        final_jobs = after_location[:limit]

        adapter_location_count = await jobs_collection.count_documents(location_query)
        return {
            "source": source_name,
            "counts": {
                "total_jobs": total_jobs,
                "auto_apply_supported_count": auto_apply_supported_count,
                "ats_provider_supported_count": ats_provider_supported_count,
                "after_swipe_exclusion_count": after_swipe_exclusion_count,
                "after_role_filter_count": len(after_role),
                "after_location_filter_count": len(after_location),
                "final_count": len(final_jobs),
            },
            "adapter_location_filter_count": adapter_location_count,
            "sample_jobs": _sample_jobs(final_jobs),
        }

    active_result = await _compare_source(_runtime_collection_provider("jobs"), db.jobs)

    return {
        "active_provider": DATABASE_PROVIDER,
        "user_id": user.user_id,
        "target_role": target_role or None,
        "role_tokens": role_tokens,
        "broader_role_tokens": broader_role_tokens,
        "swiped_job_ids_count": len(swiped_ids),
        "filters": {
            "auto_apply_supported": True,
            "ats_provider": ["greenhouse", "lever", "ashby"],
            "selected_locations": selected_location_labels,
            "location_query": location,
            "search_radius": search_radius,
            "only_my_country": only_my_country,
            "country_code": country_code or profile_country_code or None,
            "location_filter_clause": location_filter_clause,
        },
        "supabase": active_result,
        "supabase_sample_jobs": active_result.get("sample_jobs", []) if active_result.get("source") == "supabase" else [],
    }


def _runtime_collection_provider(collection_name: str) -> str:
    collection = getattr(db, collection_name)
    module_name = collection.__class__.__module__
    if "supabase_adapter" in module_name:
        return "supabase"
    return "unknown"


@api_router.get("/dev/database-usage-audit")
async def dev_database_usage_audit():
    audited_collections = [
        "users",
        "user_sessions",
        "profiles",
        "jobs",
        "applications",
        "gmail_connections",
        "application_emails",
        "swipes",
        "company_boards",
        "browser_submission_runs",
    ]
    collection_providers = {
        collection_name: _runtime_collection_provider(collection_name)
        for collection_name in audited_collections
    }

    route_collections = {
        "login:/api/auth/supabase-session": ["users", "user_sessions", "profiles", "gmail_connections"],
        "auth_me:/api/auth/me": ["user_sessions", "users", "profiles"],
        "profile:/api/profile*": ["user_sessions", "users", "profiles", "swipes", "applications"],
        "swipes:/api/swipe*": ["user_sessions", "users", "swipes", "jobs", "profiles", "applications"],
        "applications:/api/applications*": ["user_sessions", "users", "applications", "jobs", "profiles", "browser_submission_runs"],
        "emails:/api/emails*": ["user_sessions", "users", "gmail_connections", "application_emails", "applications", "jobs"],
        "jobs_feed:/api/jobs/feed": ["user_sessions", "users", "profiles", "swipes", "jobs"],
        "company_boards:startup_and_import_dev_routes": ["company_boards", "jobs"],
    }

    route_details: Dict[str, Any] = {}
    routes_using_supabase: List[str] = []
    for route_name, collections in route_collections.items():
        providers = sorted({collection_providers[collection] for collection in collections})
        route_details[route_name] = {
            "collections": collections,
            "providers": providers,
            "uses_supabase": "supabase" in providers,
        }
        if "supabase" in providers:
            routes_using_supabase.append(route_name)

    return {
        "provider": DATABASE_PROVIDER,
        "collections_using_supabase": [
            name for name, provider in collection_providers.items() if provider == "supabase"
        ],
        "collections_using_mongo": [],
        "routes_using_supabase": routes_using_supabase,
        "routes_using_mongo": [],
        "collection_providers": collection_providers,
        "route_details": route_details,
        "notes": [
            "This endpoint inspects the live db object currently bound in server.py.",
            "All runtime collections use Supabase.",
            "Provider refresh/import writes use the active database adapter for jobs and company_boards.",
        ],
    }


@api_router.get("/dev/job-debug/{job_id}")
async def dev_job_debug(job_id: str):
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    job = await db.jobs.find_one(
        {"job_id": job_id},
        {"_id": 0, "title": 1, "description": 1, "clean_description": 1, "job_description_sections": 1, "requirements": 1},
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@api_router.get("/dev/greenhouse-jobs-sample")
async def dev_greenhouse_jobs_sample():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    jobs = await db.jobs.find(
        {"ats_provider": "greenhouse", "auto_apply_supported": True},
        {
            "_id": 0,
            "job_id": 1,
            "external_id": 1,
            "title": 1,
            "company": 1,
            "external_url": 1,
            "provider": 1,
            "ats_provider": 1,
        },
    ).limit(10).to_list(10)
    return {"jobs": jobs, "count": len(jobs)}


@api_router.get("/dev/auto-apply-jobs-by-provider")
async def dev_auto_apply_jobs_by_provider():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    providers = ["greenhouse", "lever", "ashby"]
    response: Dict[str, Any] = {}
    total_jobs = 0
    total_auto_apply_jobs = 0
    for provider in providers:
        query = {"ats_provider": provider, "auto_apply_supported": True}
        count = await db.jobs.count_documents(query)
        total_auto_apply_jobs += count
        candidates = await db.jobs.find(
            query,
            {
                "_id": 0,
                "job_id": 1,
                "title": 1,
                "company": 1,
                "external_url": 1,
                "ats_provider": 1,
                "provider": 1,
                "imported_at": 1,
                "last_seen_at": 1,
            },
        ).sort([("company", 1), ("imported_at", -1)]).limit(500).to_list(500)

        sample_jobs = []
        overflow_jobs = []
        seen_companies = set()
        for job in candidates:
            company_key = (job.get("company") or "").strip().lower()
            sample = {
                "job_id": job.get("job_id"),
                "title": job.get("title"),
                "company": job.get("company"),
                "external_url": job.get("external_url"),
                "ats_provider": job.get("ats_provider"),
                "provider": job.get("provider"),
            }
            if company_key and company_key not in seen_companies:
                sample_jobs.append(sample)
                seen_companies.add(company_key)
            else:
                overflow_jobs.append(sample)
            if len(sample_jobs) >= 20:
                break
        if len(sample_jobs) < 20:
            sample_jobs.extend(overflow_jobs[: 20 - len(sample_jobs)])

        response[provider] = {
            "count": count,
            "sample_jobs": sample_jobs[:20],
        }

    total_jobs = await db.jobs.count_documents({})
    return {
        "total_jobs": total_jobs,
        "total_auto_apply_jobs": total_auto_apply_jobs,
        "providers": response,
    }


@api_router.get("/dev/clean-job-descriptions")
async def dev_clean_job_descriptions():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    provider = get_board_provider("greenhouse")

    def has_html(value: Any) -> bool:
        return bool(re.search(r"</?[a-z][\s\S]*?>", str(value or ""), flags=re.IGNORECASE))

    def clean_sections(sections: Any) -> List[Dict[str, Any]]:
        cleaned = []
        if not isinstance(sections, list):
            return cleaned
        for section in sections:
            if not isinstance(section, dict):
                continue
            title = provider.sanitize_text(section.get("title"))
            bullets = [
                provider.sanitize_text(bullet)
                for bullet in (section.get("bullets") or [])
                if provider.sanitize_text(bullet)
            ]
            if title and bullets:
                cleaned.append({"title": title, "bullets": bullets})
        return cleaned

    scanned = 0
    updated = 0
    sample_remaining_ids: List[str] = []
    cursor = db.jobs.find(
        {},
        {"_id": 0, "job_id": 1, "description": 1, "clean_description": 1, "job_description_sections": 1, "requirements": 1},
    )
    async for job in cursor:
        scanned += 1
        description = provider.sanitize_text(job.get("description"))
        clean_description = provider.sanitize_text(job.get("clean_description") or description)
        sections = clean_sections(job.get("job_description_sections"))
        requirements = [
            provider.sanitize_text(item)
            for item in (job.get("requirements") or [])
            if provider.sanitize_text(item)
        ]
        update = {
            "description": description,
            "clean_description": clean_description,
            "job_description_sections": sections,
            "requirements": requirements,
        }
        if (
            update["description"] != job.get("description")
            or update["clean_description"] != job.get("clean_description")
            or update["job_description_sections"] != (job.get("job_description_sections") or [])
            or update["requirements"] != (job.get("requirements") or [])
        ):
            await db.jobs.update_one({"job_id": job["job_id"]}, {"$set": update})
            updated += 1

    remaining_html_count = 0
    cursor = db.jobs.find(
        {},
        {"_id": 0, "job_id": 1, "description": 1, "clean_description": 1, "job_description_sections": 1, "requirements": 1},
    )
    async for job in cursor:
        contains_html = has_html(job.get("description")) or has_html(job.get("clean_description"))
        for section in job.get("job_description_sections") or []:
            contains_html = contains_html or has_html(section.get("title"))
            contains_html = contains_html or any(has_html(bullet) for bullet in section.get("bullets") or [])
        contains_html = contains_html or any(has_html(item) for item in job.get("requirements") or [])
        if contains_html:
            remaining_html_count += 1
            if len(sample_remaining_ids) < 10:
                sample_remaining_ids.append(job.get("job_id"))

    return {
        "scanned": scanned,
        "updated": updated,
        "remaining_html_count": remaining_html_count,
        "sample_remaining_ids": sample_remaining_ids,
    }


# ===================== Wire up =====================

register_training_routes(api_router, get_current_user, db, _require_training_user, _get_training_access_payload)
register_training_admin_routes(api_router, require_admin_user, db, _enrich_invite_rows_for_admin)
register_feedback_routes(api_router, get_current_user, require_admin_user)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _startup_seed_impl():
    """Seed boards and training content without blocking HTTP readiness."""
    try:
        await migrate_file_invites_to_db(db)
        await bootstrap_invites_from_influencers(db)
        await backfill_invites_from_users(db)
        await ensure_dev_test_invites(db)
        await seed_greenhouse_company_boards(db)
        await seed_lever_company_boards(db)
        await seed_training_content(db)
        await sync_training_locale_content(db)
        await ensure_training_enrollments_for_access_users(db)

        fallback_mock = os.environ.get("JOB_PROVIDER_FALLBACK_MOCK", "false").lower() in ("1", "true", "yes", "on")
        if not fallback_mock:
            return

        count = await db.jobs.count_documents({})
        if count == 0:
            now = datetime.now(timezone.utc).isoformat()
            docs = [{
                "job_id": f"job_{uuid.uuid4().hex[:10]}",
                "currency": "USD",
                "posted_at": now,
                **j,
            } for j in MOCK_JOBS]
            await db.jobs.insert_many(docs)
            logger.info(f"Seeded {len(docs)} jobs")
    except Exception as e:
        logger.warning(f"Seed failed: {e}")


@app.on_event("startup")
async def startup_seed():
    """Register routes immediately; run seeding in the background."""
    logger.info("DB health route registered at /api/dev/db-health")
    logger.info("DB counts route registered at /api/dev/db-counts")
    logger.info(
        "Startup env debug: DEV_TOOLS_ENABLED=%r ENVIRONMENT=%r PORT=%r",
        os.environ.get("DEV_TOOLS_ENABLED"),
        os.environ.get("ENVIRONMENT"),
        os.environ.get("PORT"),
    )
    asyncio.create_task(_startup_seed_impl())
    asyncio.create_task(_resume_pending_application_generation())


@app.on_event("shutdown")
async def shutdown_db_client():
    await db.close()
