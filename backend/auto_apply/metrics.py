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


async def release_stale_in_flight(
    db,
    user_id: str,
    job_id: str,
    *,
    max_age_s: float = 180.0,
    force: bool = False,
) -> int:
    """Mark stuck ``in_flight`` rows terminal so a new admin run can claim.

    Railway deploys / killed workers leave orphan in_flight rows that block
    claim_attempt via the partial unique index.
    """
    rows = await db.auto_apply_attempts.find(
        {"user_id": user_id, "job_id": job_id, "status": "in_flight"},
    ).limit(20).to_list(20)
    if not rows:
        return 0
    now = datetime.now(timezone.utc)
    released = 0
    for row in rows:
        if not force:
            stamp = row.get("updated_at") or row.get("claimed_at") or row.get("created_at") or ""
            try:
                claimed = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
                if claimed.tzinfo is None:
                    claimed = claimed.replace(tzinfo=timezone.utc)
                age = (now - claimed).total_seconds()
            except Exception:
                age = max_age_s + 1
            if age < max_age_s:
                continue
        await db.auto_apply_attempts.update_one(
            {"id": row["id"]},
            {"$set": {
                "status": "error",
                "reason": "stale_in_flight_released",
                "stage_reached": row.get("stage_reached") or "driver",
                "updated_at": _now(),
            }},
        )
        released += 1
    return released


async def claim_attempt(
    db, *, user_id: str, job_id: str, provider: str, driver: str, driver_version: str = "unknown",
) -> Optional[Dict[str, Any]]:
    # Auto-clear orphans from killed Railway workers before inserting.
    await release_stale_in_flight(db, user_id, job_id, max_age_s=180.0)
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


# Base64 screenshots larger than this blow up Supabase/Railway JSON responses
# (admin /status polls) and surface as opaque HTTP 500 Internal Server Error.
_MAX_STORED_SCREENSHOT_CHARS = 120_000


def _compact_execution_report(report: Dict[str, Any]) -> Dict[str, Any]:
    """Store a console-ready report without huge binary payloads."""
    compact = dict(report or {})
    screenshots = compact.get("screenshots") or []
    safe_shots: List[str] = []
    omitted = False
    for shot in screenshots[:1]:
        if isinstance(shot, str) and 0 < len(shot) <= _MAX_STORED_SCREENSHOT_CHARS:
            safe_shots.append(shot)
        elif isinstance(shot, str) and shot:
            omitted = True
            compact["screenshot_omitted"] = True
            compact["screenshot_chars"] = len(shot)
    compact["screenshots"] = safe_shots
    if omitted and not safe_shots:
        compact.setdefault("screenshot_omitted", True)

    evidence = compact.get("submission_evidence")
    if isinstance(evidence, dict) and evidence.get("screenshot_b64"):
        evidence = dict(evidence)
        # Screenshot already mirrored on report.screenshots (when small enough).
        evidence.pop("screenshot_b64", None)
        compact["submission_evidence"] = evidence

    raw = compact.get("debug")
    if isinstance(raw, dict):
        raw = dict(raw)
        nested = raw.get("execution")
        if isinstance(nested, dict) and nested.get("screenshot_b64"):
            nested = dict(nested)
            nested.pop("screenshot_b64", None)
            raw["execution"] = nested
        compact["debug"] = raw
    return compact


def status_safe_attempt(attempt: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Return an attempt payload safe for HTTP JSON (no multi-MB screenshots)."""
    if not attempt:
        return None
    out = dict(attempt)
    report = out.get("execution_report")
    if isinstance(report, dict):
        out["execution_report"] = _compact_execution_report(report)
    return out


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
    terminal_status = str(compact.get("status") or "error")
    # Never leave the unique (user_id, job_id) index stuck on in_flight after
    # the background run finished writing its report.
    if terminal_status == "in_flight":
        terminal_status = "error"
    stage = str(compact.get("stage_reached") or "driver")
    reason = str(compact.get("reason") or "prepare_failed")
    attempt = await latest_attempt(db, user_id, job_id)
    if not attempt:
        row = {
            "id": uuid.uuid4().hex,
            "user_id": user_id,
            "job_id": job_id,
            "provider": "unknown",
            "driver": "unknown",
            "driver_version": compact.get("driver_version") or "unknown",
            "status": terminal_status,
            "stage_reached": stage,
            "reason": reason,
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
            "status": terminal_status,
            "stage_reached": stage,
            "reason": reason,
            "verdict": compact.get("verdict"),
            "driver_version": compact.get("driver_version") or attempt.get("driver_version"),
            "blueprint_signature": compact.get("blueprint_signature") or attempt.get("blueprint_signature"),
            "updated_at": now,
        }},
    )
    attempt = dict(attempt)
    attempt["execution_report"] = compact
    attempt["status"] = terminal_status
    attempt["stage_reached"] = stage
    attempt["reason"] = reason
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
