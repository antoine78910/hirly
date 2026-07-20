"""Continuous France Travail inventory harvester.

Pulls offers from the official France Travail API (no scraping).

Default mode with JOBS_INVENTORY_BLITZ=true (on by default): rotate through
all French départements × broad role slices to maximize unique inventory
toward a ~500k/week fill target.

Legacy city-only mode remains available when blitz is disabled.
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

# Broader FR coverage when not in département-blitz mode.
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
    "Rennes",
    "Reims",
    "Saint-Etienne",
    "Le Havre",
    "Toulon",
    "Grenoble",
    "Dijon",
    "Angers",
    "Nimes",
    "Villeurbanne",
]

# Metropolitan départements + Corse + DOM (FT codes).
FR_DEPARTEMENTS = (
    [f"{i:02d}" for i in range(1, 20)]
    + ["2A", "2B"]
    + [f"{i:02d}" for i in range(21, 96)]
    + ["971", "972", "973", "974", "976"]
)

# Broad FR keywords to slice large départements beyond the first page of "all".
# Empty string = location-only (widest net).
BLITZ_HARVEST_ROLES = [
    "",
    "commercial",
    "vendeur",
    "developpeur",
    "ingenieur",
    "comptable",
    "infirmier",
    "aide soignant",
    "chauffeur",
    "manutentionnaire",
    "cuisinier",
    "serveur",
    "electricien",
    "mecanicien",
    "assistant",
    "secretaire",
    "marketing",
    "rh",
    "technicien",
    "logistique",
    "agent de securite",
    "hotellerie",
    "juridique",
    "enseignant",
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


def inventory_blitz_enabled() -> bool:
    return _env_bool("JOBS_INVENTORY_BLITZ", True)


def harvest_enabled() -> bool:
    return (
        _env_bool("FT_HARVEST_ENABLED", True)
        and is_job_provider_configured("france_travail")
    )


def _harvest_cities() -> List[str]:
    return _csv_env("FT_HARVEST_CITIES") or _csv_env("FT_HARVEST_LOCATIONS") or DEFAULT_HARVEST_CITIES


def _harvest_departements() -> List[str]:
    override = _csv_env("FT_HARVEST_DEPARTEMENTS")
    return override or list(FR_DEPARTEMENTS)


def _harvest_roles() -> List[str]:
    if os.environ.get("FT_HARVEST_ROLES") is not None:
        # Allow empty CSV entries via trailing commas; keep "" if explicitly listed.
        raw = os.environ.get("FT_HARVEST_ROLES") or ""
        parts = [item.strip() for item in raw.split(",")]
        return parts if parts else list(BLITZ_HARVEST_ROLES)
    return list(BLITZ_HARVEST_ROLES)


def _harvest_targets() -> List[Dict[str, str]]:
    """Build rotating (location, role) targets for one harvest strategy."""
    if _csv_env("FT_HARVEST_CITIES") or _csv_env("FT_HARVEST_LOCATIONS"):
        return [
            {"location": f"{city}, France", "role": "", "label": city}
            for city in _harvest_cities()
        ]
    if inventory_blitz_enabled():
        targets: List[Dict[str, str]] = []
        for dept in _harvest_departements():
            for role in _harvest_roles():
                targets.append({
                    "location": f"Département {dept}, France",
                    "role": role,
                    "label": f"{dept}:{role or 'all'}",
                })
        return targets
    return [
        {"location": f"{city}, France", "role": "", "label": city}
        for city in _harvest_cities()
    ]


def _blitz_defaults() -> Tuple[int, int, int, int, float]:
    """queries_per_run, page_size, max_pages, concurrency, interval_minutes defaults."""
    if inventory_blitz_enabled():
        return (40, 150, 10, 4, 5)
    return (10, 100, 5, 3, 60)


async def harvest_france_travail(
    db,
    *,
    max_queries: Optional[int] = None,
    dry_run: bool = False,
    start_offset: Optional[int] = None,
) -> Dict[str, Any]:
    """Run one harvest slice across the current target rotation."""
    global _harvest_cursor
    if not is_job_provider_configured("france_travail"):
        return {"enabled": False, "reason": "france_travail_not_configured", "runs": []}

    targets = _harvest_targets()
    if not targets:
        return {"enabled": True, "reason": "no_targets_configured", "runs": []}

    default_queries, default_page, default_pages, default_conc, _ = _blitz_defaults()
    queries = max(1, min(int(max_queries or _env_int("FT_HARVEST_QUERIES_PER_RUN", default_queries)), len(targets)))
    page_size = max(10, min(_env_int("FT_HARVEST_PAGE_SIZE", default_page), 150))
    max_pages = max(1, min(_env_int("FT_HARVEST_MAX_PAGES", default_pages), 20))
    pause_seconds = max(0.0, _env_float("FT_HARVEST_QUERY_PAUSE_SECONDS", 0.05 if inventory_blitz_enabled() else 0.15))
    concurrency = max(1, min(_env_int("FT_HARVEST_CONCURRENCY", default_conc), 8))
    mode = "blitz_dept_role" if inventory_blitz_enabled() and not (
        _csv_env("FT_HARVEST_CITIES") or _csv_env("FT_HARVEST_LOCATIONS")
    ) else "city_only"

    async with _harvest_lock:
        cursor = start_offset % len(targets) if start_offset is not None else _harvest_cursor % len(targets)
        provider = get_job_provider("france_travail", "")
        started = time.perf_counter()
        summary: Dict[str, Any] = {
            "enabled": True,
            "dry_run": dry_run,
            "mode": mode,
            "blitz": inventory_blitz_enabled(),
            "cursor_start": cursor,
            "targets_total": len(targets),
            "cities_total": len(targets),  # backward-compatible field for status UIs
            "queries_planned": queries,
            "concurrency": concurrency,
            "jobs_fetched": 0,
            "jobs_upserted": 0,
            "errors": [],
            "runs": [],
        }
        semaphore = asyncio.Semaphore(concurrency)
        runs: List[Optional[Dict[str, Any]]] = [None] * queries

        async def _harvest_one(index: int) -> None:
            target = targets[(cursor + index) % len(targets)]
            location_label = target["location"]
            role = target.get("role") or ""
            run: Dict[str, Any] = {
                "city": target.get("label") or location_label,
                "location": location_label,
                "role": role or "(all)",
            }
            async with semaphore:
                try:
                    if concurrency == 1 and index > 0 and pause_seconds > 0:
                        await asyncio.sleep(pause_seconds)
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
                    if jobs and not dry_run:
                        stats = await upsert_imported_jobs(db, jobs)
                        run["upserted"] = stats.get("total_imported", 0)
                except Exception as exc:
                    message = f"{exc.__class__.__name__}: {str(exc)[:200]}"
                    run["error"] = message
                    logger.warning(
                        "ft_harvest_query_failed target=%s error=%s",
                        target.get("label"),
                        message,
                    )
                    await asyncio.sleep(max(pause_seconds, 0.2) * 4)
            runs[index] = run

        await asyncio.gather(*(_harvest_one(index) for index in range(queries)))

        for run in runs:
            if not run:
                continue
            summary["runs"].append(run)
            summary["jobs_fetched"] += int(run.get("fetched") or 0)
            summary["jobs_upserted"] += int(run.get("upserted") or 0)
            if run.get("error"):
                summary["errors"].append({
                    "city": run.get("city"),
                    "location": run.get("location"),
                    "error": run["error"],
                })

        if start_offset is None:
            _harvest_cursor = (cursor + queries) % len(targets)
        summary["cursor_next"] = (cursor + queries) % len(targets)
        summary["elapsed_ms"] = int((time.perf_counter() - started) * 1000)

    global _last_run_summary
    _last_run_summary = summary
    logger.info(
        "ft_harvest_run_complete mode=%s cursor=%s->%s targets=%s concurrency=%s fetched=%s upserted=%s errors=%s elapsed_ms=%s",
        mode,
        summary["cursor_start"],
        summary["cursor_next"],
        queries,
        concurrency,
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
    _, _, _, _, default_interval = _blitz_defaults()
    interval_minutes = max(5, _env_int("FT_HARVEST_INTERVAL_MINUTES", default_interval))
    initial_delay = max(0, _env_int("FT_HARVEST_INITIAL_DELAY_SECONDS", 30 if inventory_blitz_enabled() else 60))
    targets = _harvest_targets()
    logger.info(
        "ft_harvest_loop_started mode=%s blitz=%s interval_minutes=%s initial_delay_seconds=%s targets=%s",
        "blitz_dept_role" if inventory_blitz_enabled() else "city_only",
        inventory_blitz_enabled(),
        interval_minutes,
        initial_delay,
        len(targets),
    )
    await asyncio.sleep(initial_delay)
    while True:
        ledger_run_id = None
        try:
            if harvest_enabled():
                begin = getattr(db, "begin_python_ingestion_run", None)
                claim = (
                    await begin(
                        schedule_id="python-france-travail-harvest",
                        source="france_travail",
                        cadence_seconds=interval_minutes * 60,
                    )
                    if callable(begin)
                    else {"acquired": True, "run_id": None}
                )
                if not claim.get("acquired"):
                    logger.info(
                        "ft_harvest_overlap_skipped run_id=%s scheduled_for=%s",
                        claim.get("run_id"),
                        claim.get("scheduled_for"),
                    )
                else:
                    ledger_run_id = claim.get("run_id")
                    summary = await harvest_france_travail(db)
                    complete = getattr(db, "complete_python_ingestion_run", None)
                    if ledger_run_id and callable(complete):
                        errors = summary.get("errors") or []
                        await complete(
                            run_id=ledger_run_id,
                            status="succeeded" if not errors else "partially_succeeded",
                            completeness_state="complete_snapshot" if not errors else "partial",
                            summary=summary,
                        )
        except Exception as exc:
            complete = getattr(db, "complete_python_ingestion_run", None)
            if ledger_run_id and callable(complete):
                try:
                    await complete(
                        run_id=ledger_run_id,
                        status="failed",
                        completeness_state="failed",
                        summary={"terminal_error": f"{exc.__class__.__name__}: {str(exc)[:200]}"},
                    )
                except Exception as ledger_exc:
                    logger.error("ft_harvest_ledger_completion_failed error=%s", str(ledger_exc)[:300])
            logger.warning("ft_harvest_loop_error error=%s", str(exc)[:300])
        await asyncio.sleep(interval_minutes * 60)
