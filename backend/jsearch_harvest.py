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
import hashlib
import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

from job_providers import get_job_provider, is_job_provider_configured
from job_providers.base import JobSearchQuery
from job_providers.jsearch import JSearchProvider
from ingestion_run_lease import (
    accounting_summary,
    await_with_ingestion_heartbeat,
    persist_terminal_partitions,
    partition_identity,
)
from jobs_service import upsert_imported_jobs
from jobs_service import _cooldown_until, _is_rate_limit_error, _set_rate_limit_cooldown
from location_intelligence import country_to_jsearch_language

logger = logging.getLogger(__name__)


def _combo_partition_id(role: str, city: str) -> str:
    return f"{city}, France|{role}"


def _authoritative_manifest(combos: List[tuple[str, str]]) -> Dict[str, Any]:
    partition_ids = sorted({_combo_partition_id(role, city) for role, city in combos})
    encoded = json.dumps(partition_ids, ensure_ascii=False, separators=(",", ":")).encode()
    return {
        "manifest_version": "jsearch-harvest.v2",
        "manifest_digest": hashlib.sha256(encoded).hexdigest(),
        "expected_partition_count": len(partition_ids),
        "expected_partition_ids": partition_ids,
    }

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

# Wider France-wide pool for deliberate, admin-triggered manual harvest
# bursts (see harvest_jsearch's `cities`/`roles` overrides and
# admin_jobs_jsearch_harvest's `mode="aggressive"`) -- not used by the
# routine 15-min loop, which keeps the smaller top-10-city / 12-role
# default above. Sized so a handful of 200-request rounds (one per quota
# reset) sweep through the whole pool with little repeat, rather than the
# routine loop's small combo set getting hit 200 times in a row.
AGGRESSIVE_HARVEST_CITIES = [
    "Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Montpellier",
    "Strasbourg", "Bordeaux", "Lille", "Rennes", "Reims", "Toulon",
    "Saint-Etienne", "Le Havre", "Grenoble", "Dijon", "Angers", "Nimes",
    "Villeurbanne", "Clermont-Ferrand", "Le Mans", "Aix-en-Provence",
    "Brest", "Tours", "Limoges", "Amiens", "Annecy", "Perpignan", "Metz",
    "Besancon", "Orleans", "Rouen", "Mulhouse", "Caen", "Nancy",
    "Argenteuil", "Saint-Denis", "Montreuil", "Roubaix",
]

AGGRESSIVE_HARVEST_ROLES = [
    "software engineer", "product manager", "data analyst",
    "sales representative", "marketing manager", "customer success",
    "operations manager", "human resources", "finance analyst", "designer",
    "logistics coordinator", "administrative assistant", "nurse", "teacher",
    "chef cuisinier", "retail sales associate", "warehouse worker",
    "truck driver", "electrician", "plumber", "accountant",
    "project manager", "business analyst", "IT support technician",
    "mechanical engineer", "civil engineer", "lawyer", "receptionist",
    "security guard", "construction worker",
]

_harvest_cursor = 0
_harvest_cycle = 0
_harvest_lock = asyncio.Lock()
_last_run_summary: Optional[Dict[str, Any]] = None

# Adaptive per-combo scheduling: a combo (role x city) that comes back empty
# gets pushed back an exponentially growing number of cycles instead of
# being retried on the very next rotation. This redirects request budget
# toward combos that are actually yielding jobs right now instead of
# spending it re-polling markets that were just confirmed thin/exhausted.
# Capped at 8 cycles (~2h at the default 15-min interval) so a combo is
# never skipped so long that a real new posting there goes unnoticed.
_combo_backoff_level: Dict[int, int] = {}
_combo_next_eligible_cycle: Dict[int, int] = {}
_COMBO_BACKOFF_MAX_CYCLES = 8


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
    # Harvesting can spend API quota without a user request, so it must be an
    # explicit deployment choice. Feed-triggered JSearch discovery is separate.
    return _env_bool("JSEARCH_HARVEST_ENABLED", False) and is_job_provider_configured("jsearch")


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
    cities: Optional[List[str]] = None,
    roles: Optional[List[str]] = None,
    date_posted: Optional[str] = None,
    page_size: Optional[int] = None,
    max_pages: Optional[int] = None,
) -> Dict[str, Any]:
    """Run one harvest slice: rotate through role x city combinations.

    Combo selection is adaptive rather than strict round-robin: combos that
    just came back empty are pushed to the back of the queue for a growing
    number of cycles (see _combo_next_eligible_cycle), so a fixed request
    budget spends more of its time on combos that are actually producing
    jobs right now. `cursor` still advances every run and breaks ties, so
    coverage stays fair over the long run and a backed-off combo is never
    skipped forever.
    """
    global _harvest_cursor, _harvest_cycle
    if not is_job_provider_configured("jsearch"):
        return {"enabled": False, "reason": "jsearch_not_configured", "runs": []}

    # A confirmed 429 anywhere (this loop or the live feed's fallback --
    # they share the same cooldown key) means every query below is going to
    # fail the same way. Bail out before spending any of the 6 planned
    # requests instead of burning them against a provider we already know
    # is rejecting us.
    cooldown = _cooldown_until("jsearch")
    if cooldown is not None:
        logger.info("jsearch_harvest_skipped_cooldown_active until=%s", cooldown.isoformat())
        return {
            "enabled": True,
            "reason": "provider_cooldown_active",
            "cooldown_until": cooldown.isoformat(),
            "runs": [],
        }

    using_custom_pool = cities is not None or roles is not None
    cities = cities if cities is not None else _harvest_cities()
    roles = roles if roles is not None else _harvest_roles()
    combos = [(role, city) for city in cities for role in roles]
    if not combos:
        return {"enabled": True, "reason": "no_queries_configured", "runs": []}

    queries = max(1, min(int(max_queries or _env_int("JSEARCH_HARVEST_QUERIES_PER_RUN", 6)), len(combos)))
    page_size = max(10, min(int(page_size if page_size is not None else _env_int("JSEARCH_HARVEST_PAGE_SIZE", 100)), 100))
    max_pages = max(1, min(int(max_pages if max_pages is not None else _env_int("JSEARCH_HARVEST_MAX_PAGES", 2)), 5))
    pause_seconds = max(0.2, _env_float("JSEARCH_HARVEST_QUERY_PAUSE_SECONDS", 0.5))
    # Restrict harvest queries to recently-posted jobs so repeat visits to the
    # same combo mostly surface genuinely new postings instead of re-fetching
    # (and then deduping away) the same listings every ~5h rotation. Only
    # applied here -- the live feed's on-demand fallback leaves this unset so
    # it keeps matching against jobs of any age, unchanged. An explicit
    # `date_posted` override (manual aggressive-fill runs) always wins.
    freshness_window = (date_posted or os.environ.get("JSEARCH_HARVEST_DATE_POSTED") or "3days").strip() or None

    async with _harvest_lock:
        cursor = start_offset % len(combos) if start_offset is not None else _harvest_cursor % len(combos)
        _harvest_cycle += 1
        current_cycle = _harvest_cycle
        # Build our own provider instance (rather than get_job_provider's
        # default) with a much longer HTTP timeout: that default (6s) is
        # tuned for the live feed's user-facing latency budget, but a
        # background harvest call has no such constraint, and a bundled
        # num_pages request asking for more pages/larger page_size (as the
        # aggressive mode does) genuinely takes longer to respond than a
        # normal single-page live-feed query.
        api_key = os.environ.get("JSEARCH_API_KEY") or ""
        provider = JSearchProvider(api_key=api_key, timeout=_env_float("JSEARCH_HARVEST_HTTP_TIMEOUT_SECONDS", 25.0))
        started = time.perf_counter()
        summary: Dict[str, Any] = {
            "enabled": True,
            "dry_run": dry_run,
            "cursor_start": cursor,
            "combos_total": len(combos),
            "queries_planned": queries,
            "freshness_window": freshness_window,
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
            "jobs_marked_inactive": 0,
            "write_failed": 0,
            "accounting_contract": {"state": "known"},
            "errors": [],
            "runs": [],
            "authoritative_manifest": _authoritative_manifest(combos),
        }

        if start_offset is not None:
            # Explicit offset (admin-triggered manual run) bypasses adaptive
            # skipping -- the caller asked for these specific combos.
            selected_indices = [(cursor + i) % len(combos) for i in range(queries)]
        else:
            def _sort_key(i: int) -> Any:
                backoff_gap = max(0, _combo_next_eligible_cycle.get(i, 0) - current_cycle)
                distance = (i - cursor) % len(combos)
                return (backoff_gap, distance)

            selected_indices = sorted(range(len(combos)), key=_sort_key)[:queries]

        consecutive_errors = 0
        for position, combo_index in enumerate(selected_indices):
            role, city = combos[combo_index]
            location_label = f"{city}, France"
            run: Dict[str, Any] = {
                "partition_id": _combo_partition_id(role, city),
                "role": role,
                "location": location_label,
            }
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
                    date_posted=freshness_window,
                ))
                jobs = result.jobs or []
                fetched = len(jobs)
                run["fetched"] = fetched
                raw_response = result.raw_response or {}
                completeness = raw_response.get("completeness")
                if completeness == "capped_unknown":
                    run["cap_resolution"] = "blocked_no_disjoint_exhaustive_source_partition"
                run["raw_records"] = int(raw_response.get("rows_seen") or fetched)
                run["normalized"] = fetched
                run["rejected_by_reason"] = {
                    "normalization_failed": max(0, run["raw_records"] - fetched)
                }
                run["completeness"] = completeness or "unknown"
                if completeness == "capped_unknown":
                    run["status"] = "capped"
                    run["partition_status"] = "blocked"
                    summary["errors"].append({
                        "role": role,
                        "location": location_label,
                        "error": "provider_result_cap_reached",
                    })
                summary["jobs_fetched"] += fetched
                if jobs and not dry_run:
                    stats = await upsert_imported_jobs(db, jobs)
                    run["upserted"] = stats.get("total_imported", 0)
                    run["write_stats"] = stats
                    summary["jobs_upserted"] += run["upserted"]
                if "partition_status" not in run:
                    run["partition_status"] = (
                        "completed_with_results" if fetched else "completed_zero_results"
                    )
                run["pages_requested"] = 1
                run["pages_completed"] = 1
                consecutive_errors = 0
                # Backoff state is indexed by position in the *default* combo
                # list -- skip touching it when running against a custom
                # cities/roles pool (aggressive manual runs), since those
                # indices would collide with unrelated default-list combos.
                if not using_custom_pool:
                    if fetched == 0:
                        level = _combo_backoff_level.get(combo_index, 0) + 1
                        _combo_backoff_level[combo_index] = level
                        _combo_next_eligible_cycle[combo_index] = current_cycle + min(2 ** level, _COMBO_BACKOFF_MAX_CYCLES)
                    else:
                        _combo_backoff_level.pop(combo_index, None)
                        _combo_next_eligible_cycle.pop(combo_index, None)
            except Exception as exc:
                message = f"{exc.__class__.__name__}: {str(exc)[:200]}"
                run["error"] = message
                run["partition_status"] = "failed"
                summary["errors"].append({"role": role, "location": location_label, "error": message})
                logger.warning("jsearch_harvest_query_failed role=%s location=%s error=%s", role, location_label, message)
                summary["runs"].append(run)
                consecutive_errors += 1
                if _is_rate_limit_error(exc):
                    _set_rate_limit_cooldown("jsearch")
                    summary["aborted_reason"] = "rate_limited"
                    logger.warning("jsearch_harvest_aborted_rate_limited after=%s/%s", position + 1, len(selected_indices))
                    break
                if consecutive_errors >= 2:
                    summary["aborted_reason"] = "repeated_errors"
                    logger.warning("jsearch_harvest_aborted_repeated_errors after=%s/%s", position + 1, len(selected_indices))
                    break
                await asyncio.sleep(pause_seconds * 4)
                continue
            summary["runs"].append(run)
            summary["pages_requested"] += int(run.get("pages_requested") or 0)
            summary["pages_completed"] += int(run.get("pages_completed") or 0)
            summary["raw_records"] += int(run.get("raw_records") or 0)
            summary["normalized_records"] += int(run.get("normalized") or 0)
            for reason, count in (run.get("rejected_by_reason") or {}).items():
                summary["rejected_by_reason"][reason] = (
                    int(summary["rejected_by_reason"].get(reason) or 0) + int(count or 0)
                )
            write_stats = run.get("write_stats") or {}
            summary["jobs_inserted"] += int(write_stats.get("inserted") or 0)
            summary["jobs_updated"] += int(write_stats.get("updated") or 0)
            summary["jobs_reactivated"] += int(write_stats.get("reactivated") or 0)
            summary["exact_duplicates"] += int(write_stats.get("exact_duplicate") or 0)
            summary["fuzzy_duplicate_candidates"] += int(write_stats.get("fuzzy_duplicate_candidates") or 0)
            summary["write_failed"] += int(write_stats.get("write_failed") or 0)
            if position < len(selected_indices) - 1:
                await asyncio.sleep(pause_seconds)
        all_partitions_complete = not summary["errors"] and len(summary["runs"]) == queries
        all_partitions_attempted = len(summary["runs"]) == queries
        cursor_next = (cursor + queries) % len(combos) if all_partitions_attempted else cursor
        if start_offset is None:
            _harvest_cursor = cursor_next
        summary["cursor_next"] = cursor_next
        full_manifest_attempted = (
            len(summary["runs"]) == len(combos)
            and {str(run.get("partition_id")) for run in summary["runs"]}
            == set(summary["authoritative_manifest"]["expected_partition_ids"])
        )
        summary["completeness"] = (
            "complete_snapshot"
            if all_partitions_complete and full_manifest_attempted
            else "partial_snapshot"
        )
        summary["combos_in_backoff"] = len(_combo_next_eligible_cycle)
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
        ledger_run_id = None
        try:
            if harvest_enabled():
                begin = getattr(db, "begin_python_ingestion_run", None)
                claim = (
                    await begin(
                        schedule_id="python-jsearch-harvest",
                        source="jsearch",
                        cadence_seconds=interval_minutes * 60,
                        manifest=_authoritative_manifest([
                            (role, city)
                            for city in _harvest_cities()
                            for role in _harvest_roles()
                        ]),
                    )
                    if callable(begin)
                    else {"acquired": True, "run_id": None}
                )
                if not claim.get("acquired"):
                    logger.info(
                        "jsearch_harvest_overlap_skipped run_id=%s scheduled_for=%s",
                        claim.get("run_id"),
                        claim.get("scheduled_for"),
                    )
                else:
                    ledger_run_id = claim.get("run_id")
                    summary = await await_with_ingestion_heartbeat(
                        db, ledger_run_id, harvest_jsearch(db)
                    )
                    partition_runs = summary.get("runs") or []
                    summary["proof_scope"] = {
                        "scope_kind": "provider",
                        "providers": ["jsearch"],
                        **(summary.get("authoritative_manifest") or {}),
                    }
                    summary = accounting_summary(summary)
                    await persist_terminal_partitions(db, ledger_run_id, partition_runs)
                    complete = getattr(db, "complete_python_ingestion_run", None)
                    if ledger_run_id and callable(complete):
                        errors = summary.get("errors") or []
                        completeness = summary.get("completeness")
                        proof = summary.get("proof_scope") or {}
                        full_cycle_proven = (
                            completeness == "complete_snapshot"
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
                            raise RuntimeError("jsearch fenced completion lost lease")
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
                    logger.error("jsearch_harvest_ledger_completion_failed error=%s", str(ledger_exc)[:300])
            logger.warning("jsearch_harvest_loop_error error=%s", str(exc)[:300])
        await asyncio.sleep(interval_minutes * 60)
