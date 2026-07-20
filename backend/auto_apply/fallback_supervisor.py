"""Cheap fallback supervisor for template apply failures.

Template (SmartRecruiters selectors) runs first. Only when reveal/submit hits a
known stuck reason do we ask a small vision model what to try next — then execute
a hard whitelist of safe actions. Never invents field values or clicks Submit.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

ALLOWED_ACTIONS: Set[str] = {
    "reload_oneclick",
    "wait_and_recheck",
    "reclick_apply_cta",
    "dismiss_overlay",
    "skip_offer",
    "abort_retry_session",
    "noop",
}

TRIGGER_REASONS: Set[str] = {
    "oneclick_form_not_loaded",
    "oneclick_nav_timeout",
    "oneclick_blank_shell",
}

_MAX_CALLS_DEFAULT = 2


@dataclass
class FallbackDecision:
    action: str
    issue: str = ""
    confidence: float = 0.0
    source: str = "heuristic"  # heuristic | vision


def fallback_agent_enabled() -> bool:
    return os.environ.get("AUTO_APPLY_FALLBACK_AGENT", "1").strip().lower() not in (
        "0", "false", "no", "off",
    )


def max_fallback_calls() -> int:
    raw = (os.environ.get("AUTO_APPLY_FALLBACK_MAX_CALLS") or "").strip()
    if raw.isdigit():
        return max(0, min(4, int(raw)))
    return _MAX_CALLS_DEFAULT


def _calls_used(evidence: Any) -> int:
    if evidence is None:
        return 0
    raw = evidence.raw if isinstance(getattr(evidence, "raw", None), dict) else {}
    try:
        return int(raw.get("fallback_calls") or 0)
    except (TypeError, ValueError):
        return 0


def _bump_calls(evidence: Any) -> None:
    if evidence is None:
        return
    evidence.raw.setdefault("fallback_calls", 0)
    evidence.raw["fallback_calls"] = int(evidence.raw.get("fallback_calls") or 0) + 1


def _log_decision(evidence: Any, decision: FallbackDecision, *, executed: str = "") -> None:
    if evidence is None:
        return
    evidence.raw.setdefault("fallback_decisions", []).append({
        "action": decision.action,
        "issue": decision.issue[:200],
        "confidence": decision.confidence,
        "source": decision.source,
        "executed": executed or decision.action,
    })
    evidence.raw.setdefault("step_log", []).append({
        "action": "fallback_agent",
        "locator": decision.action,
        "status": "ok" if decision.action != "noop" else "skip",
        "value_preview": decision.issue[:120] or decision.source,
        "error": "",
    })


def heuristic_decide(reason: str, *, url: str = "", body_snip: str = "") -> FallbackDecision:
    """Deterministic fallback when vision is off / unavailable."""
    reason = (reason or "").strip()
    hay = f"{body_snip or ''}".lower()
    url_l = (url or "").lower()

    if "/expired" in url_l or any(
        tok in hay
        for tok in (
            "expir",
            "no longer available",
            "plus disponible",
            "offre pourvue",
            "job ad has expired",
        )
    ):
        return FallbackDecision("skip_offer", issue="offer_looks_expired", confidence=0.85)

    if reason == "oneclick_nav_timeout":
        return FallbackDecision(
            "abort_retry_session",
            issue="oneclick_navigation_timed_out",
            confidence=0.8,
        )

    if reason in {"oneclick_form_not_loaded", "oneclick_blank_shell"}:
        if "oneclick-ui" in url_l:
            return FallbackDecision(
                "reload_oneclick",
                issue="blank_oneclick_shell",
                confidence=0.75,
            )
        return FallbackDecision(
            "reclick_apply_cta",
            issue="not_on_oneclick_after_cta",
            confidence=0.65,
        )

    if any(tok in hay for tok in ("cookie", "consent", "accepter", "paramétrage")):
        return FallbackDecision("dismiss_overlay", issue="cookie_or_consent_overlay", confidence=0.6)

    return FallbackDecision("wait_and_recheck", issue="unknown_stuck", confidence=0.4)


async def vision_decide(
    *,
    reason: str,
    url: str,
    body_snip: str,
    screenshot_b64: str,
    step_tail: Optional[List[Dict[str, Any]]] = None,
) -> Optional[FallbackDecision]:
    """Ask gpt-4.1-mini (vision) for one whitelist action. None if unavailable."""
    if not screenshot_b64 or not os.environ.get("OPENAI_API_KEY"):
        return None
    if os.environ.get("APPLY_VISION_RECOVERY", "1").strip().lower() in ("0", "false", "no"):
        return None
    try:
        from openai import AsyncOpenAI
    except ImportError:
        return None

    allowed = sorted(ALLOWED_ACTIONS)
    payload = {
        "reason": reason,
        "url": url,
        "body_snip": (body_snip or "")[:400],
        "recent_steps": (step_tail or [])[-6:],
        "allowed_actions": allowed,
        "instruction": (
            "You supervise a job-apply bot whose SmartRecruiters template failed. "
            "Look at the screenshot and pick exactly ONE action from allowed_actions. "
            "reload_oneclick: blank header-only form. "
            "wait_and_recheck: still loading/spinner. "
            "reclick_apply_cta: still on job posting. "
            "dismiss_overlay: cookie/modal blocking. "
            "skip_offer: expired/closed job. "
            "abort_retry_session: bot wall / hard fail — new browser session. "
            "noop: nothing useful. "
            "Never invent form answers. Never choose submit. "
            'Return JSON only: {"action":"...","issue":"...","confidence":0.0}'
        ),
    }
    try:
        client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        model = os.environ.get(
            "OPENAI_VISION_MODEL",
            os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
        )
        data_url = f"data:image/jpeg;base64,{screenshot_b64}"
        response = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": json.dumps(payload)},
                        {"type": "image_url", "image_url": {"url": data_url, "detail": "low"}},
                    ],
                }
            ],
            max_completion_tokens=220,
        )
        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return None
        action = str(parsed.get("action") or "").strip()
        if action not in ALLOWED_ACTIONS:
            return None
        try:
            confidence = float(parsed.get("confidence") or 0.5)
        except (TypeError, ValueError):
            confidence = 0.5
        return FallbackDecision(
            action=action,
            issue=str(parsed.get("issue") or "")[:200],
            confidence=max(0.0, min(1.0, confidence)),
            source="vision",
        )
    except Exception as exc:
        logger.info("fallback_vision_unavailable error=%s", str(exc)[:200])
        return None


async def decide_fallback(
    *,
    reason: str,
    url: str = "",
    body_snip: str = "",
    screenshot_b64: str = "",
    step_tail: Optional[List[Dict[str, Any]]] = None,
    prefer_vision: bool = True,
) -> FallbackDecision:
    if prefer_vision and screenshot_b64:
        vision = await vision_decide(
            reason=reason,
            url=url,
            body_snip=body_snip,
            screenshot_b64=screenshot_b64,
            step_tail=step_tail,
        )
        if vision is not None:
            return vision
    return heuristic_decide(reason, url=url, body_snip=body_snip)


async def _body_snip(page: Any) -> str:
    try:
        return (await page.locator("body").inner_text(timeout=2500))[:500]
    except Exception:
        return ""


async def execute_fallback_action(
    page: Any,
    decision: FallbackDecision,
    *,
    driver: Any = None,
    evidence: Any = None,
) -> str:
    """Run one whitelist action. Returns executed action name."""
    action = decision.action if decision.action in ALLOWED_ACTIONS else "noop"

    if action == "noop":
        return "noop"

    if action == "abort_retry_session":
        return "abort_retry_session"

    if action == "skip_offer":
        if evidence is not None:
            evidence.blocked_reason = "offer_expired"
        return "skip_offer"

    if action == "wait_and_recheck":
        try:
            from apply_agent.human_browser import human_pause

            await human_pause(page, 2500, 4500)
        except Exception:
            try:
                await page.wait_for_timeout(3000)
            except Exception:
                pass
        return "wait_and_recheck"

    if action == "dismiss_overlay":
        try:
            from apply_agent.recovery import dismiss_blocking_overlays

            await dismiss_blocking_overlays(page)
        except Exception:
            pass
        return "dismiss_overlay"

    if action == "reload_oneclick":
        if driver is not None and hasattr(driver, "_reload_oneclick_shell"):
            await driver._reload_oneclick_shell(page, evidence)
        else:
            url = page.url or ""
            if "oneclick-ui" in url:
                try:
                    await page.reload(wait_until="commit", timeout=45000)
                except Exception:
                    pass
        return "reload_oneclick"

    if action == "reclick_apply_cta":
        selectors = (
            "#st-apply",
            'a[data-sr-track="apply"]',
            'button:has-text("Je suis intéressé")',
            'a:has-text("Je suis intéressé")',
            'button:has-text("I\'m interested")',
            'a:has-text("I\'m interested")',
        )
        for sel in selectors:
            try:
                loc = page.locator(sel)
                if await loc.count() and await loc.first.is_visible(timeout=800):
                    try:
                        label = await loc.first.inner_text(timeout=1000)
                    except Exception:
                        label = ""
                    if re.search(r"expir|no longer", label or "", re.I):
                        continue
                    await loc.first.click(timeout=3000)
                    try:
                        from apply_agent.human_browser import human_pause

                        await human_pause(page, 800, 1500)
                    except Exception:
                        pass
                    return "reclick_apply_cta"
            except Exception:
                continue
        return "reclick_apply_cta_miss"

    return "noop"


async def run_fallback_supervisor(
    page: Any,
    evidence: Any,
    *,
    reason: str,
    driver: Any = None,
    form_ready_check=None,
) -> bool:
    """Decide + execute up to max calls. Returns True if the form looks ready after.

    ``form_ready_check`` is an optional async callable ``(page) -> bool``.
    """
    if not fallback_agent_enabled():
        return False
    if reason not in TRIGGER_REASONS and not reason.startswith("oneclick_"):
        return False
    if _calls_used(evidence) >= max_fallback_calls():
        logger.info("fallback_supervisor_budget_exhausted reason=%s", reason)
        return False

    from apply_agent.browser import screenshot_b64

    shot = ""
    capture = os.environ.get(
        "AUTO_APPLY_CAPTURE_SCREENSHOTS", "false",
    ).strip().lower() in ("1", "true", "yes", "on")
    if capture:
        try:
            shot = await screenshot_b64(page) or ""
        except Exception:
            shot = ""
    if evidence is not None and shot and not evidence.screenshot_b64:
        evidence.screenshot_b64 = shot

    body = await _body_snip(page)
    step_tail = []
    if evidence is not None:
        step_tail = list((evidence.raw or {}).get("step_log") or [])

    decision = await decide_fallback(
        reason=reason,
        url=getattr(page, "url", "") or "",
        body_snip=body,
        screenshot_b64=shot,
        step_tail=step_tail,
    )
    _bump_calls(evidence)
    executed = await execute_fallback_action(
        page, decision, driver=driver, evidence=evidence,
    )
    _log_decision(evidence, decision, executed=executed)
    logger.info(
        "fallback_supervisor reason=%s action=%s executed=%s source=%s issue=%s",
        reason,
        decision.action,
        executed,
        decision.source,
        decision.issue[:120],
    )

    if executed in {"skip_offer", "abort_retry_session", "noop"}:
        return False

    # Optional second cheap step: wait after reload/dismiss before recheck.
    if executed in {"reload_oneclick", "dismiss_overlay", "reclick_apply_cta", "reclick_apply_cta_miss"}:
        try:
            from apply_agent.human_browser import human_pause

            await human_pause(page, 800, 1600)
        except Exception:
            pass

    if form_ready_check is not None:
        try:
            if await form_ready_check(page):
                if evidence is not None and evidence.blocked_reason in TRIGGER_REASONS:
                    evidence.blocked_reason = None
                if evidence is not None:
                    evidence.raw.setdefault("step_log", []).append({
                        "action": "fallback_agent",
                        "locator": executed,
                        "status": "ok",
                        "value_preview": "recovered_form_ready",
                        "error": "",
                    })
                return True
        except Exception as exc:
            logger.info("fallback_form_ready_check_failed error=%s", str(exc)[:160])
            return False

    # Default: oneclick field probe
    try:
        n = await page.locator(
            "#first-name-input >> input, #first-name-input, #email-input >> input"
        ).count()
        if n >= 1:
            if evidence is not None:
                evidence.blocked_reason = None
            return True
    except Exception:
        pass
    return False
