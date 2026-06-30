"""Lightweight job cache maintenance helpers.

These functions are designed to be called by protected admin endpoints or a
future Railway cron HTTP job. They avoid external queues and keep API usage
bounded by conservative limits.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from job_validation import cheap_validate_job_applyability
from jobs_service import refresh_jobs_for_profile_if_needed
from ats_source_service import run_ats_direct_maintenance


logger = logging.getLogger(__name__)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def default_country_code() -> str:
    return (os.environ.get("JOBS_MAINTENANCE_DEFAULT_COUNTRY") or "FR").strip().upper()


async def refresh_jobs_for_query_or_filters(
    db,
    *,
    search_role: Optional[str] = None,
    location: Optional[str] = None,
    country_code: Optional[str] = None,
    remote: Optional[bool] = None,
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    refresh_limit = max(1, min(int(limit or env_int("JOBS_MAINTENANCE_REFRESH_LIMIT", 100)), 300))
    country = (country_code or default_country_code()).strip().lower()
    role = (search_role or "marketing").strip()
    location_label = (location or _default_location_for_country(country)).strip()
    profile = _synthetic_profile(role, location_label, country, remote)
    summary = _empty_refresh_summary(dry_run=dry_run)
    summary.update({
        "search_role": role,
        "location": location_label,
        "country_code": country,
        "limit": refresh_limit,
    })

    logger.info(
        "job_cache_refresh_start role=%s location=%s country=%s remote=%s limit=%s dry_run=%s",
        role,
        location_label,
        country,
        remote,
        refresh_limit,
        dry_run,
    )
    if dry_run:
        summary["jsearch_called"] = False
        summary["reason"] = "dry_run"
        return summary

    try:
        result = await refresh_jobs_for_profile_if_needed(
            db,
            profile,
            require_auto_apply=False,
            target_auto_apply_count=refresh_limit,
            location_override=location_label,
            location_data_override=profile["target_location_data"],
            search_radius="50km" if location_label else "country",
            role_override=role,
            force_provider_refresh=True,
        )
        jobs = [job for job in (result.get("jobs") or []) if isinstance(job, dict)]
        counts = _validation_counts(jobs)
        summary.update({
            "jsearch_called": bool(result.get("attempted")),
            "discovered_count": len(jobs),
            "imported_count": int(result.get("imported") or result.get("jobs_imported") or len(jobs) or 0),
            "provider_rate_limited": bool(result.get("provider_rate_limited")),
            "provider_cooldown_until": result.get("provider_cooldown_until"),
            "provider_requests": result.get("provider_requests"),
            "errors": result.get("provider_errors") or [],
            **counts,
        })
        logger.info("job_cache_refresh_complete summary=%s", _loggable_summary(summary))
        return summary
    except Exception as exc:
        logger.exception("job_cache_refresh_failed role=%s location=%s", role, location_label)
        summary["errors"].append(f"{exc.__class__.__name__}: {str(exc)[:200]}")
        return summary


async def revalidate_cached_jobs(
    db,
    *,
    validation_status: Optional[str] = None,
    applyability_tier: Optional[str] = None,
    older_than_hours: Optional[int] = None,
    country_code: Optional[str] = None,
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    revalidate_limit = max(1, min(int(limit or env_int("JOBS_MAINTENANCE_REVALIDATE_LIMIT", 100)), 1000))
    hours = int(older_than_hours if older_than_hours is not None else env_int("JOBS_REVALIDATE_AFTER_HOURS", 24))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, hours))
    query: Dict[str, Any] = {}
    if validation_status:
        query["validation_status"] = validation_status
    if applyability_tier:
        query["applyability_tier"] = applyability_tier.upper()
    if country_code:
        query["country_code"] = country_code.strip().lower()

    rows = await db.jobs.find(query, {"_id": 0}).limit(revalidate_limit * 3).to_list(revalidate_limit * 3)
    candidates = [job for job in rows if _needs_revalidation(job, cutoff)]
    candidates = candidates[:revalidate_limit]
    summary = {
        "dry_run": dry_run,
        "scanned_count": len(candidates),
        "updated_count": 0,
        "valid_count": 0,
        "unknown_count": 0,
        "invalid_count": 0,
        "errors": [],
    }
    logger.info("job_cache_revalidate_start query=%s candidates=%s dry_run=%s", query, len(candidates), dry_run)
    for job in candidates:
        job_id = job.get("job_id")
        try:
            validation = cheap_validate_job_applyability(job)
            _increment_validation_count(summary, validation)
            if not dry_run and job_id:
                await db.jobs.update_one({"job_id": job_id}, {"$set": validation})
                summary["updated_count"] += 1
        except Exception as exc:
            logger.warning("job_cache_revalidate_job_failed job_id=%s error=%s", job_id, exc)
            summary["errors"].append({"job_id": job_id, "error": f"{exc.__class__.__name__}: {str(exc)[:160]}"})
    logger.info("job_cache_revalidate_complete summary=%s", _loggable_summary(summary))
    return summary


async def expire_stale_jobs(
    db,
    *,
    older_than_days: Optional[int] = None,
    provider: Optional[str] = None,
    country_code: Optional[str] = None,
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    days = int(older_than_days if older_than_days is not None else env_int("JOBS_STALE_AFTER_DAYS", 30))
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    expire_limit = max(1, min(int(limit or env_int("JOBS_MAINTENANCE_REVALIDATE_LIMIT", 100)), 1000))
    query: Dict[str, Any] = {}
    if provider:
        query["provider"] = provider
    if country_code:
        query["country_code"] = country_code.strip().lower()
    rows = await db.jobs.find(query, {"_id": 0}).limit(expire_limit * 3).to_list(expire_limit * 3)
    stale_jobs = [job for job in rows if _is_stale(job, cutoff)][:expire_limit]
    now = datetime.now(timezone.utc).isoformat()
    update = {
        "validation_status": "invalid",
        "validation_reason": "stale_not_seen_recently",
        "validation_checked_at": now,
        "rejection_reason": "stale_not_seen_recently",
        "applyability_tier": "E",
        "auto_apply_supported": False,
        "manual_fulfillment_ready": False,
        "apply_fulfillment_status": "blocked_expired",
    }
    summary = {"dry_run": dry_run, "scanned_count": len(stale_jobs), "expired_count": 0, "errors": []}
    logger.info("job_cache_expire_stale_start query=%s candidates=%s cutoff=%s dry_run=%s", query, len(stale_jobs), cutoff.isoformat(), dry_run)
    for job in stale_jobs:
        job_id = job.get("job_id")
        try:
            if not dry_run and job_id:
                await db.jobs.update_one({"job_id": job_id}, {"$set": update})
            summary["expired_count"] += 1
        except Exception as exc:
            logger.warning("job_cache_expire_job_failed job_id=%s error=%s", job_id, exc)
            summary["errors"].append({"job_id": job_id, "error": f"{exc.__class__.__name__}: {str(exc)[:160]}"})
    logger.info("job_cache_expire_stale_complete summary=%s", _loggable_summary(summary))
    return summary


async def refresh_popular_job_cache(db, *, dry_run: bool = False, limit: Optional[int] = None) -> Dict[str, Any]:
    if not env_bool("JOBS_POPULAR_REFRESH_ENABLED", False):
        return {"enabled": False, "dry_run": dry_run, "runs": [], "combined": _empty_refresh_summary(dry_run=dry_run)}
    queries = _csv_env("JOBS_POPULAR_REFRESH_QUERIES") or ["sales", "commercial", "business developer", "marketing", "developer", "customer support"]
    locations = _csv_env("JOBS_POPULAR_REFRESH_LOCATIONS") or ["Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux", "Lille", "Nantes", "Remote"]
    country = default_country_code()
    max_runs = max(1, min(int(limit or env_int("JOBS_MAINTENANCE_REFRESH_LIMIT", 100)), 100))
    runs: List[Dict[str, Any]] = []
    for role in queries:
        for location in locations:
            if len(runs) >= max_runs:
                break
            runs.append(await refresh_jobs_for_query_or_filters(
                db,
                search_role=role,
                location=None if location.lower() == "remote" else f"{location}, France",
                country_code=country,
                remote=location.lower() == "remote",
                limit=max(10, min(30, env_int("JOBS_MAINTENANCE_REFRESH_LIMIT", 100))),
                dry_run=dry_run,
            ))
        if len(runs) >= max_runs:
            break
    return {"enabled": True, "dry_run": dry_run, "runs": runs, "combined": _combine_refresh_summaries(runs)}


async def run_job_cache_maintenance(
    db,
    *,
    dry_run: bool = False,
    refresh_popular: Optional[bool] = None,
) -> Dict[str, Any]:
    logger.info("job_cache_maintenance_start dry_run=%s refresh_popular=%s", dry_run, refresh_popular)
    expire = await expire_stale_jobs(db, dry_run=dry_run)
    revalidate = await revalidate_cached_jobs(db, dry_run=dry_run)
    popular_enabled = refresh_popular if refresh_popular is not None else env_bool("JOBS_POPULAR_REFRESH_ENABLED", False)
    popular = await refresh_popular_job_cache(db, dry_run=dry_run) if popular_enabled else {"enabled": False, "runs": [], "combined": _empty_refresh_summary(dry_run=dry_run)}
    ats_direct = await run_ats_direct_maintenance(db, dry_run=dry_run) if env_bool("JOBS_ATS_DIRECT_ENABLED", True) else {"enabled": False}
    summary = {"dry_run": dry_run, "expire_stale": expire, "revalidate": revalidate, "popular_refresh": popular, "ats_direct": ats_direct}
    logger.info("job_cache_maintenance_complete summary=%s", _loggable_summary(summary))
    return summary


async def job_cache_status(db, *, stale_after_days: Optional[int] = None) -> Dict[str, Any]:
    days = int(stale_after_days if stale_after_days is not None else env_int("JOBS_STALE_AFTER_DAYS", 30))
    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, days))
    total_jobs = await db.jobs.count_documents({})
    valid_ab_jobs = await db.jobs.count_documents({"validation_status": "valid", "applyability_tier": {"$in": ["A", "B"]}})
    unknown_c_jobs = await db.jobs.count_documents({"applyability_tier": "C"})
    invalid_de_jobs = await db.jobs.count_documents({"applyability_tier": {"$in": ["D", "E"]}})
    source_count = 0
    if hasattr(db, "ats_company_sources"):
        source_count = await db.ats_company_sources.count_documents({})

    sample_limit = min(max(total_jobs, 1), 5000)
    jobs = await db.jobs.find({}, {"_id": 0}).limit(sample_limit).to_list(sample_limit)
    by_ats_provider: Dict[str, int] = {}
    stale_jobs = 0
    last_imported_at = None
    last_seen_at = None
    last_validation_checked_at = None
    for job in jobs:
        provider = str(job.get("ats_provider") or job.get("provider") or "unknown").lower()
        by_ats_provider[provider] = by_ats_provider.get(provider, 0) + 1
        if _is_stale(job, cutoff):
            stale_jobs += 1
        last_imported_at = _max_iso(last_imported_at, job.get("imported_at"))
        last_seen_at = _max_iso(last_seen_at, job.get("last_seen_at"))
        last_validation_checked_at = _max_iso(last_validation_checked_at, job.get("validation_checked_at"))

    return {
        "total_jobs": total_jobs,
        "valid_ab_jobs": valid_ab_jobs,
        "unknown_c_jobs": unknown_c_jobs,
        "invalid_de_jobs": invalid_de_jobs,
        "stale_jobs_sampled": stale_jobs,
        "sampled_jobs": len(jobs),
        "jobs_by_ats_provider": by_ats_provider,
        "ats_company_sources_count": source_count,
        "last_imported_at": last_imported_at,
        "last_seen_at": last_seen_at,
        "last_validation_checked_at": last_validation_checked_at,
        "stale_after_days": max(1, days),
    }


def _synthetic_profile(role: str, location: str, country_code: str, remote: Optional[bool]) -> Dict[str, Any]:
    return {
        "user_id": "admin_job_cache_maintenance",
        "cv_text": "Maintenance refresh profile",
        "target_role": role,
        "target_location": location,
        "target_location_data": {
            "location_label": location,
            "country_code": country_code.lower(),
            "country": _country_name(country_code),
        },
        "remote_preference": "remote" if remote else "any",
    }


def _default_location_for_country(country_code: str) -> str:
    return {"fr": "Paris, France", "gb": "London, United Kingdom", "us": "New York, United States", "ma": "Casablanca, Morocco"}.get(country_code.lower(), "Paris, France")


def _country_name(country_code: str) -> str:
    return {"fr": "France", "gb": "United Kingdom", "us": "United States", "ma": "Morocco"}.get(country_code.lower(), country_code.upper())


def _needs_revalidation(job: Dict[str, Any], cutoff: datetime) -> bool:
    if not job.get("selected_apply_url") and not job.get("external_url"):
        return False
    status = str(job.get("validation_status") or "").lower()
    tier = str(job.get("applyability_tier") or "").upper()
    if status in {"", "unknown"} or tier in {"", "C"}:
        return True
    checked = _parse_dt(job.get("validation_checked_at"))
    return checked is None or checked < cutoff


def _is_stale(job: Dict[str, Any], cutoff: datetime) -> bool:
    status = str(job.get("status") or job.get("job_status") or "").lower()
    if status in {"expired", "closed", "inactive", "archived"}:
        return True
    seen = _parse_dt(job.get("last_seen_at") or job.get("imported_at") or job.get("posted_at"))
    if seen is None:
        return False
    return seen < cutoff


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _max_iso(current: Optional[str], value: Any) -> Optional[str]:
    parsed_value = _parse_dt(value)
    if parsed_value is None:
        return current
    parsed_current = _parse_dt(current)
    if parsed_current is None or parsed_value > parsed_current:
        return parsed_value.isoformat()
    return current


def _validation_counts(jobs: List[Dict[str, Any]]) -> Dict[str, int]:
    summary = {"valid_count": 0, "unknown_count": 0, "invalid_count": 0, "rejected_count": 0}
    for job in jobs:
        _increment_validation_count(summary, job)
    return summary


def _increment_validation_count(summary: Dict[str, Any], validation: Dict[str, Any]) -> None:
    status = str(validation.get("validation_status") or "").lower()
    tier = str(validation.get("applyability_tier") or "").upper()
    if status == "valid":
        summary["valid_count"] = int(summary.get("valid_count") or 0) + 1
    elif status == "invalid":
        summary["invalid_count"] = int(summary.get("invalid_count") or 0) + 1
    else:
        summary["unknown_count"] = int(summary.get("unknown_count") or 0) + 1
    if status == "invalid" or tier in {"D", "E"}:
        summary["rejected_count"] = int(summary.get("rejected_count") or 0) + 1


def _empty_refresh_summary(*, dry_run: bool) -> Dict[str, Any]:
    return {
        "dry_run": dry_run,
        "discovered_count": 0,
        "imported_count": 0,
        "valid_count": 0,
        "unknown_count": 0,
        "invalid_count": 0,
        "rejected_count": 0,
        "jsearch_called": False,
        "errors": [],
    }


def _combine_refresh_summaries(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    combined = _empty_refresh_summary(dry_run=any(run.get("dry_run") for run in runs))
    combined["jsearch_called"] = any(run.get("jsearch_called") for run in runs)
    for run in runs:
        for key in ("discovered_count", "imported_count", "valid_count", "unknown_count", "invalid_count", "rejected_count"):
            combined[key] += int(run.get(key) or 0)
        combined["errors"].extend(run.get("errors") or [])
    return combined


def _csv_env(name: str) -> List[str]:
    return [item.strip() for item in os.environ.get(name, "").split(",") if item.strip()]


def _loggable_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    compact = dict(summary)
    if isinstance(compact.get("runs"), list):
        compact["runs_count"] = len(compact["runs"])
        compact.pop("runs", None)
    return compact
