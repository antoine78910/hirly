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
    detect_captcha, detect_login_wall, dismiss_cookie_banner,
)
from apply_agent.browser import launch_page, screenshot_b64
from apply_agent.guardrails import canonical

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

    async def reveal_form(self, page: Any) -> None:
        """Optional fixed-selector click to reveal a form behind an Apply CTA.
        Default: nothing. Subclasses override with a deterministic selector."""
        return None

    async def submit(self, ctx: SubmissionContext) -> SubmissionEvidence:
        url = self.application_url(ctx.job)
        evidence = SubmissionEvidence(raw={"application_url": url})
        async with launch_page(headless=ctx.headless) as page:
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
            evidence.network_ok = None if resp is None else resp.status < 400
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            await dismiss_cookie_banner(page)

            if await detect_login_wall(page):
                evidence.blocked_reason = "login_wall"
                evidence.screenshot_b64 = await screenshot_b64(page)
                return evidence
            if captcha_active(await detect_captcha(page)):
                evidence.blocked_reason = "captcha"
                evidence.screenshot_b64 = await screenshot_b64(page)
                return evidence

            await self.reveal_form(page)
            starting_url = page.url

            for step in ctx.plan.steps:
                if step.action == "submit":
                    await self._click_submit(page, evidence)
                    continue
                await self._apply_step(page, step, ctx.documents, evidence)

            await self._gather_evidence(page, evidence, starting_url)
            evidence.screenshot_b64 = await screenshot_b64(page)
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
                    await loc.set_input_files(path, timeout=10000)
                    await self._log_step(evidence, action="upload", locators=step.locators,
                                         status="ok", value_preview=path.split("/")[-1] if path else "(file)")
                else:
                    await self._log_step(evidence, action="upload", locators=step.locators,
                                         status="error", value_preview=preview, error="file_path_missing")
            elif step.action == "select":
                await loc.select_option(label=str(step.value), timeout=3000)
                await self._log_step(evidence, action="select", locators=step.locators,
                                     status="ok", value_preview=preview)
            elif step.action == "check":
                if str(step.value).strip().lower() not in ("", "false", "no", "0"):
                    await loc.check(timeout=3000)
                await self._log_step(evidence, action="check", locators=step.locators,
                                     status="ok", value_preview=preview)
            else:  # fill
                await loc.fill(str(step.value), timeout=5000)
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
            await loc.click(timeout=8000)
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
