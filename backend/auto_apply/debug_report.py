"""Structured debug payload for admin auto-apply runs."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

from application_blueprint import NormalizedField

from .models import ApplicationPlan, ResolvedAnswer

_ERROR_HINTS = {
    "open_browser": (
        "The browser could not start. On local dev run "
        "`pip install playwright` and `python -m playwright install chromium`. "
        "On Railway, ensure Chromium is installed in the build. "
        "If you enabled “Show browser”, the server must have a display (local only)."
    ),
    "open_page": (
        "The apply page failed to load. Check that the job URL is still live, "
        "the residential proxy can reach the ATS, and Railway logs for HTTP 572 / "
        "proxy connect failures."
    ),
    "inspect": "Form inspection failed before any browser step. The ATS page structure may have changed.",
    "claim": "Could not claim this auto-apply attempt (database or lock error). Retry once.",
    "execute": "The run failed before a pipeline stage was recorded. Expand Raw ExecutionReport JSON or check Railway logs.",
}

_PROXY_HINT = (
    "Residential proxy could not reach the ATS (often PrivateProxy HTTP 572). "
    "Retries mint a new sticky SID, then one direct (no-proxy) attempt. "
    "If all fail, check BROWSER_PROXY / STICKY_SID on Railway, or try again later."
)


def _sanitize_text(value: Any, *, fallback: str) -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    text = re.sub(r"https?://\S+", "[url]", text, flags=re.I)
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[email]", text)
    text = re.sub(r"(?<!\w)\+?\d[\d .()-]{7,}\d(?!\w)", "[phone]", text)
    text = re.sub(
        r"(?i)\b(token|secret|password|authorization|api[_-]?key)\b\s*[:=]\s*\S+",
        r"\1=[redacted]",
        text,
    )
    text = re.sub(r"(?i)\b[^\s/\\]+\.(pdf|docx?|rtf)\b", "[file]", text)
    return text[:300]


def error_hint(*, phase: str = "", message: str = "") -> Optional[str]:
    lowered = (message or "").lower()
    if any(token in lowered for token in (
        "proxy could not reach",
        "failed to connect to target host",
        "http 572",
        "err_proxy",
        "err_tunnel_connection",
    )):
        return _PROXY_HINT
    if phase in _ERROR_HINTS:
        return _ERROR_HINTS[phase]
    if "Playwright is not installed" in message:
        return _ERROR_HINTS["open_browser"]
    return None


def format_run_error(exc: BaseException, *, checkpoint: str = "") -> Dict[str, Any]:
    """Normalize exceptions without copying candidate/route payloads."""
    from apply_agent.models import ApplyAgentError

    if isinstance(exc, ApplyAgentError):
        detail = exc.safe_detail()
        phase = str(detail.get("phase") or checkpoint or "execute")
        message = _sanitize_text(detail.get("message") or exc, fallback=f"{phase}_failed")
        return {
            "message": message,
            "phase": phase,
            "checkpoint": checkpoint or phase,
            "exception_class": detail.get("exception_class") or exc.__class__.__name__,
            "target_url": None,
            "hint": error_hint(phase=phase, message=message),
        }

    phase = checkpoint or "execute"
    message = _sanitize_text(exc, fallback=f"{phase}_failed")
    return {
        "phase": phase,
        "checkpoint": phase,
        "exception_class": exc.__class__.__name__,
        "message": message,
        "target_url": None,
        "hint": error_hint(phase=phase, message=message),
    }


def transport_error_report(
    *,
    message: str,
    phase: str = "execute",
    stage: str = "driver",
    exception_class: str = "",
    http_status: Optional[int] = None,
    timed_out: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build a minimal ExecutionReport when the HTTP transport fails before a pipeline result exists."""
    error: Dict[str, Any] = {
        "message": _sanitize_text(message, fallback=f"{phase}_failed"),
        "phase": phase,
        "checkpoint": phase,
        "exception_class": exception_class or None,
        "http_status": http_status,
        "timed_out": timed_out,
        "hint": error_hint(phase=phase, message=_sanitize_text(message, fallback="")),
    }
    if extra:
        error.update({k: v for k, v in extra.items() if v is not None})
    return {
        "stage_reached": stage,
        "status": "error",
        "reason": _sanitize_text(message, fallback=f"{phase}_failed"),
        "verdict": None,
        "missing_fields": [],
        "error": error,
        "debug": {
            "error": error,
            "timeline": [{
                "stage": stage,
                "status": "error",
                "detail": _sanitize_text(message, fallback=f"{phase}_failed"),
            }],
        },
        "duration_ms": None,
        "screenshots": [],
    }


def _preview(value: Any, *, is_file: bool = False) -> str:
    if is_file:
        return "(file attachment)"
    return "[redacted]" if value not in (None, "") else ""


def _safe_url(value: Any) -> str:
    try:
        parsed = urlsplit(str(value or ""))
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    return f"{parsed.scheme}://{parsed.hostname}"


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
        "tailored_cv_filename": bool(app_doc.get("tailored_cv_filename")),
        "profile_cv_text": bool(profile.get("cv_text")),
        "profile_cv_original": bool(profile.get("cv_original_b64")),
        "cover_letter": bool(app_doc.get("cover_letter") or app_doc.get("tailored_cover_letter")),
        "phone": bool(contact.get("phone")),
        "email": bool(contact.get("email")),
        "first_name": bool(contact.get("first_name") or contact.get("name")),
        "location": bool(contact.get("location") or profile.get("target_location")),
        "linkedin": bool(contact.get("linkedin")),
        "experience": bool(profile.get("experience")),
        "education": bool(profile.get("education")),
        "years_experience": bool(
            (profile.get("experience_summary") or {}).get("years_experience")
            if isinstance(profile.get("experience_summary"), dict) else False
        ) or bool(profile.get("experience")),
        "application_defaults": sorted((profile.get("application_defaults") or {}).keys()),
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
    step_log = [
        {
            "action": str(step.get("action") or "")[:64],
            "status": str(step.get("status") or "")[:32],
        }
        for step in (raw.get("step_log") or [])[:100]
        if isinstance(step, dict)
    ]

    timeline = _build_timeline(
        blueprint=blueprint,
        decision=decision,
        answers=answers,
        unresolved=unresolved,
        plan=plan,
        evidence=evidence,
        field_status=field_status,
        plan_steps=plan_steps,
    )

    return {
        "application_url": _safe_url(application_url or raw.get("application_url") or ""),
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
        "timeline": timeline,
        "execution": {
            "submit_performed": getattr(evidence, "submit_performed", None),
            "blocked_reason": getattr(evidence, "blocked_reason", None),
            "confirmation_present": bool(getattr(evidence, "confirmation_text", None)),
            "validation_error_count": len(getattr(evidence, "validation_errors", None) or []),
            "final_url": _safe_url(getattr(evidence, "final_url", None)),
            "url_changed": getattr(evidence, "url_changed", None),
            "network_ok": getattr(evidence, "network_ok", None),
            "step_log": step_log,
            "unmatched_step_count": len(raw.get("unmatched_steps") or []),
            "step_error_count": len(raw.get("step_errors") or []),
            "submit_detail": raw.get("submit") or raw.get("submit_error"),
        } if evidence is not None else None,
    }


def _timeline_entry(stage: str, *, status: str, detail: str = "") -> Dict[str, Any]:
    return {"stage": stage, "status": status, "detail": detail}


def _build_timeline(
    *,
    blueprint=None,
    decision=None,
    answers=None,
    unresolved=None,
    plan=None,
    evidence=None,
    field_status=None,
    plan_steps=None,
) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    provider = getattr(blueprint, "provider", None)
    if provider:
        entries.append(_timeline_entry(
            "driver",
            status="ok",
            detail=f"Driver {provider} selected",
        ))

    fields = getattr(blueprint, "fields", None) or []
    if fields:
        entries.append(_timeline_entry(
            "inspect",
            status="ok",
            detail=f"{len(fields)} fields detected · signature {getattr(blueprint, 'signature', '—')}",
        ))

    if decision is not None:
        eligible = getattr(decision, "eligible", None)
        score = getattr(decision, "score", None)
        reason = getattr(decision, "reason", "") or ""
        entries.append(_timeline_entry(
            "classify",
            status="ok" if eligible else "blocked",
            detail=f"{'Eligible' if eligible else 'Not eligible'}"
                   + (f" · score {score:.2f}" if isinstance(score, (int, float)) else "")
                   + (f" · {reason}" if reason else ""),
        ))

    if answers is not None or unresolved is not None:
        resolved_n = len(answers or [])
        missing_n = len(unresolved or [])
        if missing_n:
            missing_keys = ", ".join(f.key for f in (unresolved or [])[:5])
            entries.append(_timeline_entry(
                "resolve",
                status="blocked",
                detail=f"{resolved_n} resolved, {missing_n} missing ({missing_keys})",
            ))
        elif field_status:
            entries.append(_timeline_entry(
                "resolve",
                status="ok",
                detail=f"All {resolved_n} required fields resolved",
            ))

    if plan_steps:
        entries.append(_timeline_entry(
            "plan",
            status="ok",
            detail=f"{len(plan_steps)} browser steps planned",
        ))

    if evidence is not None:
        raw = getattr(evidence, "raw", None) or {}
        step_log = raw.get("step_log") or []
        if step_log:
            ok_n = sum(1 for s in step_log if s.get("status") == "ok")
            err_n = sum(1 for s in step_log if s.get("status") == "error")
            nf_n = sum(1 for s in step_log if s.get("status") == "not_found")
            entries.append(_timeline_entry(
                "submit",
                status="error" if err_n else ("warn" if nf_n else "ok"),
                detail=f"Browser: {ok_n} ok, {nf_n} not found, {err_n} errors"
                         + (" · submit clicked" if evidence.submit_performed else ""),
            ))
        elif evidence.blocked_reason:
            entries.append(_timeline_entry(
                "submit",
                status="blocked",
                detail=f"Blocked: {evidence.blocked_reason}",
            ))
        elif evidence.submit_performed:
            entries.append(_timeline_entry(
                "submit",
                status="ok",
                detail="Submit button clicked",
            ))

        if evidence.submit_performed:
            if evidence.confirmation_text:
                entries.append(_timeline_entry(
                    "verify",
                    status="ok",
                    detail="Provider confirmation detected",
                ))
            elif evidence.validation_errors:
                entries.append(_timeline_entry(
                    "verify",
                    status="error",
                    detail=f"{len(evidence.validation_errors)} validation error(s)",
                ))

    return entries
