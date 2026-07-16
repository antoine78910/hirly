"""Classify why an application failed or stalled — shared by admin ops,
user-facing copy, and future automatic expiry flows."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

OFFER_EXPIRED_MARKERS = (
    "offer expired",
    "offer_expired",
    "offer has expired",
    "job expired",
    "position expired",
    "job closed",
    "position closed",
    "posting closed",
    "no longer accepting applications",
    "no longer available",
    "this job is no longer available",
    "job is no longer available",
    "position has been filled",
    "offre expir",
    "l'offre a expir",
    "l offre a expir",
    "cette offre a expir",
    "offre n'est plus disponible",
    "offre n est plus disponible",
    "poste pourvu",
    "candidatures closes",
    "candidatures clôtur",
    "blocked:offer_expired",
)

TERMINAL_SUBMISSION_STATUSES = {"submitted", "expired"}
OPEN_SUBMISSION_STATUSES = {
    "not_submitted",
    "ready",
    "prepared",
    "failed",
    "blocked",
    "action_required",
    "blocked_captcha",
    "prepare_failed",
    "unknown",
}

FAILURE_CATALOG: Dict[str, Dict[str, str]] = {
    "offer_expired": {
        "admin_title": "Offer expired",
        "user_message_en": "Sorry, this offer has expired.",
        "user_message_fr": "Désolé, cette offre a expiré.",
    },
    "captcha_required": {
        "admin_title": "CAPTCHA required",
        "user_message_en": "A security check blocked automatic submission.",
        "user_message_fr": "Un contrôle de sécurité a bloqué l'envoi automatique.",
    },
    "login_wall": {
        "admin_title": "Login required",
        "user_message_en": "The employer site requires a login before applying.",
        "user_message_fr": "Le site employeur exige une connexion avant de postuler.",
    },
    "form_not_found": {
        "admin_title": "Application form not found",
        "user_message_en": "We could not find the application form on the employer page.",
        "user_message_fr": "Le formulaire de candidature est introuvable sur la page employeur.",
    },
    "missing_information": {
        "admin_title": "Missing information",
        "user_message_en": "More information is needed to complete this application.",
        "user_message_fr": "Des informations supplémentaires sont nécessaires pour finaliser cette candidature.",
    },
    "generation_failed": {
        "admin_title": "Document generation failed",
        "user_message_en": "We could not generate the application package.",
        "user_message_fr": "Impossible de générer le dossier de candidature.",
    },
    "submission_failed": {
        "admin_title": "Submission failed",
        "user_message_en": "Automatic submission did not complete.",
        "user_message_fr": "L'envoi automatique n'a pas abouti.",
    },
    "manual_review": {
        "admin_title": "Needs human review",
        "user_message_en": "Our team is reviewing this application.",
        "user_message_fr": "Notre équipe examine cette candidature.",
    },
}


def _normalize_text(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip().lower())
    return text


def text_indicates_offer_expired(*chunks: Any) -> bool:
    text = _normalize_text(" ".join(str(chunk or "") for chunk in chunks if chunk))
    if not text:
        return False
    return any(marker in text for marker in OFFER_EXPIRED_MARKERS)


def _job_indicates_offer_expired(job_doc: Optional[Dict[str, Any]]) -> bool:
    if not job_doc:
        return False
    status = _normalize_text(job_doc.get("status") or job_doc.get("job_status"))
    if status in {"expired", "closed", "inactive", "archived"}:
        return True
    if _normalize_text(job_doc.get("apply_fulfillment_status")) == "blocked_expired":
        return True
    if _normalize_text(job_doc.get("validation_status")) == "invalid" and text_indicates_offer_expired(
        job_doc.get("validation_reason"),
        job_doc.get("rejection_reason"),
        job_doc.get("description"),
        job_doc.get("title"),
    ):
        return True
    return text_indicates_offer_expired(
        job_doc.get("title"),
        job_doc.get("description"),
        job_doc.get("validation_reason"),
        job_doc.get("rejection_reason"),
        job_doc.get("apply_fulfillment_reason"),
    )


def _application_already_expired(app_doc: Dict[str, Any]) -> bool:
    if app_doc.get("submission_status") == "expired":
        return True
    manual = _normalize_text(app_doc.get("manual_status") or app_doc.get("admin_status"))
    return manual == "offer_expired"


def _collect_text_blobs(app_doc: Dict[str, Any], latest_run: Optional[Dict[str, Any]] = None) -> List[str]:
    blobs: List[str] = []
    for key in ("submission_error", "generation_error"):
        if app_doc.get(key):
            blobs.append(str(app_doc[key]))
    agent_result = app_doc.get("agent_apply_result") or {}
    if isinstance(agent_result, dict):
        for key in ("failure_reason", "confirmation_text_found"):
            if agent_result.get(key):
                blobs.append(str(agent_result[key]))
        for item in agent_result.get("post_submit_errors") or []:
            blobs.append(str(item))
        for item in agent_result.get("blockers") or []:
            if isinstance(item, dict):
                blobs.append(str(item.get("code") or item.get("message") or item))
            else:
                blobs.append(str(item))
    if latest_run:
        if latest_run.get("failure_reason"):
            blobs.append(str(latest_run["failure_reason"]))
        for item in latest_run.get("post_submit_errors") or []:
            blobs.append(str(item))
    return blobs


def _failure_payload(code: str, *, detail: Optional[str] = None, source: Optional[str] = None) -> Dict[str, Any]:
    meta = FAILURE_CATALOG.get(code, FAILURE_CATALOG["submission_failed"])
    return {
        "code": code,
        "admin_title": meta["admin_title"],
        "admin_detail": (detail or "").strip() or None,
        "user_message_en": meta["user_message_en"],
        "user_message_fr": meta["user_message_fr"],
        "source": source,
        "auto_expirable": code == "offer_expired",
    }


def classify_application_failure(
    app_doc: Dict[str, Any],
    *,
    job_doc: Optional[Dict[str, Any]] = None,
    latest_run: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Return a structured failure classification for admin + user surfaces."""
    if not app_doc:
        return None

    if _application_already_expired(app_doc):
        return _failure_payload("offer_expired", source="application_status")

    submission_status = _normalize_text(app_doc.get("submission_status"))
    if submission_status == "submitted":
        return None

    if _job_indicates_offer_expired(job_doc):
        return _failure_payload(
            "offer_expired",
            detail=_normalize_text(job_doc.get("validation_reason") or job_doc.get("rejection_reason") or job_doc.get("apply_fulfillment_status")),
            source="job_record",
        )

    text_blobs = _collect_text_blobs(app_doc, latest_run)
    if text_indicates_offer_expired(*text_blobs):
        return _failure_payload("offer_expired", detail=text_blobs[0] if text_blobs else None, source="automation_text")

    failure_reason = _normalize_text((latest_run or {}).get("failure_reason") or (app_doc.get("agent_apply_result") or {}).get("failure_reason"))
    if failure_reason in {"offer_expired", "blocked:offer_expired"} or text_indicates_offer_expired(failure_reason):
        return _failure_payload("offer_expired", detail=failure_reason or None, source="agent_run")
    if failure_reason == "captcha_required" or submission_status == "blocked_captcha":
        return _failure_payload("captcha_required", detail=failure_reason or None, source="agent_run")
    if failure_reason == "login_wall_detected" or bool((latest_run or {}).get("login_wall_detected")):
        return _failure_payload("login_wall", detail=failure_reason or None, source="agent_run")
    if failure_reason == "form_not_found":
        return _failure_payload("form_not_found", detail=failure_reason or None, source="agent_run")

    if submission_status == "action_required" or app_doc.get("prepared_missing_information") or app_doc.get("required_questions"):
        return _failure_payload("missing_information", source="application_record")

    generation_status = _normalize_text(app_doc.get("generation_status") or app_doc.get("package_status"))
    if generation_status == "failed" or app_doc.get("generation_error"):
        return _failure_payload("generation_failed", detail=str(app_doc.get("generation_error") or ""), source="generation")

    manual_status = _normalize_text(app_doc.get("manual_status") or app_doc.get("admin_status"))
    if manual_status in {"manual_review_needed", "manual_in_progress", "manual_blocked"}:
        return _failure_payload("manual_review", detail=manual_status, source="manual_status")

    if submission_status in {"failed", "blocked", "prepare_failed", "unknown"}:
        detail = str(app_doc.get("submission_error") or failure_reason or submission_status)
        return _failure_payload("submission_failed", detail=detail, source="submission_status")

    return None


def should_auto_expire_application(app_doc: Dict[str, Any], classification: Optional[Dict[str, Any]]) -> bool:
    if not classification or classification.get("code") != "offer_expired":
        return False
    if _application_already_expired(app_doc):
        return False
    return _normalize_text(app_doc.get("submission_status")) in OPEN_SUBMISSION_STATUSES
