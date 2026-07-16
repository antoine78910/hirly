"""Mark applications as offer-expired, refund credits, and notify users."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from application_failure import (
    classify_application_failure,
    should_auto_expire_application,
)
from notifications_service import create_notification


def _billing_from_user(user_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return dict((user_doc or {}).get("billing") or {})


async def _refund_application_credit(db, user_id: str) -> None:
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "billing": 1})
    billing = _billing_from_user(user_doc)
    plan_total = int(billing.get("credits_total") or 0)
    plan_remaining = int(billing.get("credits_remaining") or 0)
    new_remaining = min(plan_total, plan_remaining + 1) if plan_total > 0 else plan_remaining + 1
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {
            "billing.credits_remaining": new_remaining,
            "billing.updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )


async def mark_application_offer_expired(
    db,
    app_doc: Dict[str, Any],
    *,
    source: str,
    actor_email: Optional[str] = None,
    note: Optional[str] = None,
) -> Dict[str, Any]:
    application_id = app_doc.get("application_id")
    if not application_id:
        return app_doc

    if app_doc.get("submission_status") == "expired" or app_doc.get("manual_status") == "offer_expired":
        refreshed = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
        return refreshed or app_doc

    now = datetime.now(timezone.utc).isoformat()
    update: Dict[str, Any] = {
        "admin_status": "offer_expired",
        "manual_status": "offer_expired",
        "submission_status": "expired",
        "failure_code": "offer_expired",
        "failure_source": source,
        "failure_detected_at": now,
        "updated_at": now,
    }
    if note:
        update["failure_detail"] = note
    if actor_email:
        update["manual_status_updated_by"] = actor_email
        update["manual_status_updated_at"] = now
        update["admin_status_updated_by"] = actor_email
        update["admin_status_updated_at"] = now

    if not app_doc.get("credit_refunded_at") and app_doc.get("user_id"):
        await _refund_application_credit(db, app_doc["user_id"])
        update["credit_refunded_at"] = now
        job = await db.jobs.find_one({"job_id": app_doc.get("job_id")}, {"_id": 0}) or {}
        job_label = job.get("title") or "this position"
        if job.get("company"):
            job_label += f" at {job['company']}"
        await create_notification(
            db,
            user_id=app_doc["user_id"],
            type="offer_expired",
            title="This job offer has expired",
            body=f"We've refunded the credit used for {job_label}.",
            application_id=application_id,
        )

    await db.applications.update_one({"application_id": application_id}, {"$set": update})
    refreshed = await db.applications.find_one({"application_id": application_id}, {"_id": 0})
    return refreshed or {**app_doc, **update}


async def maybe_auto_expire_application(
    db,
    app_doc: Dict[str, Any],
    *,
    job_doc: Optional[Dict[str, Any]] = None,
    latest_run: Optional[Dict[str, Any]] = None,
    source: str = "auto_detected",
) -> Optional[Dict[str, Any]]:
    classification = classify_application_failure(app_doc, job_doc=job_doc, latest_run=latest_run)
    if not should_auto_expire_application(app_doc, classification):
        return None
    return await mark_application_offer_expired(
        db,
        app_doc,
        source=source,
        note=(classification or {}).get("admin_detail"),
    )


async def expire_open_applications_for_job(db, job_id: str, *, source: str = "job_expired") -> int:
    if not job_id:
        return 0
    rows = await db.applications.find(
        {"job_id": job_id, "submission_status": {"$nin": ["submitted", "expired"]}},
        {"_id": 0},
    ).to_list(500)
    count = 0
    for app_doc in rows:
        await mark_application_offer_expired(db, app_doc, source=source)
        count += 1
    return count
