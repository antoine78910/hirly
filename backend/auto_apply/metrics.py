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

_SUBMIT_STATUSES = {"submitted_success", "submit_failed"}


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
            "updated_at": _now(),
        }},
    )


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
