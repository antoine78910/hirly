"""Continuous France Travail inventory harvester.

Pulls offers from the official France Travail API (no scraping) for the top
French job markets, **city-only** (no role keyword) so each query captures the
broadest local inventory (e.g. all Paris offers, not just "barista Paris").

Results are upserted into Supabase (`jobs` table). A background loop rotates
through the top 10 cities and re-runs frequently to pick up new postings.

Designed to run either:
- as a background loop started at app startup (FT_HARVEST_ENABLED=true), or
- on demand through POST /api/admin/jobs/france-travail/harvest.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional

from job_providers import get_job_provider, is_job_provider_configured
from job_providers.base import JobSearchQuery
from jobs_service import upsert_imported_jobs

logger = logging.getLogger(__name__)

# Top 10 French job markets, highest volume first.
DEFAULT_HARVEST_CITIES = [
    "Paris",
    "Lyon",
    "Marseille",
    "Toulouse",
    "Nice",
    "Nantes",
    "Montpellier",
    "Strasbourg",
    "Bordeaux",
    "Lille",
]

_harvest_cursor = 0
_harvest_lock = asyncio.Lock()
_last_run_summary: Optional[Dict[str, Any]] = None


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _csv_env(name: str) -> List[str]:
    raw = os.environ.get(name) or ""
    return [item.strip() for item in raw.split(",") if item.strip()]


def harvest_enabled() -> bool:
    return (
        _env_bool("FT_HARVEST_ENABLED", True)
        and is_job_provider_configured("france_travail")
    )


def _harvest_cities() -> List[str]:
    return _csv_env("FT_HARVEST_CITIES") or _csv_env("FT_HARVEST_LOCATIONS") or DEFAULT_HARVEST_CITIES


async def harvest_france_travail(
    db,
    *,
    max_queries: Optional[int] = None,
    dry_run: bool = False,
    start_offset: Optional[int] = None,
) -> Dict[str, Any]:
    """Run one harvest slice: rotate through top cities with broad (no-role) queries."""
    global _harvest_cursor
    if not is_job_provider_configured("france_travail"):
        return {"enabled": False, "reason": "france_travail_not_configured", "runs": []}

    cities = _harvest_cities()
    if not cities:
        return {"enabled": True, "reason": "no_cities_configured", "runs": []}

    # Default: sweep all top-10 cities each cycle.
    queries = max(1, min(int(max_queries or _env_int("FT_HARVEST_QUERIES_PER_RUN", 10)), len(cities)))
    page_size = max(10, min(_env_int("FT_HARVEST_PAGE_SIZE", 100), 150))
    max_pages = max(1, min(_env_int("FT_HARVEST_MAX_PAGES", 3), 5))
    pause_seconds = max(0.2, _env_float("FT_HARVEST_QUERY_PAUSE_SECONDS", 0.5))

    async with _harvest_lock:
        cursor = start_offset % len(cities) if start_offset is not None else _harvest_cursor % len(cities)
        provider = get_job_provider("france_travail", "")
        started = time.perf_counter()
        summary: Dict[str, Any] = {
            "enabled": True,
            "dry_run": dry_run,
            "mode": "city_only",
            "cursor_start": cursor,
            "cities_total": len(cities),
            "queries_planned": queries,
            "jobs_fetched": 0,
            "jobs_upserted": 0,
            "errors": [],
            "runs": [],
        }
        for index in range(queries):
            city = cities[(cursor + index) % len(cities)]
            location_label = f"{city}, France"
            run: Dict[str, Any] = {"city": city, "location": location_label, "role": "(all)"}
            try:
                result = await provider.search(JobSearchQuery(
                    role="",
                    location=location_label,
                    country="fr",
                    limit=page_size * max_pages,
                    page_size=page_size,
                    max_pages=max_pages,
                ))
                jobs = result.jobs or []
                run["fetched"] = len(jobs)
                summary["jobs_fetched"] += len(jobs)
                if jobs and not dry_run:
                    stats = await upsert_imported_jobs(db, jobs)
                    run["upserted"] = stats.get("total_imported", 0)
                    summary["jobs_upserted"] += run["upserted"]
            except Exception as exc:
                message = f"{exc.__class__.__name__}: {str(exc)[:200]}"
                run["error"] = message
                summary["errors"].append({"city": city, "location": location_label, "error": message})
                logger.warning("ft_harvest_query_failed city=%s error=%s", city, message)
                await asyncio.sleep(pause_seconds * 4)
            summary["runs"].append(run)
            if index < queries - 1:
                await asyncio.sleep(pause_seconds)
        if start_offset is None:
            _harvest_cursor = (cursor + queries) % len(cities)
        summary["cursor_next"] = (cursor + queries) % len(cities)
        summary["elapsed_ms"] = int((time.perf_counter() - started) * 1000)

    global _last_run_summary
    _last_run_summary = summary
    logger.info(
        "ft_harvest_run_complete mode=city_only cursor=%s->%s cities=%s fetched=%s upserted=%s errors=%s elapsed_ms=%s",
        summary["cursor_start"],
        summary["cursor_next"],
        queries,
        summary["jobs_fetched"],
        summary["jobs_upserted"],
        len(summary["errors"]),
        summary["elapsed_ms"],
    )
    return summary


def last_harvest_summary() -> Optional[Dict[str, Any]]:
    return _last_run_summary


async def run_france_travail_harvest_loop(db) -> None:
    """Periodic harvester started from the app startup hook."""
    if not harvest_enabled():
        logger.info("ft_harvest_loop_disabled")
        return
    interval_minutes = max(5, _env_int("FT_HARVEST_INTERVAL_MINUTES", 60))
    initial_delay = max(0, _env_int("FT_HARVEST_INITIAL_DELAY_SECONDS", 60))
    logger.info(
        "ft_harvest_loop_started mode=city_only interval_minutes=%s initial_delay_seconds=%s cities=%s",
        interval_minutes,
        initial_delay,
        len(_harvest_cities()),
    )
    await asyncio.sleep(initial_delay)
    while True:
        try:
            if harvest_enabled():
                await harvest_france_travail(db)
        except Exception as exc:
            logger.warning("ft_harvest_loop_error error=%s", str(exc)[:300])
        await asyncio.sleep(interval_minutes * 60)
