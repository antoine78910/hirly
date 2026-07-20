"""Job import/cache service.

Supabase is the source of truth. External providers import normalized jobs into
the active database adapter.
"""

import hashlib
import logging
import os
import re
import time
import unicodedata
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx

from employment_kind import contract_type_query_hint, enrich_job_employment_kind, resolve_profile_contract_type
from profile_search_preferences import (
    resolve_profile_target_location_data,
    resolve_profile_target_location_label,
    resolve_profile_target_role,
)
from job_normalization import (
    build_job_fingerprint,
    canonicalize_apply_url,
    classify_dedup_pair,
    sanitize_display_title,
)
from job_providers import (
    get_board_provider,
    get_job_provider,
    is_france_travail_provider,
    is_job_provider_configured,
    is_job_provider_enabled,
    primary_job_provider_name,
)
from job_providers.apply_eligibility import is_manual_fulfillment_ready
from job_providers.base import BoardQuery, JobSearchQuery
from job_validation import cheap_validate_job_applyability
from location_intelligence import country_to_jsearch_language
from role_query_terms import resolve_role_query_term

logger = logging.getLogger(__name__)
_PROVIDER_COOLDOWN_UNTIL: Dict[str, datetime] = {}
_PROVIDER_RATE_LIMIT_COOLDOWN_MINUTES = 15
FEED_COVERAGE_EVALUATOR_VERSION = "feed-coverage-v1"

GREENHOUSE_SEED_BOARDS = [
    ("stripe", "Stripe"),
    ("airbnb", "Airbnb"),
    ("discord", "Discord"),
    ("figma", "Figma"),
    ("reddit", "Reddit"),
    ("notion", "Notion"),
    ("coinbase", "Coinbase"),
    ("scaleai", "Scale AI"),
    ("chime", "Chime"),
    ("brex", "Brex"),
]

LEVER_SEED_BOARDS = [
    ("tsmg", "TSMG"),
    ("paytmpayments", "Paytm Payments Services"),
    ("paytm", "Paytm"),
    ("shieldai", "Shield AI"),
    ("spotify", "Spotify"),
    ("coupa", "Coupa"),
    ("peerspace", "Peerspace"),
    ("dnb", "Dun & Bradstreet"),
    ("hcvt", "HCVT"),
    ("bonedry", "Bone Dry Roofing"),
]

LEGACY_INVALID_LEVER_SEED_SITES = [
    "asana",
    "canonical",
    "databricks",
    "gusto",
    "netlify",
    "postman",
    "retool",
    "zapier",
    "mercury",
    "headway",
]


def hash_feed_coverage_user_id(user_id: str, *, salt: Optional[str] = None) -> str:
    """Return a stable, non-reversible identifier for coverage audit output."""
    hash_salt = salt or os.environ.get("COVERAGE_AUDIT_HASH_SALT") or os.environ.get("SESSION_SECRET")
    if not hash_salt:
        raise RuntimeError("COVERAGE_AUDIT_HASH_SALT or SESSION_SECRET is required")
    return hashlib.sha256(f"{hash_salt}:{user_id}".encode("utf-8")).hexdigest()


def build_feed_coverage_snapshot(
    *,
    user_id: str,
    profile: Dict[str, Any],
    feed_response: Dict[str, Any],
    evaluated_at: Optional[datetime] = None,
    freshness_window_days: int = 30,
    hash_salt: Optional[str] = None,
) -> Dict[str, Any]:
    """Summarize an already-evaluated no-refresh feed without mutating state."""
    evaluated_at = evaluated_at or datetime.now(timezone.utc)
    jobs = [job for job in (feed_response.get("jobs") or []) if isinstance(job, dict)]

    def _identity(job: Dict[str, Any]) -> str:
        return str(
            job.get("canonical_group_id")
            or (
                f"{job.get('provider')}:{job.get('external_id')}"
                if job.get("provider") and job.get("external_id")
                else job.get("job_id")
            )
            or ""
        )

    def _is_actionable(job: Dict[str, Any]) -> bool:
        return str(job.get("application_mode") or "").strip().lower() in {
            "auto_apply",
            "assisted",
            "manual",
        }

    def _is_fresh(job: Dict[str, Any]) -> bool:
        raw = job.get("posted_at") or job.get("first_seen_at") or job.get("imported_at")
        if not raw:
            return False
        try:
            parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return False
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed >= evaluated_at - timedelta(days=freshness_window_days)

    actionable_jobs = [job for job in jobs if _is_actionable(job)]
    unique_ids = {_identity(job) for job in jobs if _identity(job)}
    source_set = sorted({str(job.get("provider")) for job in jobs if job.get("provider")})
    empty_reason = feed_response.get("empty_reason")
    terminal_reason = (
        empty_reason.get("code")
        if isinstance(empty_reason, dict) and empty_reason.get("code")
        else feed_response.get("fallback_used")
        or ("RESULTS_RETURNED" if jobs else "NO_RESULTS")
    )
    profile_location = profile.get("target_location_data") if isinstance(profile.get("target_location_data"), dict) else {}

    return {
        "user_id": hash_feed_coverage_user_id(user_id, salt=hash_salt),
        "cohort_dimensions": {
            "country_code": str(profile_location.get("country_code") or "").lower() or None,
            "remote_preference": profile.get("remote_preference") or None,
        },
        "evaluated_at": evaluated_at.isoformat(),
        "source_set": source_set,
        "coverage_scope": "ordered_no_refresh_feed",
        "freshness_window_days": freshness_window_days,
        "relevant_total": len(jobs),
        "fresh_relevant_total": sum(1 for job in jobs if _is_fresh(job)),
        "unique_total": len(unique_ids),
        "actionable_total": len(actionable_jobs),
        "unseen_actionable_total": len(actionable_jobs),
        "route_known_count": sum(
            1
            for job in jobs
            if str(job.get("ats_provider") or "").strip().lower() not in {"", "unknown", "none"}
        ),
        "direct_employer_count": sum(
            1
            for job in jobs
            if str(job.get("provider") or "").strip().lower()
            in {"greenhouse", "lever", "ashby", "recruitee", "personio", "smartrecruiters", "teamtailor"}
        ),
        "ordered_eligible_job_ids": [str(job.get("job_id")) for job in jobs if job.get("job_id")],
        "terminal_reason": terminal_reason,
        "evaluator_version": FEED_COVERAGE_EVALUATOR_VERSION,
    }


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


def _country_and_location(target_location: Optional[str]) -> Tuple[str, Optional[str]]:
    location = (target_location or "").strip() or None
    text = (location or "").lower()
    country = os.environ.get("JSEARCH_COUNTRY", "us")

    if any(term in text for term in ("royaume-uni", "united kingdom", "uk", "england", "london", "egham")):
        country = "gb"
        if location:
            location = location.replace("Royaume-Uni", "United Kingdom").replace("royaume-uni", "United Kingdom")
    elif _looks_like_france_location(text):
        country = "fr"
    elif any(term in text for term in ("morocco", "maroc", "casablanca")):
        country = "ma"

    return country, location


def _looks_like_france_location(text: str) -> bool:
    normalized = (text or "").lower()
    normalized_ascii = unicodedata.normalize("NFKD", normalized).encode("ascii", "ignore").decode("ascii")
    france_markers = {
        "france", "paris", "ile de france", "ile-de-france", "bordeaux", "lyon", "marseille",
        "toulouse", "nice", "nantes", "strasbourg", "lille", "montpellier", "rennes",
        "grenoble", "dijon", "limoges", "poitiers", "angers", "caen", "rouen", "reims",
        "metz", "nancy", "tours", "clermont ferrand", "clermont-ferrand", "besancon",
        "brest", "amiens", "orleans", "perpignan", "bayonne", "pau", "la rochelle",
        "avignon", "annecy", "chambery", "valence", "nimes", "mulhouse", "colmar",
        "lorient", "vannes", "quimper", "saint etienne", "saint-etienne",
    }
    return any(marker in normalized_ascii for marker in france_markers)


def _country_and_location_from_data(location_data: Optional[Dict[str, Any]], fallback_location: Optional[str]) -> Tuple[str, Optional[str]]:
    if not location_data:
        return _country_and_location(fallback_location)

    location = (
        location_data.get("location_label")
        or location_data.get("label")
        or fallback_location
    )
    country_code = (location_data.get("country_code") or "").strip().lower()
    if country_code:
        return country_code, location
    return _country_and_location(location)


def _language_for_country(country: Optional[str]) -> str:
    explicit = os.environ.get("JSEARCH_LANGUAGE")
    if explicit:
        return explicit
    return country_to_jsearch_language(country)


def _next_radius(search_radius: str) -> Optional[str]:
    radius = _radius_km(search_radius)
    if radius is None or radius >= 500:
        return None
    return f"{min(500, radius + 50)}km"


def _radius_km(search_radius: str) -> Optional[int]:
    text = (search_radius or "").lower().strip()
    if not text.endswith("km"):
        return None
    try:
        return max(10, min(500, int(text[:-2])))
    except ValueError:
        return None


def build_profile_job_query(
    profile: Dict[str, Any],
    location_override: Optional[str] = None,
    location_data_override: Optional[Dict[str, Any]] = None,
    search_radius: str = "50km",
    role_override: Optional[str] = None,
) -> JobSearchQuery:
    radius_scope = (search_radius or "").lower().strip()
    if role_override is not None:
        role = role_override.strip()
    else:
        role = resolve_profile_target_role(profile)
    requested_location = location_override or resolve_profile_target_location_label(profile) or None
    location_data = location_data_override or resolve_profile_target_location_data(profile) or None
    country, location = _country_and_location_from_data(location_data, requested_location)
    if radius_scope in ("country", "country-wide"):
        location = _country_name(country) or location
    elif radius_scope in ("remote", "remote/worldwide", "worldwide"):
        location = None
    if radius_scope in ("worldwide", "remote/worldwide"):
        country = None
    remote_preference = "remote" if str(profile.get("remote_preference") or "").lower().strip() == "remote" else "any"
    if radius_scope in ("remote", "remote/worldwide"):
        remote_preference = "remote"
    query_language = _language_for_country(country)
    contract_hint = contract_type_query_hint(resolve_profile_contract_type(profile), query_language)
    # A handful of role labels are ambiguous or homonymous across languages
    # (e.g. "Chef" / "Cuisinier" -- bare "chef" in French means "lead", not
    # specifically a cook, and collides with unrelated titles like "chef de
    # mission"). Resolve to the search term that's safe for the TARGET
    # MARKET's language, not the profile's UI language; unknown roles pass
    # through unchanged.
    resolved_role = resolve_role_query_term(role, query_language)
    if resolved_role != role:
        logger.info("Role search term disambiguated: original=%s resolved=%s language=%s", role, resolved_role, query_language)
    role = resolved_role
    logger.info(
        "JSearch query location normalized: country=%s location=%s radius=%s role=%s contract_hint=%s",
        country, location, search_radius, role, contract_hint,
    )
    return JobSearchQuery(
        role=role,
        location=location,
        remote_preference=remote_preference,
        country=country,
        language=query_language,
        limit=max(20, min(_env_int("JOB_IMPORT_LIMIT", 50), 100)),
        contract_hint=contract_hint,
        radius_km=_radius_km(search_radius),
    )


def _country_name(country: str) -> Optional[str]:
    return {"fr": "France", "gb": "United Kingdom", "ma": "Morocco", "us": "United States"}.get((country or "").lower())


def _dedupe(values: List[Optional[str]]) -> List[Optional[str]]:
    seen = set()
    out: List[Optional[str]] = []
    for value in values:
        key = (value or "").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def _cooldown_until(provider_name: str) -> Optional[datetime]:
    until = _PROVIDER_COOLDOWN_UNTIL.get(provider_name)
    if until and until > datetime.now(timezone.utc):
        return until
    if until:
        _PROVIDER_COOLDOWN_UNTIL.pop(provider_name, None)
    return None


def _set_rate_limit_cooldown(provider_name: str) -> datetime:
    until = datetime.now(timezone.utc) + timedelta(minutes=_PROVIDER_RATE_LIMIT_COOLDOWN_MINUTES)
    _PROVIDER_COOLDOWN_UNTIL[provider_name] = until
    return until


def _is_rate_limit_error(exc: Exception) -> bool:
    return (
        isinstance(exc, httpx.HTTPStatusError)
        and exc.response is not None
        and exc.response.status_code == 429
    )


def _nearby_locations(query: JobSearchQuery, search_radius: str) -> List[Optional[str]]:
    radius = (search_radius or "50km").lower()
    radius_km = _radius_km(radius)
    if radius_km is not None and radius_km <= 25:
        return [query.location]
    if radius_km is not None:
        return [query.location, *_fallback_locations(query)]
    if radius in ("country", "country-wide"):
        return [_country_name(query.country) or query.location]
    if radius in ("remote", "remote/worldwide", "worldwide"):
        return [None]
    return [query.location, *_fallback_locations(query)]


def _fallback_locations(query: JobSearchQuery) -> List[Optional[str]]:
    location_text = (query.location or "").lower()
    locations: List[Optional[str]] = []

    if query.country == "gb" or any(term in location_text for term in ("egham", "united kingdom", "royaume-uni", "london")):
        locations = ["Egham, United Kingdom", "London, United Kingdom", "United Kingdom"]
    elif query.country == "fr" or _looks_like_france_location(location_text):
        city = re.split(r"[,/|-]", query.location or "", maxsplit=1)[0].strip().lower()
        if city and city not in {"france"} and len(city) >= 3:
            locations = []
        else:
            locations = ["France", "Paris, France", "Ile-de-France, France", "Lyon, France", "Bordeaux, France"]
    elif query.country == "ma" or any(term in location_text for term in ("casablanca", "morocco", "maroc")):
        locations = ["Casablanca, Morocco", "Morocco"]
    elif query.country and query.country != os.environ.get("JSEARCH_COUNTRY", "us"):
        country_names = {"fr": "France", "gb": "United Kingdom", "ma": "Morocco"}
        locations = [country_names.get(query.country)]

    seen = {query.location}
    return [loc for loc in locations if loc and loc not in seen]


def _ensure_job_id(job: Dict[str, Any]) -> Dict[str, Any]:
    """Guarantee a stable PK for batch upserts (PostgREST on_conflict=job_id)."""
    if job.get("job_id"):
        return job
    provider = str(job.get("provider") or "unknown")
    external_id = str(job.get("external_id") or "")
    if not external_id:
        return job
    digest = hashlib.sha1(f"{provider}:{external_id}".encode("utf-8")).hexdigest()[:16]
    job["job_id"] = f"job_{digest}"
    return job


def _prepare_job_for_upsert(job: Dict[str, Any]) -> Dict[str, Any]:
    prepared = enrich_job_employment_kind(dict(job))
    sanitized_title = sanitize_display_title(prepared.get("title"), fallback=prepared.get("rome_label"))
    if sanitized_title:
        prepared["title"] = sanitized_title
    prepared = _with_cheap_validation(prepared)
    prepared["fingerprint"] = prepared.get("fingerprint") or build_job_fingerprint(prepared)
    prepared["canonical_apply_url"] = canonicalize_apply_url(
        prepared.get("selected_apply_url") or prepared.get("external_url")
    )
    return _ensure_job_id(prepared)


def _candidate_key(classification: str, job: Dict[str, Any]) -> Optional[str]:
    if classification == "canonical_url_candidate":
        return job.get("canonical_apply_url") or canonicalize_apply_url(
            job.get("selected_apply_url") or job.get("external_url")
        )
    if classification == "ats_id_candidate":
        provider = str(job.get("ats_provider") or "").lower()
        ats_job_id = str(job.get("ats_job_id") or "")
        return f"{provider}:{ats_job_id}" if provider and ats_job_id else None
    if classification == "fingerprint_candidate":
        return job.get("fingerprint") or build_job_fingerprint(job)
    return None


async def _write_job_chunk(
    db,
    chunk: List[Dict[str, Any]],
    *,
    provider_claim: Optional[Dict[str, Any]] = None,
) -> None:
    """Persist a chunk of jobs — prefer multi-row upsert, fall back to update_one."""
    if not chunk:
        return
    providers = {str(job.get("provider") or "") for job in chunk}
    if "france_travail" in providers:
        if not provider_claim:
            raise RuntimeError("France Travail canonical writes require one provider claim")
        other_jobs = [
            job for job in chunk if str(job.get("provider") or "") != "france_travail"
        ]
        if other_jobs:
            await _write_job_chunk(db, other_jobs)
        chunk = [
            job for job in chunk if str(job.get("provider") or "") == "france_travail"
        ]
        guarded_upsert = getattr(db, "upsert_python_provider_jobs", None)
        if not callable(guarded_upsert):
            raise RuntimeError("France Travail provider claim RPC is unavailable")
        written = await guarded_upsert(provider_claim, chunk)
        if written != len(chunk):
            raise RuntimeError("France Travail provider claim write was incomplete")
        return
    insert_many = getattr(db.jobs, "insert_many", None)
    if callable(insert_many):
        try:
            await insert_many(chunk)
            return
        except Exception as exc:
            logger.warning(
                "job_batch_insert_many_failed size=%s error=%s; falling back to update_one",
                len(chunk),
                exc,
            )
    for job in chunk:
        await db.jobs.update_one(
            {"provider": job["provider"], "external_id": job["external_id"]},
            {"$set": job},
            upsert=True,
        )


async def _import_provider_jobs(db, provider, query: JobSearchQuery) -> Dict[str, int]:
    provider_claim = None
    is_france_travail = is_france_travail_provider(getattr(provider, "name", ""))
    if is_france_travail:
        claim = getattr(db, "claim_python_provider_work", None)
        if not callable(claim):
            raise RuntimeError("France Travail provider ownership claim is unavailable")
        provider_claim = await claim("france_travail")
    try:
        result = await provider.search(query)
        prepared_jobs = [_prepare_job_for_upsert(job) for job in (result.jobs or [])]
        if is_france_travail and prepared_jobs:
            heartbeat = getattr(db, "heartbeat_python_provider_work", None)
            if not callable(heartbeat) or not await heartbeat(provider_claim):
                raise RuntimeError("France Travail provider ownership claim became stale")
        batch_stats = await _upsert_job_batch(
            db,
            prepared_jobs,
            already_prepared=True,
            provider_claim=provider_claim,
        )
        return {
            **batch_stats,
            "jobs": prepared_jobs,
        }
    finally:
        if provider_claim is not None:
            finish = getattr(db, "finish_python_provider_work", None)
            if callable(finish):
                try:
                    await finish(provider_claim)
                except Exception as exc:
                    logger.warning("France Travail provider claim finish failed: %s", exc)


async def _upsert_job_batch(
    db,
    jobs: List[Dict[str, Any]],
    progress: Optional[Dict[str, Any]] = None,
    progress_base: int = 0,
    *,
    already_prepared: bool = False,
    provider_claim: Optional[Dict[str, Any]] = None,
) -> Dict[str, int]:
    stats = {
        "total_imported": 0,
        "inserted": 0,
        "updated": 0,
        "reactivated": 0,
        "exact_duplicate": 0,
        "fuzzy_duplicate_candidates": 0,
        "dedup_candidate_links": 0,
        "write_failed": 0,
        "auto_apply_supported_imported": 0,
        "unknown_ats_imported": 0,
    }
    if not jobs:
        return stats

    prepared: List[Dict[str, Any]] = []
    seen_prepared_ids: set[str] = set()
    for job in jobs:
        row = job if already_prepared else _prepare_job_for_upsert(job)
        if not row.get("provider") or not row.get("external_id") or not row.get("job_id"):
            logger.warning(
                "job_upsert_skip missing_keys provider=%s external_id=%s job_id=%s",
                row.get("provider"),
                row.get("external_id"),
                row.get("job_id"),
            )
            continue
        stable_id = str(row["job_id"])
        if stable_id in seen_prepared_ids:
            stats["exact_duplicate"] += 1
            continue
        seen_prepared_ids.add(stable_id)
        prepared.append(row)

    existing_rows = await db.jobs.find(
        {"job_id": {"$in": [row["job_id"] for row in prepared]}},
        {"_id": 0},
    ).limit(len(prepared)).to_list(len(prepared))
    existing_by_id = {str(row.get("job_id")): row for row in existing_rows if row.get("job_id")}
    candidate_rows_by_id: Dict[str, Dict[str, Any]] = {}
    candidate_filters = (
        ("canonical_apply_url", {row.get("canonical_apply_url") for row in prepared if row.get("canonical_apply_url")}),
        ("ats_job_id", {row.get("ats_job_id") for row in prepared if row.get("ats_job_id")}),
        ("fingerprint", {row.get("fingerprint") for row in prepared if row.get("fingerprint")}),
    )
    for field, values in candidate_filters:
        if not values:
            continue
        rows = await db.jobs.find(
            {field: {"$in": sorted(values)}}, {"_id": 0}
        ).limit(max(100, len(prepared) * 20)).to_list(max(100, len(prepared) * 20))
        for row in rows:
            if row.get("job_id"):
                candidate_rows_by_id[str(row["job_id"])] = row

    candidate_pairs: Dict[tuple[str, str, str], Dict[str, Any]] = {}
    comparison_rows = [*candidate_rows_by_id.values(), *prepared]
    for index, left in enumerate(comparison_rows):
        for right in comparison_rows[index + 1:]:
            left_id, right_id = str(left.get("job_id") or ""), str(right.get("job_id") or "")
            if not left_id or not right_id or left_id == right_id:
                continue
            classification = classify_dedup_pair(left, right)["classification"]
            if not classification.endswith("_candidate"):
                continue
            ordered = tuple(sorted((left_id, right_id)))
            key = _candidate_key(classification, left) or _candidate_key(classification, right)
            if not key:
                continue
            candidate_pairs[(ordered[0], ordered[1], classification)] = {
                "left_job_id": ordered[0],
                "right_job_id": ordered[1],
                "candidate_type": classification,
                "candidate_key": key,
            }
    stats["fuzzy_duplicate_candidates"] = len(candidate_pairs)

    chunk_size = max(10, min(_env_int("JOB_UPSERT_BATCH_SIZE", 75), 200))
    for offset in range(0, len(prepared), chunk_size):
        chunk = prepared[offset : offset + chunk_size]
        try:
            await _write_job_chunk(db, chunk, provider_claim=provider_claim)
        except Exception:
            stats["write_failed"] += len(chunk)
            raise
        stats["total_imported"] += len(chunk)
        if progress is not None:
            progress["jobs_upserted_so_far"] = progress_base + stats["total_imported"]
        for job in chunk:
            existing = existing_by_id.get(str(job["job_id"]))
            if existing is None:
                stats["inserted"] += 1
            elif (
                existing.get("fingerprint") == job.get("fingerprint")
                and existing.get("selected_apply_url") == job.get("selected_apply_url")
            ):
                stats["exact_duplicate"] += 1
            else:
                stats["updated"] += 1
                if existing.get("validation_status") == "invalid" and job.get("validation_status") != "invalid":
                    stats["reactivated"] += 1
            if job.get("auto_apply_supported") is True:
                stats["auto_apply_supported_imported"] += 1
            if job.get("ats_provider") == "unknown":
                stats["unknown_ats_imported"] += 1
    candidate_collection = getattr(db, "job_dedup_candidates", None)
    if candidate_pairs and candidate_collection is not None:
        now = datetime.now(timezone.utc).isoformat()
        links = []
        for candidate in candidate_pairs.values():
            digest = hashlib.sha256(
                "|".join((
                    candidate["left_job_id"],
                    candidate["right_job_id"],
                    candidate["candidate_type"],
                    candidate["candidate_key"],
                )).encode()
            ).hexdigest()
            links.append({
                "candidate_id": digest,
                **candidate,
                "created_at": now,
                "last_seen_at": now,
            })
        await candidate_collection.insert_many(links)
        stats["dedup_candidate_links"] = len(links)
    return stats


async def upsert_imported_jobs(
    db,
    jobs: List[Dict[str, Any]],
    progress: Optional[Dict[str, Any]] = None,
    progress_base: int = 0,
    *,
    provider_claim: Optional[Dict[str, Any]] = None,
) -> Dict[str, int]:
    """Persist imported jobs through the shared validation/upsert path."""
    return await _upsert_job_batch(
        db,
        jobs,
        progress=progress,
        progress_base=progress_base,
        provider_claim=provider_claim,
    )


def _with_cheap_validation(job: Dict[str, Any]) -> Dict[str, Any]:
    try:
        validation = cheap_validate_job_applyability(job)
    except Exception as exc:
        logger.warning("cheap job validation failed job_id=%s error=%s", job.get("job_id"), exc)
        validation = {
            "validation_status": "unknown",
            "validation_reason": f"Validator failed: {exc.__class__.__name__}",
            "validation_checked_at": datetime.now(timezone.utc).isoformat(),
            "applyability_tier": "C",
            "applyability_score": 0.45,
        }
    return {**job, **validation}


def _greenhouse_board_doc(token: str, company: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "board_id": f"greenhouse:{token}",
        "company": company,
        "ats_provider": "greenhouse",
        "board_token": token,
        "board_url": f"https://boards.greenhouse.io/{token}",
        "api_url": f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true",
        "enabled": True,
        "priority": 100,
        "countries": ["us", "gb", "remote"],
        "role_keywords": ["engineer", "analyst", "product", "marketing", "sales", "operations"],
        "last_synced_at": None,
        "last_success_at": None,
        "last_error": None,
        "failure_count": 0,
        "created_at": now,
        "updated_at": now,
    }


async def seed_greenhouse_company_boards(db) -> int:
    seeded = 0
    for token, company in GREENHOUSE_SEED_BOARDS:
        doc = _greenhouse_board_doc(token, company)
        result = await db.company_boards.update_one(
            {"board_id": doc["board_id"]},
            {
                "$setOnInsert": {
                    "board_id": doc["board_id"],
                    "created_at": doc["created_at"],
                },
                "$set": {
                    "company": doc["company"],
                    "ats_provider": "greenhouse",
                    "board_token": doc["board_token"],
                    "board_url": doc["board_url"],
                    "api_url": doc["api_url"],
                    "enabled": doc["enabled"],
                    "priority": doc["priority"],
                    "countries": doc["countries"],
                    "role_keywords": doc["role_keywords"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            },
            upsert=True,
        )
        if result.upserted_id is not None:
            seeded += 1
    return seeded


def _lever_board_doc(site: str, company: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "board_id": f"lever:{site}",
        "company": company,
        "ats_provider": "lever",
        "board_token": site,
        "board_url": f"https://jobs.lever.co/{site}",
        "api_url": f"https://api.lever.co/v0/postings/{site}?mode=json",
        "enabled": True,
        "priority": 90,
        "countries": ["us", "gb", "eu", "remote"],
        "role_keywords": ["engineer", "analyst", "product", "marketing", "sales", "operations"],
        "last_synced_at": None,
        "last_success_at": None,
        "last_error": None,
        "failure_count": 0,
        "created_at": now,
        "updated_at": now,
    }


async def seed_lever_company_boards(db) -> int:
    seeded = 0
    await db.company_boards.update_many(
        {"board_id": {"$in": [f"lever:{site}" for site in LEGACY_INVALID_LEVER_SEED_SITES]}},
        {"$set": {"enabled": False, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    for site, company in LEVER_SEED_BOARDS:
        doc = _lever_board_doc(site, company)
        result = await db.company_boards.update_one(
            {"board_id": doc["board_id"]},
            {
                "$setOnInsert": {
                    "board_id": doc["board_id"],
                    "created_at": doc["created_at"],
                },
                "$set": {
                    "company": doc["company"],
                    "ats_provider": "lever",
                    "board_token": doc["board_token"],
                    "board_url": doc["board_url"],
                    "api_url": doc["api_url"],
                    "enabled": doc["enabled"],
                    "priority": doc["priority"],
                    "countries": doc["countries"],
                    "role_keywords": doc["role_keywords"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            },
            upsert=True,
        )
        if result.upserted_id is not None:
            seeded += 1
    return seeded


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


async def refresh_greenhouse_boards(
    db,
    profile: Optional[Dict[str, Any]] = None,
    limit_boards: int = 10,
    force: bool = False,
    job_limit: Optional[int] = None,
    progress: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    started_at = time.perf_counter()
    limit_boards = max(1, min(int(limit_boards or 10), _env_int("MAX_PROVIDER_REFRESH_BOARDS", 25)))
    job_limit = max(1, min(int(job_limit or _env_int("GREENHOUSE_BOARD_JOB_LIMIT", 100)), 500))
    logger.info("refresh_start provider=greenhouse limit_boards=%s job_limit=%s force=%s", limit_boards, job_limit, force)
    await seed_greenhouse_company_boards(db)
    provider = get_board_provider("greenhouse")
    ttl_minutes = _env_int("GREENHOUSE_BOARD_IMPORT_TTL_MINUTES", 360)
    stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=ttl_minutes)
    boards = await db.company_boards.find(
        {"ats_provider": "greenhouse", "enabled": True},
        {"_id": 0},
    ).sort("priority", -1).limit(limit_boards).to_list(limit_boards)

    role = None
    location = None
    remote_preference = "any"
    country = None
    if profile:
        query = build_profile_job_query(profile)
        role = query.role
        location = query.location
        remote_preference = query.remote_preference
        country = query.country

    boards_checked = 0
    boards_successful = 0
    jobs_imported = 0
    auto_apply_supported_imported = 0
    sample_jobs: List[Dict[str, Any]] = []

    for board in boards:
        last_synced = _parse_iso_datetime(board.get("last_synced_at"))
        if not force and last_synced and last_synced >= stale_cutoff:
            continue

        boards_checked += 1
        if progress is not None:
            progress["boards_checked"] = boards_checked
            progress["last_board"] = board.get("board_token")
        now = datetime.now(timezone.utc).isoformat()
        board_query = BoardQuery(
            board_token=board["board_token"],
            company=board["company"],
            role=role,
            location=location,
            remote_preference=remote_preference,
            country=country,
            limit=job_limit,
        )
        try:
            inspection = await provider.inspect_board(board["board_token"])
            logger.info(
                "Greenhouse board check: board_token=%s api_url=%s status=%s jobs_count=%s error_snippet=%s",
                board["board_token"],
                inspection["api_url"],
                inspection["status_code"],
                inspection["jobs_count"],
                inspection["error_snippet"],
            )
            if inspection["status_code"] != 200:
                raise httpx.HTTPStatusError(
                    f"Greenhouse board returned {inspection['status_code']}",
                    request=httpx.Request("GET", inspection["api_url"]),
                    response=httpx.Response(
                        inspection["status_code"],
                        request=httpx.Request("GET", inspection["api_url"]),
                        text=inspection["error_snippet"] or "",
                    ),
                )
            result = await provider.search_board(board_query)
            stats = await _upsert_job_batch(db, result.jobs, progress=progress, progress_base=jobs_imported)
            jobs_imported += stats["total_imported"]
            if progress is not None:
                progress["jobs_upserted_so_far"] = jobs_imported
                progress["sample_jobs"] = [*progress.get("sample_jobs", []), *result.jobs[:5]][:5]
            auto_apply_supported_imported += stats["auto_apply_supported_imported"]
            if result.jobs and len(sample_jobs) < 5:
                sample_jobs.extend(result.jobs[: 5 - len(sample_jobs)])
            boards_successful += 1
            await db.company_boards.update_one(
                {"board_id": board["board_id"]},
                {
                    "$set": {
                        "last_synced_at": now,
                        "last_success_at": now,
                        "last_error": None,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
            )
            logger.info(
                "Greenhouse board refreshed: board=%s total_imported=%s auto_apply_supported_imported=%s",
                board["board_token"],
                stats["total_imported"],
                stats["auto_apply_supported_imported"],
            )
        except Exception as exc:
            await db.company_boards.update_one(
                {"board_id": board["board_id"]},
                {
                    "$set": {
                        "last_synced_at": now,
                        "last_error": str(exc)[:500],
                        "updated_at": now,
                    },
                    "$inc": {"failure_count": 1},
                },
            )
            logger.warning("Greenhouse board refresh failed: board=%s error=%s", board.get("board_token"), exc)

    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    logger.info(
        "refresh_end provider=greenhouse boards_checked=%s jobs_upserted=%s elapsed_ms=%s",
        boards_checked,
        jobs_imported,
        elapsed_ms,
    )
    return {
        "boards_checked": boards_checked,
        "boards_successful": boards_successful,
        "jobs_imported": jobs_imported,
        "auto_apply_supported_imported": auto_apply_supported_imported,
        "sample_jobs": sample_jobs,
        "elapsed_ms": elapsed_ms,
    }


async def refresh_lever_boards(
    db,
    profile: Optional[Dict[str, Any]] = None,
    limit_boards: int = 10,
    force: bool = False,
    job_limit: Optional[int] = None,
    progress: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    started_at = time.perf_counter()
    limit_boards = max(1, min(int(limit_boards or 10), _env_int("MAX_PROVIDER_REFRESH_BOARDS", 25)))
    job_limit = max(1, min(int(job_limit or _env_int("LEVER_BOARD_JOB_LIMIT", 100)), 500))
    logger.info("refresh_start provider=lever limit_boards=%s job_limit=%s force=%s", limit_boards, job_limit, force)
    await seed_lever_company_boards(db)
    provider = get_board_provider("lever")
    ttl_minutes = _env_int("LEVER_BOARD_IMPORT_TTL_MINUTES", 360)
    stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=ttl_minutes)
    boards = await db.company_boards.find(
        {"ats_provider": "lever", "enabled": True},
        {"_id": 0},
    ).sort("priority", -1).limit(limit_boards).to_list(limit_boards)

    role = None
    location = None
    remote_preference = "any"
    country = None
    if profile:
        query = build_profile_job_query(profile)
        role = query.role
        location = query.location
        remote_preference = query.remote_preference
        country = query.country

    boards_checked = 0
    boards_successful = 0
    jobs_imported = 0
    auto_apply_supported_imported = 0
    sample_jobs: List[Dict[str, Any]] = []

    for board in boards:
        last_synced = _parse_iso_datetime(board.get("last_synced_at"))
        if not force and last_synced and last_synced >= stale_cutoff:
            continue

        boards_checked += 1
        if progress is not None:
            progress["boards_checked"] = boards_checked
            progress["last_board"] = board.get("board_token")
        now = datetime.now(timezone.utc).isoformat()
        board_query = BoardQuery(
            board_token=board["board_token"],
            company=board["company"],
            role=role,
            location=location,
            remote_preference=remote_preference,
            country=country,
            limit=job_limit,
        )
        try:
            inspection = await provider.inspect_board(board["board_token"])
            logger.info(
                "Lever board check: site=%s primary_status=%s eu_status=%s jobs_count=%s primary_error_snippet=%s eu_error_snippet=%s",
                board["board_token"],
                inspection.get("primary_status"),
                inspection.get("eu_status"),
                inspection["jobs_count"],
                inspection.get("primary_error_snippet"),
                inspection.get("eu_error_snippet"),
            )
            if inspection["status_code"] != 200:
                raise httpx.HTTPStatusError(
                    f"Lever board returned {inspection['status_code']}",
                    request=httpx.Request("GET", inspection["api_url"]),
                    response=httpx.Response(
                        inspection["status_code"] or 500,
                        request=httpx.Request("GET", inspection["api_url"]),
                        text=inspection["error_snippet"] or "",
                    ),
                )
            result = await provider.search_board(board_query)
            stats = await _upsert_job_batch(db, result.jobs, progress=progress, progress_base=jobs_imported)
            jobs_imported += stats["total_imported"]
            if progress is not None:
                progress["jobs_upserted_so_far"] = jobs_imported
                progress["sample_jobs"] = [*progress.get("sample_jobs", []), *result.jobs[:5]][:5]
            auto_apply_supported_imported += stats["auto_apply_supported_imported"]
            if result.jobs and len(sample_jobs) < 5:
                sample_jobs.extend(result.jobs[: 5 - len(sample_jobs)])
            boards_successful += 1
            await db.company_boards.update_one(
                {"board_id": board["board_id"]},
                {
                    "$set": {
                        "last_synced_at": now,
                        "last_success_at": now,
                        "last_error": None,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
            )
            logger.info(
                "Lever board refreshed: site=%s total_imported=%s auto_apply_supported_imported=%s",
                board["board_token"],
                stats["total_imported"],
                stats["auto_apply_supported_imported"],
            )
        except Exception as exc:
            await db.company_boards.update_one(
                {"board_id": board["board_id"]},
                {
                    "$set": {
                        "last_synced_at": now,
                        "last_error": str(exc)[:500],
                        "updated_at": now,
                    },
                    "$inc": {"failure_count": 1},
                },
            )
            logger.warning("Lever board refresh failed: site=%s error=%s", board.get("board_token"), exc)

    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    logger.info(
        "refresh_end provider=lever boards_checked=%s jobs_upserted=%s elapsed_ms=%s",
        boards_checked,
        jobs_imported,
        elapsed_ms,
    )
    return {
        "boards_checked": boards_checked,
        "boards_successful": boards_successful,
        "jobs_imported": jobs_imported,
        "auto_apply_supported_imported": auto_apply_supported_imported,
        "sample_jobs": sample_jobs,
        "elapsed_ms": elapsed_ms,
    }


async def _count_recent_auto_apply_jobs(db, provider_name: str, stale_cutoff: str) -> int:
    return await db.jobs.count_documents({
        "provider": provider_name,
        "auto_apply_supported": True,
        "imported_at": {"$gte": stale_cutoff},
    })


def _role_variants(role: str) -> List[str]:
    normalized = " ".join((role or "").split()) or "software engineer"
    lower = normalized.lower()
    variants = [normalized]
    if lower == "market analyst":
        variants.append("Analyst")
    elif lower == "software engineer":
        variants.append("Engineer")
    elif "software engineer" in lower and lower != "software engineer":
        variants.append("Software Engineer")
    elif lower.endswith(" analyst") and lower != "analyst":
        variants.append("Analyst")
    elif lower.endswith(" engineer") and lower != "engineer":
        variants.append("Engineer")
    return [value for value in _dedupe(variants) if value]


def _localized_role_variants(role: str, country: Optional[str]) -> List[str]:
    normalized = " ".join((role or "").split()) or "software engineer"
    lower = normalized.lower()
    country_code = (country or "").lower()
    variants = [normalized]

    if country_code in ("fr", "ma", "be", "ch"):
        if any(term in lower for term in ("software", "engineer", "developer", "full stack", "full-stack", "frontend", "backend")):
            variants = ["developpeur", "developpeur logiciel", "ingenieur logiciel", normalized]
        elif "data" in lower and "analyst" in lower:
            variants = ["analyste data", "analyste donnees", normalized]
        elif "analyst" in lower:
            variants = ["analyste", "charge d'etudes", normalized]
        elif "product" in lower and "manager" in lower:
            variants = ["chef de produit", "product manager", normalized]
        elif "project" in lower and "manager" in lower:
            variants = ["chef de projet", normalized]
        elif any(term in lower for term in ("hr", "human resources", "resources humaines", "ressources humaines")):
            variants = ["assistant rh", "ressources humaines", "charge rh", "recrutement", normalized]
        elif any(term in lower for term in ("recruiter", "talent acquisition")):
            variants = ["recruteur", "charge de recrutement", "talent acquisition", normalized]
        elif any(term in lower for term in ("research", "researcher")):
            variants = ["charge de recherche", "charge d'etudes", "recherche", "r&d", normalized]
        elif any(term in lower for term in ("sales", "business development", "commercial")):
            variants = ["commercial", "vendeur", "conseiller commercial", normalized]
        elif "marketing" in lower:
            variants = ["marketing", "assistant marketing", "charge marketing", "responsable marketing", "communication", "community manager", normalized]
        elif "operations" in lower:
            variants = ["operations", "responsable operations", "assistant operations", normalized]
        elif any(term in lower for term in ("administrative", "receptionist", "office manager", "executive assistant")):
            variants = ["assistant administratif", "assistant de direction", "receptionniste", "office manager", normalized]
        elif any(term in lower for term in ("finance", "accountant", "bookkeeper", "payroll")):
            variants = ["comptable", "finance", "gestionnaire paie", "assistant comptable", normalized]
        elif any(term in lower for term in ("teacher", "teaching")):
            variants = ["enseignant", "professeur", "formateur", normalized]
        elif any(term in lower for term in ("nurse", "medical", "healthcare", "care assistant")):
            variants = ["infirmier", "aide soignant", "secretaire medical", normalized]
        elif any(term in lower for term in ("driver", "delivery")):
            variants = ["chauffeur", "livreur", normalized]
        elif any(term in lower for term in ("warehouse", "logistics")):
            variants = ["preparateur commande", "magasinier", "logistique", normalized]
        elif any(term in lower for term in ("retail", "store", "waiter", "barista", "chef", "kitchen")):
            variants = ["vendeur", "serveur", "cuisinier", "employe polyvalent"]
            # Don't add the raw text back in when it's just the bare
            # ambiguous word itself ("chef" means "lead" in French outside
            # a kitchen context -- see role_query_terms.py) -- the safe
            # variants above already cover it.
            if lower not in ("chef", "cuisinier", "cuisiniere", "cook"):
                variants.append(normalized)
        elif "customer" in lower and "success" in lower:
            variants = ["customer success", "charge de clientele", "support client", normalized]

    return [value for value in _dedupe(variants) if value]


def _copy_query_with_role(query: JobSearchQuery, role: str, *, raw_query: bool = False) -> JobSearchQuery:
    return JobSearchQuery(
        role=role,
        location=query.location,
        remote_preference=query.remote_preference,
        country=query.country,
        language=query.language,
        limit=query.limit,
        raw_query=raw_query,
        max_pages=query.max_pages,
        page_size=query.page_size,
        contract_hint=query.contract_hint,
        radius_km=query.radius_km,
    )


def _copy_query_with_role_and_location(
    query: JobSearchQuery,
    role: str,
    location: Optional[str],
    *,
    raw_query: bool = False,
) -> JobSearchQuery:
    return JobSearchQuery(
        role=role,
        location=location,
        remote_preference=query.remote_preference,
        country=query.country,
        language=query.language,
        limit=query.limit,
        raw_query=raw_query,
        max_pages=query.max_pages,
        page_size=query.page_size,
        contract_hint=query.contract_hint,
        radius_km=query.radius_km,
    )


def _direct_apply_search_domains() -> List[str]:
    configured = [
        domain.strip().lower().removeprefix("www.")
        for domain in os.environ.get("JOB_DIRECT_APPLY_SEARCH_DOMAINS", "").split(",")
        if domain.strip()
    ]
    defaults = [
        "greenhouse.io",
        "jobs.lever.co",
        "ashbyhq.com",
        "workable.com",
        "jobs.smartrecruiters.com",
        "smartrecruiters.com",
        "teamtailor.com",
        "recruitee.com",
        "breezy.hr",
        "jazz.co",
        "applytojob.com",
        "bamboohr.com",
        "personio.com",
    ]
    return [domain for domain in _dedupe(configured or defaults) if domain]


def _domain_groups(domains: List[str]) -> List[List[str]]:
    size = max(1, min(_env_int("JOB_DIRECT_APPLY_SEARCH_BATCH_SIZE", 4), 8))
    return [domains[index:index + size] for index in range(0, len(domains), size)]


def _localized_jobs_word(country: Optional[str]) -> str:
    if (country or "").lower() in ("fr", "be", "ch", "ma"):
        return "emploi"
    return "jobs"


def _direct_apply_raw_query(role: str, location: Optional[str], country: Optional[str], domains: List[str]) -> str:
    parts = [" ".join((role or "").split()) or "software engineer", _localized_jobs_word(country)]
    if location:
        parts.extend(["in", location])
    domain_expr = " OR ".join(f"site:{domain}" for domain in domains)
    return f"{' '.join(parts)} ({domain_expr})"


def _direct_apply_attempt_queries(query: JobSearchQuery, roles: List[str], locations: List[Optional[str]]) -> List[JobSearchQuery]:
    if not _env_bool("JOB_DIRECT_APPLY_SEARCH_ENABLED", False):
        return []
    max_attempts = max(1, min(_env_int("JOB_DIRECT_APPLY_SEARCH_MAX_ATTEMPTS", 2), 8))
    groups = _domain_groups(_direct_apply_search_domains())
    attempts: List[JobSearchQuery] = []
    for role in roles[:2]:
        for location in locations[:2]:
            for domains in groups:
                attempts.append(_copy_query_with_role_and_location(
                    query,
                    _direct_apply_raw_query(role, location, query.country, domains),
                    location,
                    raw_query=True,
                ))
                if len(attempts) >= max_attempts:
                    return attempts
    return attempts


def _raw_location_attempt_queries(query: JobSearchQuery, roles: List[str], locations: List[Optional[str]]) -> List[JobSearchQuery]:
    attempts: List[JobSearchQuery] = []
    for role in roles[:2]:
        for location in locations[:3]:
            if not location:
                continue
            raw_role = f"{' '.join((role or '').split()) or 'job'} {_localized_jobs_word(query.country)} in {location}"
            attempts.append(_copy_query_with_role_and_location(
                query,
                raw_role,
                None,
                raw_query=True,
            ))
    return attempts


def _dedupe_queries(queries: List[JobSearchQuery], provider) -> List[JobSearchQuery]:
    seen = set()
    out: List[JobSearchQuery] = []
    for item in queries:
        key = provider.search_key(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _provider_attempt_queries(query: JobSearchQuery, search_radius: str, provider) -> List[JobSearchQuery]:
    if getattr(provider, "name", None) == "france_travail":
        # Keep the user's role/location/radius — FT keyword mapping handles FR translations.
        return [query]

    role_variants = _localized_role_variants(query.role, query.country)
    locations = _nearby_locations(query, search_radius)
    primary_location = query.location
    fallback_locations = [loc for loc in locations if loc != primary_location]
    attempts: List[JobSearchQuery] = []
    primary_roles = role_variants[:2]
    secondary_roles = role_variants[2:]

    for role in primary_roles:
        attempts.append(_copy_query_with_role_and_location(query, role, primary_location))

    for fallback_location in fallback_locations:
        for role in primary_roles:
            attempts.append(_copy_query_with_role_and_location(query, role, fallback_location))

    for role in secondary_roles:
        attempts.append(_copy_query_with_role_and_location(query, role, primary_location))

    for fallback_location in fallback_locations[:2]:
        for role in secondary_roles[:2]:
            attempts.append(_copy_query_with_role_and_location(query, role, fallback_location))

    attempts.extend(_raw_location_attempt_queries(query, primary_roles, [primary_location, *fallback_locations]))
    attempts.extend(_direct_apply_attempt_queries(query, primary_roles, [primary_location, *fallback_locations]))

    return _dedupe_queries(attempts, provider)


def _is_direct_apply_raw_query(query: JobSearchQuery) -> bool:
    return bool(query.raw_query and "site:" in (query.role or "").lower())


def _query_family_tokens(role: str, country: Optional[str]) -> List[str]:
    text = " ".join(_localized_role_variants(role, country)).lower()
    base = set()
    for token in re.findall(r"[a-z0-9]+", text):
        if len(token) > 2:
            base.add(token)
    lower = (role or "").lower()
    if any(term in lower for term in ("marketing", "communication", "community", "seo", "brand", "digital", "social")):
        base.update(["marketing", "communication", "community", "seo", "brand", "digital", "social", "content", "contenu", "growth"])
    if any(term in lower for term in ("hr", "human resources", "ressources humaines", "recruiter", "talent")):
        base.update(["hr", "rh", "ressources", "humaines", "recrutement", "recruteur", "talent", "paie", "formation"])
    if any(term in lower for term in ("sales", "commercial", "business developer", "account", "customer", "support")):
        base.update(["sales", "commercial", "vente", "vendeur", "account", "customer", "client", "support", "success"])
    if any(term in lower for term in ("software", "developer", "engineer", "frontend", "backend", "devops")):
        base.update(["software", "developer", "developpeur", "engineer", "ingenieur", "frontend", "backend", "devops", "cloud"])
    if any(term in lower for term in ("administrative", "receptionist", "office", "executive assistant")):
        base.update(["administratif", "administrative", "assistant", "direction", "reception", "office"])
    if any(term in lower for term in ("finance", "accountant", "bookkeeper", "payroll")):
        base.update(["finance", "comptable", "accounting", "paie", "payroll", "audit"])
    return list(base)


def _job_matches_query_family(job: Dict[str, Any], query: JobSearchQuery) -> bool:
    tokens = _query_family_tokens(query.role, query.country)
    if not tokens:
        return True
    text = " ".join([
        str(job.get("title") or ""),
        str(job.get("description") or ""),
        str(job.get("clean_description") or ""),
        " ".join(str(item) for item in (job.get("requirements") or [])),
    ]).lower()
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return any(token in text for token in tokens)


def _job_matches_query_location(job: Dict[str, Any], query: JobSearchQuery, search_radius: str) -> bool:
    radius = (search_radius or "50km").lower().strip()
    if radius in ("worldwide", "remote/worldwide"):
        return True
    if radius == "remote":
        return str(job.get("remote") or "").lower() == "remote"

    job_location = unicodedata.normalize(
        "NFKD",
        " ".join([
            str(job.get("location") or ""),
            str(job.get("city") or ""),
            str(job.get("region") or ""),
        ]).lower(),
    ).encode("ascii", "ignore").decode("ascii")
    query_location = unicodedata.normalize(
        "NFKD",
        str(query.location or "").lower(),
    ).encode("ascii", "ignore").decode("ascii")
    city = re.split(r"[,/|-]", query_location, maxsplit=1)[0].strip()
    if city and city in job_location:
        return True

    query_country = str(query.country or "").lower().strip()
    job_country = str(job.get("country_code") or "").lower().strip()
    if not query.location and query_country and job_country == query_country:
        return True

    if not query.location and query_country:
        country_name = (_country_name(query_country) or "").lower()
        if country_name and country_name in job_location:
            return True

    return False


def _ats_attempt_countries(query: JobSearchQuery, search_radius: str) -> List[Optional[str]]:
    country = (query.country or "").lower() or None
    if (search_radius or "").lower() == "worldwide":
        return _dedupe([country, None, "us", "gb"])
    return _dedupe([country])


async def _import_ats_targeted_jobs(
    db,
    provider,
    query: JobSearchQuery,
    target_count: int,
    stale_cutoff: str,
    search_radius: str,
    max_attempts: int = 8,
) -> int:
    ats_domains = [
        "jobs.lever.co",
        "boards.greenhouse.io",
        "job-boards.greenhouse.io",
        "jobs.ashbyhq.com",
        "ashbyhq.com",
    ]
    total_imported = 0
    attempts = 0
    role_variants = _role_variants(query.role)
    country_variants = _ats_attempt_countries(query, search_radius)
    query_variants: List[Tuple[str, str, str]] = []
    for domain in ats_domains:
        query_variants.append((domain, role_variants[0], "{role} site:{domain}"))
    for domain in ats_domains:
        query_variants.append((domain, role_variants[0], "{role} {domain}"))
    for domain in ats_domains:
        query_variants.append((domain, role_variants[0], "{role} careers {domain}"))
    for role_variant in role_variants[1:]:
        for domain in ats_domains:
            query_variants.append((domain, role_variant, "{role} site:{domain}"))

    primary_domain_variants = query_variants[:len(ats_domains)]
    attempt_plan: List[Tuple[str, str, str, Optional[str]]] = []
    if (search_radius or "").lower() == "worldwide":
        profile_country = country_variants[0] if country_variants else query.country
        for ats_domain, role_variant, intent in primary_domain_variants:
            attempt_plan.append((ats_domain, role_variant, intent, profile_country))
        for country in country_variants[1:]:
            for ats_domain, role_variant, intent in primary_domain_variants:
                attempt_plan.append((ats_domain, role_variant, intent, country))
        for ats_domain, role_variant, intent in query_variants[len(ats_domains):]:
            for country in country_variants:
                attempt_plan.append((ats_domain, role_variant, intent, country))
    else:
        country = country_variants[0] if country_variants else query.country
        attempt_plan = [(ats_domain, role_variant, intent, country) for ats_domain, role_variant, intent in query_variants]

    for ats_domain, role_variant, template, country in attempt_plan:
        current_auto_count = await _count_recent_auto_apply_jobs(db, provider.name, stale_cutoff)
        if current_auto_count >= target_count:
            break

        if attempts >= max_attempts:
            return total_imported
        before_auto_count = await _count_recent_auto_apply_jobs(db, provider.name, stale_cutoff)
        targeted_query = JobSearchQuery(
            role=template.format(role=role_variant, domain=ats_domain),
            location=query.location if (search_radius or "").lower() != "worldwide" else None,
            remote_preference=query.remote_preference,
            country=country,
            language=query.language,
            limit=query.limit,
            raw_query=True,
        )
        attempts += 1
        stats = await _import_provider_jobs(db, provider, targeted_query)
        total_imported += stats["total_imported"]
        after_auto_count = await _count_recent_auto_apply_jobs(db, provider.name, stale_cutoff)
        auto_imported = max(0, after_auto_count - before_auto_count)
        logger.info(
            "JSearch ATS-targeted attempt: ats_domain=%s query=%s country=%s work_from_home=%s total_imported=%s auto_apply_supported_imported=%s unknown_ats_imported=%s",
            ats_domain,
            provider._query_string(targeted_query),
            country or "global",
            targeted_query.remote_preference == "remote",
            stats["total_imported"],
            auto_imported,
            stats["unknown_ats_imported"],
        )
        if after_auto_count >= target_count:
            return total_imported
    return total_imported


async def _attempt_france_travail_fallback(
    db,
    query: JobSearchQuery,
    search_radius: str,
    current_provider_name: str,
) -> Dict[str, Any]:
    """Absolute last-resort source: tried whenever the primary provider yields
    nothing relevant -- including when it couldn't be tried at all because it's
    rate-limited. A rate-limited primary provider must never silently skip this
    fallback; the user is owed a real check against France Travail, even if
    that check itself comes back empty.
    """
    result: Dict[str, Any] = {
        "used": False,
        "total_imported": 0,
        "relevant_imported": 0,
        "manual_ready_imported": 0,
        "jobs": [],
    }
    if is_france_travail_provider(current_provider_name):
        return result
    if not (is_job_provider_configured("france_travail") and is_job_provider_enabled("france_travail")):
        return result
    try:
        ft_provider = get_job_provider("france_travail", "")
        if _cooldown_until(ft_provider.name):
            return result
        # Monaco resolves to country_code "mc" upstream (correctly, for the
        # primary JSearch provider), but France Travail only searches France
        # and would skip the query outright. Monaco-based postings do show
        # up on France Travail (filed under Alpes-Maritimes -- see
        # france_travail.py's _MEGA_CITY_DEPARTEMENT), so this is the one
        # provider where Monaco searches need to be treated as French.
        ft_country = "fr" if "monaco" in (query.location or "").lower() else query.country
        ft_query = JobSearchQuery(
            role=query.role,
            location=query.location,
            remote_preference=query.remote_preference,
            country=ft_country,
            language=query.language,
            limit=query.limit,
            raw_query=query.raw_query,
            contract_hint=query.contract_hint,
            radius_km=query.radius_km,
        )
        ft_stats = await _import_provider_jobs(db, ft_provider, ft_query)
        ft_jobs = ft_stats.get("jobs") or []
        ft_relevant = sum(
            1
            for job in ft_jobs
            if _job_matches_query_family(job, query)
            and _job_matches_query_location(job, query, search_radius)
            and is_manual_fulfillment_ready(job)
        )
        result.update({
            "used": ft_stats["total_imported"] > 0,
            "total_imported": ft_stats["total_imported"],
            "relevant_imported": ft_relevant,
            "manual_ready_imported": sum(1 for job in ft_jobs if is_manual_fulfillment_ready(job)),
            "jobs": ft_jobs,
        })
        logger.info(
            "France Travail last-resort fallback: role=%s location=%s total_imported=%s relevant_imported=%s",
            ft_query.role,
            ft_query.location,
            ft_stats["total_imported"],
            ft_relevant,
        )
    except Exception as exc:
        if _is_rate_limit_error(exc):
            _set_rate_limit_cooldown("france_travail")
        logger.warning("France Travail fallback attempt failed: %s", exc)
    return result


async def refresh_jobs_for_profile_if_needed(
    db,
    profile: Dict[str, Any],
    require_auto_apply: bool = False,
    target_auto_apply_count: int = 0,
    location_override: Optional[str] = None,
    location_data_override: Optional[Dict[str, Any]] = None,
    search_radius: str = "50km",
    role_override: Optional[str] = None,
    force_provider_refresh: bool = False,
    query_limit_override: Optional[int] = None,
    provider_max_pages: Optional[int] = None,
    provider_page_size: Optional[int] = None,
    max_provider_requests_override: Optional[int] = None,
    max_direct_apply_requests_override: Optional[int] = None,
) -> Dict[str, Any]:
    query = build_profile_job_query(
        profile,
        location_override=location_override,
        location_data_override=location_data_override,
        search_radius=search_radius,
        role_override=role_override,
    )
    if query_limit_override or provider_max_pages or provider_page_size:
        query = JobSearchQuery(
            role=query.role,
            location=query.location,
            remote_preference=query.remote_preference,
            country=query.country,
            language=query.language,
            limit=max(1, min(int(query_limit_override or query.limit), 100)),
            raw_query=query.raw_query,
            max_pages=provider_max_pages,
            page_size=provider_page_size,
            contract_hint=query.contract_hint,
            radius_km=query.radius_km,
        )
    base_metadata = {
        "searched_location": query.location,
        "search_radius": search_radius,
        "suggested_next_radius": _next_radius(search_radius),
        "widened_search": False,
        "original_location": location_override or profile.get("target_location"),
        "final_location_used": query.location,
        "provider_rate_limited": False,
        "provider_cooldown_until": None,
    }

    # SmartRecruiters / Workday run only when local cache is not feed-ready
    # (see after the freshness short-circuit below).
    smartrecruiters_result = None
    workday_result = None

    greenhouse_result = None
    lever_result = None
    if require_auto_apply:
        existing_auto_count = await db.jobs.count_documents({
            "auto_apply_supported": True,
            "ats_provider": {"$in": ["greenhouse", "lever", "ashby"]},
        })
        if existing_auto_count < target_auto_apply_count:
            greenhouse_result = await refresh_greenhouse_boards(
                db,
                profile=profile,
                limit_boards=_env_int("GREENHOUSE_FEED_REFRESH_BOARD_LIMIT", 10),
            )
            existing_auto_count = await db.jobs.count_documents({
                "auto_apply_supported": True,
                "ats_provider": {"$in": ["greenhouse", "lever", "ashby"]},
            })
        if existing_auto_count < target_auto_apply_count:
            lever_result = await refresh_lever_boards(
                db,
                profile=profile,
                limit_boards=_env_int("LEVER_FEED_REFRESH_BOARD_LIMIT", 10),
            )
            existing_auto_count = await db.jobs.count_documents({
                "auto_apply_supported": True,
                "ats_provider": {"$in": ["greenhouse", "lever", "ashby"]},
            })
        if existing_auto_count >= target_auto_apply_count:
            return {
                "attempted": bool(greenhouse_result or lever_result),
                "ok": True,
                "reason": "direct_ats_imported" if (greenhouse_result or lever_result) else "cache_fresh_auto_apply",
                "count": existing_auto_count,
                "greenhouse": greenhouse_result,
                "lever": lever_result,
                **base_metadata,
            }

    try:
        from job_search_routing import resolve_primary_provider

        provider_name = resolve_primary_provider(query)
    except Exception:
        # France Travail is intentionally not auto-selected here even for
        # French locations -- it's tried only as a last-resort fallback
        # below, after the primary provider (JSearch) yields nothing.
        provider_name = primary_job_provider_name()

    if not is_job_provider_enabled(provider_name):
        return {"attempted": bool(greenhouse_result or lever_result), "reason": "disabled", "greenhouse": greenhouse_result, "lever": lever_result, **base_metadata}

    if not is_job_provider_configured(provider_name):
        return {"attempted": bool(greenhouse_result or lever_result), "reason": "missing_api_key", "greenhouse": greenhouse_result, "lever": lever_result, **base_metadata}

    api_key = os.environ.get("JSEARCH_API_KEY") or ""
    provider = get_job_provider(provider_name, api_key)
    cooldown_until = _cooldown_until(provider.name)
    if cooldown_until:
        logger.info("Skipping %s refresh during provider cooldown until %s", provider.name, cooldown_until.isoformat())
        ft_result = await _attempt_france_travail_fallback(db, query, search_radius, provider.name)
        return {
            "attempted": ft_result["used"],
            "ok": ft_result["used"],
            "reason": "provider_rate_limited_france_travail_fallback" if ft_result["used"] else "provider_rate_limited",
            "imported": ft_result["total_imported"],
            "jobs_imported": ft_result["total_imported"],
            "relevant_imported": ft_result["relevant_imported"],
            "manual_ready_imported": ft_result["manual_ready_imported"],
            "jobs": ft_result["jobs"][:200],
            "france_travail_fallback_used": ft_result["used"],
            **base_metadata,
            "provider_rate_limited": True,
            "provider_cooldown_until": cooldown_until.isoformat(),
        }

    query_variants = _provider_attempt_queries(query, search_radius, provider)
    search_keys = [provider.search_key(item) for item in query_variants]
    search_key = search_keys[0] if search_keys else provider.search_key(query)
    ttl_minutes = _env_int("JOB_IMPORT_TTL_MINUTES", 360)
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=ttl_minutes)).isoformat()

    min_fresh_count = max(target_auto_apply_count, _env_int("JOB_IMPORT_MIN_FRESH_COUNT", 10))
    min_feed_ready_count = max(
        min_fresh_count,
        target_auto_apply_count * max(1, _env_int("JOB_IMPORT_CACHE_FRESH_MULTIPLIER", 4)),
    )
    if query_limit_override:
        min_feed_ready_count = max(3, min(int(query_limit_override), min_feed_ready_count))
    fresh_query = {
        "provider": provider.name,
        "provider_search_key": {"$in": search_keys},
        "imported_at": {"$gte": stale_cutoff},
    }
    fresh_jobs = await db.jobs.find(fresh_query, {"_id": 0}).limit(300).to_list(300) if search_keys else []
    fresh_count = len(fresh_jobs)
    fresh_relevant_count = sum(1 for job in fresh_jobs if _job_matches_query_family(job, query))
    swiped_ids = set()
    user_id = profile.get("user_id")
    if user_id:
        swiped_rows = await db.swipes.find({"user_id": user_id}, {"_id": 0, "job_id": 1}).limit(1000).to_list(1000)
        swiped_ids = {row.get("job_id") for row in swiped_rows if row.get("job_id")}
    fresh_feed_ready_count = sum(
        1
        for job in fresh_jobs
        if job.get("job_id") not in swiped_ids
        and _job_matches_query_family(job, query)
        and _job_matches_query_location(job, query, search_radius)
        and is_manual_fulfillment_ready(job)
    )
    if fresh_feed_ready_count >= min_feed_ready_count and not require_auto_apply and not force_provider_refresh:
        return {
            "attempted": False,
            "reason": "cache_fresh_feed_ready",
            "search_key": search_key,
            "search_keys": search_keys,
            "count": fresh_count,
            "relevant_count": fresh_relevant_count,
            "feed_ready_count": fresh_feed_ready_count,
            "min_feed_ready_count": min_feed_ready_count,
            "smartrecruiters": None,
            "workday": None,
            **base_metadata,
        }

    # Cache is thin — supplemental ATS searches are worth the latency/load.
    try:
        from smartrecruiters_search import refresh_smartrecruiters_jobs_for_query

        smartrecruiters_result = await refresh_smartrecruiters_jobs_for_query(
            db,
            query=query,
            limit=query_limit_override or query.limit,
        )
    except Exception as exc:
        logger.warning("smartrecruiters_search_failed error=%s", exc)

    try:
        from job_search_routing import resolve_primary_provider
        from workday_search import refresh_workday_jobs_for_query, should_run_workday_search

        primary_for_routing = resolve_primary_provider(query)
        if should_run_workday_search(query, primary_provider=primary_for_routing):
            workday_result = await refresh_workday_jobs_for_query(
                db,
                query=query,
                limit=query_limit_override or query.limit,
            )
    except Exception as exc:
        logger.warning("workday_search_failed error=%s", exc)

    # Skip per-key counts when forcing a refresh — they only appear in error
    # metadata and wasting ~6 s of the 8 s per-location budget.
    any_cached = 0
    if not force_provider_refresh and search_keys:
        total = await db.jobs.count_documents({
            "provider": provider.name,
            "provider_search_key": {"$in": search_keys},
        })
        any_cached = total

    try:
        max_provider_requests = max(1, min(int(max_provider_requests_override or _env_int("JOB_IMPORT_MAX_PROVIDER_REQUESTS", 7)), 12))
        max_direct_apply_requests = max(0, min(int(max_direct_apply_requests_override if max_direct_apply_requests_override is not None else _env_int("JOB_DIRECT_APPLY_SEARCH_MAX_ATTEMPTS", 2)), 8))
        min_provider_requests = 1 if force_provider_refresh else 0
        provider_requests = 0
        direct_apply_requests = 0
        broad_provider_requests = 0
        total_imported = 0
        relevant_imported = fresh_feed_ready_count
        manual_ready_imported = 0
        provider_errors: List[str] = []
        provider_rate_limited = False
        provider_cooldown_until = None
        imported_jobs: List[Dict[str, Any]] = []
        imported = 0
        fallback_used = None
        for attempt_query in query_variants:
            is_direct_apply_attempt = _is_direct_apply_raw_query(attempt_query)
            if is_direct_apply_attempt:
                if direct_apply_requests >= max_direct_apply_requests:
                    continue
            elif broad_provider_requests >= max_provider_requests:
                break
            if (
                broad_provider_requests >= min_provider_requests
                and relevant_imported >= min_feed_ready_count
            ):
                break
            provider_requests += 1
            if is_direct_apply_attempt:
                direct_apply_requests += 1
            else:
                broad_provider_requests += 1
            try:
                import_stats = await _import_provider_jobs(db, provider, attempt_query)
            except Exception as exc:
                if _is_rate_limit_error(exc):
                    cooldown_until = _set_rate_limit_cooldown(provider.name)
                    provider_rate_limited = True
                    provider_cooldown_until = cooldown_until.isoformat()
                    logger.warning(
                        "JSearch refresh attempt rate-limited: role=%s location=%s country=%s query=%s cooldown_until=%s",
                        attempt_query.role,
                        attempt_query.location,
                        attempt_query.country,
                        provider._query_string(attempt_query),
                        provider_cooldown_until,
                    )
                    break
                provider_errors.append(f"{exc.__class__.__name__}: {str(exc)[:160]}")
                logger.warning(
                    "JSearch refresh attempt failed; continuing: role=%s location=%s country=%s query=%s error=%s",
                    attempt_query.role,
                    attempt_query.location,
                    attempt_query.country,
                    provider._query_string(attempt_query),
                    exc,
                )
                continue
            imported = import_stats["total_imported"]
            manual_ready = sum(1 for job in (import_stats.get("jobs") or []) if is_manual_fulfillment_ready(job))
            relevant = sum(
                1
                for job in (import_stats.get("jobs") or [])
                if _job_matches_query_family(job, query)
                and _job_matches_query_location(job, query, search_radius)
                and is_manual_fulfillment_ready(job)
            )
            total_imported += imported
            relevant_imported += relevant
            manual_ready_imported += manual_ready
            imported_jobs.extend(import_stats.get("jobs") or [])
            if imported > 0 and fallback_used is None and attempt_query.location != query.location:
                fallback_used = attempt_query.location
            logger.info(
                "JSearch refresh attempt: role=%s location=%s country=%s direct_apply_attempt=%s query=%s total_imported=%s manual_ready_imported=%s relevant_imported=%s auto_apply_supported_imported=%s unknown_ats_imported=%s",
                attempt_query.role,
                attempt_query.location,
                attempt_query.country,
                is_direct_apply_attempt,
                provider._query_string(attempt_query),
                import_stats["total_imported"],
                manual_ready,
                relevant,
                import_stats["auto_apply_supported_imported"],
                import_stats["unknown_ats_imported"],
            )
        if relevant_imported < min_feed_ready_count and broad_provider_requests < max_provider_requests and not provider_rate_limited:
            broad_location = query.location or _country_name(query.country) or "remote"
            broad_query = JobSearchQuery(
                role=f"{query.role} jobs in {broad_location}",
                location=None,
                remote_preference=query.remote_preference,
                country=query.country,
                language=query.language,
                limit=query.limit,
                raw_query=True,
                max_pages=query.max_pages,
                page_size=query.page_size,
                contract_hint=query.contract_hint,
                radius_km=query.radius_km,
            )
            provider_requests += 1
            broad_provider_requests += 1
            try:
                broad_stats = await _import_provider_jobs(db, provider, broad_query)
            except Exception as exc:
                if _is_rate_limit_error(exc):
                    cooldown_until = _set_rate_limit_cooldown(provider.name)
                    provider_rate_limited = True
                    provider_cooldown_until = cooldown_until.isoformat()
                    logger.warning("JSearch broad local attempt rate-limited; cooldown active until %s", provider_cooldown_until)
                else:
                    provider_errors.append(f"{exc.__class__.__name__}: {str(exc)[:160]}")
                    logger.warning("JSearch broad local attempt failed; continuing with imported/cache jobs: %s", exc)
                broad_stats = {"total_imported": 0, "jobs": [], "auto_apply_supported_imported": 0, "unknown_ats_imported": 0}
            total_imported += broad_stats["total_imported"]
            manual_ready_broad = sum(1 for job in (broad_stats.get("jobs") or []) if is_manual_fulfillment_ready(job))
            manual_ready_imported += manual_ready_broad
            relevant_imported += sum(
                1
                for job in (broad_stats.get("jobs") or [])
                if _job_matches_query_family(job, query)
                and _job_matches_query_location(job, query, search_radius)
                and is_manual_fulfillment_ready(job)
            )
            imported_jobs.extend(broad_stats.get("jobs") or [])
            logger.info(
                "JSearch broad local attempt: query=%s country=%s total_imported=%s manual_ready_imported=%s relevant_imported=%s auto_apply_supported_imported=%s unknown_ats_imported=%s",
                provider._query_string(broad_query),
                broad_query.country,
                broad_stats["total_imported"],
                manual_ready_broad,
                relevant_imported,
                broad_stats["auto_apply_supported_imported"],
                broad_stats["unknown_ats_imported"],
            )
            if broad_stats["total_imported"] > 0 and fallback_used is None:
                fallback_used = broad_location

        france_travail_fallback_used = False
        if relevant_imported == 0:
            ft_result = await _attempt_france_travail_fallback(db, query, search_radius, provider.name)
            total_imported += ft_result["total_imported"]
            relevant_imported += ft_result["relevant_imported"]
            manual_ready_imported += ft_result["manual_ready_imported"]
            imported_jobs.extend(ft_result["jobs"])
            france_travail_fallback_used = ft_result["used"]

        ats_targeted_imported = 0
    except Exception as exc:
        if _is_rate_limit_error(exc):
            cooldown_until = _set_rate_limit_cooldown(provider.name)
            logger.warning("Job provider rate-limited; cooldown active until %s", cooldown_until.isoformat())
            return {
                "attempted": True,
                "ok": False,
                "reason": "provider_rate_limited",
                "search_key": search_key,
                "search_keys": search_keys,
                "cached_count": any_cached,
                **base_metadata,
                "provider_rate_limited": True,
                "provider_cooldown_until": cooldown_until.isoformat(),
            }
        logger.warning("Job provider refresh failed: %s", exc)
        return {
            "attempted": True,
            "ok": False,
            "reason": "provider_error",
            "search_key": search_key,
            "search_keys": search_keys,
            "cached_count": any_cached,
            **base_metadata,
        }

    combined_jobs: List[Dict[str, Any]] = []
    seen_job_ids = set()
    for job in [*fresh_jobs, *imported_jobs]:
        job_id = job.get("job_id")
        if job_id and job_id in seen_job_ids:
            continue
        if job_id:
            seen_job_ids.add(job_id)
        combined_jobs.append(job)

    return {
        "attempted": True,
        "ok": True,
        "reason": "imported",
        "search_key": search_key,
        "search_keys": search_keys,
        "imported": total_imported,
        "jobs_imported": total_imported,
        "relevant_imported": relevant_imported,
        "manual_ready_imported": manual_ready_imported,
        "provider_requests": provider_requests,
        "direct_apply_requests": direct_apply_requests,
        "broad_provider_requests": broad_provider_requests,
        "provider_errors": provider_errors[:5],
        "provider_rate_limited": provider_rate_limited,
        "provider_cooldown_until": provider_cooldown_until,
        "jobs": combined_jobs[:200],
        "fallback_used": fallback_used,
        "ats_targeted_imported": ats_targeted_imported,
        "france_travail_fallback_used": france_travail_fallback_used,
        "smartrecruiters": smartrecruiters_result,
        "workday": workday_result,
        **base_metadata,
        "widened_search": fallback_used is not None,
        "final_location_used": fallback_used or query.location,
    }
