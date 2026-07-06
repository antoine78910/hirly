"""Keyword search across SmartRecruiters public company boards."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set

from job_providers.ats_adapters.smartrecruiters import SmartRecruitersAtsAdapter
from job_providers.base import JobSearchQuery
from job_validation import cheap_validate_job_applyability
from jobs_service import upsert_imported_jobs


logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def build_smartrecruiters_keyword(role: Optional[str], location: Optional[str]) -> str:
    """Mirror jobs.smartrecruiters.com/?keyword=auxerre%20eh style queries."""
    parts = [part.strip() for part in (location, role) if part and str(part).strip()]
    return " ".join(parts)


def _default_company_slugs() -> List[str]:
    raw = os.environ.get(
        "SMARTRECRUITERS_DEFAULT_COMPANY_SLUGS",
        "Sodexo,Visa,IKEA,Decathlon,Accor,Renault,BoschGroup,Continental,Wayfair",
    )
    return [item.strip() for item in raw.split(",") if item.strip()]


def _city_from_location(location: Optional[str]) -> Optional[str]:
    if not location:
        return None
    first = re.split(r"[,/|]", str(location).strip())[0].strip()
    return first or None


async def _company_slugs_for_query(db, *, country: Optional[str]) -> List[str]:
    slugs: List[str] = []
    seen: Set[str] = set()

    def add_slug(value: Optional[str]) -> None:
        slug = (value or "").strip()
        if not slug:
            return
        key = slug.lower()
        if key in seen:
            return
        seen.add(key)
        slugs.append(slug)

    for slug in _default_company_slugs():
        add_slug(slug)

    query: Dict[str, Any] = {"ats_provider": "smartrecruiters", "is_active": True}
    if country:
        query["country_code"] = country.strip().lower()
    if db is not None:
        rows = await db.ats_company_sources.find(query, {"_id": 0, "source_key": 1}).limit(50).to_list(50)
        for row in rows:
            add_slug(row.get("source_key"))

        job_query: Dict[str, Any] = {"ats_provider": "smartrecruiters"}
        if country:
            job_query["country_code"] = country.strip().lower()
        job_rows = await db.jobs.find(job_query, {"_id": 0, "board_token": 1, "provider_query": 1}).limit(100).to_list(100)
        for row in job_rows:
            add_slug(row.get("board_token") or row.get("provider_query"))

    return slugs


async def refresh_smartrecruiters_jobs_for_query(
    db,
    *,
    query: JobSearchQuery,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    if not _env_bool("SMARTRECRUITERS_SEARCH_ENABLED", True):
        return {"attempted": False, "reason": "disabled", "imported_count": 0}

    adapter = SmartRecruitersAtsAdapter()
    keyword = build_smartrecruiters_keyword(query.role, query.location)
    city = _city_from_location(query.location)
    country = (query.country or "").strip().lower() or None
    company_limit = max(1, min(_env_int("SMARTRECRUITERS_SEARCH_MAX_COMPANIES", 6), 20))
    per_company_limit = max(1, min(_env_int("SMARTRECRUITERS_SEARCH_PER_COMPANY_LIMIT", 5), 25))
    detail_limit = max(0, min(_env_int("SMARTRECRUITERS_DETAIL_FETCH_LIMIT", 12), 40))
    target_count = max(1, min(int(limit or query.limit or 20), 50))

    company_slugs = (await _company_slugs_for_query(db, country=country))[:company_limit]
    if not company_slugs:
        return {"attempted": False, "reason": "no_company_slugs", "imported_count": 0}

    logger.info(
        "smartrecruiters_search_start keyword=%s city=%s country=%s companies=%s",
        keyword,
        city,
        country,
        len(company_slugs),
    )

    sem = asyncio.Semaphore(max(1, min(_env_int("SMARTRECRUITERS_SEARCH_CONCURRENCY", 4), 8)))

    async def _search_company(slug: str) -> List[Dict[str, Any]]:
        async with sem:
            try:
                return await adapter.fetch_postings(
                    slug,
                    limit=per_company_limit,
                    q=keyword or None,
                    city=city,
                    country=country,
                    language=query.language,
                )
            except Exception as exc:
                logger.warning("smartrecruiters_search_company_failed slug=%s error=%s", slug, exc)
                return []

    grouped = await asyncio.gather(*[_search_company(slug) for slug in company_slugs])
    candidates: List[tuple[str, Dict[str, Any]]] = []
    for slug, rows in zip(company_slugs, grouped):
        for row in rows:
            if isinstance(row, dict):
                candidates.append((slug, row))

    normalized: List[Dict[str, Any]] = []
    seen_external: Set[str] = set()
    for index, (slug, row) in enumerate(candidates):
        posting_id = str(row.get("id") or "").strip()
        if not posting_id:
            continue
        external_id = f"{slug}:{posting_id}"
        if external_id in seen_external:
            continue
        seen_external.add(external_id)

        detail: Dict[str, Any] = {}
        if index < detail_limit:
            try:
                detail = await adapter.fetch_posting_detail(slug, posting_id)
            except Exception as exc:
                logger.warning(
                    "smartrecruiters_posting_detail_failed slug=%s posting_id=%s error=%s",
                    slug,
                    posting_id,
                    exc,
                )

        job = adapter.normalize_job(row, source_key=slug, detail=detail)
        if job:
            normalized.append({**job, **cheap_validate_job_applyability(job)})
        if len(normalized) >= target_count:
            break

    import_stats = await upsert_imported_jobs(db, normalized[:target_count]) if normalized else {"total_imported": 0}
    imported_count = int(import_stats.get("total_imported") or 0)
    logger.info(
        "smartrecruiters_search_complete keyword=%s candidates=%s normalized=%s imported=%s",
        keyword,
        len(candidates),
        len(normalized),
        imported_count,
    )
    return {
        "attempted": True,
        "reason": "imported" if imported_count else "no_results",
        "keyword": keyword,
        "company_slugs": company_slugs,
        "candidate_count": len(candidates),
        "normalized_count": len(normalized),
        "imported_count": imported_count,
    }
