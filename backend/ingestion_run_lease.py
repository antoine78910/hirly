# stack-policy: python-exception=the authoritative scheduled ingestion loops remain Python-owned, so lease heartbeats must wrap them in-process until migration
"""Fenced run-lease supervision for the current Python ingestion loops."""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Dict, Iterable, TypeVar


T = TypeVar("T")


async def await_with_ingestion_heartbeat(
    db: Any,
    run_id: str | None,
    operation: Awaitable[T],
    *,
    interval_seconds: float = 60.0,
) -> T:
    """Run one operation while renewing its durable fenced lease.

    A missing heartbeat API is allowed for local adapters. Once a durable run id
    exists, a rejected heartbeat or database outage aborts the operation so a
    stale owner cannot continue writing after another process takes over.
    """

    if not run_id:
        return await operation
    heartbeat = getattr(db, "heartbeat_python_ingestion_run", None)
    if not callable(heartbeat):
        return await operation

    task = asyncio.create_task(operation)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=interval_seconds)
            if task in done:
                return task.result()
            renewed = await heartbeat(run_id)
            if renewed is not True:
                raise RuntimeError("python ingestion run lease was lost")
    except BaseException:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        raise


def accounting_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    """Attach a stable known/unknown accounting contract to a run summary."""
    result = dict(summary)
    raw = int(result.get("raw_records", result.get("jobs_fetched", 0)) or 0)
    normalized = int(result.get("normalized_records", raw) or 0)
    rejected = result.get("rejected_by_reason")
    if not isinstance(rejected, dict):
        rejected = {}
    result.update({
        "pages_requested": int(result.get("pages_requested", 0) or 0),
        "pages_completed": int(result.get("pages_completed", 0) or 0),
        "retries": int(result.get("retries", 0) or 0),
        "raw_records": raw,
        "normalized_records": normalized,
        "rejected_by_reason": rejected,
        "exact_duplicates": result.get("exact_duplicates"),
        "fuzzy_duplicate_candidates": result.get("fuzzy_duplicate_candidates"),
        "jobs_inserted": result.get("jobs_inserted"),
        "jobs_updated": result.get("jobs_updated"),
        "jobs_reactivated": result.get("jobs_reactivated"),
        "jobs_marked_inactive": int(result.get("jobs_marked_inactive", 0) or 0),
    })
    known_rejections = sum(int(value or 0) for value in rejected.values())
    if normalized < known_rejections:
        raise ValueError("rejection accounting exceeds normalized records")
    result.setdefault("accounting_contract", {})
    for field in (
        "exact_duplicates", "fuzzy_duplicate_candidates", "jobs_inserted",
        "jobs_updated", "jobs_reactivated",
    ):
        if result[field] is None:
            result["accounting_contract"].setdefault(field, "unknown")
    if result["accounting_contract"].get("state") == "known":
        if raw != normalized + known_rejections:
            raise ValueError("raw records do not reconcile to normalized plus rejected")
        identity_total = sum(int(result.get(field) or 0) for field in (
            "jobs_inserted", "jobs_updated", "exact_duplicates", "write_failed",
        ))
        if normalized != identity_total:
            raise ValueError("normalized records do not reconcile to terminal write outcomes")
        if int(result.get("jobs_reactivated") or 0) > int(result.get("jobs_updated") or 0):
            raise ValueError("reactivated records must be a subset of updated records")
    return result


async def persist_terminal_partitions(
    db: Any,
    run_id: str | None,
    partitions: Iterable[Dict[str, Any]],
) -> None:
    if not run_id:
        return
    record = getattr(db, "record_python_ingestion_partition", None)
    if not callable(record):
        return
    facts = list(partitions)
    if not facts:
        facts = [{"partition_id": "run", "status": "completed_zero_results"}]
    for index, fact in enumerate(facts):
        status = str(fact.get("partition_status") or fact.get("status") or "failed")
        if status not in {
            "completed_with_results", "completed_zero_results", "failed", "blocked",
        }:
            status = "failed"
        partition_id = partition_identity(fact, index)
        counters = {
            "pages_requested": int(fact.get("pages_requested", 0) or 0),
            "pages_completed": int(fact.get("pages_completed", 0) or 0),
            "retries": int(fact.get("retries", 0) or 0),
            "source_reported_total": fact.get("source_reported_total"),
            "raw_records": int(fact.get("fetched", fact.get("raw_records", 0)) or 0),
            "normalized_records": int(fact.get("normalized", fact.get("fetched", 0)) or 0),
            "rejected_by_reason": fact.get("rejected_by_reason") or {},
        }
        saved = await record(
            run_id=run_id,
            partition_id=partition_id,
            status=status,
            counters=counters,
            terminal_error=str(fact.get("error") or "") or None,
        )
        if saved is not True:
            raise RuntimeError(f"failed to persist terminal partition {partition_id}")


def partition_identity(fact: Dict[str, Any], index: int) -> str:
    return str(
        fact.get("partition_id")
        or fact.get("city")
        or fact.get("query")
        or fact.get("source_key")
        or f"partition-{index}"
    )
