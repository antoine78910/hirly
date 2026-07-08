"""Continuous JSearch inventory harvester.

Deliberately separate from the JSearch call already wired into the live
feed (server.py's sync_refresh_* fallback, which only fires on demand when
a user's request finds the DB cache too thin, and is capped small to
protect that request's own latency budget). This is a background loop that
builds up DB inventory proactively the same way france_travail_harvest.py
already does for France Travail -- rotating broad role x city queries so
JSearch's own aggregated sources (LinkedIn, Indeed, Talent.com, etc.) keep
feeding the database on a schedule, not only when a user happens to hit a
thin spot in the feed.
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
from location_intelligence import country_to_jsearch_language

logger = logging.getLogger(__name__)

# Same top 10 French job markets as france_travail_harvest.py, kept in
# lockstep deliberately -- both harvesters are prioritizing the same
# France-first focus.
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

# Broad role categories, not narrow titles -- mirrors the same category
# spread already used for onboarding (software/product/data/sales/etc.),
# so this harvester's coverage roughly matches the breadth of roles the
# app actually serves rather than skewing toward one niche.
DEFAULT_HARVEST_ROLES = [
    "software engineer",
    "product manager",
    "data analyst",
    "sales representative",
    "marketing manager",
    "customer success",
    "operations manager",
    "human resources",
    "finance analyst",
    "designer",
    "logistics coordinator",
    "administrative assistant",
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
    return _env_bool("JSEARCH_HARVEST_ENABLED", True) and is_job_provider_configured("jsearch")


def _harvest_cities() -> List[str]:
    return _csv_env("JSEARCH_HARVEST_CITIES") or DEFAULT_HARVEST_CITIES


def _harvest_roles() -> List[str]:
    return _csv_env("JSEARCH_HARVEST_ROLES") or DEFAULT_HARVEST_ROLES


async def harvest_jsearch(
    db,
    *,
    max_queries: Optional[int] = None,
    dry_run: bool = False,
    start_offset: Optional[int] = None,
) -> Dict[str, Any]:
    """Run one harvest slice: rotate through role x city combinations."""
    global _harvest_cursor
    if not is_job_provider_configured("jsearch"):
        return {"enabled": False, "reason": "jsearch_not_configured", "runs": []}

    cities = _harvest_cities()
    roles = _harvest_roles()
    combos = [(role, city) for city in cities for role in roles]
    if not combos:
        return {"enabled": True, "reason": "no_queries_configured", "runs": []}

    queries = max(1, min(int(max_queries or _env_int("JSEARCH_HARVEST_QUERIES_PER_RUN", 6)), len(combos)))
    page_size = max(10, min(_env_int("JSEARCH_HARVEST_PAGE_SIZE", 100), 100))
    max_pages = max(1, min(_env_int("JSEARCH_HARVEST_MAX_PAGES", 2), 5))
    pause_seconds = max(0.2, _env_float("JSEARCH_HARVEST_QUERY_PAUSE_SECONDS", 0.5))

    async with _harvest_lock:
        cursor = start_offset % len(combos) if start_offset is not None else _harvest_cursor % len(combos)
        provider = get_job_provider("jsearch", "")
        started = time.perf_counter()
        summary: Dict[str, Any] = {
            "enabled": True,
            "dry_run": dry_run,
            "cursor_start": cursor,
            "combos_total": len(combos),
            "queries_planned": queries,
            "jobs_fetched": 0,
            "jobs_upserted": 0,
            "errors": [],
            "runs": [],
        }
        for index in range(queries):
            role, city = combos[(cursor + index) % len(combos)]
            location_label = f"{city}, France"
            run: Dict[str, Any] = {"role": role, "location": location_label}
            try:
                result = await provider.search(JobSearchQuery(
                    role=role,
                    location=location_label,
                    country="fr",
                    # Confirmed live: leaving this at the dataclass default
                    # ("en") while targeting country="fr" made every single
                    # query return zero results -- the working feed-fallback
                    # path (jobs_service.build_profile_job_query) always
                    # matches language to country for exactly this reason.
                    language=country_to_jsearch_language("fr"),
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
                summary["errors"].append({"role": role, "location": location_label, "error": message})
                logger.warning("jsearch_harvest_query_failed role=%s location=%s error=%s", role, location_label, message)
                await asyncio.sleep(pause_seconds * 4)
            summary["runs"].append(run)
            if index < queries - 1:
                await asyncio.sleep(pause_seconds)
        if start_offset is None:
            _harvest_cursor = (cursor + queries) % len(combos)
        summary["cursor_next"] = (cursor + queries) % len(combos)
        summary["elapsed_ms"] = int((time.perf_counter() - started) * 1000)

    global _last_run_summary
    _last_run_summary = summary
    logger.info(
        "jsearch_harvest_run_complete cursor=%s->%s queries=%s fetched=%s upserted=%s errors=%s elapsed_ms=%s",
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


async def run_jsearch_harvest_loop(db) -> None:
    """Periodic harvester started from the app startup hook, independent of
    the live feed's synchronous JSearch fallback.
    """
    if not harvest_enabled():
        logger.info("jsearch_harvest_loop_disabled")
        return
    interval_minutes = max(5, _env_int("JSEARCH_HARVEST_INTERVAL_MINUTES", 15))
    initial_delay = max(0, _env_int("JSEARCH_HARVEST_INITIAL_DELAY_SECONDS", 120))
    logger.info(
        "jsearch_harvest_loop_started interval_minutes=%s initial_delay_seconds=%s combos=%s",
        interval_minutes,
        initial_delay,
        len(_harvest_cities()) * len(_harvest_roles()),
    )
    await asyncio.sleep(initial_delay)
    while True:
        try:
            if harvest_enabled():
                await harvest_jsearch(db)
        except Exception as exc:
            logger.warning("jsearch_harvest_loop_error error=%s", str(exc)[:300])
        await asyncio.sleep(interval_minutes * 60)
