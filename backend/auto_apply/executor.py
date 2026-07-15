"""ATS-agnostic orchestration: claim -> inspect -> classify -> resolve -> plan
-> submit -> verify -> record.

The executor is a thin coordinator. It contains ZERO provider branches and
imports nothing ATS-specific -- the driver, reached only through DRIVER_REGISTRY,
is the sole ATS-aware dependency. Adding a new ATS means registering a new
ApplyDriver; this file never changes.

Every run ends in exactly one persisted terminal record, and idempotency is a
DB invariant (metrics.claim_attempt): two concurrent runs -> exactly one submit.
Each record carries stage_reached / status / reason / missing_fields /
lifecycle timestamps so the frontend can always answer: what stage is this
application in, why did it stop, and what is the next action.
"""
from __future__ import annotations

import logging
import tempfile
from typing import Any, Dict

from apply_agent.agent import build_candidate_context
from apply_agent.browser import write_cover_letter_file, write_resume_file

from . import metrics
from .classifier import classify
from .driver import DRIVER_REGISTRY
from .models import SubmissionContext
from .planner import plan as build_plan
from .resolver import resolve
from .verification import verify

logger = logging.getLogger(__name__)


async def execute_application(
    db, job: Dict[str, Any], profile: Dict[str, Any], app_doc: Dict[str, Any], user: Dict[str, Any],
    *, dry_run: bool = False, headless: bool = True,
) -> Dict[str, Any]:
    user_id = str(user.get("user_id"))
    job_id = str(job.get("job_id"))

    driver = DRIVER_REGISTRY.for_job(job)
    if driver is None:
        return {"status": "unsupported", "reason": "no_driver_for_provider"}

    driver_version = getattr(driver, "version", "unknown")
    claim = await metrics.claim_attempt(db, user_id=user_id, job_id=job_id,
                                        provider=driver.provider, driver=driver.provider,
                                        driver_version=driver_version)
    if claim is None:
        active = await metrics.active_attempt_status(db, user_id, job_id)
        status = "already_submitted" if active == "submitted_success" else "already_in_flight"
        return {"status": status, "reason": "active_claim_exists"}

    try:
        blueprint = await driver.inspect_application(job)
        known = await metrics.known_successful_signatures(db, driver.provider)
        decision = classify(blueprint, known_successful_signatures=known)
        base = {
            "eligible": decision.eligible, "complexity": blueprint.complexity.value,
            "compatibility_score": decision.score, "blueprint_signature": blueprint.signature,
        }

        if not decision.eligible:
            # UNSUPPORTED -> Hirly can't handle yet (waits for driver/capability).
            # NEEDS_USER_INPUT -> recoverable; surface the missing fields.
            missing = decision.signals.get("missing_fields", [])
            await metrics.record_terminal(db, claim, status=decision.category, reason=decision.reason,
                                          stage_reached="classify", missing_fields=missing, **base)
            return {"status": decision.category, "reason": decision.reason,
                    "missing_fields": missing, "eligibility": decision.signals}

        candidate_context = build_candidate_context(profile, app_doc, user)
        answers, unresolved = resolve(blueprint, candidate_context, profile)
        if unresolved:
            missing = [f.key for f in unresolved]
            reason = "needs_user_input:" + ",".join(missing[:5])
            await metrics.record_terminal(db, claim, status="needs_user_input", reason=reason,
                                          stage_reached="resolve", missing_fields=missing, **base)
            return {"status": "needs_user_input", "reason": reason, "missing_fields": missing}

        application_plan = build_plan(blueprint, answers)

        if dry_run:
            await metrics.record_terminal(db, claim, status="prepared", stage_reached="plan", **base)
            return {"status": "prepared", "reason": "ready_not_submitted"}

        with tempfile.TemporaryDirectory(prefix="auto_apply_") as tmp:
            documents = {
                "resume_path": write_resume_file(app_doc, tmp),
                "cover_letter_path": write_cover_letter_file(app_doc, tmp),
            }
            ctx = SubmissionContext(job=job, blueprint=blueprint, plan=application_plan,
                                    documents=documents, dry_run=False, headless=headless)
            evidence = await driver.submit(ctx)

        safe_evidence = _safe_evidence(evidence)

        # A runtime login wall / CAPTCHA means Hirly can't complete it -> unsupported.
        if evidence.blocked_reason:
            reason = f"blocked:{evidence.blocked_reason}"
            await metrics.record_terminal(db, claim, status="unsupported", reason=reason,
                                          stage_reached="submit", evidence=safe_evidence, **base)
            return {"status": "unsupported", "reason": reason}

        # The submit control was never actioned -> the submission never happened.
        if not evidence.submit_performed:
            await metrics.record_terminal(db, claim, status="submit_failed", reason="submit_not_performed",
                                          stage_reached="submit", evidence=safe_evidence, **base)
            return {"status": "submit_failed", "reason": "submit_not_performed"}

        verdict = verify(evidence)
        db_status = "submitted_success" if verdict.status == "verified_success" else "verification_failed"
        await metrics.record_terminal(db, claim, status=db_status, verdict=verdict.status,
                                      reason=verdict.reason, stage_reached="verify",
                                      evidence=safe_evidence, **base)
        # Returned status is the persisted terminal status (frontend vocabulary);
        # the raw verify() verdict is kept alongside for observability.
        return {"status": db_status, "reason": verdict.reason, "verdict": verdict.status}
    except Exception as exc:
        logger.warning("auto_apply_execute_failed job=%s error=%s", job_id, str(exc)[:300])
        await metrics.record_terminal(db, claim, status="error", reason=exc.__class__.__name__,
                                      stage_reached="error")
        return {"status": "error", "reason": exc.__class__.__name__}


def _safe_evidence(evidence) -> Dict[str, Any]:
    return {
        "submit_performed": evidence.submit_performed,
        "confirmation_text": evidence.confirmation_text,
        "submit_control_gone": evidence.submit_control_gone,
        "url_changed": evidence.url_changed,
        "network_ok": evidence.network_ok,
        "validation_errors": evidence.validation_errors[:5],
        "blocked_reason": evidence.blocked_reason,
        "final_url": evidence.final_url,
    }
