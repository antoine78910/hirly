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
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from apply_agent.blockers import (
    captcha_active, collect_post_submit_errors, confirmation_text_found,
    detect_bot_wall, detect_captcha, detect_login_wall, dismiss_cookie_banner,
)
from apply_agent.browser import launch_page, screenshot_b64
from apply_agent.guardrails import canonical
from apply_agent.human_browser import (
    human_check, human_click, human_pause, human_scroll, human_select, human_type, human_upload,
)
from apply_agent.models import ApplyAgentError

from .models import SubmissionContext, SubmissionEvidence

logger = logging.getLogger(__name__)

_TIMEOUT_MS = 45000
_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"], button:has-text("Submit")'


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
        await human_pause(page, 1200, 2800)
        await human_scroll(page)

    async def reveal_form(self, page: Any) -> None:
        """Optional fixed-selector click to reveal a form behind an Apply CTA.
        Default: nothing. Subclasses override with a deterministic selector."""
        return None

    async def submit(self, ctx: SubmissionContext) -> SubmissionEvidence:
        url = self.application_url(ctx.job)
        nav_url = self.navigation_url(ctx.job)
        evidence = SubmissionEvidence(raw={"application_url": url, "navigation_url": nav_url})
        try:
            async with launch_page(headless=ctx.headless) as page:
                await self._log_step(evidence, action="open_browser", locators=["chromium"],
                                     status="ok", value_preview="headless" if ctx.headless else "visible")
                http_status = None
                try:
                    resp = await page.goto(nav_url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
                    http_status = None if resp is None else resp.status
                    evidence.network_ok = None if resp is None else resp.status < 400
                    if evidence.network_ok is False:
                        await self._log_step(
                            evidence, action="navigate", locators=[nav_url], status="error",
                            value_preview=nav_url[:100], error=f"HTTP {http_status}",
                        )
                    else:
                        await self._log_step(
                            evidence, action="navigate", locators=[nav_url], status="ok", value_preview=nav_url[:100],
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
                    ) from exc
                try:
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    pass
                await dismiss_cookie_banner(page)

                if await detect_bot_wall(page, http_status=http_status):
                    evidence.blocked_reason = "bot_protection"
                    evidence.screenshot_b64 = await screenshot_b64(page)
                    await self._log_step(evidence, action="bot_wall", locators=["body"],
                                         status="blocked", error=f"HTTP {http_status or 'page'}")
                    return evidence
                if await detect_login_wall(page):
                    evidence.blocked_reason = "login_wall"
                    evidence.screenshot_b64 = await screenshot_b64(page)
                    return evidence
                if captcha_active(await detect_captcha(page)):
                    evidence.blocked_reason = "captcha"
                    evidence.screenshot_b64 = await screenshot_b64(page)
                    return evidence

                await self.after_navigation(page, evidence)
                await self.reveal_form(page)
                await human_pause(page, 900, 2000)
                starting_url = page.url

                for step in ctx.plan.steps:
                    if step.action == "submit":
                        await self._click_submit(page, evidence)
                        continue
                    await self._apply_step(page, step, ctx.documents, evidence)
                    await human_pause(page, 500, 1400)

                await self._gather_evidence(page, evidence, starting_url)
                evidence.screenshot_b64 = await screenshot_b64(page)
        except ApplyAgentError:
            raise
        except Exception as exc:
            raise ApplyAgentError(
                "open_browser",
                f"Browser session failed: {exc.__class__.__name__}: {str(exc)[:300]}",
                target_url=url,
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

    async def _gather_evidence(self, page: Any, evidence: SubmissionEvidence, starting_url: str) -> None:
        try:
            await page.wait_for_timeout(1500)
            raw_text = await page.locator("body").inner_text(timeout=5000)
        except Exception:
            raw_text = ""
        text = " ".join(raw_text.split())
        evidence.confirmation_text = confirmation_text_found(canonical(text))
        evidence.validation_errors = collect_post_submit_errors(text)
        submit_loc = await self._first_locator(page, [_SUBMIT_SELECTOR])
        if submit_loc is None:
            evidence.submit_control_gone = True
        else:
            try:
                evidence.submit_control_gone = not await submit_loc.is_visible(timeout=1500)
            except Exception:
                evidence.submit_control_gone = False
        evidence.final_url = page.url
        evidence.url_changed = bool(page.url) and page.url != starting_url


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
