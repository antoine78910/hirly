"""Continuous France Travail inventory harvester.

Pulls offers from the official France Travail API (no scraping).

Default mode with JOBS_INVENTORY_BLITZ=true (on by default): rotate through
all French départements × broad role slices to maximize unique inventory
toward a ~500k/week fill target.

Legacy city-only mode remains available when blitz is disabled.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

from job_providers import get_job_provider, is_job_provider_configured
from job_providers.base import JobSearchQuery
from ingestion_run_lease import (
    accounting_summary,
    await_with_ingestion_heartbeat,
    persist_terminal_partitions,
    partition_identity,
)
from jobs_service import upsert_imported_jobs

logger = logging.getLogger(__name__)


def _partition_id(target: Dict[str, Any]) -> str:
    return f"{target.get('location') or ''}|{target.get('role') or ''}"


def _authoritative_manifest(targets: List[Dict[str, Any]]) -> Dict[str, Any]:
    partition_ids = sorted({_partition_id(target) for target in targets})
    encoded = json.dumps(partition_ids, ensure_ascii=False, separators=(",", ":")).encode()
    return {
        "manifest_version": "france-travail-harvest.v2",
        "manifest_digest": hashlib.sha256(encoded).hexdigest(),
        "expected_partition_count": len(partition_ids),
        "expected_partition_ids": partition_ids,
        "geography_scope": "country",
        "countries": ["fr"],
        "remote_scope": "included",
    }

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
_harvest_retry_indices: set[int] = set()
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
    _harvest_retry_indices.intersection_update(range(len(targets)))

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
            "pages_requested": 0,
            "pages_completed": 0,
            "retries": 0,
            "raw_records": 0,
            "normalized_records": 0,
            "rejected_by_reason": {},
            "exact_duplicates": 0,
            "fuzzy_duplicate_candidates": 0,
            "jobs_inserted": 0,
            "jobs_updated": 0,
            "jobs_reactivated": 0,
            "write_failed": 0,
            "jobs_marked_inactive": 0,
            "accounting_contract": {"state": "known"},
            "errors": [],
            "runs": [],
            "authoritative_manifest": _authoritative_manifest(targets),
        }
        semaphore = asyncio.Semaphore(concurrency)
        runs: List[Optional[Dict[str, Any]]] = [None] * queries
        fresh_indices = [(cursor + index) % len(targets) for index in range(queries)]
        retry_indices = sorted(
            (index for index in _harvest_retry_indices if index not in fresh_indices),
            key=lambda index: (index - cursor) % len(targets),
        )
        selected_indices = list(fresh_indices)
        if retry_indices and queries > 1:
            selected_indices[-1] = retry_indices[0]

        async def _harvest_one(index: int) -> None:
            target_index = selected_indices[index]
            target = targets[target_index]
            location_label = target["location"]
            role = target.get("role") or ""
            run: Dict[str, Any] = {
                "partition_id": _partition_id(target),
                "city": target.get("label") or location_label,
                "location": location_label,
                "role": role or "(all)",
            }
            async with semaphore:
                provider_claim = None
                try:
                    if concurrency == 1 and index > 0 and pause_seconds > 0:
                        await asyncio.sleep(pause_seconds)
                    if not dry_run:
                        claim = getattr(db, "claim_python_provider_work", None)
                        if not callable(claim):
                            raise RuntimeError(
                                "France Travail provider ownership claim is unavailable"
                            )
                        provider_claim = await claim("france_travail")
                    result = await provider.search(JobSearchQuery(
                        role=role,
                        location=location_label,
                        country="fr",
                        limit=page_size * max_pages,
                        page_size=page_size,
                        max_pages=max_pages,
                    ))
                    jobs = list(result.jobs or [])
                    normalized_occurrences = len(jobs)
                    raw = result.raw_response if isinstance(result.raw_response, dict) else {}
                    page_responses = [raw]
                    split_depth = 0
                    max_split_depth = max(0, min(_env_int("FT_HARVEST_MAX_SPLIT_DEPTH", 3), 8))
                    child_states = []
                    while raw.get("completeness") == "capped_needs_split" and split_depth < max_split_depth:
                        if provider_claim is not None:
                            heartbeat = getattr(db, "heartbeat_python_provider_work", None)
                            if not callable(heartbeat) or not await heartbeat(provider_claim):
                                raise RuntimeError(
                                    "France Travail provider ownership claim became stale"
                                )
                        states = raw.get("pagination_states") or []
                        next_page = max(
                            (int(state.get("next_page") or 0) for state in states),
                            default=(split_depth + 1) * max_pages,
                        )
                        child = await provider.search(JobSearchQuery(
                            role=role,
                            location=location_label,
                            country="fr",
                            limit=page_size * max_pages,
                            page_size=page_size,
                            max_pages=max_pages,
                            page_start=next_page,
                        ))
                        child_jobs = child.jobs or []
                        normalized_occurrences += len(child_jobs)
                        by_id = {str(job.get("job_id")): job for job in jobs if job.get("job_id")}
                        for job in child_jobs:
                            if job.get("job_id"):
                                by_id[str(job["job_id"])] = job
                        jobs = list(by_id.values())
                        raw = child.raw_response if isinstance(child.raw_response, dict) else {}
                        page_responses.append(raw)
                        child_states.append(raw.get("pagination_states") or [])
                        split_depth += 1
                    run["fetched"] = len(jobs)
                    run["split_depth"] = split_depth
                    run["child_pagination_states"] = child_states
                    run["raw_records"] = sum(
                        int(response.get("rows_seen") or 0) for response in page_responses
                    ) or len(jobs)
                    run["source_exact_duplicates"] = max(
                        0, normalized_occurrences - len(jobs)
                    )
                    run["normalized"] = len(jobs)
                    run["rejected_by_reason"] = {
                        "normalization_failed": max(
                            0, run["raw_records"] - normalized_occurrences
                        )
                    }
                    all_states = [
                        state
                        for response in page_responses
                        for state in (response.get("pagination_states") or [])
                    ]
                    run["pages_requested"] = sum(
                        int(state.get("pages_requested", state.get("pages_completed", 0)) or 0)
                        for state in all_states
                    )
                    run["pages_completed"] = sum(
                        int(state.get("pages_completed") or 0) for state in all_states
                    )
                    run["retries"] = sum(int(state.get("retries") or 0) for state in all_states)
                    run["completeness"] = raw.get("completeness") or "unknown"
                    run["partition_status"] = (
                        "completed_with_results"
                        if run["completeness"] == "complete" and jobs
                        else "completed_zero_results"
                        if run["completeness"] == "complete"
                        else "blocked"
                        if run["completeness"] == "capped_needs_split"
                        else "failed"
                    )
                    if run["completeness"] == "capped_needs_split":
                        run["error"] = "source_cap_reached_needs_split"
                    if jobs and not dry_run:
                        heartbeat = getattr(db, "heartbeat_python_provider_work", None)
                        if not callable(heartbeat) or not await heartbeat(provider_claim):
                            raise RuntimeError(
                                "France Travail provider ownership claim became stale"
                            )
                        stats = await upsert_imported_jobs(
                            db,
                            jobs,
                            provider_claim=provider_claim,
                        )
                        run["upserted"] = stats.get("total_imported", 0)
                        run["write_stats"] = stats
                except Exception as exc:
                    message = f"{exc.__class__.__name__}: {str(exc)[:200]}"
                    run["error"] = message
                    run["partition_status"] = "failed"
                    logger.warning(
                        "ft_harvest_query_failed target=%s error=%s",
                        target.get("label"),
                        message,
                    )
                    await asyncio.sleep(max(pause_seconds, 0.2) * 4)
                finally:
                    if provider_claim is not None:
                        finish = getattr(db, "finish_python_provider_work", None)
                        if callable(finish):
                            try:
                                await finish(provider_claim)
                            except Exception as exc:
                                logger.warning(
                                    "ft_harvest_provider_claim_finish_failed error=%s",
                                    str(exc)[:200],
                                )
            runs[index] = run

        await asyncio.gather(*(_harvest_one(index) for index in range(queries)))

        for run in runs:
            if not run:
                continue
            summary["runs"].append(run)
            summary["jobs_fetched"] += int(run.get("fetched") or 0)
            summary["jobs_upserted"] += int(run.get("upserted") or 0)
            summary["pages_requested"] += int(run.get("pages_requested") or 0)
            summary["pages_completed"] += int(run.get("pages_completed") or 0)
            summary["retries"] += int(run.get("retries") or 0)
            summary["raw_records"] += int(run.get("raw_records") or 0)
            summary["normalized_records"] += int(run.get("normalized") or 0)
            summary["source_exact_duplicates"] = (
                int(summary.get("source_exact_duplicates") or 0)
                + int(run.get("source_exact_duplicates") or 0)
            )
            for reason, count in (run.get("rejected_by_reason") or {}).items():
                summary["rejected_by_reason"][reason] = (
                    int(summary["rejected_by_reason"].get(reason) or 0) + int(count or 0)
                )
            write_stats = run.get("write_stats") or {}
            summary["jobs_inserted"] += int(write_stats.get("inserted") or 0)
            summary["jobs_updated"] += int(write_stats.get("updated") or 0)
            summary["jobs_reactivated"] += int(write_stats.get("reactivated") or 0)
            summary["exact_duplicates"] += int(write_stats.get("exact_duplicate") or 0)
            summary["write_exact_duplicates"] = (
                int(summary.get("write_exact_duplicates") or 0)
                + int(write_stats.get("exact_duplicate") or 0)
            )
            summary["fuzzy_duplicate_candidates"] += int(write_stats.get("fuzzy_duplicate_candidates") or 0)
            summary["write_failed"] += int(write_stats.get("write_failed") or 0)
            if run.get("error"):
                summary["errors"].append({
                    "city": run.get("city"),
                    "location": run.get("location"),
                    "error": run["error"],
                })
        summary["exact_duplicates"] += int(summary.get("source_exact_duplicates") or 0)

        all_partitions_complete = all(
            run and str(run.get("partition_status", "")).startswith("completed_")
            for run in runs
        )
        completed_count = 0
        for target_index, run in zip(selected_indices, runs):
            if run and str(run.get("partition_status", "")).startswith("completed_"):
                completed_count += 1
                _harvest_retry_indices.discard(target_index)
            else:
                _harvest_retry_indices.add(target_index)
        cursor_next = (cursor + completed_count) % len(targets)
        if start_offset is None:
            _harvest_cursor = cursor_next
        summary["cursor_next"] = cursor_next
        summary["retry_partition_ids"] = [
            _partition_id(targets[index]) for index in sorted(_harvest_retry_indices)
        ]
        full_manifest_attempted = (
            len(runs) == len(targets)
            and {str(run.get("partition_id")) for run in runs if run}
            == set(summary["authoritative_manifest"]["expected_partition_ids"])
        )
        summary["completeness"] = (
            "complete_snapshot"
            if all_partitions_complete and full_manifest_attempted
            else "partial_snapshot"
        )
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
                        manifest=_authoritative_manifest(_harvest_targets()),
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
                    summary = await await_with_ingestion_heartbeat(
                        db, ledger_run_id, harvest_france_travail(db)
                    )
                    partition_runs = summary.get("runs") or []
                    summary["proof_scope"] = {
                        "scope_kind": "provider",
                        "providers": ["france_travail"],
                        **(summary.get("authoritative_manifest") or {}),
                    }
                    summary = accounting_summary(summary)
                    await persist_terminal_partitions(db, ledger_run_id, partition_runs)
                    complete = getattr(db, "complete_python_ingestion_run", None)
                    if ledger_run_id and callable(complete):
                        errors = summary.get("errors") or []
                        proof = summary.get("proof_scope") or {}
                        full_cycle_proven = (
                            summary.get("completeness") == "complete_snapshot"
                            and bool(partition_runs)
                            and {partition_identity(fact, index) for index, fact in enumerate(partition_runs)}
                            == set(proof.get("expected_partition_ids") or [])
                        )
                        completed = await complete(
                            run_id=ledger_run_id,
                            status="succeeded" if not errors else "partially_succeeded",
                            completeness_state=(
                                "complete_snapshot"
                                if not errors and full_cycle_proven
                                else "partial"
                            ),
                            summary=summary,
                        )
                        if completed is not True:
                            raise RuntimeError("france_travail fenced completion lost lease")
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
