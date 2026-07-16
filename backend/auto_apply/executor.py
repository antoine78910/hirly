"""ATS-agnostic orchestration: claim -> inspect -> classify -> resolve -> plan
-> submit -> verify -> record.

The executor is a thin coordinator. It contains ZERO provider branches and
imports nothing ATS-specific -- the driver, reached only through DRIVER_REGISTRY,
is the sole ATS-aware dependency. Adding a new ATS means registering a new
ApplyDriver; this file never changes.

Every run ends in exactly one persisted terminal record, and idempotency is a
DB invariant (metrics.claim_attempt): two concurrent runs -> exactly one submit.

Every call returns a standardized ExecutionReport (see _report) -- the generic
debugging interface for every ApplyDriver. It surfaces data the run already has
(stage, status, reason, signature, driver_version, evidence, screenshots,
timestamps, duration); it introduces no orchestration.
"""
from __future__ import annotations

import logging
import tempfile
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from apply_agent.agent import build_candidate_context
from apply_agent.browser import write_cover_letter_file, write_resume_file

from . import metrics
from .classifier import classify
from .debug_report import build_debug_report, data_availability, format_run_error
from .driver import DRIVER_REGISTRY
from .models import SubmissionContext
from .planner import plan as build_plan
from .resolver import resolve
from .verification import verify

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _full_evidence(ev) -> Optional[Dict[str, Any]]:
    if ev is None:
        return None
    return {
        "submit_performed": ev.submit_performed,
        "confirmation_text": ev.confirmation_text,
        "submit_control_gone": ev.submit_control_gone,
        "url_changed": ev.url_changed,
        "network_ok": ev.network_ok,
        "validation_errors": ev.validation_errors,
        "blocked_reason": ev.blocked_reason,
        "final_url": ev.final_url,
        "screenshot_b64": ev.screenshot_b64,
        "raw": ev.raw,
    }


def _safe_evidence(ev) -> Dict[str, Any]:
    # Persisted variant: everything except the (large) screenshot.
    full = _full_evidence(ev) or {}
    full.pop("screenshot_b64", None)
    return full


def _report(
    *, started: float, stage: str, status: str, reason: str = "", verdict: Optional[str] = None,
    missing_fields: Optional[List[str]] = None, blueprint_signature: Optional[str] = None,
    driver_version: Optional[str] = None, evidence=None, claim: Optional[Dict[str, Any]] = None,
    debug: Optional[Dict[str, Any]] = None, error: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    now = _now()
    screenshot = getattr(evidence, "screenshot_b64", None)
    return {
        "stage_reached": stage,
        "status": status,
        "reason": reason,
        "verdict": verdict,
        "missing_fields": list(missing_fields or []),
        "blueprint_signature": blueprint_signature,
        "driver_version": driver_version,
        "submission_evidence": _full_evidence(evidence),
        "screenshots": [screenshot] if screenshot else [],
        "debug": debug,
        "error": error,
        "timestamps": {
            "claimed_at": (claim or {}).get("claimed_at"),
            "submitted_at": now if (evidence is not None and evidence.submit_performed) else None,
            "verified_at": now if verdict is not None else None,
        },
        "duration_ms": int((time.monotonic() - started) * 1000),
    }


async def execute_application(
    db, job: Dict[str, Any], profile: Dict[str, Any], app_doc: Dict[str, Any], user: Dict[str, Any],
    *, dry_run: bool = False, headless: bool = True,
) -> Dict[str, Any]:
    started = time.monotonic()
    user_id = str(user.get("user_id"))
    job_id = str(job.get("job_id"))

    driver = DRIVER_REGISTRY.for_job(job)
    if driver is None:
        return _report(started=started, stage="driver", status="unsupported",
                       reason="no_driver_for_provider")

    driver_version = getattr(driver, "version", "unknown")
    claim = await metrics.claim_attempt(db, user_id=user_id, job_id=job_id,
                                        provider=driver.provider, driver=driver.provider,
                                        driver_version=driver_version)
    if claim is None:
        active = await metrics.active_attempt_status(db, user_id, job_id)
        status = "already_submitted" if active == "submitted_success" else "already_in_flight"
        return _report(started=started, stage="claim", status=status,
                       reason="active_claim_exists", driver_version=driver_version)

    checkpoint = "driver"
    blueprint = None
    signature = None
    decision = None
    candidate_context = None
    answers = None
    unresolved = None
    application_plan = None
    app_url = ""
    evidence = None

    try:
        checkpoint = "inspect"
        blueprint = await driver.inspect_application(job)
        signature = blueprint.signature
        known = await metrics.known_successful_signatures(db, driver.provider)
        checkpoint = "classify"
        decision = classify(blueprint, known_successful_signatures=known)
        base = {
            "eligible": decision.eligible, "complexity": blueprint.complexity.value,
            "compatibility_score": decision.score, "blueprint_signature": signature,
        }
        report_common = {"blueprint_signature": signature, "driver_version": driver_version, "claim": claim}
        app_url = ""
        try:
            app_url = driver.application_url(job)
        except Exception:
            app_url = ""

        if not decision.eligible:
            missing = decision.signals.get("missing_fields", [])
            debug = build_debug_report(
                job=job, profile=profile, app_doc=app_doc, blueprint=blueprint, decision=decision,
                application_url=app_url,
            )
            await metrics.record_terminal(db, claim, status=decision.category, reason=decision.reason,
                                          stage_reached="classify", missing_fields=missing, **base)
            return _report(started=started, stage="classify", status=decision.category,
                           reason=decision.reason, missing_fields=missing, debug=debug, **report_common)

        checkpoint = "resolve"
        candidate_context = build_candidate_context(profile, app_doc, user)
        answers, unresolved = resolve(blueprint, candidate_context, profile)
        if unresolved:
            missing = [f.key for f in unresolved]
            reason = "needs_user_input:" + ",".join(missing[:5])
            debug = build_debug_report(
                job=job, profile=profile, app_doc=app_doc, blueprint=blueprint, decision=decision,
                answers=answers, unresolved=unresolved, candidate_context=candidate_context,
                application_url=app_url,
            )
            await metrics.record_terminal(db, claim, status="needs_user_input", reason=reason,
                                          stage_reached="resolve", missing_fields=missing, **base)
            return _report(started=started, stage="resolve", status="needs_user_input",
                           reason=reason, missing_fields=missing, debug=debug, **report_common)

        checkpoint = "plan"
        application_plan = build_plan(blueprint, answers)
        debug = build_debug_report(
            job=job, profile=profile, app_doc=app_doc, blueprint=blueprint, decision=decision,
            answers=answers, plan=application_plan, candidate_context=candidate_context,
            application_url=app_url,
        )

        if dry_run:
            await metrics.record_terminal(db, claim, status="prepared", stage_reached="plan", **base)
            return _report(started=started, stage="plan", status="prepared",
                           reason="ready_not_submitted", debug=debug, **report_common)

        checkpoint = "submit"
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
        # Offer-expired is different: stop immediately and refund via expiry flow.
        if evidence.blocked_reason:
            reason = f"blocked:{evidence.blocked_reason}"
            status = "unsupported"
            if evidence.blocked_reason == "offer_expired":
                reason = "offer_expired"
                status = "submit_failed"
                try:
                    from application_expiry import maybe_auto_expire_application
                    await maybe_auto_expire_application(
                        db,
                        app_doc,
                        job_doc=job,
                        latest_run={"failure_reason": "offer_expired"},
                        source="auto_apply_submit",
                    )
                except Exception as exc:
                    logger.warning(
                        "auto_apply_offer_expire_failed job=%s error=%s",
                        job.get("job_id"),
                        str(exc)[:200],
                    )
            debug = build_debug_report(
                job=job, profile=profile, app_doc=app_doc, blueprint=blueprint, decision=decision,
                answers=answers, plan=application_plan, candidate_context=candidate_context,
                application_url=app_url, evidence=evidence,
            )
            await metrics.record_terminal(db, claim, status=status, reason=reason,
                                          stage_reached="submit", evidence=safe_evidence, **base)
            return _report(started=started, stage="submit", status=status, reason=reason,
                           evidence=evidence, debug=debug, **report_common)

        # The submit control was never actioned -> the submission never happened.
        if not evidence.submit_performed:
            raw = evidence.raw or {}
            submit_detail = raw.get("submit") or raw.get("submit_error")
            step_log = raw.get("step_log") or []
            if submit_detail == "button_not_found":
                reason = "submit_button_not_found"
            elif not step_log:
                reason = "browser_never_reached_form"
            elif any(s.get("status") == "error" for s in step_log):
                reason = "browser_step_errors"
            else:
                reason = "submit_not_performed"
            debug = build_debug_report(
                job=job, profile=profile, app_doc=app_doc, blueprint=blueprint, decision=decision,
                answers=answers, plan=application_plan, candidate_context=candidate_context,
                application_url=app_url, evidence=evidence,
            )
            await metrics.record_terminal(db, claim, status="submit_failed", reason=reason,
                                          stage_reached="submit", evidence=safe_evidence, **base)
            return _report(started=started, stage="submit", status="submit_failed",
                           reason=reason, evidence=evidence, debug=debug, **report_common)

        checkpoint = "verify"
        verdict = verify(evidence)
        db_status = "submitted_success" if verdict.status == "verified_success" else "verification_failed"
        debug = build_debug_report(
            job=job, profile=profile, app_doc=app_doc, blueprint=blueprint, decision=decision,
            answers=answers, plan=application_plan, candidate_context=candidate_context,
            application_url=app_url, evidence=evidence,
        )
        await metrics.record_terminal(db, claim, status=db_status, verdict=verdict.status,
                                      reason=verdict.reason, stage_reached="verify",
                                      evidence=safe_evidence, **base)
        return _report(started=started, stage="verify", status=db_status, verdict=verdict.status,
                       reason=verdict.reason, evidence=evidence, debug=debug, **report_common)
    except Exception as exc:
        error_detail = format_run_error(exc, checkpoint=checkpoint)
        stage = checkpoint
        if error_detail.get("phase") in ("open_browser", "open_page"):
            stage = "submit"
        logger.warning(
            "auto_apply_execute_failed job=%s stage=%s phase=%s error=%s",
            job_id, stage, error_detail.get("phase"), error_detail.get("message", str(exc))[:300],
        )
        debug = None
        try:
            debug = build_debug_report(
                job=job,
                profile=profile,
                app_doc=app_doc,
                blueprint=blueprint,
                decision=decision,
                answers=answers,
                unresolved=unresolved,
                plan=application_plan,
                candidate_context=candidate_context,
                application_url=app_url,
                evidence=evidence,
            )
            debug["error"] = error_detail
            debug["timeline"] = (debug.get("timeline") or []) + [{
                "stage": stage,
                "status": "error",
                "detail": error_detail.get("message") or exc.__class__.__name__,
            }]
        except Exception:
            debug = {
                "data_availability": data_availability(profile, app_doc),
                "error": error_detail,
                "timeline": [{
                    "stage": stage,
                    "status": "error",
                    "detail": error_detail.get("message") or exc.__class__.__name__,
                }],
            }
        reason = error_detail.get("message") or exc.__class__.__name__
        await metrics.record_terminal(
            db, claim, status="error", reason=reason[:500], stage_reached=stage,
        )
        return _report(
            started=started,
            stage=stage,
            status="error",
            reason=reason,
            error=error_detail,
            debug=debug,
            driver_version=driver_version,
            claim=claim,
            blueprint_signature=signature,
            evidence=evidence,
        )
