"""Lightweight job cache maintenance helpers.

These functions are designed to be called by protected admin endpoints or a
future Railway cron HTTP job. They avoid external queues and keep API usage
bounded by conservative limits.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from ats_source_service import (
    discover_ats_sources_from_cached_jobs,
    refresh_known_ats_sources,
    run_ats_direct_maintenance,
)
from job_providers import get_job_provider, is_job_provider_configured, primary_job_provider_name
from job_providers.base import JobSearchQuery
from job_validation import cheap_validate_job_applyability
from jobs_service import refresh_jobs_for_profile_if_needed, upsert_imported_jobs
from location_intelligence import country_to_jsearch_language, expand_location_radius


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
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    search_radius: Optional[str] = None,
    include_cross_border: Optional[bool] = None,
    discover_ats_sources: bool = False,
    refresh_discovered_ats_sources: bool = False,
    ats_refresh_limit: Optional[int] = None,
    remote: Optional[bool] = None,
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    refresh_limit = max(1, min(int(limit or env_int("JOBS_MAINTENANCE_REFRESH_LIMIT", 100)), 300))
    country = (country_code or default_country_code()).strip().lower()
    role = (search_role or "marketing").strip()
    location_label = (location or _default_location_for_country(country)).strip()
    radius_km = _parse_radius_km(search_radius)
    if (
        env_bool("JOBS_ADMIN_LOCATION_EXPANSION_ENABLED", True)
        and location_label
        and radius_km is not None
        and radius_km >= env_int("JOBS_ADMIN_LOCATION_MIN_RADIUS_KM", 10)
    ):
        return await _refresh_jobs_for_expanded_locations(
            db,
            role=role,
            location_label=location_label,
            country_code=country,
            lat=lat,
            lng=lng,
            radius_km=radius_km,
            include_cross_border=include_cross_border,
            refresh_limit=refresh_limit,
            dry_run=dry_run,
            discover_ats_sources=discover_ats_sources,
            refresh_discovered_ats_sources=refresh_discovered_ats_sources,
            ats_refresh_limit=ats_refresh_limit,
            remote=remote,
        )

    profile = _synthetic_profile(role, location_label, country, remote)
    summary = _empty_refresh_summary(dry_run=dry_run)
    summary.update({
        "search_role": role,
        "location": location_label,
        "country_code": country,
        "limit": refresh_limit,
        "search_radius": search_radius or "50km",
        "location_expansion_used": False,
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
            search_radius=search_radius or ("50km" if location_label else "country"),
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


async def _refresh_jobs_for_expanded_locations(
    db,
    *,
    role: str,
    location_label: str,
    country_code: str,
    lat: Optional[float],
    lng: Optional[float],
    radius_km: int,
    include_cross_border: Optional[bool],
    refresh_limit: int,
    dry_run: bool,
    discover_ats_sources: bool,
    refresh_discovered_ats_sources: bool,
    ats_refresh_limit: Optional[int],
    remote: Optional[bool],
) -> Dict[str, Any]:
    max_cities = max(1, min(env_int("JOBS_ADMIN_LOCATION_MAX_CITIES", 8), 50))
    query_budget = max(1, min(env_int("JOBS_ADMIN_LOCATION_PROVIDER_QUERY_BUDGET", 8), 50))
    cross_border = env_bool("JOBS_ADMIN_LOCATION_INCLUDE_CROSS_BORDER", True) if include_cross_border is None else bool(include_cross_border)
    min_population = max(0, env_int("JOBS_ADMIN_LOCATION_MIN_POPULATION", 1000))
    expanded_places = await expand_location_radius(
        location_label=location_label,
        lat=lat,
        lng=lng,
        country_hint=country_code,
        radius_km=radius_km,
        max_cities=max_cities,
        include_cross_border=cross_border,
        min_population=min_population,
        db=db,
    )
    expanded_places = _dedupe_expanded_places(expanded_places)[:query_budget]
    if not expanded_places:
        logger.info("job_cache_location_expansion_empty role=%s location=%s radius_km=%s; falling back", role, location_label, radius_km)
        profile = _synthetic_profile(role, location_label, country_code, remote)
        result = await refresh_jobs_for_profile_if_needed(
            db,
            profile,
            require_auto_apply=False,
            target_auto_apply_count=refresh_limit,
            location_override=location_label,
            location_data_override=profile["target_location_data"],
            search_radius=f"{radius_km}km",
            role_override=role,
            force_provider_refresh=True,
        )
        summary = _empty_refresh_summary(dry_run=dry_run)
        jobs = [job for job in (result.get("jobs") or []) if isinstance(job, dict)]
        summary.update({
            "search_role": role,
            "location": location_label,
            "country_code": country_code,
            "search_radius": f"{radius_km}km",
            "location_expansion_used": False,
            "jsearch_called": bool(result.get("attempted")),
            "discovered_count": len(jobs),
            "imported_count": int(result.get("imported") or result.get("jobs_imported") or len(jobs) or 0),
            **_validation_counts(jobs),
        })
        return summary

    summary = _empty_refresh_summary(dry_run=dry_run)
    summary.update({
        "search_role": role,
        "location": location_label,
        "country_code": country_code,
        "search_radius": f"{radius_km}km",
        "location_expansion_used": True,
        "include_cross_border": cross_border,
        "expanded_locations": [_public_place_summary(place) for place in expanded_places],
        "provider_queries_attempted": 0,
        "provider_results_by_location": {},
        "provider_query_budget": query_budget,
        "deduped_count": 0,
        "validated_counts": {"A": 0, "B": 0, "C": 0, "D": 0, "E": 0, "unknown": 0},
        "direct_ats_sources_discovered": 0,
        "direct_ats_sources_refreshed": 0,
        "ats_discovery": None,
        "ats_refresh": None,
    })
    logger.info(
        "job_cache_location_expanded_refresh_start role=%s origin=%s radius_km=%s expanded=%s budget=%s dry_run=%s",
        role,
        location_label,
        radius_km,
        [f"{p.get('name')}:{p.get('country_code')}" for p in expanded_places],
        query_budget,
        dry_run,
    )
    if dry_run:
        summary["reason"] = "dry_run"
        return summary

    provider_name = primary_job_provider_name()
    if not is_job_provider_configured(provider_name):
        summary["errors"].append("missing_job_provider_credentials")
        return summary
    api_key = os.environ.get("JSEARCH_API_KEY") or ""
    provider = get_job_provider(provider_name, api_key)
    per_query_limit = max(1, min(refresh_limit, env_int("JOBS_ADMIN_LOCATION_REFRESH_RESULTS_PER_CITY", 30), 100))
    page_size = max(5, min(env_int("JSEARCH_FEED_FALLBACK_PAGE_SIZE", 10), 50))
    max_pages = max(1, min(env_int("JSEARCH_FEED_FALLBACK_MAX_PAGES", 1), 3))
    imported_job_ids = set()
    all_imported_jobs: List[Dict[str, Any]] = []

    for place in expanded_places:
        if int(summary["provider_queries_attempted"]) >= query_budget:
            break
        place_country = str(place.get("country_code") or country_code or "").lower() or None
        query = JobSearchQuery(
            role=role,
            location=_jsearch_location_label(place),
            remote_preference="remote" if remote else "any",
            country=place_country,
            language=country_to_jsearch_language(place_country),
            limit=per_query_limit,
            max_pages=max_pages,
            page_size=page_size,
        )
        summary["provider_queries_attempted"] += 1
        key = f"{place.get('name')}|{place_country}"
        try:
            result = await provider.search(query)
            jobs = [job for job in result.jobs if isinstance(job, dict)]
            import_stats = await upsert_imported_jobs(db, jobs)
            imported_jobs = [job for job in jobs if job.get("job_id") not in imported_job_ids]
            imported_job_ids.update(job.get("job_id") for job in imported_jobs if job.get("job_id"))
            all_imported_jobs.extend(imported_jobs)
            summary["provider_results_by_location"][key] = {
                "country_code": place_country,
                "language": query.language,
                "result_count": len(jobs),
                "imported_count": int(import_stats.get("total_imported") or 0),
            }
            logger.info(
                "job_cache_location_refresh_query_complete role=%s location=%s country=%s language=%s results=%s imported=%s",
                role,
                query.location,
                query.country,
                query.language,
                len(jobs),
                import_stats.get("total_imported"),
            )
        except Exception as exc:
            error = f"{exc.__class__.__name__}: {str(exc)[:160]}"
            summary["errors"].append({"location": key, "error": error})
            summary["provider_results_by_location"][key] = {
                "country_code": place_country,
                "language": query.language,
                "result_count": 0,
                "imported_count": 0,
                "error": error,
            }
            logger.warning("job_cache_location_refresh_query_failed role=%s location=%s error=%s", role, key, exc)

    counts = _validation_counts(all_imported_jobs)
    unique_count = len(imported_job_ids) or len(all_imported_jobs)
    summary.update({
        "jsearch_called": int(summary["provider_queries_attempted"]) > 0,
        "discovered_count": len(all_imported_jobs),
        "imported_count": unique_count,
        "deduped_count": max(0, len(all_imported_jobs) - unique_count),
        "validated_counts": _tier_counts(all_imported_jobs),
        **counts,
    })
    if discover_ats_sources:
        discovery = await discover_ats_sources_from_cached_jobs(
            db,
            limit=max(100, min(len(all_imported_jobs) * 5 or refresh_limit * 5, 1000)),
            dry_run=False,
        )
        summary["ats_discovery"] = discovery
        summary["direct_ats_sources_discovered"] = int(discovery.get("discovered_count") or 0)
    if refresh_discovered_ats_sources:
        refresh = await refresh_known_ats_sources(
            db,
            limit=max(1, min(int(ats_refresh_limit or env_int("JOBS_ATS_REFRESH_LIMIT", 25)), 100)),
            dry_run=False,
        )
        summary["ats_refresh"] = refresh
        summary["direct_ats_sources_refreshed"] = int(refresh.get("refreshed_sources_count") or 0)

    logger.info("job_cache_location_expanded_refresh_complete summary=%s", _loggable_summary(summary))
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
                try:
                    from application_expiry import expire_open_applications_for_job
                    await expire_open_applications_for_job(db, job_id, source="stale_job_maintenance")
                except Exception as exc:
                    logger.warning("job_cache_expire_applications_failed job_id=%s error=%s", job_id, exc)
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


KNOWN_JOB_PROVIDERS = [
    "jsearch",
    "france_travail",
    "greenhouse",
    "lever",
    "ashby",
    "smartrecruiters",
    "recruitee",
    "personio",
    "teamtailor",
    "workday",
    "flatchr",
]

SOURCE_DISPLAY_NAMES = {
    "jsearch": "JSearch",
    "france_travail": "France Travail",
    "greenhouse": "Greenhouse",
    "lever": "Lever",
    "ashby": "Ashby",
    "smartrecruiters": "SmartRecruiters",
    "recruitee": "Recruitee",
    "personio": "Personio",
    "teamtailor": "Teamtailor",
    "workday": "Workday",
    "flatchr": "Flatchr",
    "other": "Other",
    "unknown": "Unknown",
}


def _normalize_job_source(provider: Any) -> str:
    text = str(provider or "unknown").strip().lower()
    return text or "unknown"


def _source_display_name(source: str) -> str:
    return SOURCE_DISPLAY_NAMES.get(source, source.replace("_", " ").title())


async def _fetch_import_activity_rows(db, cutoff_iso: str, *, limit: int = 15000) -> List[Dict[str, Any]]:
    filter_query = {"imported_at": {"$gte": cutoff_iso}}
    if hasattr(db.jobs, "read_with_select"):
        return await db.jobs.read_with_select(
            filter_query,
            limit=limit,
            select="provider,imported_at",
        )
    cursor = db.jobs.find(filter_query, {"provider": 1, "imported_at": 1, "_id": 0})
    if hasattr(cursor, "limit"):
        cursor = cursor.limit(limit)
    return await cursor.to_list(limit)


async def job_inventory_analytics(db, *, days: int = 30) -> Dict[str, Any]:
    """Admin inventory snapshot: totals by ingestion source and daily import activity."""
    period_days = max(7, min(int(days), 90))
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=period_days)
    cutoff_iso = cutoff.isoformat()

    total_jobs = await db.jobs.count_documents({})
    valid_ab_jobs = await db.jobs.count_documents(
        {"validation_status": "valid", "applyability_tier": {"$in": ["A", "B"]}},
    )

    by_source: Dict[str, int] = {}
    counted = 0
    for provider in KNOWN_JOB_PROVIDERS:
        count = await db.jobs.count_documents({"provider": provider})
        if count:
            by_source[provider] = count
            counted += count
    other_total = max(0, total_jobs - counted)
    if other_total:
        by_source["other"] = other_total

    rows = await _fetch_import_activity_rows(db, cutoff_iso)
    daily_counts: Dict[str, Dict[str, int]] = {}
    for row in rows:
        imported_at = _parse_dt(row.get("imported_at"))
        if imported_at is None:
            continue
        day_key = imported_at.date().isoformat()
        source = _normalize_job_source(row.get("provider"))
        bucket = daily_counts.setdefault(day_key, {})
        bucket[source] = bucket.get(source, 0) + 1

    daily_series: List[Dict[str, Any]] = []
    day_cursor = cutoff.date()
    end_day = now.date()
    while day_cursor <= end_day:
        day_key = day_cursor.isoformat()
        sources = daily_counts.get(day_key, {})
        daily_series.append({
            "date": day_key,
            "sources": sources,
            "total": sum(sources.values()),
        })
        day_cursor += timedelta(days=1)

    period_source_totals: Dict[str, int] = {}
    for day in daily_series:
        for source, count in (day.get("sources") or {}).items():
            period_source_totals[source] = period_source_totals.get(source, 0) + count

    top_sources = sorted(
        period_source_totals.keys(),
        key=lambda source: period_source_totals[source],
        reverse=True,
    )[:8]

    chart_daily: List[Dict[str, Any]] = []
    for day in daily_series:
        entry: Dict[str, Any] = {"date": day["date"], "total": day["total"]}
        tracked = 0
        for source in top_sources:
            value = int((day.get("sources") or {}).get(source, 0))
            entry[source] = value
            tracked += value
        remainder = max(0, int(day["total"]) - tracked)
        if remainder:
            entry["other"] = remainder
        chart_daily.append(entry)

    chart_sources = list(top_sources)
    if any(int(day.get("other") or 0) > 0 for day in chart_daily):
        chart_sources.append("other")

    cutoff_24h = (now - timedelta(days=1)).date().isoformat()
    cutoff_7d = (now - timedelta(days=7)).date().isoformat()
    imports_last_24h = sum(day["total"] for day in daily_series if day["date"] >= cutoff_24h)
    imports_last_7d = sum(day["total"] for day in daily_series if day["date"] >= cutoff_7d)

    by_source_list = sorted(
        [
            {
                "source": source,
                "label": _source_display_name(source),
                "count": count,
                "share_pct": round((count / total_jobs) * 100, 1) if total_jobs else 0.0,
            }
            for source, count in by_source.items()
        ],
        key=lambda row: row["count"],
        reverse=True,
    )

    return {
        "total_jobs": total_jobs,
        "valid_ab_jobs": valid_ab_jobs,
        "imports_last_24h": imports_last_24h,
        "imports_last_7d": imports_last_7d,
        "by_source": by_source_list,
        "daily": chart_daily,
        "chart_sources": chart_sources,
        "period_days": period_days,
        "activity_rows": len(rows),
        "activity_capped": len(rows) >= 15000,
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


def _tier_counts(jobs: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = {"A": 0, "B": 0, "C": 0, "D": 0, "E": 0, "unknown": 0}
    for job in jobs:
        tier = str(job.get("applyability_tier") or "").upper()
        if tier in counts and tier != "UNKNOWN":
            counts[tier] += 1
        else:
            counts["unknown"] += 1
    return counts


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


def _parse_radius_km(search_radius: Optional[str]) -> Optional[int]:
    text = str(search_radius or "").strip().lower()
    if text in {"", "worldwide", "remote", "remote/worldwide", "country", "country-wide"}:
        return None
    match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*km\s*$", text)
    if not match:
        return None
    return max(1, min(int(float(match.group(1))), 500))


def _dedupe_expanded_places(places: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for place in places:
        key = (
            str(place.get("normalized_name") or place.get("name") or "").strip().lower(),
            str(place.get("country_code") or "").strip().lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(place)
    return out


def _public_place_summary(place: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": place.get("name"),
        "ascii_name": place.get("ascii_name"),
        "country_code": place.get("country_code"),
        "distance_km": place.get("distance_km"),
        "population": place.get("population"),
        "is_origin": bool(place.get("is_origin")),
    }


def _jsearch_location_label(place: Dict[str, Any]) -> Optional[str]:
    name = place.get("ascii_name") or place.get("name")
    if not name:
        return None
    return str(name)
