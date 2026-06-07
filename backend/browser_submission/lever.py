"""Playwright-based Lever application form preparation."""

from __future__ import annotations

import base64
import asyncio
import logging
import os
import random
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from application_documents import cover_letter_to_text

from .base import BrowserFile, BrowserSubmissionError, BrowserSubmissionResult, blocker, calculate_success_likelihood
from .field_extractors import extract_fields
from .matching import canonical, is_sensitive_field, match_field

logger = logging.getLogger(__name__)

TSMG_LEVER_FIELD_NAMES = {
    "comment": "cards[415e4314-19c5-45c4-8523-12565bb87917][field0]",
    "data_processing_consent": "cards[ded439b4-712a-4cd3-8f14-a8f652c8e2bc][field0]",
    "marketing_preference": "cards[c7220d88-6808-4b17-ad1d-fd72a01ad465][field0]",
}

if os.name == "nt":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except AttributeError:
        pass


class LeverBrowserSubmissionEngine:
    provider = "lever"
    engine_version = "lever_browser_engine_v3_real_launch_2026_06_05"

    def __init__(self, headless: bool = True, timeout_ms: int = 45000):
        self.headless = headless
        self.timeout_ms = timeout_ms
        self.last_launch_marker = "not_started"
        self.human_pace = os.environ.get("BROWSER_HUMAN_PACE", "false").strip().lower() in ("1", "true", "yes", "on")
        self.min_delay_ms = int(os.environ.get("BROWSER_MIN_DELAY_MS", "400"))
        self.max_delay_ms = int(os.environ.get("BROWSER_MAX_DELAY_MS", "1400"))
        self.type_delay_ms = int(os.environ.get("BROWSER_TYPE_DELAY_MS", "50"))
        self.pre_submit_pause_ms = int(os.environ.get("BROWSER_PRE_SUBMIT_PAUSE_MS", "5000"))

    async def prepare_fill(
        self,
        *,
        job: Dict[str, Any],
        app_doc: Dict[str, Any],
        profile: Dict[str, Any],
        user: Dict[str, Any],
        click_submit: bool = False,
    ) -> BrowserSubmissionResult:
        phase = "load_application"
        url = self._application_url(job)
        self._validate_lever_url(url)

        try:
            phase = "open_browser"
            self.last_launch_marker = "before_async_playwright"
            logger.info("Lever launch marker=%s", self.last_launch_marker)
            from playwright.async_api import TimeoutError as PlaywrightTimeoutError
            from playwright.async_api import async_playwright
        except ImportError as exc:
            raise BrowserSubmissionError(
                "open_browser",
                "Playwright is not installed. Run `pip install -r backend/requirements.txt` "
                "and `python -m playwright install chromium`.",
                exception_class=exc.__class__.__name__,
                inner_exception_class=exc.__class__.__name__,
                inner_exception_message=self._safe_exception_message(exc, "Playwright import failed."),
                last_launch_marker=self.last_launch_marker,
            ) from exc

        fields_detected: List[Dict[str, Any]] = []
        fields_filled: List[Dict[str, Any]] = []
        field_fill_debug: List[Dict[str, Any]] = []
        blocker_debug: Dict[str, Any] = {}
        blockers: List[Dict[str, Any]] = []
        unfilled_required_fields: List[Dict[str, Any]] = []
        file_uploads: List[BrowserFile] = []
        screenshot_b64 = ""
        resume_uploaded = False
        submit_disabled = False
        final_click_candidate_selector = None
        submit_clicked = False
        success_detected = False
        failure_reason = None
        final_url = None
        submit_screenshot_b64 = None
        captcha_required = False
        action_required = False
        captcha_debug: Dict[str, Any] = {}
        post_submit_page_text_excerpt = None
        post_submit_errors: List[str] = []
        submit_button_still_visible = None
        confirmation_text_found = None
        lever_network_submit_statuses: List[Dict[str, Any]] = []

        with tempfile.TemporaryDirectory(prefix="swiipr_lever_") as tmpdir:
            resume_path = self._write_resume_file(app_doc, tmpdir)
            cover_letter_path = self._write_cover_letter_file(app_doc, tmpdir)

            async with async_playwright() as p:
                self.last_launch_marker = "after_async_playwright_started"
                logger.info("Lever launch marker=%s", self.last_launch_marker)
                browser = None
                context = None
                try:
                    phase = "open_browser"
                    logger.info(
                        "LEVER_REAL_LAUNCH_PATH_V3 provider class=%s module_file=%s method=%s engine_version=%s",
                        self.__class__.__name__,
                        __file__,
                        "prepare_fill",
                        self.engine_version,
                    )
                    self.last_launch_marker = "before_chromium_launch"
                    logger.info("Lever launch marker=%s", self.last_launch_marker)
                    browser_user_data_dir = os.environ.get("BROWSER_USER_DATA_DIR")
                    context_options = self._browser_context_options()
                    if browser_user_data_dir:
                        context = await p.chromium.launch_persistent_context(
                            user_data_dir=browser_user_data_dir,
                            headless=self.headless,
                            **context_options,
                        )
                        browser = None
                    else:
                        browser = await p.chromium.launch(headless=self.headless)
                        context = await browser.new_context(**context_options)
                    self.last_launch_marker = "after_chromium_launch"
                    logger.info("Lever launch marker=%s", self.last_launch_marker)
                    self.last_launch_marker = "before_new_page"
                    logger.info("Lever launch marker=%s", self.last_launch_marker)
                    page = await context.new_page()
                    self.last_launch_marker = "after_new_page"
                    logger.info("Lever launch marker=%s", self.last_launch_marker)
                    try:
                        try:
                            phase = "open_page"
                            response = await page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
                            status = response.status if response is not None else None
                            if status and status >= 400:
                                raise BrowserSubmissionError(
                                    "open_page",
                                    f"Lever page returned HTTP {status}",
                                    exception_class="HTTPStatusError",
                                    target_url=url,
                                    status=status,
                                )
                            try:
                                await page.wait_for_load_state("networkidle", timeout=8000)
                            except PlaywrightTimeoutError:
                                pass
                            await self._open_apply_form_if_needed(page)
                            await self._dismiss_obvious_cookie_banner(page)

                            page_text = canonical(await page.locator("body").inner_text(timeout=5000))
                            if "captcha" in page_text or "verify you are human" in page_text:
                                blockers.append(blocker("captcha_detected", "CAPTCHA or human verification was detected."))
                            if "sign in" in page_text and "password" in page_text:
                                blockers.append(blocker("login_required", "The application page appears to require login."))

                            phase = "extract_fields"
                            fields_detected = await extract_fields(page)
                            self._after_fields_detected(url, fields_detected)
                            await self._prepare_field_models(url, fields_detected, job, app_doc, profile, user)
                            if self.provider == "greenhouse":
                                logger.info(
                                    "greenhouse_fields_detected url=%s fields=%s",
                                    url,
                                    self._safe_json([
                                        {
                                            "selector": field.get("selector"),
                                            "tag": field.get("tag"),
                                            "type": field.get("type"),
                                            "label": field.get("label"),
                                            "aria_label": field.get("aria_label"),
                                            "placeholder": field.get("placeholder"),
                                            "name": field.get("name"),
                                            "id": field.get("id"),
                                            "required": field.get("required"),
                                            "options": field.get("options") or [],
                                        }
                                        for field in fields_detected
                                        if field.get("visible")
                                    ])[:12000],
                                )
                            if not fields_detected:
                                blockers.append(blocker("form_not_found", "No application form fields were detected."))

                            phase = "fill_fields"
                            for field in fields_detected:
                                fill = self._match_field(field, profile, app_doc, user)
                                self._log_answer_resolution(field, fill)
                                if not fill:
                                    if self._is_tsmg_field(field) or field.get("required"):
                                        field_fill_debug.append(self._fill_debug(field, None, False, False, ""))
                                    continue
                                field_type = str(field.get("type") or "text").lower()
                                selector = field.get("selector")
                                if not selector and not self._is_tsmg_field(field):
                                    continue
                                valid_before, reject_reason = self._validate_fill_before_attempt(field, fill)
                                if not valid_before:
                                    value_preview = self._safe_value_preview(fill.get("value") if fill else "")
                                    debug_item = self._fill_debug(field, fill, False, False, "")
                                    debug_item.update({
                                        "fill_rejected": True,
                                        "rejection_reason": reject_reason,
                                        "attempted_value_preview": value_preview,
                                    })
                                    field_fill_debug.append(debug_item)
                                    self._log_fill_rejected(field, fill, reject_reason)
                                    if field.get("required"):
                                        blockers.append(blocker(
                                            "field_fill_rejected",
                                            f"Field fill rejected by validation: {reject_reason}",
                                            field,
                                        ))
                                    continue
                                try:
                                    success = False
                                    value_after = ""
                                    if self._is_tsmg_field(field):
                                        success, value_after = await self._fill_exact_named_field(page, field, fill)
                                    elif field_type == "file":
                                        phase = "upload_files"
                                        upload = await self._upload_file(
                                            page,
                                            selector,
                                            fill["value"],
                                            resume_path,
                                            cover_letter_path,
                                        )
                                        if upload:
                                            file_uploads.append(upload)
                                            if upload.field_name == "resume":
                                                resume_uploaded = True
                                            success = True
                                            value_after = upload.filename
                                        phase = "fill_fields"
                                    elif field_type in ("text", "email", "tel", "url", "search", "textarea", "contenteditable"):
                                        await self._human_fill_text(page, selector, str(fill["value"]))
                                        success = True
                                        value_after = await self._read_field_value_after_fill(page, field, str(fill["value"]))
                                    elif field_type == "select":
                                        if await self._select_option(page, selector, str(fill["value"])):
                                            success = True
                                            value_after = await self._read_field_value_after_fill(page, field, str(fill["value"]))
                                    elif field_type == "combobox":
                                        if await self._select_combobox_option(page, field, str(fill["value"])):
                                            success = True
                                            value_after = await self._read_field_value_after_fill(page, field, str(fill["value"]))
                                    elif field_type in ("checkbox", "radio"):
                                        if self._should_check_option(field, fill):
                                            await self._human_check(page, selector)
                                            success = True
                                            value_after = "checked"
                                    if success:
                                        valid_after, invalid_reason = self._validate_fill_after_attempt(field, fill, value_after)
                                        debug_item = self._fill_debug(field, fill, True, valid_after, value_after)
                                        if not valid_after:
                                            debug_item.update({
                                                "invalid_after_fill": True,
                                                "invalid_after_fill_reason": invalid_reason,
                                            })
                                            await self._clear_invalid_field_value(page, field)
                                            blockers.append(blocker(
                                                "invalid_field_value_after_fill",
                                                f"Filled value failed validation: {invalid_reason}",
                                                field,
                                            ))
                                        field_fill_debug.append(debug_item)
                                        self._log_fill_attempt(field, fill, valid_after, value_after)
                                        if valid_after:
                                            fields_filled.append(self._filled(field, fill))
                                    elif fill:
                                        field_fill_debug.append(self._fill_debug(field, fill, True, False, value_after))
                                except Exception as exc:
                                    field_fill_debug.append(self._fill_debug(field, fill, True, False, "", exc))
                                    self._log_fill_attempt(field, fill, False, "", exc)
                                    blockers.append(blocker(
                                        "field_fill_failed",
                                        f"Could not fill field: {exc.__class__.__name__}",
                                        field,
                                    ))
                                finally:
                                    await self._human_delay()

                            await page.wait_for_timeout(500)
                            phase = "extract_fields"
                            fields_after = await extract_fields(page)
                            field_value_by_name = {
                                str(field.get("name") or ""): self._field_has_value(field)
                                for field in fields_after
                                if field.get("name")
                            }
                            for field in fields_after:
                                if not field.get("required") or field.get("disabled") or not field.get("visible"):
                                    continue
                                if field.get("type") != "file" and not self._field_has_value(field):
                                    unfilled_required_fields.append(self._field_summary(field))
                                    if is_sensitive_field(field):
                                        blockers.append(blocker(
                                            "required_sensitive_field_missing",
                                            "Required sensitive/legal field needs an explicit user answer.",
                                            field,
                                        ))
                                    else:
                                        blockers.append(blocker(
                                            "required_field_unmatched",
                                            "Required field could not be matched confidently.",
                                            field,
                                        ))

                            self._after_required_verification(fields_after, unfilled_required_fields, blockers)
                            blocker_debug = self._cleanup_stale_field_fill_blockers(blockers, field_value_by_name)
                            blockers = blocker_debug["blockers_after_revalidation"]
                            final_click_candidate_selector = await self._final_click_candidate_selector(page)
                            submit_disabled = await self._submit_button_disabled(page)
                            ready_for_final_click = (
                                bool(fields_filled)
                                and not blockers
                                and not unfilled_required_fields
                                and resume_uploaded
                                and bool(final_click_candidate_selector)
                                and not submit_disabled
                            )
                            if click_submit:
                                if ready_for_final_click:
                                    phase = "submit_click"
                                    submit_result = await self._click_submit_and_detect_success(page, final_click_candidate_selector)
                                    submit_clicked = submit_result["submit_clicked"]
                                    success_detected = submit_result["success_detected"]
                                    failure_reason = submit_result["failure_reason"]
                                    final_url = submit_result["final_url"]
                                    submit_screenshot_b64 = submit_result["submit_screenshot_b64"]
                                    captcha_required = bool(submit_result.get("captcha_required"))
                                    action_required = bool(submit_result.get("action_required"))
                                    captcha_debug = submit_result.get("captcha_debug") or {}
                                    post_submit_page_text_excerpt = submit_result.get("post_submit_page_text_excerpt")
                                    post_submit_errors = submit_result.get("post_submit_errors") or []
                                    submit_button_still_visible = submit_result.get("submit_button_still_visible")
                                    confirmation_text_found = submit_result.get("confirmation_text_found")
                                    lever_network_submit_statuses = submit_result.get("lever_network_submit_statuses") or []
                                else:
                                    failure_reason = "not_ready_for_final_click"
                            phase = "screenshot"
                            screenshot_b64 = base64.b64encode(await page.screenshot(full_page=True)).decode("ascii")
                            self._after_final_prepare_result(
                                ready_for_final_click=ready_for_final_click,
                                blockers=blockers,
                                unfilled_required_fields=unfilled_required_fields,
                                resume_uploaded=resume_uploaded,
                                final_click_candidate_selector=final_click_candidate_selector,
                                submit_disabled=submit_disabled,
                            )
                        except BrowserSubmissionError:
                            raise
                        except Exception as exc:
                            if phase == "open_page":
                                raise BrowserSubmissionError(
                                    phase,
                                    self._safe_exception_message(exc, "Lever page navigation failed."),
                                    exception_class=exc.__class__.__name__,
                                    target_url=url,
                                ) from exc
                            blockers.append(blocker(
                                f"{phase}_failed",
                                f"Lever browser phase failed: {phase} ({exc.__class__.__name__}: {self._safe_exception_message(exc, 'no message')})",
                            ))
                            try:
                                phase = "screenshot"
                                screenshot_b64 = base64.b64encode(await page.screenshot(full_page=True)).decode("ascii")
                            except Exception:
                                screenshot_b64 = ""
                    finally:
                        await page.close()
                except BrowserSubmissionError:
                    raise
                except Exception as exc:
                    if os.environ.get("ENVIRONMENT", "").strip().lower() == "development" or os.environ.get("DEV_TOOLS_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on"):
                        logger.exception("Lever browser launch/page setup failed at marker=%s", self.last_launch_marker)
                    raise BrowserSubmissionError(
                        phase,
                        self._safe_exception_message(exc, "Lever browser launch/page setup failed."),
                        exception_class=exc.__class__.__name__,
                        inner_exception_class=exc.__class__.__name__,
                        inner_exception_message=self._safe_exception_message(exc, "Lever browser launch/page setup failed."),
                        last_launch_marker=self.last_launch_marker,
                        target_url=url if phase == "open_page" else None,
                    ) from exc
                finally:
                    if context is not None:
                        await context.close()
                    if browser is not None:
                        await browser.close()

        success_likelihood = calculate_success_likelihood(
            blockers,
            unfilled_required_fields,
            resume_uploaded=resume_uploaded,
            submit_disabled=submit_disabled,
        )
        return BrowserSubmissionResult(
            provider=self.provider,
            application_url=url,
            screenshot_b64=screenshot_b64,
            fields_detected=[self._field_summary(field) for field in fields_detected],
            fields_filled=fields_filled,
            field_fill_debug=field_fill_debug,
            blocker_debug=blocker_debug,
            blockers=blockers,
            unfilled_required_fields=unfilled_required_fields,
            file_uploads=file_uploads,
            success_likelihood=success_likelihood,
            ready_for_final_click=bool(fields_filled) and not blockers and not unfilled_required_fields and resume_uploaded and bool(final_click_candidate_selector) and not submit_disabled,
            final_click_candidate_selector=final_click_candidate_selector,
            submit_clicked=submit_clicked,
            success_detected=success_detected,
            failure_reason=failure_reason,
            final_url=final_url,
            submit_screenshot_b64=submit_screenshot_b64,
            captcha_required=captcha_required,
            action_required=action_required,
            captcha_debug=captcha_debug,
            post_submit_page_text_excerpt=post_submit_page_text_excerpt,
            post_submit_errors=post_submit_errors,
            submit_button_still_visible=submit_button_still_visible,
            confirmation_text_found=confirmation_text_found,
            lever_network_submit_statuses=lever_network_submit_statuses,
        )

    def _application_url(self, job: Dict[str, Any]) -> str:
        for key in ("apply_url", "application_url", "external_url"):
            value = job.get(key)
            if value:
                return str(value)
        raw = job.get("raw_provider_payload") or {}
        for key in ("applyUrl", "apply_url", "hostedUrl", "hosted_url"):
            value = raw.get(key) if isinstance(raw, dict) else None
            if value:
                return str(value)
        raise ValueError("Lever application URL is missing")

    def _validate_lever_url(self, url: str) -> None:
        host = urlparse(url).netloc.lower()
        if "jobs.lever.co" not in host and "jobs.eu.lever.co" not in host:
            raise ValueError("URL is not a Lever hosted application page")

    async def _open_apply_form_if_needed(self, page: Any) -> None:
        if await page.locator("input[type='file'], input[name='name'], input[name='email']").count():
            return
        candidates = [
            page.get_by_role("link", name="Apply"),
            page.get_by_role("button", name="Apply"),
            page.locator("a[href*='/apply']").first,
        ]
        for locator in candidates:
            try:
                if await locator.count():
                    await locator.first.click(timeout=4000)
                    await page.wait_for_load_state("domcontentloaded", timeout=8000)
                    return
            except Exception:
                continue

    async def _dismiss_obvious_cookie_banner(self, page: Any) -> None:
        for text in ("Accept", "Accept all", "I agree", "Got it"):
            try:
                button = page.get_by_role("button", name=text)
                if await button.count():
                    await button.first.click(timeout=1500)
                    return
            except Exception:
                continue

    def _write_resume_file(self, app_doc: Dict[str, Any], tmpdir: str) -> Optional[str]:
        resume_b64 = app_doc.get("tailored_cv_file_b64")
        if not resume_b64:
            return None
        filename = app_doc.get("tailored_cv_filename") or "tailored_cv.docx"
        path = Path(tmpdir) / self._safe_filename(filename)
        path.write_bytes(base64.b64decode(resume_b64))
        return str(path)

    def _write_cover_letter_file(self, app_doc: Dict[str, Any], tmpdir: str) -> Optional[str]:
        text = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
        if not text.strip():
            return None
        path = Path(tmpdir) / "cover_letter.txt"
        path.write_text(text, encoding="utf-8")
        return str(path)

    def _safe_filename(self, filename: str) -> str:
        return "".join(char if char.isalnum() or char in "._-" else "_" for char in filename) or "tailored_cv.docx"

    def _safe_exception_message(self, exc: Exception, fallback: str) -> str:
        message = str(exc).strip()
        return message[:800] if message else fallback

    def _safe_json(self, value: Any) -> str:
        try:
            import json
            return json.dumps(value, default=str)
        except Exception:
            return str(value)

    def _match_field(
        self,
        field: Dict[str, Any],
        profile: Dict[str, Any],
        app_doc: Dict[str, Any],
        user: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        return match_field(field, profile, app_doc, user)

    def _after_fields_detected(self, url: str, fields: List[Dict[str, Any]]) -> None:
        return None

    async def _prepare_field_models(
        self,
        url: str,
        fields: List[Dict[str, Any]],
        job: Dict[str, Any],
        app_doc: Dict[str, Any],
        profile: Dict[str, Any],
        user: Dict[str, Any],
    ) -> None:
        return None

    def _log_answer_resolution(self, field: Dict[str, Any], fill: Optional[Dict[str, Any]]) -> None:
        return None

    def _log_fill_attempt(
        self,
        field: Dict[str, Any],
        fill: Optional[Dict[str, Any]],
        success: bool,
        value_after: str,
        exc: Optional[Exception] = None,
    ) -> None:
        return None

    def _after_required_verification(
        self,
        fields_after: List[Dict[str, Any]],
        unfilled_required_fields: List[Dict[str, Any]],
        blockers: List[Dict[str, Any]],
    ) -> None:
        return None

    def _after_final_prepare_result(
        self,
        *,
        ready_for_final_click: bool,
        blockers: List[Dict[str, Any]],
        unfilled_required_fields: List[Dict[str, Any]],
        resume_uploaded: bool,
        final_click_candidate_selector: Optional[str],
        submit_disabled: bool,
    ) -> None:
        return None

    async def _human_delay(self, min_ms: Optional[int] = None, max_ms: Optional[int] = None) -> None:
        if not self.human_pace:
            return
        low = self.min_delay_ms if min_ms is None else min_ms
        high = self.max_delay_ms if max_ms is None else max_ms
        if high < low:
            high = low
        await asyncio.sleep(random.randint(low, high) / 1000)

    async def _human_scroll_to_locator(self, locator: Any) -> None:
        if not self.human_pace:
            try:
                await locator.scroll_into_view_if_needed(timeout=3000)
            except Exception:
                pass
            return
        try:
            await locator.evaluate("element => element.scrollIntoView({block: 'center', behavior: 'smooth'})")
            await self._human_delay(250, 700)
        except Exception:
            try:
                await locator.scroll_into_view_if_needed(timeout=3000)
            except Exception:
                pass

    async def _human_move_to_locator(self, page: Any, locator: Any) -> None:
        if not self.human_pace:
            return
        try:
            box = await locator.bounding_box(timeout=3000)
            if box:
                x = box["x"] + random.uniform(box["width"] * 0.25, box["width"] * 0.75)
                y = box["y"] + random.uniform(box["height"] * 0.25, box["height"] * 0.75)
                await page.mouse.move(x, y, steps=random.randint(8, 18))
                await self._human_delay(120, 350)
        except Exception:
            pass

    async def _human_fill_text(self, page: Any, selector: str, value: str) -> None:
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        await self._human_move_to_locator(page, locator)
        if self.human_pace:
            await locator.click(timeout=5000)
            await self._human_delay(120, 350)
            try:
                await locator.press("Control+A", timeout=2000)
            except Exception:
                pass
            await locator.type(value, delay=self.type_delay_ms, timeout=max(self.timeout_ms, len(value) * max(self.type_delay_ms, 1) + 5000))
        else:
            await locator.fill(value, timeout=5000)

    async def _human_check(self, page: Any, selector: str) -> None:
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        await self._human_move_to_locator(page, locator)
        if self.human_pace:
            await locator.click(timeout=5000)
        else:
            await locator.check(timeout=5000)

    async def _human_gradual_scroll_before_submit(self, page: Any, selector: str) -> None:
        locator = page.locator(selector).first
        if not self.human_pace:
            await self._human_scroll_to_locator(locator)
            return
        for _ in range(random.randint(3, 6)):
            await page.mouse.wheel(0, random.randint(180, 420))
            await self._human_delay(180, 450)
        await self._human_scroll_to_locator(locator)
        await self._human_delay(self.pre_submit_pause_ms, self.pre_submit_pause_ms)

    def _browser_context_options(self) -> Dict[str, Any]:
        return {
            "viewport": {"width": 1440, "height": 1200},
            "user_agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            ),
            "locale": os.environ.get("BROWSER_LOCALE", "en-US"),
            "timezone_id": os.environ.get("BROWSER_TIMEZONE", "Europe/London"),
        }

    async def _upload_file(
        self,
        page: Any,
        selector: str,
        value: str,
        resume_path: Optional[str],
        cover_letter_path: Optional[str],
    ) -> Optional[BrowserFile]:
        if value == "__cover_letter_file__":
            path = cover_letter_path
            field_name = "cover_letter"
            mime = "text/plain"
        else:
            path = resume_path
            field_name = "resume"
            mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if not path:
            return None
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        await self._human_delay()
        await locator.set_input_files(path, timeout=8000)
        await self._human_delay()
        stat = Path(path).stat()
        return BrowserFile(field_name=field_name, filename=Path(path).name, mime=mime, size_bytes=stat.st_size)

    def _is_tsmg_field(self, field: Dict[str, Any]) -> bool:
        return str(field.get("name") or "") in set(TSMG_LEVER_FIELD_NAMES.values())

    def _fill_debug(
        self,
        field: Dict[str, Any],
        fill: Optional[Dict[str, Any]],
        attempted: bool,
        success: bool,
        value_after: str,
        exc: Optional[Exception] = None,
    ) -> Dict[str, Any]:
        item = {
            "field_name": field.get("name"),
            "id": field.get("id"),
            "field_type": field.get("type"),
            "label": field.get("label"),
            "placeholder": field.get("placeholder"),
            "options": field.get("options") or [],
            "aria_label": field.get("aria_label"),
            "nearby_text": field.get("nearby_text"),
            "field_container_text": field.get("field_container_text"),
            "matched_value": fill.get("value") if fill else None,
            "match_source": fill.get("source") if fill else None,
            "attempted_fill": attempted,
            "fill_success": success,
            "value_after_fill": value_after,
        }
        if exc:
            item["fill_error"] = f"{exc.__class__.__name__}: {self._safe_exception_message(exc, '')}"
        return item

    def _validate_fill_before_attempt(self, field: Dict[str, Any], fill: Dict[str, Any]) -> tuple[bool, str]:
        return True, ""

    def _validate_fill_after_attempt(self, field: Dict[str, Any], fill: Dict[str, Any], value_after: str) -> tuple[bool, str]:
        return True, ""

    def _log_fill_rejected(self, field: Dict[str, Any], fill: Optional[Dict[str, Any]], reason: str) -> None:
        logger.info(
            "%s_fill_rejected field=%s reason=%s",
            self.provider,
            field.get("label") or field.get("name") or field.get("id"),
            reason,
        )

    def _safe_value_preview(self, value: Any) -> str:
        text = str(value or "").replace("\n", " ").replace("\r", " ").strip()
        return text[:80]

    async def _read_field_value_after_fill(self, page: Any, field: Dict[str, Any], fallback: str = "") -> str:
        selector = field.get("selector")
        field_name = str(field.get("name") or "")
        try:
            if field_name:
                value = await self._field_value_by_name(page, field_name)
                if str(value or "").strip():
                    return str(value)
            if selector:
                return await page.locator(selector).first.evaluate(
                    """(element) => {
                        if (!element) return "";
                        if (element.tagName && element.tagName.toLowerCase() === "select") {
                            const option = element.options && element.selectedIndex >= 0 ? element.options[element.selectedIndex] : null;
                            return String((option && (option.label || option.textContent || option.value)) || element.value || "");
                        }
                        return String(element.value || element.getAttribute("aria-label") || element.textContent || "");
                    }"""
                )
        except Exception:
            return fallback
        return fallback

    async def _clear_invalid_field_value(self, page: Any, field: Dict[str, Any]) -> None:
        selector = field.get("selector")
        field_name = str(field.get("name") or "")
        try:
            if field_name:
                await self._set_field_value_with_js(page, field_name, "")
                return
            if selector:
                await page.locator(selector).first.evaluate(
                    """(element) => {
                        if (!element) return;
                        if ("value" in element) element.value = "";
                        element.dispatchEvent(new Event("input", {bubbles: true}));
                        element.dispatchEvent(new Event("change", {bubbles: true}));
                    }"""
                )
        except Exception:
            return

    async def _fill_exact_named_field(self, page: Any, field: Dict[str, Any], fill: Dict[str, Any]) -> tuple[bool, str]:
        field_name = str(field.get("name") or "")
        field_type = str(field.get("type") or "").lower()
        value = str(fill.get("value") or "")
        selector = field.get("selector") or f"[name=\"{field_name}\"]"

        if field_type in ("textarea", "text", "email", "tel", "url", "search", "contenteditable"):
            try:
                await self._human_fill_text(page, selector, value)
            except Exception:
                await self._set_field_value_with_js(page, field_name, value)
            value_after = await self._field_value_by_name(page, field_name)
            if value_after.strip():
                return True, value_after
            await self._set_field_value_with_js(page, field_name, value)
            value_after = await self._field_value_by_name(page, field_name)
            return bool(value_after.strip()), value_after

        if field_type == "select":
            try:
                if not await self._select_option(page, selector, value):
                    raise RuntimeError("select_option failed")
            except Exception:
                await self._set_field_value_with_js(page, field_name, value)
            value_after = await self._field_value_by_name(page, field_name)
            if canonical(value_after) == canonical(value):
                return True, value_after
            await self._set_field_value_with_js(page, field_name, value)
            value_after = await self._field_value_by_name(page, field_name)
            return canonical(value_after) == canonical(value), value_after

        return False, await self._field_value_by_name(page, field_name)

    async def _field_value_by_name(self, page: Any, field_name: str) -> str:
        return await page.evaluate(
            """(fieldName) => {
                const element = Array.from(document.querySelectorAll("[name]"))
                    .find((item) => item.getAttribute("name") === fieldName);
                return element ? String(element.value || "") : "";
            }""",
            field_name,
        )

    async def _set_field_value_with_js(self, page: Any, field_name: str, value: str) -> None:
        await page.evaluate(
            """({fieldName, value}) => {
                const element = Array.from(document.querySelectorAll("[name]"))
                    .find((item) => item.getAttribute("name") === fieldName);
                if (!element) return false;
                if (element.tagName && element.tagName.toLowerCase() === "select") {
                    const option = Array.from(element.options || []).find((item) =>
                        String(item.value) === String(value) ||
                        String(item.label || item.textContent || "").trim() === String(value)
                    );
                    if (option) {
                        element.value = option.value;
                    } else {
                        element.value = value;
                    }
                } else {
                    element.value = value;
                }
                element.dispatchEvent(new Event("input", {bubbles: true}));
                element.dispatchEvent(new Event("change", {bubbles: true}));
                return true;
            }""",
            {"fieldName": field_name, "value": value},
        )

    def _field_has_value(self, field: Dict[str, Any]) -> bool:
        value = str(field.get("value_before") or "").strip()
        if str(field.get("type") or "").lower() == "combobox" and not value:
            value = str(field.get("nearby_text") or field.get("field_container_text") or "").strip()
        if not value:
            return False
        normalized = canonical(value)
        if normalized in ("select", "select one", "select an option", "please select"):
            return False
        if normalized.startswith("select ") and len(normalized.split()) <= 3:
            return False
        return True

    def _cleanup_stale_field_fill_blockers(
        self,
        blockers: List[Dict[str, Any]],
        field_value_by_name: Dict[str, bool],
    ) -> Dict[str, Any]:
        before = [dict(item) for item in blockers]
        after = []
        removed = []
        for item in blockers:
            field = item.get("field") or {}
            field_name = str(field.get("name") or "")
            if (
                item.get("code") == "field_fill_failed"
                and field_name
                and field_value_by_name.get(field_name) is True
            ):
                removed.append(item)
                continue
            after.append(item)
        return {
            "blockers_before_revalidation": before,
            "blockers_after_revalidation": after,
            "removed_stale_blockers": removed,
        }

    async def _select_option(self, page: Any, selector: str, value: str) -> bool:
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        await self._human_move_to_locator(page, locator)
        if self.human_pace:
            try:
                await locator.click(timeout=4000)
                await self._human_delay()
            except Exception:
                pass
        try:
            await locator.select_option(label=value, timeout=3000)
            await self._human_delay()
            return True
        except Exception:
            pass
        try:
            await locator.select_option(value=value, timeout=3000)
            await self._human_delay()
            return True
        except Exception:
            return False

    async def _select_combobox_option(self, page: Any, field: Dict[str, Any], value: str) -> bool:
        selector = field.get("selector")
        if not selector or not value:
            return False
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        await self._human_move_to_locator(page, locator)
        try:
            await locator.click(timeout=5000)
            await self._human_delay()
        except Exception:
            return False

        candidates = [value]
        normalized = canonical(value)
        if normalized == "swiipr":
            candidates.extend(["Other", "Other website", "Job board", "Online"])
        elif normalized in ("i agree", "agree"):
            candidates.extend(["I agree", "Agree", "Yes"])
        elif normalized in ("no", "false"):
            candidates.extend(["No"])

        for candidate in candidates:
            try:
                option = page.get_by_role("option", name=candidate).first
                if await option.count():
                    await option.click(timeout=5000)
                    await self._human_delay()
                    return True
            except Exception:
                pass
            try:
                text_option = page.locator(
                    "[role='option'], [id*='option'], .select__option, [class*='option']"
                ).filter(has_text=candidate).first
                if await text_option.count():
                    await text_option.click(timeout=5000)
                    await self._human_delay()
                    return True
            except Exception:
                pass
        return False

    def _should_check_option(self, field: Dict[str, Any], fill: Dict[str, Any]) -> bool:
        value = canonical(fill.get("value"))
        label = canonical(field.get("label"))
        if value == "no":
            return label in ("no", "n") or label.startswith("no ") or " no" in f" {label} "
        if value in ("i agree", "agree"):
            return "agree" in label or "consent" in label or "data processing" in label or "privacy" in label
        if value in ("yes", "true"):
            return label in ("yes", "y", "true") or label.startswith("yes ")
        if value in ("yes", "true", "i agree", "agree"):
            return True
        return bool(value and (value in label or label in value))

    async def _submit_button_disabled(self, page: Any) -> bool:
        for locator in (
            page.get_by_role("button", name="Submit application"),
            page.get_by_role("button", name="Submit"),
            page.locator("button[type='submit']").first,
            page.locator("input[type='submit']").first,
        ):
            try:
                if await locator.count():
                    return bool(await locator.first.is_disabled(timeout=1500))
            except Exception:
                continue
        return False

    async def _final_click_candidate_selector(self, page: Any) -> Optional[str]:
        return await page.evaluate(r"""
() => {
  const cssEscape = window.CSS && window.CSS.escape
    ? window.CSS.escape
    : (value) => String(value).replace(/["\\#.:,[\]>+~*^$|=()\s]/g, "\\$&");

  function textOf(node) {
    return (node && (node.innerText || node.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function selectorFor(element) {
    if (!element) return null;
    if (element.id) return "#" + cssEscape(element.id);
    if (element.name) {
      return element.tagName.toLowerCase() + "[name=\"" + String(element.name).replace(/"/g, "\\\"") + "\"]";
    }
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += "#" + cssEscape(node.id);
        parts.unshift(part);
        break;
      }
      let index = 1;
      let sibling = node;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) index += 1;
      }
      part += ":nth-of-type(" + index + ")";
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  const candidates = Array.from(document.querySelectorAll("button, input[type='submit'], a"));
  const candidate = candidates.find((element) => {
    const text = textOf(element) || element.value || element.getAttribute("aria-label") || "";
    const type = (element.getAttribute("type") || "").toLowerCase();
    const visible = Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    const disabled = Boolean(element.disabled || element.getAttribute("aria-disabled") === "true");
    return visible && !disabled && (
      type === "submit" ||
      /submit|send application|apply/i.test(text)
    );
  });
  return selectorFor(candidate);
}
""")

    async def _click_submit_and_detect_success(self, page: Any, selector: str) -> Dict[str, Any]:
        network_statuses: List[Dict[str, Any]] = []

        def record_response(response: Any) -> None:
            try:
                url = response.url
                if "lever" in url.lower() or "apply" in url.lower() or "posting" in url.lower():
                    network_statuses.append({
                        "url": url[:300],
                        "status": response.status,
                        "method": response.request.method,
                    })
            except Exception:
                return

        page.on("response", record_response)
        try:
            captcha_before = await self._captcha_debug(page)
            if self._captcha_active(captcha_before):
                screenshot_b64 = base64.b64encode(await page.screenshot(full_page=True)).decode("ascii")
                diagnostics = await self._post_submit_diagnostics(page, selector, network_statuses)
                return {
                    "submit_clicked": False,
                    "success_detected": False,
                    "failure_reason": "captcha_required",
                    "final_url": page.url,
                    "submit_screenshot_b64": screenshot_b64,
                    "captcha_required": True,
                    "action_required": True,
                    "captcha_debug": captcha_before,
                    **diagnostics,
                }
            await self._human_gradual_scroll_before_submit(page, selector)
            await page.locator(selector).first.click(timeout=8000)
            await self._wait_after_submit(page)
            captcha_after = await self._captcha_debug(page)
            diagnostics = await self._post_submit_diagnostics(page, selector, network_statuses)
            if self._captcha_active(captcha_after):
                screenshot_b64 = base64.b64encode(await page.screenshot(full_page=True)).decode("ascii")
                return {
                    "submit_clicked": True,
                    "success_detected": False,
                    "failure_reason": "captcha_required",
                    "final_url": page.url,
                    "submit_screenshot_b64": screenshot_b64,
                    "captcha_required": True,
                    "action_required": True,
                    "captcha_debug": captcha_after,
                    **diagnostics,
                }
            success_detected = bool(diagnostics.get("confirmation_text_found")) or (
                diagnostics.get("submit_button_still_visible") is False
                and not diagnostics.get("post_submit_errors")
            )
            screenshot_b64 = base64.b64encode(await page.screenshot(full_page=True)).decode("ascii")
            return {
                "submit_clicked": True,
                "success_detected": success_detected,
                "failure_reason": None if success_detected else "submission_status_unknown",
                "final_url": page.url,
                "submit_screenshot_b64": screenshot_b64,
                "captcha_required": False,
                "action_required": False,
                "captcha_debug": captcha_after,
                **diagnostics,
            }
        except Exception as exc:
            screenshot_b64 = ""
            try:
                screenshot_b64 = base64.b64encode(await page.screenshot(full_page=True)).decode("ascii")
            except Exception:
                pass
            click_error = self._safe_exception_message(exc, "submit click failed")
            captcha_after_error = await self._captcha_debug(page, click_error=click_error)
            diagnostics = await self._post_submit_diagnostics(page, selector, network_statuses)
            if self._captcha_active(captcha_after_error):
                return {
                    "submit_clicked": False,
                    "success_detected": False,
                    "failure_reason": "captcha_required",
                    "final_url": page.url,
                    "submit_screenshot_b64": screenshot_b64,
                    "captcha_required": True,
                    "action_required": True,
                    "captcha_debug": captcha_after_error,
                    **diagnostics,
                }
            return {
                "submit_clicked": False,
                "success_detected": False,
                "failure_reason": f"{exc.__class__.__name__}: {self._safe_exception_message(exc, 'submit click failed')}",
                "final_url": page.url,
                "submit_screenshot_b64": screenshot_b64,
                "captcha_required": False,
                "action_required": False,
                "captcha_debug": captcha_after_error,
                **diagnostics,
            }
        finally:
            try:
                page.remove_listener("response", record_response)
            except Exception:
                pass

    async def _captcha_debug(self, page: Any, click_error: str = "") -> Dict[str, Any]:
        try:
            iframe_count = await page.locator('iframe[src*="hcaptcha"], iframe[src*="recaptcha"]').count()
        except Exception:
            iframe_count = 0
        try:
            visible_captcha_count = await page.locator(
                'iframe[src*="hcaptcha"]:visible, iframe[src*="recaptcha"]:visible, '
                '[class*="hcaptcha"]:visible, [class*="recaptcha"]:visible, '
                '[id*="hcaptcha"]:visible, [id*="recaptcha"]:visible'
            ).count()
        except Exception:
            visible_captcha_count = 0
        try:
            body_text = canonical(await page.locator("body").inner_text(timeout=3000))
        except Exception:
            body_text = ""
        captcha_text_detected = any(text in body_text for text in ("captcha", "security challenge", "verify you are human"))
        click_lower = (click_error or "").lower()
        click_intercepted = any(text in click_lower for text in ("hcaptcha", "recaptcha", "captcha", "security challenge"))
        return {
            "iframe_count": iframe_count,
            "visible_captcha_count": visible_captcha_count,
            "captcha_iframe_visible": visible_captcha_count > 0,
            "captcha_overlay_detected": captcha_text_detected or visible_captcha_count > 0,
            "click_intercepted_by_captcha": click_intercepted,
        }

    def _captcha_active(self, captcha_debug: Dict[str, Any]) -> bool:
        return bool(
            captcha_debug.get("visible_captcha_count")
            or captcha_debug.get("captcha_overlay_detected")
            or captcha_debug.get("click_intercepted_by_captcha")
        )

    async def _wait_after_submit(self, page: Any) -> None:
        deadline = asyncio.get_running_loop().time() + 20
        while asyncio.get_running_loop().time() < deadline:
            if await self._submission_success_detected(page):
                return
            try:
                await page.wait_for_load_state("networkidle", timeout=2500)
            except Exception:
                await page.wait_for_timeout(1000)

    async def _post_submit_diagnostics(
        self,
        page: Any,
        submit_selector: str,
        network_statuses: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        try:
            raw_text = await page.locator("body").inner_text(timeout=5000)
        except Exception:
            raw_text = ""
        text = " ".join(raw_text.split())
        lower = canonical(text)
        confirmation_text_found = self._confirmation_text_found(lower)
        post_submit_errors = self._post_submit_errors(text)
        try:
            submit_button_still_visible = await page.locator(submit_selector).first.is_visible(timeout=1500)
        except Exception:
            submit_button_still_visible = False
        return {
            "post_submit_page_text_excerpt": text[:2000],
            "post_submit_errors": post_submit_errors,
            "submit_button_still_visible": submit_button_still_visible,
            "confirmation_text_found": confirmation_text_found,
            "lever_network_submit_statuses": network_statuses[-20:],
        }

    def _confirmation_text_found(self, canonical_text: str) -> Optional[str]:
        phrases = (
            "your application has been submitted",
            "application submitted",
            "thank you for applying",
            "thanks for applying",
            "we ve received your application",
            "we have received your application",
            "your application has been received",
            "application has been received",
        )
        for phrase in phrases:
            if phrase in canonical_text:
                return phrase
        return None

    def _post_submit_errors(self, page_text: str) -> List[str]:
        lines = [line.strip() for line in page_text.splitlines() if line.strip()]
        error_terms = ("required", "error", "invalid", "please", "missing", "failed", "could not", "must")
        errors = []
        for line in lines:
            normalized = canonical(line)
            if any(term in normalized for term in error_terms):
                errors.append(line[:300])
            if len(errors) >= 10:
                break
        return errors

    async def _submission_success_detected(self, page: Any) -> bool:
        try:
            await page.wait_for_timeout(1500)
            body_text = canonical(await page.locator("body").inner_text(timeout=5000))
        except Exception:
            body_text = ""
        success_phrases = (
            "application submitted",
            "thank you for applying",
            "your application has been submitted",
            "your application has been received",
            "application has been received",
            "thanks for applying",
            "we ve received your application",
            "we have received your application",
        )
        if any(phrase in body_text for phrase in success_phrases):
            return True
        url = page.url.lower()
        return any(token in url for token in ("confirmation", "success", "submitted", "thank-you", "thank_you"))

    def _filled(self, field: Dict[str, Any], fill: Dict[str, Any]) -> Dict[str, Any]:
        return {
            **self._field_summary(field),
            "source": fill.get("source"),
            "confidence": fill.get("confidence", 0.0),
        }

    def _field_summary(self, field: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "name": field.get("name"),
            "id": field.get("id"),
            "label": field.get("label"),
            "type": field.get("type"),
            "placeholder": field.get("placeholder"),
            "options": field.get("options") or [],
            "aria_label": field.get("aria_label"),
            "nearby_text": field.get("nearby_text"),
            "field_container_text": field.get("field_container_text"),
            "matched_value": None,
            "match_source": None,
            "attempted_fill": False,
            "fill_success": False,
            "value_after_fill": field.get("value_before") or field.get("nearby_text") or "",
            "required": bool(field.get("required")),
            "visible": bool(field.get("visible")),
            "disabled": bool(field.get("disabled")),
        }
