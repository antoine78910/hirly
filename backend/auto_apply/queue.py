"""Production auto-apply queue for registered ATS drivers.

Lifecycle on each application document:
  awaiting_review -> queued -> running -> succeeded | failed | skipped

Items are claimed with a status filter so only one worker slot runs them.
Idempotency for the actual ATS submit still lives in auto_apply_attempts.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from .driver import DRIVER_REGISTRY
from db.base import is_missing_database_contract_error
from job_providers.ats_detection import APPLICATION_CAPABILITIES

logger = logging.getLogger(__name__)

QUEUE_STATUSES_ACTIVE = frozenset({"queued", "awaiting_review", "running"})
QUEUE_STATUSES_TERMINAL = frozenset({"succeeded", "failed", "skipped"})
DEFAULT_PROVIDERS = tuple(
    sorted(
        provider
        for provider, capability in APPLICATION_CAPABILITIES.items()
        if capability["driverRegistered"]
        and capability["queuePermitted"]
        and capability["noSubmitVerified"]
    )
)

_worker_task: Optional[asyncio.Task] = None
_claim_lock = asyncio.Lock()
_running_tasks: Set[asyncio.Task] = set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def queue_enabled() -> bool:
    return _env_bool("AUTO_APPLY_QUEUE_ENABLED", True)


def max_concurrent() -> int:
    return _env_int("AUTO_APPLY_MAX_CONCURRENT", 1)


def queue_providers() -> Set[str]:
    raw = (os.environ.get("AUTO_APPLY_QUEUE_PROVIDERS") or ",".join(DEFAULT_PROVIDERS)).strip()
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def normalize_provider(value: Any) -> str:
    return str(value or "").strip().lower()


def provider_for_job(job: Optional[Dict[str, Any]]) -> Optional[str]:
    if not job:
        return None
    provider = normalize_provider(job.get("ats_provider") or job.get("provider"))
    if provider not in queue_providers():
        return None
    if DRIVER_REGISTRY.for_job(job) is None:
        return None
    return provider


def provider_for_application(app_doc: Dict[str, Any], job: Optional[Dict[str, Any]] = None) -> Optional[str]:
    from_job = provider_for_job(job)
    if from_job:
        return from_job
    provider = normalize_provider(app_doc.get("ats_provider") or app_doc.get("submission_provider"))
    if provider in queue_providers() and provider in DRIVER_REGISTRY.providers():
        return provider
    return None


def is_package_ready(app_doc: Dict[str, Any]) -> bool:
    return app_doc.get("package_status") in {"generated", "generated_text_only"}


def is_already_submitted(app_doc: Dict[str, Any]) -> bool:
    if app_doc.get("submission_status") in {"submitted", "expired"}:
        return True
    if app_doc.get("manual_status") in {"manually_submitted", "offer_expired"}:
        return True
    if app_doc.get("auto_apply_queue_status") == "succeeded":
        return True
    return False


def _needs_document_review(app_doc: Dict[str, Any], user_doc: Optional[Dict[str, Any]]) -> bool:
    # Production auto-apply defaults to submit without the Review-tab gate.
    # Flip AUTO_APPLY_REQUIRE_DOCUMENT_REVIEW=true to honor require_review_before_send.
    if not _env_bool("AUTO_APPLY_REQUIRE_DOCUMENT_REVIEW", False):
        return False
    if not user_doc:
        return False
    if not bool(user_doc.get("require_review_before_send", True)):
        return False
    review = app_doc.get("document_review_status")
    if review is None:
        return False
    return review != "approved"


async def enqueue_application(
    db,
    app_doc: Dict[str, Any],
    job: Optional[Dict[str, Any]] = None,
    *,
    user_doc: Optional[Dict[str, Any]] = None,
    force: bool = False,
) -> Optional[Dict[str, Any]]:
    """Mark an application as waiting for the auto-apply worker."""
    if not queue_enabled() and not force:
        return None
    if not is_package_ready(app_doc) or is_already_submitted(app_doc):
        return None

    provider = provider_for_application(app_doc, job)
    if not provider:
        return None

    current = app_doc.get("auto_apply_queue_status")
    if current in QUEUE_STATUSES_ACTIVE and not force:
        return {
            "application_id": app_doc.get("application_id"),
            "auto_apply_queue_status": current,
            "auto_apply_provider": app_doc.get("auto_apply_provider") or provider,
            "enqueued": False,
        }

    if user_doc is None and app_doc.get("user_id"):
        user_doc = await db.users.find_one({"user_id": app_doc["user_id"]}, {"_id": 0})

    status = "awaiting_review" if _needs_document_review(app_doc, user_doc) else "queued"
    now = _now()
    update = {
        "auto_apply_queue_status": status,
        "auto_apply_provider": provider,
        "auto_apply_queued_at": app_doc.get("auto_apply_queued_at") or now,
        "auto_apply_queue_reason": "awaiting_document_review" if status == "awaiting_review" else "queued",
        "auto_apply_started_at": None,
        "auto_apply_finished_at": None,
        "updated_at": now,
    }
    await db.applications.update_one(
        {"application_id": app_doc["application_id"]},
        {"$set": update},
    )
    logger.info(
        "auto_apply_enqueued application_id=%s job_id=%s provider=%s status=%s",
        app_doc.get("application_id"),
        app_doc.get("job_id"),
        provider,
        status,
    )
    return {"application_id": app_doc.get("application_id"), **update, "enqueued": True}


async def release_after_document_approval(db, app_doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Move awaiting_review items into queued once the user approved documents."""
    if app_doc.get("auto_apply_queue_status") != "awaiting_review":
        # Fresh approval on a queueable app that was never enqueued (edge cases).
        job = await db.jobs.find_one({"job_id": app_doc.get("job_id")}, {"_id": 0})
        return await enqueue_application(db, app_doc, job)
    if is_already_submitted(app_doc):
        return None
    now = _now()
    update = {
        "auto_apply_queue_status": "queued",
        "auto_apply_queue_reason": "document_review_approved",
        "updated_at": now,
    }
    await db.applications.update_one(
        {"application_id": app_doc["application_id"], "auto_apply_queue_status": "awaiting_review"},
        {"$set": update},
    )
    logger.info(
        "auto_apply_released_after_review application_id=%s",
        app_doc.get("application_id"),
    )
    return {"application_id": app_doc.get("application_id"), **update}


def map_execution_to_queue(report: Dict[str, Any]) -> Dict[str, Any]:
    """Translate an ExecutionReport into application queue + submission fields."""
    status = str(report.get("status") or "")
    reason = str(report.get("reason") or "")
    missing = list(report.get("missing_fields") or [])
    now = _now()

    if status in {"submitted_success", "already_submitted"}:
        return {
            "auto_apply_queue_status": "succeeded",
            "auto_apply_queue_reason": reason or status,
            "auto_apply_finished_at": now,
            "submission_status": "submitted",
            "submitted_at": now,
            "submission_error": None,
        }

    if status == "offer_expired" or reason == "offer_expired" or "offer_expired" in reason:
        return {
            "auto_apply_queue_status": "skipped",
            "auto_apply_queue_reason": "offer_expired",
            "auto_apply_finished_at": now,
            # Expiry helper may already set submission/manual fields.
        }

    if status == "needs_user_input":
        details = report.get("missing_field_details")
        missing = list(report.get("missing_fields") or [])
        if isinstance(details, list) and details:
            prepared = details
        else:
            prepared = [
                {
                    "field_name": key,
                    "label": key,
                    "question": key,
                    "reason": "needs_user_input",
                    "field_type": "input_text",
                    "type": "input_text",
                    "options": [],
                }
                for key in missing
            ]
        update = {
            "auto_apply_queue_status": "failed",
            "auto_apply_queue_reason": reason or "needs_user_input",
            "auto_apply_finished_at": now,
            "submission_status": "action_required",
            "manual_status": "needs_user_input",
            "submission_error": reason or "needs_user_input",
            "prepared_missing_information": prepared,
        }
        return update

    if status == "already_in_flight":
        return {
            "auto_apply_queue_status": "queued",
            "auto_apply_queue_reason": "retry_after_in_flight",
            "auto_apply_started_at": None,
        }

    if status in {"unsupported", "submit_failed", "verification_failed", "error", "prepared"}:
        submission = "blocked_captcha" if "captcha" in reason.lower() else "failed"
        if status == "unsupported" and "login" in reason.lower():
            submission = "blocked"
        return {
            "auto_apply_queue_status": "failed" if status != "prepared" else "skipped",
            "auto_apply_queue_reason": reason or status,
            "auto_apply_finished_at": now,
            "submission_status": submission,
            "submission_error": (reason or status)[:500],
        }

    return {
        "auto_apply_queue_status": "failed",
        "auto_apply_queue_reason": reason or status or "unknown_error",
        "auto_apply_finished_at": now,
        "submission_status": "failed",
        "submission_error": (reason or status or "unknown_error")[:500],
    }


async def backfill_pending_applications(db, *, limit: int = 200) -> int:
    """Enqueue historical package-ready apps for configured providers."""
    if not queue_enabled():
        return 0

    providers = sorted(queue_providers())
    if not providers:
        return 0
    set_based_backfill = getattr(db, "backfill_auto_apply_queue", None)
    if set_based_backfill is not None:
        try:
            return await set_based_backfill(providers, limit=limit)
        except Exception as error:
            if not is_missing_database_contract_error(error, "backfill_auto_apply_queue"):
                raise
            logger.warning(
                "auto_apply_queue_backfill_rpc_unavailable fallback=legacy error=%s",
                str(error)[:300],
            )

    # Prefer app.ats_provider (denormalized). Also scan recent not_submitted packages.
    candidates = await db.applications.find(
        {
            "package_status": {"$in": ["generated", "generated_text_only"]},
            "submission_status": {"$nin": ["submitted", "expired"]},
            "auto_apply_queue_status": {"$nin": list(QUEUE_STATUSES_ACTIVE | {"succeeded"})},
        },
        {"_id": 0},
    ).sort("created_at", 1).limit(limit * 3).to_list(limit * 3)

    enqueued = 0
    job_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    for app_doc in candidates:
        if enqueued >= limit:
            break
        if is_already_submitted(app_doc):
            continue
        job_id = app_doc.get("job_id")
        if job_id not in job_cache:
            job_cache[job_id] = await db.jobs.find_one({"job_id": job_id}, {"_id": 0}) if job_id else None
        job = job_cache[job_id]
        provider = provider_for_application(app_doc, job)
        if not provider:
            continue
        # Successful attempt already exists -> mark succeeded without re-running.
        success = await db.auto_apply_attempts.find_one(
            {
                "user_id": app_doc.get("user_id"),
                "job_id": job_id,
                "status": "submitted_success",
            },
            {"_id": 0, "id": 1},
        )
        if success:
            await db.applications.update_one(
                {"application_id": app_doc["application_id"]},
                {"$set": {
                    "auto_apply_queue_status": "succeeded",
                    "auto_apply_provider": provider,
                    "auto_apply_queue_reason": "prior_submitted_success",
                    "auto_apply_finished_at": _now(),
                    "submission_status": "submitted",
                    "updated_at": _now(),
                }},
            )
            continue
        result = await enqueue_application(db, app_doc, job)
        if result and result.get("enqueued"):
            enqueued += 1

    if enqueued:
        logger.info("auto_apply_backfill_enqueued count=%s providers=%s", enqueued, providers)
    return enqueued


async def _claim_next(db) -> Optional[Dict[str, Any]]:
    async with _claim_lock:
        row = await db.applications.find_one(
            {"auto_apply_queue_status": "queued"},
            {"_id": 0},
            sort=[("auto_apply_queued_at", 1), ("created_at", 1)],
        )
        if not row:
            return None
        now = _now()
        result = await db.applications.update_one(
            {
                "application_id": row["application_id"],
                "auto_apply_queue_status": "queued",
            },
            {"$set": {
                "auto_apply_queue_status": "running",
                "auto_apply_started_at": now,
                "auto_apply_queue_reason": "running",
                "updated_at": now,
            }},
        )
        matched = getattr(result, "matched_count", None)
        if matched == 0:
            return None
        row = dict(row)
        row["auto_apply_queue_status"] = "running"
        row["auto_apply_started_at"] = now
        return row


async def _load_user_dict(db, user_id: str) -> Optional[Dict[str, Any]]:
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user_doc:
        return None
    return {
        "user_id": user_doc.get("user_id"),
        "email": user_doc.get("email") or "",
        "name": user_doc.get("name") or "",
        "picture": user_doc.get("picture"),
        "demo_account": bool(user_doc.get("demo_account")),
        "training_access": bool(user_doc.get("training_access")),
        "require_review_before_send": bool(user_doc.get("require_review_before_send", True)),
    }


async def process_application(db, app_doc: Dict[str, Any], *, headless: bool = True) -> Dict[str, Any]:
    """Run execute_application for one claimed queue item and persist outcomes."""
    from .executor import execute_application
    from .metrics import persist_execution_report

    application_id = app_doc.get("application_id")
    user_id = app_doc.get("user_id")
    job_id = app_doc.get("job_id")
    provider = app_doc.get("auto_apply_provider") or normalize_provider(app_doc.get("ats_provider"))

    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0}) if job_id else None
    profile = await db.profiles.find_one({"user_id": user_id}, {"_id": 0}) if user_id else None
    user = await _load_user_dict(db, user_id) if user_id else None
    latest = await db.applications.find_one({"application_id": application_id}, {"_id": 0}) or app_doc

    if not job or not profile or not user:
        update = {
            "auto_apply_queue_status": "failed",
            "auto_apply_queue_reason": "missing_job_profile_or_user",
            "auto_apply_finished_at": _now(),
            "submission_status": "failed",
            "submission_error": "missing_job_profile_or_user",
            "updated_at": _now(),
        }
        await db.applications.update_one({"application_id": application_id}, {"$set": update})
        return update

    if _needs_document_review(latest, user):
        update = {
            "auto_apply_queue_status": "awaiting_review",
            "auto_apply_queue_reason": "awaiting_document_review",
            "auto_apply_started_at": None,
            "updated_at": _now(),
        }
        await db.applications.update_one({"application_id": application_id}, {"$set": update})
        return update

    try:
        report = await execute_application(
            db, job, profile, latest, user,
            dry_run=False,
            headless=headless,
        )
    except Exception as exc:
        logger.exception(
            "auto_apply_queue_execute_failed application_id=%s job_id=%s",
            application_id,
            job_id,
        )
        report = {
            "status": "error",
            "reason": (str(exc).strip() or exc.__class__.__name__)[:500],
            "stage_reached": "driver",
        }

    try:
        await persist_execution_report(db, user_id, job_id, report if isinstance(report, dict) else {})
    except Exception as exc:
        logger.warning(
            "auto_apply_queue_persist_report_failed application_id=%s error=%s",
            application_id,
            str(exc)[:200],
        )

    update = map_execution_to_queue(report if isinstance(report, dict) else {})
    if provider:
        update["submission_provider"] = provider
        update["auto_apply_provider"] = provider
    update["updated_at"] = _now()

    # Don't overwrite expiry fields if the expiry helper already ran.
    if update.get("auto_apply_queue_reason") == "offer_expired":
        existing = await db.applications.find_one({"application_id": application_id}, {"_id": 0}) or {}
        if existing.get("submission_status") == "expired" or existing.get("manual_status") == "offer_expired":
            update.pop("submission_status", None)

    await db.applications.update_one({"application_id": application_id}, {"$set": update})
    logger.info(
        "auto_apply_queue_finished application_id=%s job_id=%s queue_status=%s exec_status=%s reason=%s",
        application_id,
        job_id,
        update.get("auto_apply_queue_status"),
        (report or {}).get("status") if isinstance(report, dict) else None,
        update.get("auto_apply_queue_reason"),
    )
    return update


async def list_queue_for_user(db, user_id: str, *, limit: int = 100) -> Dict[str, Any]:
    rows = await db.applications.find(
        {
            "user_id": user_id,
            "auto_apply_queue_status": {"$in": list(QUEUE_STATUSES_ACTIVE | QUEUE_STATUSES_TERMINAL)},
        },
        {"_id": 0},
    ).sort("auto_apply_queued_at", 1).limit(limit).to_list(limit)

    active = [r for r in rows if r.get("auto_apply_queue_status") in QUEUE_STATUSES_ACTIVE]
    active_sorted = sorted(
        active,
        key=lambda r: (
            0 if r.get("auto_apply_queue_status") == "running" else
            1 if r.get("auto_apply_queue_status") == "queued" else 2,
            r.get("auto_apply_queued_at") or r.get("created_at") or "",
        ),
    )
    position_by_id = {
        r.get("application_id"): idx + 1
        for idx, r in enumerate(
            [x for x in active_sorted if x.get("auto_apply_queue_status") in {"queued", "running"}]
        )
    }

    job_ids = list({r.get("job_id") for r in rows if r.get("job_id")})
    jobs = await db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0}).to_list(len(job_ids) or 1) if job_ids else []
    job_map = {j["job_id"]: j for j in jobs}

    items = []
    for row in rows:
        job = job_map.get(row.get("job_id")) or {}
        status = row.get("auto_apply_queue_status")
        items.append({
            "application_id": row.get("application_id"),
            "job_id": row.get("job_id"),
            "provider": row.get("auto_apply_provider") or normalize_provider(row.get("ats_provider")),
            "queue_status": status,
            "queue_reason": row.get("auto_apply_queue_reason"),
            "queued_at": row.get("auto_apply_queued_at"),
            "started_at": row.get("auto_apply_started_at"),
            "finished_at": row.get("auto_apply_finished_at"),
            "position": position_by_id.get(row.get("application_id")),
            "company": job.get("company"),
            "title": job.get("title"),
            "submission_status": row.get("submission_status"),
        })

    items.sort(
        key=lambda item: (
            0 if item.get("queue_status") == "running" else
            1 if item.get("queue_status") == "queued" else
            2 if item.get("queue_status") == "awaiting_review" else 3,
            item.get("queued_at") or "",
        )
    )
    return {
        "enabled": queue_enabled(),
        "providers": sorted(queue_providers()),
        "max_concurrent": max_concurrent(),
        "active_count": len([i for i in items if i.get("queue_status") in QUEUE_STATUSES_ACTIVE]),
        "items": items,
    }


async def _worker_loop(db) -> None:
    logger.info(
        "auto_apply_queue_worker_started enabled=%s providers=%s max_concurrent=%s",
        queue_enabled(),
        sorted(queue_providers()),
        max_concurrent(),
    )
    from apply_agent.browser import effective_headless

    while True:
        try:
            if not queue_enabled():
                await asyncio.sleep(5)
                continue

            # Drop finished tasks
            done = {t for t in _running_tasks if t.done()}
            for task in done:
                _running_tasks.discard(task)
                exc = task.exception() if not task.cancelled() else None
                if exc:
                    logger.warning("auto_apply_queue_task_error error=%s", str(exc)[:300])

            slots = max_concurrent() - len(_running_tasks)
            for _ in range(max(0, slots)):
                claimed = await _claim_next(db)
                if not claimed:
                    break
                headless = effective_headless(
                    os.environ.get("BROWSER_HEADLESS", "true").lower() in ("1", "true", "yes", "on")
                )
                task = asyncio.create_task(process_application(db, claimed, headless=headless))
                _running_tasks.add(task)

            await asyncio.sleep(2 if _running_tasks else 4)
        except asyncio.CancelledError:
            logger.info("auto_apply_queue_worker_cancelled")
            raise
        except Exception:
            logger.exception("auto_apply_queue_worker_tick_failed")
            await asyncio.sleep(5)


def start_worker(db) -> Optional[asyncio.Task]:
    global _worker_task
    if _worker_task and not _worker_task.done():
        return _worker_task
    if not queue_enabled():
        logger.info("auto_apply_queue_worker_not_started reason=disabled")
        return None
    _worker_task = asyncio.create_task(_worker_loop(db))
    return _worker_task


async def startup(db) -> None:
    """Backfill historical SR/GH apps, then start the in-process worker."""
    try:
        # Ensure drivers are registered before provider checks.
        import auto_apply.drivers  # noqa: F401
        count = await backfill_pending_applications(db)
        logger.info("auto_apply_queue_startup_backfill count=%s", count)
    except Exception:
        logger.exception("auto_apply_queue_startup_backfill_failed")
    start_worker(db)
