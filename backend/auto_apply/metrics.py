"""Attempt records: idempotency claim + reliability metrics in one store.

The idempotency invariant ("an application is never submitted twice") is a DB
invariant, enforced by a partial unique index on (user_id, job_id) for active
statuses (see supabase_schema.sql). claim_attempt inserts a fresh-id row with
status='in_flight'; if the pair is already active, insert_one raises and the
claim is lost. Terminal non-success statuses free the pair for a later retry;
submitted_success holds the index permanently.

Every record carries:
  - reason:         a status_reason for any non-success outcome (analytics/debug)
  - missing_fields: the exact fields to render for a NEEDS_USER_INPUT outcome
  - driver_version: correlates success-rate shifts with deployments
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_SUBMIT_STATUSES = {"submitted_success", "submit_failed", "verification_failed"}
_ACTIVE_STATUSES = ("in_flight", "submitted_success")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def claim_attempt(
    db, *, user_id: str, job_id: str, provider: str, driver: str, driver_version: str = "unknown",
) -> Optional[Dict[str, Any]]:
    row = {
        "id": uuid.uuid4().hex,
        "user_id": user_id,
        "job_id": job_id,
        "provider": provider,
        "driver": driver,
        "driver_version": driver_version,
        "status": "in_flight",
        "stage_reached": "claim",
        "claimed_at": _now(),
        "created_at": _now(),
        "updated_at": _now(),
    }
    try:
        await db.auto_apply_attempts.insert_one(row)
    except Exception:
        # Unique-constraint violation on the partial index -> already active.
        return None
    return row


async def record_terminal(
    db, claim: Dict[str, Any], *, status: str, verdict: Optional[str] = None, reason: str = "",
    stage_reached: str = "", eligible: Optional[bool] = None, complexity: Optional[str] = None,
    compatibility_score: Optional[float] = None, blueprint_signature: Optional[str] = None,
    missing_fields: Optional[List[str]] = None, evidence: Optional[Dict[str, Any]] = None,
) -> None:
    now = _now()
    # Operational timestamps: submitted_at only when a submit was actually
    # performed; verified_at only when a verification verdict was produced.
    # These let us later measure queue time / submission duration / verify latency.
    submitted_at = now if (evidence or {}).get("submit_performed") else None
    verified_at = now if verdict is not None else None
    await db.auto_apply_attempts.update_one(
        {"id": claim["id"]},
        {"$set": {
            "status": status,
            "verdict": verdict,
            "reason": reason,
            "stage_reached": stage_reached or status,
            "eligible": eligible,
            "complexity": complexity,
            "compatibility_score": compatibility_score,
            "blueprint_signature": blueprint_signature,
            "missing_fields": list(missing_fields or []),
            "evidence": evidence or {},
            "submitted_at": submitted_at,
            "verified_at": verified_at,
            "updated_at": now,
        }},
    )


async def active_attempt_status(db, user_id: str, job_id: str) -> Optional[str]:
    """Status of the currently-active attempt for a (user_id, job_id) pair, if
    any -- used to tell a lost claim apart: 'submitted_success' -> already
    applied, 'in_flight' -> another run is mid-flight."""
    rows = await db.auto_apply_attempts.find(
        {"user_id": user_id, "job_id": job_id}, {"status": 1}
    ).limit(50).to_list(50)
    for r in rows:
        if r.get("status") in _ACTIVE_STATUSES:
            return r.get("status")
    return None


async def latest_attempt(db, user_id: str, job_id: str) -> Optional[Dict[str, Any]]:
    """Most recent attempt record for a (user_id, job_id) pair -- exposes the
    full lifecycle (stage, status, reason, missing_fields, driver_version,
    blueprint_signature, timestamps) for debugging / frontend display."""
    rows = await db.auto_apply_attempts.find({"user_id": user_id, "job_id": job_id}).limit(50).to_list(50)
    if not rows:
        return None
    return sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True)[0]


def _compact_execution_report(report: Dict[str, Any]) -> Dict[str, Any]:
    """Store a console-ready report without huge binary payloads."""
    compact = dict(report or {})
    screenshots = compact.get("screenshots") or []
    if screenshots:
        # Keep at most one screenshot for the admin console.
        compact["screenshots"] = screenshots[:1]
    evidence = compact.get("submission_evidence")
    if isinstance(evidence, dict) and evidence.get("screenshot_b64"):
        evidence = dict(evidence)
        # Screenshot already mirrored on report.screenshots.
        evidence.pop("screenshot_b64", None)
        compact["submission_evidence"] = evidence
    return compact


async def persist_execution_report(
    db, user_id: str, job_id: str, report: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Attach the full ExecutionReport to the latest attempt so polling clients
    can render the console after an async (background) run.

    If no attempt row exists yet (prepare failed before claim), insert a
    terminal error row so the poller can still finish.
    """
    compact = _compact_execution_report(report)
    now = _now()
    attempt = await latest_attempt(db, user_id, job_id)
    if not attempt:
        row = {
            "id": uuid.uuid4().hex,
            "user_id": user_id,
            "job_id": job_id,
            "provider": "unknown",
            "driver": "unknown",
            "driver_version": "unknown",
            "status": compact.get("status") or "error",
            "stage_reached": compact.get("stage_reached") or "driver",
            "reason": compact.get("reason") or "prepare_failed",
            "verdict": compact.get("verdict"),
            "claimed_at": now,
            "created_at": now,
            "updated_at": now,
            "execution_report": compact,
        }
        await db.auto_apply_attempts.insert_one(row)
        return row

    await db.auto_apply_attempts.update_one(
        {"id": attempt["id"]},
        {"$set": {
            "execution_report": compact,
            "updated_at": now,
        }},
    )
    attempt = dict(attempt)
    attempt["execution_report"] = compact
    attempt["updated_at"] = now
    return attempt


async def known_successful_signatures(db, provider: str) -> frozenset:
    rows = await db.auto_apply_attempts.find(
        {"provider": provider, "status": "submitted_success"}, {"blueprint_signature": 1}
    ).limit(5000).to_list(5000)
    return frozenset(r.get("blueprint_signature") for r in rows if r.get("blueprint_signature"))


async def summary(db, provider: str) -> Dict[str, Any]:
    rows = await db.auto_apply_attempts.find({"provider": provider}, {"status": 1, "verdict": 1}).limit(50000).to_list(50000)
    submit_attempts = sum(1 for r in rows if r.get("status") in _SUBMIT_STATUSES)
    verified_success = sum(1 for r in rows if r.get("status") == "submitted_success")
    return {
        "provider": provider,
        "total_attempts": len(rows),
        "submit_attempts": submit_attempts,
        "verified_success": verified_success,
        "success_rate": round(verified_success / submit_attempts, 4) if submit_attempts else None,
    }
