"""Direct ATS source discovery and refresh helpers."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from job_providers.ats_adapters import adapter_for_url, get_ats_adapter, supported_ats_providers
from job_validation import cheap_validate_job_applyability
from jobs_service import upsert_imported_jobs


logger = logging.getLogger(__name__)


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


async def discover_ats_sources_from_cached_jobs(
    db,
    *,
    provider: Optional[str] = None,
    country_code: Optional[str] = None,
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    providers = [provider.strip().lower()] if provider else list(supported_ats_providers())
    scan_limit = max(1, min(int(limit or 500), 5000))
    query: Dict[str, Any] = {"ats_provider": {"$in": providers}}
    if country_code:
        query["country_code"] = country_code.strip().lower()
    rows = await db.jobs.find(query, {"_id": 0}).limit(scan_limit).to_list(scan_limit)
    summary = {
        "dry_run": dry_run,
        "provider": provider,
        "country_code": country_code,
        "scanned_count": len(rows),
        "discovered_count": 0,
        "skipped_count": 0,
        "errors": [],
    }
    logger.info("ats_source_discovery_start query=%s limit=%s dry_run=%s", query, scan_limit, dry_run)
    for job in rows:
        try:
            source_doc = _source_doc_from_job(job, providers)
            if not source_doc:
                summary["skipped_count"] += 1
                continue
            if not dry_run:
                await db.ats_company_sources.update_one(
                    {"id": source_doc["id"]},
                    {"$set": source_doc},
                    upsert=True,
                )
            summary["discovered_count"] += 1
        except Exception as exc:
            logger.warning("ats_source_discovery_job_failed job_id=%s error=%s", job.get("job_id"), exc)
            summary["errors"].append({"job_id": job.get("job_id"), "error": f"{exc.__class__.__name__}: {str(exc)[:160]}"})
    logger.info("ats_source_discovery_complete summary=%s", _compact_summary(summary))
    return summary


async def refresh_ats_source(
    db,
    *,
    ats_provider: str,
    source_key: str,
    limit: Optional[int] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    provider = (ats_provider or "").strip().lower()
    key = (source_key or "").strip().lower()
    adapter = get_ats_adapter(provider)
    source_id = f"{provider}:{key}"
    summary = _empty_refresh_summary(provider, key, dry_run)
    if not adapter:
        summary["errors"].append(f"unsupported_ats_provider:{provider}")
        return summary
    if not key:
        summary["errors"].append("missing_source_key")
        return summary

    now = datetime.now(timezone.utc).isoformat()
    logger.info("ats_source_refresh_start provider=%s source_key=%s limit=%s dry_run=%s", provider, key, limit, dry_run)
    try:
        raw_jobs = await adapter.fetch_jobs(key, limit=max(1, min(int(limit or env_int("JOBS_ATS_REFRESH_JOB_LIMIT", 200)), 500)))
        normalized = [adapter.normalize_job(row, source_key=key) for row in raw_jobs]
        jobs = [job for job in normalized if job]
        validated_jobs = [{**job, **cheap_validate_job_applyability(job)} for job in jobs]
        counts = _validation_counts(validated_jobs)
        summary.update({
            "fetched_count": len(raw_jobs),
            "normalized_count": len(jobs),
            **counts,
        })
        if not dry_run and jobs:
            import_stats = await upsert_imported_jobs(db, jobs)
            summary["imported_count"] = int(import_stats.get("total_imported") or 0)
        if not dry_run:
            await _update_source_status(
                db,
                source_id,
                {
                    "id": source_id,
                    "ats_provider": provider,
                    "source_key": key,
                    "is_active": True,
                    "last_checked_at": now,
                    "last_success_at": now,
                    "last_error": None,
                    "failure_count": 0,
                    "updated_at": now,
                },
                success=True,
            )
        logger.info("ats_source_refresh_complete summary=%s", _compact_summary(summary))
        return summary
    except Exception as exc:
        logger.warning("ats_source_refresh_failed provider=%s source_key=%s error=%s", provider, key, exc)
        summary["errors"].append(f"{exc.__class__.__name__}: {str(exc)[:200]}")
        if not dry_run:
            await _record_source_failure(db, source_id, provider, key, str(exc), now)
        return summary


async def refresh_known_ats_sources(
    db,
    *,
    provider: Optional[str] = None,
    country_code: Optional[str] = None,
    limit: Optional[int] = None,
    older_than_hours: Optional[int] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    refresh_limit = max(1, min(int(limit or env_int("JOBS_ATS_REFRESH_LIMIT", 25)), 100))
    hours = max(1, int(older_than_hours if older_than_hours is not None else env_int("JOBS_ATS_REFRESH_OLDER_THAN_HOURS", 12)))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    query: Dict[str, Any] = {"is_active": True}
    if provider:
        query["ats_provider"] = provider.strip().lower()
    if country_code:
        query["country_code"] = country_code.strip().lower()
    rows = await db.ats_company_sources.find(query, {"_id": 0}).limit(refresh_limit * 5).to_list(refresh_limit * 5)
    candidates = [row for row in rows if _checked_before(row.get("last_checked_at"), cutoff)][:refresh_limit]
    summary = {
        "dry_run": dry_run,
        "provider": provider,
        "country_code": country_code,
        "limit": refresh_limit,
        "scanned_count": len(rows),
        "refreshed_sources_count": 0,
        "runs": [],
        "errors": [],
    }
    logger.info("ats_known_sources_refresh_start query=%s candidates=%s dry_run=%s", query, len(candidates), dry_run)
    for source in candidates:
        run = await refresh_ats_source(
            db,
            ats_provider=source.get("ats_provider"),
            source_key=source.get("source_key"),
            dry_run=dry_run,
        )
        summary["runs"].append(run)
        if run.get("errors"):
            summary["errors"].extend(run["errors"])
        else:
            summary["refreshed_sources_count"] += 1
    logger.info("ats_known_sources_refresh_complete summary=%s", _compact_summary(summary))
    return summary


async def run_ats_direct_maintenance(
    db,
    *,
    dry_run: bool = False,
) -> Dict[str, Any]:
    if not env_bool("JOBS_ATS_DIRECT_ENABLED", True):
        return {"enabled": False, "dry_run": dry_run, "discover": None, "refresh": None}
    discover = None
    if env_bool("JOBS_ATS_DISCOVER_FROM_CACHE_ENABLED", True):
        discover = await discover_ats_sources_from_cached_jobs(db, dry_run=dry_run)
    refresh = await refresh_known_ats_sources(
        db,
        limit=env_int("JOBS_ATS_REFRESH_LIMIT", 25),
        older_than_hours=env_int("JOBS_ATS_REFRESH_OLDER_THAN_HOURS", 12),
        dry_run=dry_run,
    )
    return {"enabled": True, "dry_run": dry_run, "discover": discover, "refresh": refresh}


def _source_doc_from_job(job: Dict[str, Any], providers: List[str]) -> Optional[Dict[str, Any]]:
    urls = _job_urls(job)
    for url in urls:
        adapter = adapter_for_url(url)
        if not adapter or adapter.provider not in providers:
            continue
        source_key = adapter.extract_source_key_from_url(url)
        if not source_key:
            continue
        provider = adapter.provider
        now = datetime.now(timezone.utc).isoformat()
        return {
            "id": f"{provider}:{source_key}",
            "ats_provider": provider,
            "source_key": source_key,
            "company_name": job.get("company"),
            "careers_url": _careers_url(provider, source_key),
            "country_code": (job.get("country_code") or "").lower() or None,
            "discovered_from_url": url,
            "discovered_from_job_id": job.get("job_id"),
            "is_active": True,
            "failure_count": int(job.get("failure_count") or 0),
            "raw_metadata": {"source": "cached_jobs"},
            "created_at": now,
            "updated_at": now,
        }
    return None


def _job_urls(job: Dict[str, Any]) -> List[str]:
    urls: List[str] = []
    for key in ("selected_apply_url", "external_url", "apply_url", "hosted_url"):
        value = job.get(key)
        if isinstance(value, str) and value:
            urls.append(value)
    for option in job.get("apply_options") or []:
        if isinstance(option, dict):
            url = option.get("url") or option.get("apply_url")
            if isinstance(url, str) and url:
                urls.append(url)
    for url in job.get("source_urls") or []:
        if isinstance(url, str) and url:
            urls.append(url)
    return list(dict.fromkeys(urls))


def _careers_url(provider: str, source_key: str) -> str:
    if provider == "greenhouse":
        return f"https://boards.greenhouse.io/{source_key}"
    if provider == "lever":
        return f"https://jobs.lever.co/{source_key}"
    if provider == "ashby":
        return f"https://jobs.ashbyhq.com/{source_key}"
    if provider == "smartrecruiters":
        return f"https://jobs.smartrecruiters.com/{source_key}"
    return source_key


async def _update_source_status(db, source_id: str, fields: Dict[str, Any], *, success: bool) -> None:
    existing = await db.ats_company_sources.find_one({"id": source_id}, {"_id": 0})
    merged = {**(existing or {}), **fields}
    if success:
        merged["failure_count"] = 0
    await db.ats_company_sources.update_one({"id": source_id}, {"$set": merged}, upsert=True)


async def _record_source_failure(db, source_id: str, provider: str, source_key: str, error: str, checked_at: str) -> None:
    existing = await db.ats_company_sources.find_one({"id": source_id}, {"_id": 0}) or {}
    failure_count = int(existing.get("failure_count") or 0) + 1
    await db.ats_company_sources.update_one(
        {"id": source_id},
        {"$set": {
            **existing,
            "id": source_id,
            "ats_provider": provider,
            "source_key": source_key,
            "is_active": existing.get("is_active", True),
            "last_checked_at": checked_at,
            "last_error": error[:500],
            "failure_count": failure_count,
            "updated_at": checked_at,
        }},
        upsert=True,
    )


def _checked_before(value: Any, cutoff: datetime) -> bool:
    if not value:
        return True
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return True
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed < cutoff


def _validation_counts(jobs: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = {"valid_count": 0, "unknown_count": 0, "invalid_count": 0, "rejected_count": 0}
    for job in jobs:
        status = str(job.get("validation_status") or "").lower()
        tier = str(job.get("applyability_tier") or "").upper()
        if status == "valid":
            counts["valid_count"] += 1
        elif status == "invalid":
            counts["invalid_count"] += 1
        else:
            counts["unknown_count"] += 1
        if status == "invalid" or tier in {"D", "E"}:
            counts["rejected_count"] += 1
    return counts


def _empty_refresh_summary(provider: str, source_key: str, dry_run: bool) -> Dict[str, Any]:
    return {
        "dry_run": dry_run,
        "ats_provider": provider,
        "source_key": source_key,
        "fetched_count": 0,
        "normalized_count": 0,
        "imported_count": 0,
        "valid_count": 0,
        "unknown_count": 0,
        "invalid_count": 0,
        "rejected_count": 0,
        "errors": [],
    }


def _compact_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in summary.items() if key != "runs"}
