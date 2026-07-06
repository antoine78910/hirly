"""Continuous France Travail inventory harvester.

Pulls offers from the official France Travail API (no scraping needed) across a
rotating grid of cities x roles and upserts them into the jobs collection.
The goal is a warm database so the feed can answer almost any role/city query
instantly from local inventory, without blocking on providers at request time.

Designed to run either:
- as a background loop started at app startup (FT_HARVEST_ENABLED=true), or
- on demand through the admin endpoint POST /api/admin/jobs/france-travail/harvest.

API usage stays conservative: each run performs at most
FT_HARVEST_QUERIES_PER_RUN searches, sequentially, with a small pause between
queries (France Travail allows ~10 req/s).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from job_providers import get_job_provider, is_job_provider_configured
from job_providers.base import JobSearchQuery
from jobs_service import upsert_imported_jobs

logger = logging.getLogger(__name__)

# Largest French job markets first; the rotation wraps around so every
# city/role combo is eventually refreshed.
DEFAULT_HARVEST_LOCATIONS = [
    "Paris", "Lyon", "Marseille", "Toulouse", "Nice", "Nantes", "Montpellier",
    "Strasbourg", "Bordeaux", "Lille", "Rennes", "Reims", "Toulon",
    "Saint-Etienne", "Le Havre", "Grenoble", "Dijon", "Angers", "Nimes",
    "Aix-en-Provence", "Clermont-Ferrand", "Tours", "Amiens", "Metz", "Rouen",
]

# "" means a broad location-only sweep (no motsCles) which captures the whole
# local market; specific roles deepen coverage for popular searches.
DEFAULT_HARVEST_ROLES = [
    "", "vendeur", "serveur", "barista", "commercial", "assistant administratif",
    "comptable", "developpeur", "marketing", "chef de projet", "logistique",
    "chauffeur livreur", "aide soignant", "infirmier", "technicien maintenance",
    "cuisinier", "receptionniste", "manutentionnaire", "agent d'entretien",
    "conseiller clientele",
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


def _harvest_combos() -> List[Tuple[str, str]]:
    locations = _csv_env("FT_HARVEST_LOCATIONS") or DEFAULT_HARVEST_LOCATIONS
    roles_env = os.environ.get("FT_HARVEST_ROLES")
    roles = (
        [item.strip() for item in roles_env.split(",")] if roles_env is not None
        else DEFAULT_HARVEST_ROLES
    )
    # City-major order: broad sweep + popular roles for one city before moving
    # to the next, so each run leaves at least one city fully covered.
    return [(role, city) for city in locations for role in roles]


async def harvest_france_travail(
    db,
    *,
    max_queries: Optional[int] = None,
    dry_run: bool = False,
    start_offset: Optional[int] = None,
) -> Dict[str, Any]:
    """Run one harvest slice (rotating cursor over the cities x roles grid)."""
    global _harvest_cursor
    if not is_job_provider_configured("france_travail"):
        return {"enabled": False, "reason": "france_travail_not_configured", "runs": []}

    combos = _harvest_combos()
    if not combos:
        return {"enabled": True, "reason": "no_combos_configured", "runs": []}

    queries = max(1, min(int(max_queries or _env_int("FT_HARVEST_QUERIES_PER_RUN", 12)), 60))
    page_size = max(10, min(_env_int("FT_HARVEST_PAGE_SIZE", 100), 150))
    max_pages = max(1, min(_env_int("FT_HARVEST_MAX_PAGES", 2), 5))
    pause_seconds = max(0.2, _env_float("FT_HARVEST_QUERY_PAUSE_SECONDS", 0.5))

    async with _harvest_lock:
        cursor = start_offset % len(combos) if start_offset is not None else _harvest_cursor % len(combos)
        provider = get_job_provider("france_travail", "")
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
            run: Dict[str, Any] = {"role": role or "(broad)", "location": location_label}
            try:
                result = await provider.search(JobSearchQuery(
                    role=role,
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
                summary["errors"].append({"role": role, "location": location_label, "error": message})
                logger.warning("ft_harvest_query_failed role=%r location=%s error=%s", role, location_label, message)
                # Back off harder on provider errors (rate limit / auth hiccups).
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
        "ft_harvest_run_complete cursor=%s->%s fetched=%s upserted=%s errors=%s elapsed_ms=%s",
        summary["cursor_start"],
        summary["cursor_next"],
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
    interval_minutes = max(5, _env_int("FT_HARVEST_INTERVAL_MINUTES", 20))
    initial_delay = max(0, _env_int("FT_HARVEST_INITIAL_DELAY_SECONDS", 60))
    logger.info(
        "ft_harvest_loop_started interval_minutes=%s initial_delay_seconds=%s",
        interval_minutes,
        initial_delay,
    )
    await asyncio.sleep(initial_delay)
    while True:
        try:
            if harvest_enabled():
                await harvest_france_travail(db)
        except Exception as exc:
            logger.warning("ft_harvest_loop_error error=%s", str(exc)[:300])
        await asyncio.sleep(interval_minutes * 60)
