"""Apply-link eligibility for jobs shown in the swipe feed."""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

from .ats_detection import (
    ATS_DOMAINS,
    DISCOVERY_ONLY_DOMAINS,
    LOGIN_REQUIRED_DOMAINS,
    detect_job_platform,
)

DIRECT_ATS_DOMAINS = ATS_DOMAINS
ACCOUNT_REQUIRED_DOMAINS = LOGIN_REQUIRED_DOMAINS


def classify_apply_link(
    external_url: Optional[str],
    *,
    source: Optional[str] = None,
    apply_options: Optional[Iterable[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Select the best apply URL and classify whether admins can fulfill it."""

    candidates = _candidate_urls(external_url, apply_options)
    if not candidates:
        return _result(
            status="blocked_missing_apply_url",
            reason="No apply URL was provided by the job source.",
            selected_url=None,
            selected_source=source,
            provider="unknown",
        )

    direct = [item for item in candidates if _direct_provider(item["url"])]
    if direct:
        selected = direct[0]
        provider = _direct_provider(selected["url"]) or "company"
        return _result(
            status="manual_ready",
            reason=f"Direct apply URL available via {provider}.",
            selected_url=selected["url"],
            selected_source=selected.get("source") or source,
            provider=provider,
        )

    neutral = [item for item in candidates if not _blocked_provider(item["url"], source=item.get("source") or source)]
    if neutral:
        selected = neutral[0]
        return _result(
            status="manual_ready",
            reason="Direct company apply URL available.",
            selected_url=selected["url"],
            selected_source=selected.get("source") or source,
            provider="company",
        )

    selected = candidates[0]
    blocked_provider = _blocked_provider(selected["url"], source=selected.get("source") or source) or "third_party"
    status = (
        "blocked_user_account_required"
        if blocked_provider in ACCOUNT_REQUIRED_DOMAINS.values()
        else "discovery_only"
    )
    return _result(
        status=status,
        reason=f"{blocked_provider} is not a direct apply destination.",
        selected_url=selected["url"],
        selected_source=selected.get("source") or source,
        provider=blocked_provider,
    )


def is_manual_fulfillment_ready(job: Dict[str, Any]) -> bool:
    """Return True only when a job can be fulfilled by Hirly/admins."""

    validation_status = str(job.get("validation_status") or "").strip().lower()
    applyability_tier = str(job.get("applyability_tier") or "").strip().upper()
    if validation_status == "invalid" or applyability_tier in {"D", "E"}:
        return False
    stored = job.get("manual_fulfillment_ready")
    if stored is not None:
        return bool(stored)
    status = str(job.get("apply_fulfillment_status") or "").strip().lower()
    if status:
        return status == "manual_ready"
    classification = classify_apply_link(
        job.get("external_url") or job.get("apply_url") or job.get("hosted_url"),
        source=job.get("source") or job.get("provider"),
        apply_options=job.get("apply_options") or [],
    )
    return bool(classification.get("manual_fulfillment_ready"))


def _candidate_urls(
    external_url: Optional[str],
    apply_options: Optional[Iterable[Dict[str, Any]]],
) -> List[Dict[str, Optional[str]]]:
    candidates: List[Dict[str, Optional[str]]] = []
    if external_url:
        candidates.append({"url": str(external_url), "source": None})
    for option in apply_options or []:
        if not isinstance(option, dict):
            continue
        url = option.get("apply_link") or option.get("link") or option.get("url")
        if not url:
            continue
        candidates.append({"url": str(url), "source": option.get("publisher") or option.get("source")})
    seen = set()
    deduped: List[Dict[str, Optional[str]]] = []
    for item in candidates:
        key = (item.get("url") or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _direct_provider(url: str) -> Optional[str]:
    platform = detect_job_platform(url)
    return platform.get("provider") if platform.get("category") == "direct_ats" else None


def _blocked_provider(url: str, *, source: Optional[str] = None) -> Optional[str]:
    platform = detect_job_platform(url)
    if platform.get("category") in {"account_required", "discovery_only"}:
        return str(platform.get("provider") or "third_party")
    text = (source or "").lower()
    for provider in {**ACCOUNT_REQUIRED_DOMAINS, **DISCOVERY_ONLY_DOMAINS}.values():
        if provider in text:
            return provider
    return None


def _result(
    *,
    status: str,
    reason: str,
    selected_url: Optional[str],
    selected_source: Optional[str],
    provider: str,
) -> Dict[str, Any]:
    return {
        "apply_fulfillment_status": status,
        "apply_fulfillment_reason": reason,
        "apply_url_source": selected_source,
        "apply_url_provider": provider,
        "selected_apply_url": selected_url,
        "manual_fulfillment_ready": status == "manual_ready",
        "job_board_account_required": status == "blocked_user_account_required",
    }
