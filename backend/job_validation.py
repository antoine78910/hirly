"""Cheap, non-browser job applyability validation."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

from job_providers.apply_eligibility import classify_apply_link
from job_providers.ats_detection import PRIMARY_AUTO_APPLY_ATS, detect_job_platform


def cheap_validate_job_applyability(job: Dict[str, Any]) -> Dict[str, Any]:
    """Classify a job using only stored payload fields and URL/domain rules."""
    try:
        return _cheap_validate_job_applyability(job)
    except Exception as exc:
        now = datetime.now(timezone.utc).isoformat()
        return {
            "validation_status": "unknown",
            "validation_reason": f"Validator failed: {exc.__class__.__name__}",
            "validation_checked_at": now,
            "ats_provider": job.get("ats_provider") or "unknown",
            "auto_apply_supported": bool(job.get("auto_apply_supported")),
            "manual_fulfillment_ready": False,
            "apply_fulfillment_status": "validation_unknown",
            "apply_url_provider": job.get("apply_url_provider") or "unknown",
            "selected_apply_url": _selected_apply_url(job),
            "requires_login": False,
            "requires_account_creation": False,
            "captcha_detected": False,
            "has_cv_upload": job.get("has_cv_upload"),
            "has_cover_letter": job.get("has_cover_letter"),
            "has_custom_questions": job.get("has_custom_questions"),
            "applyability_score": 0.45,
            "applyability_tier": "C",
            "rejection_reason": None,
        }


def _cheap_validate_job_applyability(job: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    classification = classify_apply_link(
        job.get("selected_apply_url") or job.get("external_url") or job.get("apply_url") or job.get("hosted_url"),
        source=job.get("source") or job.get("provider"),
        apply_options=job.get("apply_options") or [],
    )
    selected_url = classification.get("selected_apply_url") or _selected_apply_url(job)
    platform = detect_job_platform(selected_url)
    ats_provider = platform.get("ats_provider") or job.get("ats_provider") or "unknown"
    provider = platform.get("provider") or classification.get("apply_url_provider") or "unknown"
    expired = _looks_expired(job)
    captcha_detected = _has_signal(job, ("captcha", "recaptcha", "hcaptcha", "bot protection"))

    if not selected_url:
        return _result(
            now=now,
            status="invalid",
            reason="No apply URL is available.",
            tier="E",
            score=0.02,
            selected_url=None,
            provider="unknown",
            ats_provider=ats_provider,
            apply_status="blocked_missing_apply_url",
            requires_login=False,
            requires_account_creation=False,
            captcha_detected=False,
            rejection_reason="missing_apply_url",
        )

    if expired:
        return _result(
            now=now,
            status="invalid",
            reason="Job appears expired or closed.",
            tier="E",
            score=0.05,
            selected_url=selected_url,
            provider=provider,
            ats_provider=ats_provider,
            apply_status="blocked_expired",
            requires_login=bool(platform.get("requires_login")),
            requires_account_creation=bool(platform.get("requires_account_creation")),
            captcha_detected=captcha_detected,
            rejection_reason="expired_or_closed",
        )

    if captcha_detected:
        return _result(
            now=now,
            status="invalid",
            reason="Job payload contains CAPTCHA or bot-protection signals.",
            tier="E",
            score=0.03,
            selected_url=selected_url,
            provider=provider,
            ats_provider=ats_provider,
            apply_status="blocked_captcha",
            requires_login=bool(platform.get("requires_login")),
            requires_account_creation=bool(platform.get("requires_account_creation")),
            captcha_detected=True,
            rejection_reason="captcha_or_bot_protection",
        )

    if platform.get("category") == "account_required":
        return _result(
            now=now,
            status="invalid",
            reason=f"{provider} usually requires a candidate account or login.",
            tier="D",
            score=0.2,
            selected_url=selected_url,
            provider=provider,
            ats_provider=ats_provider,
            apply_status="blocked_user_account_required",
            requires_login=True,
            requires_account_creation=True,
            captcha_detected=False,
            rejection_reason="login_or_account_required",
        )

    if platform.get("category") == "discovery_only":
        return _result(
            now=now,
            status="invalid",
            reason=f"{provider} is a discovery or aggregator destination, not a direct apply form.",
            tier="D",
            score=0.25,
            selected_url=selected_url,
            provider=provider,
            ats_provider=ats_provider,
            apply_status="discovery_only",
            requires_login=False,
            requires_account_creation=False,
            captcha_detected=False,
            rejection_reason="discovery_only",
        )

    if platform.get("category") == "direct_ats":
        tier = "A" if ats_provider in PRIMARY_AUTO_APPLY_ATS else "B"
        score = 0.92 if tier == "A" else 0.78
        return _result(
            now=now,
            status="valid",
            reason=f"Direct public application URL detected via {ats_provider}.",
            tier=tier,
            score=score,
            selected_url=selected_url,
            provider=provider,
            ats_provider=ats_provider,
            apply_status="manual_ready",
            requires_login=False,
            requires_account_creation=False,
            captcha_detected=False,
            rejection_reason=None,
            auto_apply_supported=ats_provider in PRIMARY_AUTO_APPLY_ATS,
        )

    return _result(
        now=now,
        status="unknown",
        reason="Company career URL is not clearly blocked, but needs later browser validation.",
        tier="C",
        score=0.55,
        selected_url=selected_url,
        provider=provider,
        ats_provider=ats_provider,
        apply_status="needs_validation",
        requires_login=False,
        requires_account_creation=False,
        captcha_detected=False,
        rejection_reason=None,
        manual_ready=True,
    )


def _result(
    *,
    now: str,
    status: str,
    reason: str,
    tier: str,
    score: float,
    selected_url: Optional[str],
    provider: str,
    ats_provider: Optional[str],
    apply_status: str,
    requires_login: bool,
    requires_account_creation: bool,
    captcha_detected: bool,
    rejection_reason: Optional[str],
    auto_apply_supported: bool = False,
    manual_ready: Optional[bool] = None,
) -> Dict[str, Any]:
    is_manual_ready = apply_status == "manual_ready" if manual_ready is None else manual_ready
    return {
        "validation_status": status,
        "validation_reason": reason,
        "validation_checked_at": now,
        "ats_provider": ats_provider or "unknown",
        "auto_apply_supported": bool(auto_apply_supported),
        "manual_fulfillment_ready": bool(is_manual_ready),
        "apply_fulfillment_status": apply_status,
        "apply_url_provider": provider,
        "selected_apply_url": selected_url,
        "requires_login": bool(requires_login),
        "requires_account_creation": bool(requires_account_creation),
        "captcha_detected": bool(captcha_detected),
        "has_cv_upload": None,
        "has_cover_letter": None,
        "has_custom_questions": None,
        "applyability_score": score,
        "applyability_tier": tier,
        "rejection_reason": rejection_reason,
        "job_board_account_required": bool(requires_login or requires_account_creation),
    }


def _selected_apply_url(job: Dict[str, Any]) -> Optional[str]:
    if job.get("selected_apply_url"):
        return str(job.get("selected_apply_url"))
    for key in ("external_url", "apply_url", "hosted_url", "job_apply_link"):
        if job.get(key):
            return str(job.get(key))
    for option in job.get("apply_options") or []:
        if isinstance(option, dict):
            url = option.get("apply_link") or option.get("link") or option.get("url")
            if url:
                return str(url)
    return None


def _looks_expired(job: Dict[str, Any]) -> bool:
    status = str(job.get("status") or job.get("job_status") or "").lower()
    if status in {"expired", "closed", "inactive", "archived"}:
        return True
    text = " ".join(
        str(job.get(key) or "")
        for key in ("title", "description", "external_url", "apply_fulfillment_reason", "validation_reason")
    ).lower()
    return any(
        marker in text
        for marker in (
            "job expired",
            "position expired",
            "job closed",
            "position closed",
            "no longer accepting applications",
            "this job is no longer available",
        )
    )


def _has_signal(job: Dict[str, Any], markers: Iterable[str]) -> bool:
    text = " ".join(str(job.get(key) or "") for key in ("description", "external_url", "selected_apply_url")).lower()
    return any(marker in text for marker in markers)
