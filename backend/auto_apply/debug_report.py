"""Structured debug payload for admin auto-apply runs."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from application_blueprint import NormalizedField

from .models import ApplicationPlan, ResolvedAnswer


def _preview(value: Any, *, is_file: bool = False) -> str:
    if is_file:
        return "(file attachment)"
    text = str(value or "")
    if len(text) > 100:
        return text[:97] + "..."
    return text


def _field_row(field: NormalizedField) -> Dict[str, Any]:
    return {
        "key": field.key,
        "type": field.type.value,
        "label": field.label,
        "required": field.required,
        "supported": field.supported,
        "binding": field.binding,
        "sensitive": bool(field.validation.sensitive),
    }


def data_availability(profile: Dict[str, Any], app_doc: Dict[str, Any]) -> Dict[str, Any]:
    contact = profile.get("contact") or {}
    return {
        "tailored_cv_file": bool(app_doc.get("tailored_cv_file_b64")),
        "tailored_cv_filename": app_doc.get("tailored_cv_filename"),
        "profile_cv_text": bool(profile.get("cv_text")),
        "profile_cv_original": bool(profile.get("cv_original_b64")),
        "cover_letter": bool(app_doc.get("cover_letter") or app_doc.get("tailored_cover_letter")),
        "phone": bool(contact.get("phone")),
        "email": bool(contact.get("email")),
        "first_name": bool(contact.get("first_name") or contact.get("name")),
        "location": bool(contact.get("location") or profile.get("target_location")),
        "linkedin": bool(contact.get("linkedin")),
    }


def build_debug_report(
    *,
    job: Dict[str, Any],
    profile: Dict[str, Any],
    app_doc: Dict[str, Any],
    blueprint=None,
    decision=None,
    answers: Optional[List[ResolvedAnswer]] = None,
    unresolved: Optional[List[NormalizedField]] = None,
    plan: Optional[ApplicationPlan] = None,
    candidate_context: Optional[Dict[str, Any]] = None,
    application_url: str = "",
    evidence=None,
) -> Dict[str, Any]:
    resolved_keys = {a.field_key for a in (answers or [])}
    blueprint_fields = [_field_row(f) for f in (getattr(blueprint, "fields", None) or [])]

    field_status: List[Dict[str, Any]] = []
    for row in blueprint_fields:
        key = row["key"]
        if key in resolved_keys:
            ans = next(a for a in (answers or []) if a.field_key == key)
            field_status.append({
                **row,
                "status": "resolved",
                "source": ans.source,
                "value_preview": _preview(ans.value, is_file=ans.is_file),
            })
        elif any(f.key == key for f in (unresolved or [])):
            field_status.append({**row, "status": "missing", "source": None, "value_preview": None})
        else:
            field_status.append({**row, "status": "optional_skipped", "source": None, "value_preview": None})

    plan_steps: List[Dict[str, Any]] = []
    for step in (plan.steps if plan else []):
        plan_steps.append({
            "action": step.action,
            "locators": step.locators,
            "value_preview": _preview(step.value, is_file=step.action == "upload"),
            "source": step.source,
            "file_role": step.file_role,
        })

    raw = getattr(evidence, "raw", None) or {}
    step_log = raw.get("step_log") or []

    return {
        "application_url": application_url or raw.get("application_url") or "",
        "job_id": job.get("job_id"),
        "ats_provider": job.get("ats_provider") or job.get("provider"),
        "data_availability": data_availability(profile, app_doc),
        "candidate_context_keys": sorted((candidate_context or {}).keys()),
        "blueprint": {
            "provider": getattr(blueprint, "provider", None),
            "signature": getattr(blueprint, "signature", None),
            "complexity": getattr(getattr(blueprint, "complexity", None), "value", None),
            "field_count": len(blueprint_fields),
            "fields": blueprint_fields,
        },
        "classification": {
            "eligible": getattr(decision, "eligible", None),
            "category": getattr(decision, "category", None),
            "reason": getattr(decision, "reason", None),
            "score": getattr(decision, "score", None),
            "signals": getattr(decision, "signals", None) or {},
        } if decision is not None else None,
        "field_status": field_status,
        "resolved_count": len(answers or []),
        "unresolved_count": len(unresolved or []),
        "plan_step_count": len(plan_steps),
        "plan_steps": plan_steps,
        "execution": {
            "submit_performed": getattr(evidence, "submit_performed", None),
            "blocked_reason": getattr(evidence, "blocked_reason", None),
            "confirmation_text": getattr(evidence, "confirmation_text", None),
            "validation_errors": getattr(evidence, "validation_errors", None) or [],
            "final_url": getattr(evidence, "final_url", None),
            "url_changed": getattr(evidence, "url_changed", None),
            "network_ok": getattr(evidence, "network_ok", None),
            "step_log": step_log,
            "unmatched_steps": raw.get("unmatched_steps") or [],
            "step_errors": raw.get("step_errors") or [],
            "submit_detail": raw.get("submit") or raw.get("submit_error"),
        } if evidence is not None else None,
    }
