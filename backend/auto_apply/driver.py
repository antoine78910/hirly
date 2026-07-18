"""ApplyDriver contract + BrowserApplyDriver base + driver registry.

The pipeline talks ONLY to ApplyDriver. It is mechanism-agnostic: a driver may
be Browser-, Email- or API-based and the executor can never tell the difference
-- it only touches `provider`, `version`, `inspect_application`, `submit`.

Browser-based ATS drivers extend BrowserApplyDriver, which executes a normalized
ApplicationPlan deterministically using shared apply_agent primitives. There is
NO provider-specific logic here -- every locator comes from the plan, and the
primary locator is authoritative (fallbacks are tried only when the primary
matches nothing, i.e. DOM drift).
"""
from __future__ import annotations

import logging
import os
import random
import time
import asyncio
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from apply_agent.blockers import (
    captcha_active, collect_post_submit_errors, confirmation_text_found,
    detect_bot_wall, detect_captcha, detect_login_wall, detect_offer_expired,
    dismiss_cookie_banner,
)
from apply_agent.browser import (
    browser_navigation_timeout_ms,
    is_proxy_connect_failure_status,
    is_proxy_connect_failure_text,
    is_transient_navigation_error,
    launch_page,
    proxy_configured,
    screenshot_b64,
    warm_session_configured,
)
from apply_agent.guardrails import canonical
from apply_agent.human_browser import (
    human_check, human_click, human_mouse_wander, human_pause, human_scroll,
    human_select, human_type, human_upload, try_pass_datadome_slider,
)
from apply_agent.models import ApplyAgentError
from apply_agent.recovery import recover_stuck_page

from .models import SubmissionContext, SubmissionEvidence

logger = logging.getLogger(__name__)

_TIMEOUT_MS = 45000
_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"], button:has-text("Submit")'


def driver_submit_deadline_s() -> float:
    """Wall-clock budget for browser submit + proxy SID retries."""
    raw = os.environ.get("AUTO_APPLY_DRIVER_DEADLINE_S", "").strip()
    if raw and raw.replace(".", "", 1).isdigit():
        return max(60.0, float(raw))
    return 180.0


async def _goto_apply_page(page: Any, nav_url: str):
    """Navigate with proxy-friendly waits (commit first, then DOM)."""
    timeout_ms = browser_navigation_timeout_ms()
    resp = await page.goto(nav_url, wait_until="commit", timeout=timeout_ms)
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=min(45000, timeout_ms))
    except Exception:
        # Some ATS shells stay busy; commit + partial DOM can still be enough.
        pass
    return resp


async def _wait_for_meaningful_body(page: Any, *, timeout_ms: int = 12000) -> str:
    """Wait until the body has real copy (avoids racing empty DataDome shells)."""
    deadline = timeout_ms
    elapsed = 0
    step = 500
    text = ""
    while elapsed <= deadline:
        try:
            text = await page.locator("body").inner_text(timeout=2000)
        except Exception:
            text = ""
        if text and len(text.strip()) >= 20:
            return text
        await page.wait_for_timeout(step)
        elapsed += step
    return text


class ApplyDriver(ABC):
    """The single, mechanism-agnostic contract every ATS implements."""

    provider: str
    version: str = "unknown"  # concrete drivers override; executor persists it

    @abstractmethod
    def can_handle(self, job: Dict[str, Any]) -> bool: ...

    @abstractmethod
    async def inspect_application(self, job: Dict[str, Any]): ...

    @abstractmethod
    async def submit(self, ctx: SubmissionContext) -> SubmissionEvidence: ...


class BrowserApplyDriver(ApplyDriver):
    """Reusable browser lifecycle + plan execution. Contains no ATS-specific
    logic. Subclasses provide application_url(job) and inspect_application(job),
    and may override reveal_form(page) with a fixed-selector click."""

    @abstractmethod
    def application_url(self, job: Dict[str, Any]) -> str: ...

    def navigation_url(self, job: Dict[str, Any]) -> str:
        """First page to open in the browser. Subclasses may use a posting page
        before the apply form (e.g. SmartRecruiters job page -> Apply CTA)."""
        return self.application_url(job)

    async def after_navigation(self, page: Any, evidence: SubmissionEvidence) -> None:
        """Hook after the first page load and cookie dismissal."""
        await human_pause(page, 1800, 3800)
        await human_mouse_wander(page)
        await human_scroll(page)
        await human_pause(page, 600, 1400)
        await human_mouse_wander(page)

    async def reveal_form(self, page: Any, evidence: Optional[SubmissionEvidence] = None) -> None:
        """Optional fixed-selector click to reveal a form behind an Apply CTA.
        Default: nothing. Subclasses override with a deterministic selector."""
        return None

    async def _raise_if_proxy_connect_failure(
        self,
        page: Any,
        evidence: SubmissionEvidence,
        *,
        target_url: str,
        http_status: Optional[int] = None,
        stage: str = "navigate",
    ) -> None:
        """Abort+retry when PrivateProxy serves HTTP 572 / Failed to connect page."""
        body_preview = ""
        try:
            body_preview = await page.locator("body").inner_text(timeout=3000)
        except Exception:
            body_preview = ""
        if not (
            is_proxy_connect_failure_status(http_status)
            or is_proxy_connect_failure_text(body_preview)
        ):
            return
        evidence.screenshot_b64 = await screenshot_b64(page)
        detail = (
            f"Proxy could not reach target host "
            f"(HTTP {http_status or 'page'})."
        )
        await self._log_step(
            evidence,
            action=stage,
            locators=[target_url],
            status="error",
            value_preview=(target_url or "")[:100],
            error=detail[:200],
        )
        raise ApplyAgentError(
            "open_page",
            detail,
            target_url=target_url,
            exception_class="ProxyConnectFailure",
        )

    async def _wait_for_manual_captcha_clear(self, page: Any, *, timeout_ms: int = 180_000) -> bool:
        """Headed runs: give the operator time to solve DataDome in the real Chrome window."""
        deadline = time.monotonic() + (timeout_ms / 1000.0)
        while time.monotonic() < deadline:
            if not captcha_active(await detect_captcha(page)):
                return True
            try:
                await page.wait_for_timeout(2000)
            except Exception:
                await asyncio.sleep(2)
        return not captcha_active(await detect_captcha(page))

    async def _abort_if_blocked(
        self,
        page: Any,
        evidence: SubmissionEvidence,
        *,
        http_status: Optional[int] = None,
        stage: str = "bot_wall",
        allow_manual_captcha: bool = False,
    ) -> bool:
        """Return True when the run should stop (bot wall / login / captcha)."""
        if await detect_offer_expired(page):
            evidence.blocked_reason = "offer_expired"
            evidence.screenshot_b64 = await screenshot_b64(page)
            await self._log_step(
                evidence,
                action="offer_expired",
                locators=["body"],
                status="blocked",
                error="expired_cta_or_copy",
            )
            return True
        if await detect_login_wall(page):
            evidence.blocked_reason = "login_wall"
            evidence.screenshot_b64 = await screenshot_b64(page)
            await self._log_step(evidence, action="login_wall", locators=["body"], status="blocked")
            return True

        # DataDome shows FR "Accès temporairement restreint" + a slider. That
        # copy used to trip bot_wall and close the browser before we dragged.
        captcha_dbg = await detect_captcha(page)
        wall_hit = await detect_bot_wall(page, http_status=http_status)
        if captcha_active(captcha_dbg) or wall_hit:
            wait_ms = 15000 if captcha_active(captcha_dbg) else 6000
            await self._log_step(
                evidence,
                action="datadome_slider_attempt",
                locators=["iframe[src*=captcha-delivery]"],
                status="retry",
                value_preview=f"wait_frame_ms={wait_ms}",
            )
            try:
                passed = await try_pass_datadome_slider(
                    page, attempts=4, wait_for_frame_ms=wait_ms,
                )
            except Exception as exc:
                passed = False
                await self._log_step(
                    evidence,
                    action="datadome_slider_attempt",
                    locators=["body"],
                    status="error",
                    error=str(exc)[:200],
                )
            # Re-check from DOM only — navigation may still be HTTP 403.
            captcha_dbg = await detect_captcha(page)
            wall_hit = await detect_bot_wall(page, http_status=None)
            if passed or (not captcha_active(captcha_dbg) and not wall_hit):
                await self._log_step(
                    evidence,
                    action="captcha",
                    locators=["body"],
                    status="ok",
                    value_preview="datadome_slider_passed",
                )
                return False
            # Only wait for a human when the slider/captcha UI is still up —
            # a hard bot wall without challenge must abort immediately.
            if allow_manual_captcha and captcha_active(captcha_dbg):
                await self._log_step(
                    evidence,
                    action="captcha_wait_manual",
                    locators=["body"],
                    status="retry",
                    value_preview="Solve the captcha in the Chrome window (up to 3 min)",
                )
                if await self._wait_for_manual_captcha_clear(page, timeout_ms=180_000):
                    await self._log_step(
                        evidence, action="captcha", locators=["body"], status="ok",
                        value_preview="manual_solve",
                    )
                    return False
            evidence.blocked_reason = (
                "captcha" if captcha_active(captcha_dbg) else "bot_protection"
            )
            evidence.screenshot_b64 = await screenshot_b64(page)
            await self._log_step(
                evidence,
                action="captcha" if evidence.blocked_reason == "captcha" else stage,
                locators=["body"],
                status="blocked",
                error=f"HTTP {http_status or 'page'}",
            )
            return True
        return False

    async def submit(self, ctx: SubmissionContext) -> SubmissionEvidence:
        url = self.application_url(ctx.job)
        nav_url = self.navigation_url(ctx.job)
        evidence = SubmissionEvidence(raw={"application_url": url, "navigation_url": nav_url})
        # Residential proxies often hand out dead exits — relaunch with a fresh
        # sticky sid, then one direct (no-proxy) attempt. Cap wall-clock so a
        # string of dead exits cannot burn minutes before the admin console
        # surfaces a real error.
        max_attempts = 3
        deadline_at = time.monotonic() + driver_submit_deadline_s()
        last_open_page_error: Optional[ApplyAgentError] = None
        last_evidence = evidence
        force_new_proxy_sid = False
        disable_proxy = False
        allow_direct = os.environ.get("AUTO_APPLY_ALLOW_DIRECT", "1").strip().lower() not in (
            "0", "false", "no",
        )
        for attempt in range(1, max_attempts + 1):
            if time.monotonic() >= deadline_at and attempt > 1:
                raise ApplyAgentError(
                    "open_page",
                    (
                        f"Proxy/browser retries exceeded {int(driver_submit_deadline_s())}s budget "
                        f"after {attempt - 1} attempt(s). Check BROWSER_PROXY / sticky SID."
                    ),
                    target_url=nav_url,
                    exception_class="DriverDeadlineExceeded",
                )
            try:
                last_evidence = await self._submit_browser_session(
                    ctx,
                    evidence,
                    url=url,
                    nav_url=nav_url,
                    attempt=attempt,
                    max_attempts=max_attempts,
                    force_new_proxy_sid=force_new_proxy_sid,
                    disable_proxy=disable_proxy,
                )
            except ApplyAgentError as exc:
                last_open_page_error = exc
                would_retry = (
                    exc.phase == "open_page"
                    and attempt < max_attempts
                    and is_transient_navigation_error(exc)
                )
                if would_retry and time.monotonic() >= deadline_at:
                    raise ApplyAgentError(
                        "open_page",
                        (
                            f"Proxy/browser retries exceeded {int(driver_submit_deadline_s())}s budget "
                            f"after {attempt} attempt(s). Check BROWSER_PROXY / sticky SID."
                        ),
                        target_url=nav_url,
                        exception_class="DriverDeadlineExceeded",
                    ) from exc
                if not would_retry:
                    raise
                # Last retry: drop the residential proxy ONLY when we have no
                # warm cookies — storage state is IP-bound to the sticky exit.
                next_is_last = attempt + 1 >= max_attempts
                warm = warm_session_configured()
                fixed_sticky = bool(os.environ.get("BROWSER_PROXY_STICKY_SID", "").strip().isdigit())
                if (
                    next_is_last
                    and allow_direct
                    and proxy_configured()
                    and not disable_proxy
                    and not warm
                ):
                    disable_proxy = True
                    force_new_proxy_sid = False
                    retry_label = "direct_no_proxy"
                elif warm and fixed_sticky:
                    # Keep the capture IP — rotating SID invalidates DataDome cookies.
                    force_new_proxy_sid = False
                    disable_proxy = False
                    retry_label = "same_sticky_sid"
                else:
                    # Dead residential exit (HTTP 572 etc.) — mint a fresh sticky sid.
                    force_new_proxy_sid = True
                    disable_proxy = False
                    retry_label = "new_proxy_sid"
                await self._log_step(
                    evidence,
                    action="navigate_retry",
                    locators=[nav_url],
                    status="retry",
                    error=f"attempt {attempt}/{max_attempts}: {str(exc)[:160]} → {retry_label}",
                )
                logger.warning(
                    "apply_nav_retry provider=%s attempt=%s/%s next=%s error=%s",
                    self.provider,
                    attempt,
                    max_attempts,
                    retry_label,
                    str(exc)[:200],
                )
                continue

            # JS/ad-blocker interstitial is usually a bad residential exit —
            # mint a new sticky sid and try again before failing the run.
            # Skip when STICKY_SID is fixed (warm cookie sessions must keep one IP).
            fixed_sticky = bool(os.environ.get("BROWSER_PROXY_STICKY_SID", "").strip().isdigit())
            warm = warm_session_configured()
            retry_blockers = {"bot_protection", "captcha"}
            if (
                last_evidence.blocked_reason in retry_blockers
                and attempt < max_attempts
                and (proxy_configured() or last_evidence.blocked_reason == "captcha")
                and not (fixed_sticky and last_evidence.blocked_reason == "bot_protection" and warm)
                and time.monotonic() < deadline_at
                and not disable_proxy
            ):
                next_is_last = attempt + 1 >= max_attempts
                if next_is_last and allow_direct and proxy_configured() and not warm:
                    disable_proxy = True
                    force_new_proxy_sid = False
                    retry_label = "direct_no_proxy"
                elif warm and fixed_sticky:
                    force_new_proxy_sid = False
                    retry_label = "same_sticky_sid"
                else:
                    force_new_proxy_sid = True
                    retry_label = "new_proxy_sid"
                await self._log_step(
                    evidence,
                    action="bot_wall_retry",
                    locators=[nav_url],
                    status="retry",
                    error=(
                        f"attempt {attempt}/{max_attempts}: "
                        f"{last_evidence.blocked_reason} → {retry_label}"
                    ),
                )
                logger.warning(
                    "apply_bot_wall_retry provider=%s attempt=%s/%s next=%s reason=%s",
                    self.provider,
                    attempt,
                    max_attempts,
                    retry_label,
                    last_evidence.blocked_reason,
                )
                # Clear so the next attempt can set a fresh blocked_reason.
                evidence.blocked_reason = None
                continue
            return last_evidence
        if last_open_page_error:
            raise last_open_page_error
        return last_evidence

    def prefer_remote_browser(self) -> bool:
        """Opt into Bright Data / remote anti-detect browser when configured.

        SmartRecruiters overrides this; Greenhouse stays on local Chromium.
        """
        return False

    async def _submit_browser_session(
        self,
        ctx: SubmissionContext,
        evidence: SubmissionEvidence,
        *,
        url: str,
        nav_url: str,
        attempt: int,
        max_attempts: int,
        force_new_proxy_sid: bool = False,
        disable_proxy: bool = False,
    ) -> SubmissionEvidence:
        prefer_remote = self.prefer_remote_browser()
        if prefer_remote:
            evidence.raw["browser_transport"] = "remote_preferred"
        try:
            async with launch_page(
                headless=ctx.headless,
                force_new_proxy_sid=force_new_proxy_sid,
                disable_proxy=disable_proxy,
                prefer_remote=prefer_remote,
            ) as page:
                await self._log_step(
                    evidence,
                    action="open_browser",
                    locators=["chromium"],
                    status="ok",
                    value_preview=(
                        f"{'headless' if ctx.headless else 'visible'}"
                        f"{f' · try {attempt}/{max_attempts}' if max_attempts > 1 else ''}"
                        f"{' · new_proxy_sid' if force_new_proxy_sid else ''}"
                        f"{' · direct_no_proxy' if disable_proxy else ''}"
                    ),
                )
                http_status = None
                try:
                    resp = await _goto_apply_page(page, nav_url)
                    http_status = None if resp is None else resp.status
                    evidence.network_ok = None if resp is None else resp.status < 400
                    if evidence.network_ok is False:
                        await self._log_step(
                            evidence, action="navigate", locators=[nav_url], status="error",
                            value_preview=nav_url[:100], error=f"HTTP {http_status}",
                        )
                    else:
                        await self._log_step(
                            evidence, action="navigate", locators=[nav_url], status="ok",
                            value_preview=nav_url[:100],
                        )
                except Exception as exc:
                    await self._log_step(
                        evidence, action="navigate", locators=[nav_url], status="error",
                        value_preview=nav_url[:100], error=str(exc)[:200],
                    )
                    raise ApplyAgentError(
                        "open_page",
                        f"Failed to load apply page: {exc.__class__.__name__}: {str(exc)[:300]}",
                        target_url=nav_url,
                        exception_class=exc.__class__.__name__,
                    ) from exc

                # Proxy gateway failures (PrivateProxy HTTP 572 + "Failed to connect
                # to target host") still yield a Response — abort+retry instead of
                # filling fields on the error page.
                await self._raise_if_proxy_connect_failure(
                    page,
                    evidence,
                    target_url=nav_url,
                    http_status=http_status,
                    stage="navigate",
                )

                try:
                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                except Exception:
                    pass
                await dismiss_cookie_banner(page)
                await _wait_for_meaningful_body(page, timeout_ms=6000)
                await human_pause(page, 300, 700)

                if await self._abort_if_blocked(
                    page,
                    evidence,
                    http_status=http_status,
                    stage="bot_wall",
                    # Bright Data solves captchas server-side — never block 3 min for a human.
                    allow_manual_captcha=(not ctx.headless) and not prefer_remote,
                ):
                    # Still capture a recovery screenshot for debugging popups / walls.
                    try:
                        recovery = await recover_stuck_page(page, reason="bot_wall", use_vision=False)
                        evidence.raw["recovery_on_abort"] = {
                            k: recovery.get(k) for k in ("actions", "stuck")
                        }
                        if recovery.get("screenshot_b64"):
                            evidence.screenshot_b64 = recovery["screenshot_b64"]
                    except Exception:
                        pass
                    return evidence

                await self.after_navigation(page, evidence)
                await self.reveal_form(page, evidence)
                await human_pause(page, 400, 900)
                try:
                    # networkidle often stalls 10–15s on SR analytics; DOM ready is enough.
                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                except Exception:
                    pass
                await dismiss_cookie_banner(page)
                await _wait_for_meaningful_body(page, timeout_ms=6000)

                # Apply CTA / oneclick can hit a dead exit even when the posting
                # page loaded — retry with a fresh sticky sid instead of filling.
                await self._raise_if_proxy_connect_failure(
                    page,
                    evidence,
                    target_url=page.url or url or nav_url,
                    stage="reveal_form_proxy",
                )

                from apply_agent.remote_browser import should_use_remote_browser

                remote_session = bool(prefer_remote) and should_use_remote_browser(
                    prefer_remote=True,
                )

                # SmartRecruiters (and similar) often serve the bot wall only
                # after the Apply CTA navigates to oneclick-ui — re-check here.
                if await self._abort_if_blocked(
                    page,
                    evidence,
                    stage="bot_wall_after_reveal",
                    # Bright Data solves captchas server-side — never block 3 min for a human.
                    allow_manual_captcha=(not ctx.headless) and not prefer_remote,
                ):
                    return evidence

                starting_url = page.url

                for step in ctx.plan.steps:
                    if step.action == "submit":
                        # Read the form once more before submitting.
                        await dismiss_cookie_banner(page)
                        # Vision pre-submit is slow (OpenAI round-trip); skip on Bright Data.
                        recovery = await recover_stuck_page(
                            page, reason="pre_submit", use_vision=not remote_session,
                        )
                        evidence.raw.setdefault("recovery", []).append(
                            {k: recovery.get(k) for k in ("reason", "actions", "notes", "stuck")}
                        )
                        if recovery.get("screenshot_b64"):
                            evidence.screenshot_b64 = recovery["screenshot_b64"]
                        if not remote_session:
                            await human_scroll(page, direction="up")
                            await human_mouse_wander(page)
                        await human_pause(page, 300, 700)
                        await dismiss_cookie_banner(page)
                        await self._click_submit(page, evidence)
                        continue
                    try:
                        await self._apply_step(page, step, ctx.documents, evidence)
                    except Exception as step_exc:
                        # Click intercepted by modal / overlay — screenshot and recover.
                        recovery = await recover_stuck_page(
                            page,
                            reason="click_intercepted",
                            use_vision=not remote_session,
                        )
                        evidence.raw.setdefault("recovery", []).append(
                            {
                                "reason": "click_intercepted",
                                "error": str(step_exc)[:200],
                                "actions": recovery.get("actions"),
                                "notes": recovery.get("notes"),
                                "stuck": recovery.get("stuck"),
                            }
                        )
                        if recovery.get("screenshot_b64"):
                            evidence.screenshot_b64 = recovery["screenshot_b64"]
                        try:
                            await self._apply_step(page, step, ctx.documents, evidence)
                        except Exception as retry_exc:
                            await self._log_step(
                                evidence,
                                action=step.action,
                                locators=step.locators,
                                status="error",
                                value_preview=str(step.value or "")[:80],
                                error=str(retry_exc)[:200],
                            )
                    # Between fields: short pause. Skip wander/scroll on Bright Data.
                    if remote_session:
                        await human_pause(page, 120, 320)
                    else:
                        await human_pause(page, 900, 2200)
                        if random.random() < 0.45:
                            await human_scroll(page)
                        if random.random() < 0.35:
                            await human_mouse_wander(page)

                await self._gather_evidence(page, evidence, starting_url)
                # Retry once when the application form is clearly still open
                # (false "Envoyer gone" / consent toggle / dead click).
                form_still_open = bool((evidence.raw or {}).get("form_still_open"))
                submit_looks_done = bool(evidence.confirmation_text) or (
                    evidence.submit_control_gone is True and not form_still_open
                )
                if evidence.submit_performed and not submit_looks_done and (
                    form_still_open or evidence.validation_errors
                ):
                    stuck_check = await recover_stuck_page(
                        page,
                        reason="submit_validation",
                        use_vision=not remote_session,
                    )
                    evidence.raw.setdefault("recovery", []).append(
                        {k: stuck_check.get(k) for k in ("reason", "actions", "notes", "stuck", "stuck_after")}
                    )
                    if stuck_check.get("screenshot_b64"):
                        evidence.screenshot_b64 = stuck_check["screenshot_b64"]
                    empty = (stuck_check.get("stuck_after") or stuck_check.get("stuck") or {}).get(
                        "required_empty"
                    ) or []
                    if empty:
                        evidence.raw["required_empty_after_submit"] = empty[:12]
                        await self._log_step(
                            evidence,
                            action="recovery_refill_needed",
                            locators=empty[:5],
                            status="blocked",
                            error="required_fields_empty",
                        )
                    else:
                        await self._click_submit(page, evidence)
                        await self._gather_evidence(page, evidence, starting_url)
                if not evidence.screenshot_b64:
                    evidence.screenshot_b64 = await screenshot_b64(page)
        except ApplyAgentError:
            raise
        except Exception as exc:
            raise ApplyAgentError(
                "open_browser",
                f"Browser session failed: {exc.__class__.__name__}: {str(exc)[:300]}",
                target_url=url,
                exception_class=exc.__class__.__name__,
            ) from exc
        return evidence

    async def _first_locator(self, page: Any, locators: List[str]):
        """Try locators in order; the FIRST (primary) is authoritative. A later
        (fallback) locator is only attempted if the primary matches nothing --
        i.e. only under DOM drift, never on the normal path."""
        for selector in locators:
            try:
                loc = page.locator(selector)
                if await loc.count():
                    return loc.first
            except Exception:
                continue
        return None

    async def _log_step(self, evidence: SubmissionEvidence, *, action: str, locators: List[str],
                        status: str, value_preview: str = "", error: str = "") -> None:
        evidence.raw.setdefault("step_log", []).append({
            "action": action,
            "locator": locators[0] if locators else "",
            "status": status,
            "value_preview": value_preview,
            "error": error[:200] if error else "",
        })

    async def _apply_step(self, page: Any, step, documents: Dict[str, Any], evidence: SubmissionEvidence) -> None:
        preview = "(file)" if step.action == "upload" else str(step.value or "")[:100]
        loc = await self._first_locator(page, step.locators)
        if loc is None:
            evidence.raw.setdefault("unmatched_steps", []).append(step.locators[:1])
            await self._log_step(evidence, action=step.action, locators=step.locators,
                                 status="not_found", value_preview=preview)
            return
        try:
            if step.action == "upload":
                path = documents.get("resume_path") if step.file_role == "resume" else documents.get("cover_letter_path")
                if path:
                    await human_upload(loc, page, path)
                    await self._log_step(evidence, action="upload", locators=step.locators,
                                         status="ok", value_preview=path.split("/")[-1] if path else "(file)")
                else:
                    await self._log_step(evidence, action="upload", locators=step.locators,
                                         status="error", value_preview=preview, error="file_path_missing")
            elif step.action == "select":
                await human_select(loc, page, str(step.value))
                await self._log_step(evidence, action="select", locators=step.locators,
                                     status="ok", value_preview=preview)
            elif step.action == "check":
                if str(step.value).strip().lower() not in ("", "false", "no", "0"):
                    await human_check(loc, page)
                await self._log_step(evidence, action="check", locators=step.locators,
                                     status="ok", value_preview=preview)
            else:  # fill
                await human_type(loc, page, str(step.value))
                await self._log_step(evidence, action="fill", locators=step.locators,
                                     status="ok", value_preview=preview)
        except Exception as exc:
            evidence.raw.setdefault("step_errors", []).append(f"{exc.__class__.__name__}:{step.locators[:1]}")
            await self._log_step(evidence, action=step.action, locators=step.locators,
                                 status="error", value_preview=preview, error=str(exc))

    async def _click_submit(self, page: Any, evidence: SubmissionEvidence) -> None:
        loc = await self._first_locator(page, [_SUBMIT_SELECTOR])
        if loc is None:
            evidence.raw["submit"] = "button_not_found"
            await self._log_step(evidence, action="submit", locators=[_SUBMIT_SELECTOR],
                                 status="not_found")
            return
        try:
            await loc.scroll_into_view_if_needed(timeout=3000)
        except Exception:
            pass
        try:
            await human_click(loc, page)
            evidence.submit_performed = True
            await self._log_step(evidence, action="submit", locators=[_SUBMIT_SELECTOR], status="ok")
        except Exception:
            try:
                await loc.click(timeout=5000, force=True)
                evidence.submit_performed = True
                await self._log_step(evidence, action="submit", locators=[_SUBMIT_SELECTOR],
                                     status="ok", error="forced_click")
            except Exception as exc:
                evidence.raw["submit_error"] = str(exc)[:200]
                await self._log_step(evidence, action="submit", locators=[_SUBMIT_SELECTOR],
                                     status="error", error=str(exc))

    async def _application_form_still_open(self, page: Any, body_text: str = "") -> bool:
        """True when the apply form is still on screen (submit did not leave)."""
        try:
            n = await page.locator(
                "#first-name-input >> input, #first-name-input, "
                "#email-input >> input, #email-input, "
                'input[type="email"]:visible'
            ).count()
            if n >= 1:
                return True
        except Exception:
            pass
        hay = canonical(body_text or "")
        return any(
            marker in hay
            for marker in (
                "postulez facilement",
                "informations personnelles",
                "confirmez votre e mail",
                "confirmez votre email",
                "choose an option to autofill",
                "personal information",
            )
        )

    async def _gather_evidence(self, page: Any, evidence: SubmissionEvidence, starting_url: str) -> None:
        """Poll briefly for confirmation / form leave (SR SPA)."""
        deadline_ms = 12_000
        elapsed = 0
        poll_ms = 900
        raw_text = ""
        while elapsed <= deadline_ms:
            try:
                await page.wait_for_timeout(poll_ms if elapsed else 1500)
                elapsed += poll_ms if elapsed else 1500
                raw_text = await page.locator("body").inner_text(timeout=5000)
            except Exception:
                raw_text = ""
            text = " ".join((raw_text or "").split())
            evidence.confirmation_text = confirmation_text_found(canonical(text))
            form_open = await self._application_form_still_open(page, raw_text or "")
            evidence.raw["form_still_open"] = form_open
            submit_loc = await self._first_locator(
                page,
                [_SUBMIT_SELECTOR, 'button:has-text("Envoyer")'],
            )
            if form_open:
                # Shadow Envoyer is often invisible to Playwright — never treat
                # "button not found" as success while the form is still there.
                evidence.submit_control_gone = False
            elif submit_loc is None:
                evidence.submit_control_gone = True
            else:
                try:
                    evidence.submit_control_gone = not await submit_loc.is_visible(timeout=800)
                except Exception:
                    evidence.submit_control_gone = False
            evidence.final_url = page.url
            evidence.url_changed = bool(page.url) and page.url != starting_url
            if evidence.confirmation_text or (evidence.submit_control_gone and not form_open):
                break
            if not form_open and elapsed >= 4000:
                # Form left without matching our confirmation phrases yet.
                break
        evidence.validation_errors = collect_post_submit_errors(raw_text or "")
        form_open = bool(evidence.raw.get("form_still_open"))
        if evidence.confirmation_text or (evidence.submit_control_gone and not form_open):
            evidence.validation_errors = []
        evidence.raw["post_submit_body_preview"] = (raw_text or "")[:500]


class _Registry:
    """Resolves drivers by provider identifier only -- no isinstance, no
    provider branching leaks into the executor."""

    def __init__(self):
        self._by_provider: Dict[str, ApplyDriver] = {}

    def register(self, driver: ApplyDriver) -> None:
        self._by_provider[driver.provider] = driver

    def for_job(self, job: Dict[str, Any]) -> Optional[ApplyDriver]:
        provider = str(job.get("ats_provider") or job.get("provider") or "").lower()
        return self._by_provider.get(provider)

    def providers(self) -> List[str]:
        return sorted(self._by_provider.keys())


DRIVER_REGISTRY = _Registry()
