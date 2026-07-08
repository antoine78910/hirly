"""Top-level orchestration: one entrypoint for any ATS or friendly custom
career portal, replacing the old provider-specific `prepare_fill()` methods.

Flow: navigate -> dismiss cookie banner -> check login wall / CAPTCHA (abort
to manual if either is present, no attempt to bypass) -> perceive the page
-> resolve file uploads deterministically -> ask the agent to plan the rest
-> validate every proposal against guardrails -> apply only what passed ->
re-perceive to catch newly-revealed conditional fields -> screenshot -> only
if click_submit=True and everything required is filled from an approved
source, click submit and verify success. Submission is never assumed; it is
only ever detected.
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from . import agent as agent_module
from . import blockers
from . import perception
from . import recipes as recipes_module
from .browser import launch_page, screenshot_b64, write_cover_letter_file, write_resume_file
from .guardrails import canonical
from .models import ApplyAgentError, ApplyRunResult, BrowserFile, blocker, calculate_success_likelihood

logger = logging.getLogger(__name__)

_TIMEOUT_MS = 45000


def _application_url(job: Dict[str, Any]) -> str:
    # "apply_url" (only Lever populates this distinctly today) is the ATS's
    # own direct-to-form link; "selected_apply_url" is often just the
    # job-description/hosted posting page, which for Lever specifically has
    # no form in the DOM at all (confirmed live: hostedUrl renders only a
    # cookie banner, the form lives at hostedUrl + "/apply"). Checked first
    # so it wins whenever present; every other provider still falls through
    # to selected_apply_url exactly as before since they don't set apply_url.
    for key in ("apply_url", "selected_apply_url", "external_url", "application_url", "hosted_url"):
        value = job.get(key)
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    return ""


def _domain(url: str) -> str:
    return (urlparse(url).netloc or "").lower().removeprefix("www.")


async def run_apply_attempt(
    job: Dict[str, Any],
    app_doc: Dict[str, Any],
    profile: Dict[str, Any],
    user: Dict[str, Any],
    *,
    click_submit: bool = False,
    headless: bool = True,
    db: Any = None,
    invent_missing_answers: bool = False,
) -> ApplyRunResult:
    """`invent_missing_answers` is test-only and never set by any request
    model the real API exposes -- it fills remaining required job-specific
    questions with a generic placeholder instead of leaving them for the
    user, purely to verify a submit click goes through end-to-end. Sensitive
    fields (visa, salary, EEO, ...) are still never invented: the
    placeholder's source isn't in guardrails' sensitive-field allowlist, so
    validate_agent_fill rejects it there exactly like any other unapproved
    guess.
    """
    url = _application_url(job)
    domain = _domain(url)
    provider = str(job.get("ats_provider") or job.get("provider") or "unknown")
    result = ApplyRunResult(provider=provider, application_url=url, domain=domain)
    recipe_key = recipes_module.recipe_key_for_url(url) if url else ""

    if not url:
        result.blockers.append(blocker("missing_apply_url", "No usable apply URL on this job."))
        result.failure_reason = "missing_apply_url"
        return result

    with tempfile.TemporaryDirectory(prefix="apply_agent_") as tmpdir:
        resume_path = write_resume_file(app_doc, tmpdir)
        cover_letter_path = write_cover_letter_file(app_doc, tmpdir)

        async with launch_page(headless=headless) as page:
            try:
                response = await page.goto(url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
                if response is not None and response.status >= 400:
                    raise ApplyAgentError("open_page", f"Apply page returned HTTP {response.status}.", target_url=url)
            except ApplyAgentError:
                raise
            except Exception as exc:
                raise ApplyAgentError("open_page", f"Failed to load apply page: {exc.__class__.__name__}", target_url=url) from exc

            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass

            await blockers.dismiss_cookie_banner(page)

            if await blockers.detect_login_wall(page):
                result.login_wall_detected = True
                result.blockers.append(blocker("login_wall_detected", "This apply page requires an account/login."))
                result.failure_reason = "login_wall_detected"
                result.screenshot_b64 = await screenshot_b64(page)
                return result

            captcha_debug = await blockers.detect_captcha(page)
            if blockers.captcha_active(captcha_debug):
                result.captcha_required = True
                result.action_required = True
                result.blockers.append(blocker("captcha_detected", "CAPTCHA or bot-wall detected before any fields were touched."))
                result.failure_reason = "captcha_required"
                result.screenshot_b64 = await screenshot_b64(page)
                return result

            fields = await perception.extract_fields(page)
            if not perception.looks_like_real_form(fields):
                # Landing page, not the form yet (confirmed live on Ashby,
                # Flatchr, SmartRecruiters, Workday) -- try the generic
                # "Apply" CTA and re-perceive. If nothing matched, `fields`
                # is untouched and behavior is identical to before this fix.
                if await blockers.reveal_apply_form(page):
                    try:
                        await page.wait_for_load_state("networkidle", timeout=6000)
                    except Exception:
                        pass
                    # A single fixed wait after the click isn't reliable --
                    # confirmed live on Flatchr, where the real form (an SPA
                    # route change) hadn't finished rendering by the time a
                    # one-shot re-perceive ran right after `networkidle`, so
                    # it silently fell through to the unrelated "new
                    # conditional fields" top-up pass later instead. Poll
                    # briefly instead of guessing a fixed delay.
                    deadline = asyncio.get_running_loop().time() + 5
                    while asyncio.get_running_loop().time() < deadline:
                        fields = await perception.extract_fields(page)
                        if perception.looks_like_real_form(fields):
                            break
                        await page.wait_for_timeout(500)
            result.fields_detected = fields
            if not fields:
                result.blockers.append(blocker("form_not_found", "No fillable fields were found on this page."))
                result.failure_reason = "form_not_found"
                result.screenshot_b64 = await screenshot_b64(page)
                return result

            candidate_context = agent_module.build_candidate_context(profile, app_doc, user)
            file_fills = agent_module.resolve_file_upload_fields(fields)

            recipe = await recipes_module.get_recipe(db, recipe_key) if db is not None and recipe_key else None
            recipe_proposals = recipes_module.propose_fills_from_recipe(fields, recipe, candidate_context)
            fields_needing_agent = recipes_module.uncovered_fields(
                [f for f in fields if f.get("widget_type") != "file_upload"], recipe_proposals,
            )
            agent_proposals = await agent_module.plan_fills(fields_needing_agent, job, candidate_context) if fields_needing_agent else []
            result.agent_plan = agent_proposals
            result.recipe_used = recipe_key if recipe_proposals else None
            accepted, rejected = agent_module.validated_plan(fields, file_fills + recipe_proposals + agent_proposals, profile)
            result.rejected_fills = rejected

            resume_uploaded = await _apply_fills(page, fields, accepted, resume_path, cover_letter_path, result)

            # Re-perceive: a previous answer may have revealed new conditional
            # fields (e.g. "please specify" follow-ups). One top-up pass only,
            # not a fixed-point loop -- keeps runtime and LLM cost bounded.
            await page.wait_for_timeout(500)
            fields_after = await perception.extract_fields(page)
            new_fields = [f for f in fields_after if f.get("required") and not any(
                f.get("stable_field_id") == existing.get("stable_field_id") for existing in fields
            ) and (f.get("widget_type") == "file_upload" or f.get("visible"))]
            if new_fields:
                # Same deterministic file-upload path as the main pass, not
                # just the LLM -- otherwise a resume/cover-letter field that
                # only appears in this top-up round (confirmed live on
                # Flatchr, where the reveal-form click's form took long
                # enough to render that the file inputs only showed up
                # here) never gets uploaded, since plan_fills always
                # excludes file_upload fields on purpose.
                new_file_fills = agent_module.resolve_file_upload_fields(new_fields)
                top_up_proposals = await agent_module.plan_fills(
                    [f for f in new_fields if f.get("widget_type") != "file_upload"],
                    job,
                    agent_module.build_candidate_context(profile, app_doc, user),
                )
                top_up_accepted, top_up_rejected = agent_module.validated_plan(new_fields, new_file_fills + top_up_proposals, profile)
                result.rejected_fills.extend(top_up_rejected)
                # OR'd in, not reassigned -- a resume uploaded in the first
                # pass must not be forgotten just because this second pass
                # uploaded nothing new.
                resume_uploaded = resume_uploaded or await _apply_fills(
                    page, new_fields, top_up_accepted, resume_path, cover_letter_path, result,
                )
                await page.wait_for_timeout(300)
                fields_after = await perception.extract_fields(page)

            def _compute_unfilled_required() -> List[Dict[str, Any]]:
                return [
                    f for f in fields_after
                    if f.get("required")
                    and not f.get("disabled")
                    and not _has_value(f)
                    # File uploads are routinely hidden behind a styled button/
                    # dropzone (visible=False but real and fillable -- see
                    # resolve_file_upload_fields), so a required-but-unfilled one
                    # must still be flagged; every other widget type keeps the
                    # visibility requirement since a hidden text/select/checkbox
                    # is usually conditionally-inactive, not a real blocker.
                    and (f.get("widget_type") == "file_upload" or f.get("visible"))
                ]

            unfilled_required = _compute_unfilled_required()
            if invent_missing_answers and unfilled_required:
                invented_proposals = agent_module.invent_placeholder_fills(unfilled_required)
                invented_accepted, invented_rejected = agent_module.validated_plan(unfilled_required, invented_proposals, profile)
                result.rejected_fills.extend(invented_rejected)
                resume_uploaded = resume_uploaded or await _apply_fills(
                    page, unfilled_required, invented_accepted, resume_path, cover_letter_path, result,
                )
                await page.wait_for_timeout(300)
                fields_after = await perception.extract_fields(page)
                unfilled_required = _compute_unfilled_required()
            for field in unfilled_required:
                code = "required_sensitive_field_missing" if _is_sensitive(field) else "required_field_unmatched"
                result.blockers.append(blocker(code, "Required field has no safe automatic answer.", field))
            result.unfilled_required_fields = unfilled_required

            result.screenshot_b64 = await screenshot_b64(page)
            result.success_likelihood = calculate_success_likelihood(
                result.blockers,
                unfilled_required,
                resume_uploaded=resume_uploaded,
                rejected_fill_count=len(result.rejected_fills),
            )
            result.ready_for_final_click = bool(
                result.fields_filled
                and not result.blockers
                and not unfilled_required
                and resume_uploaded
            )

            if result.ready_for_final_click and db is not None and recipe_key:
                await recipes_module.record_successful_fills(db, recipe_key, provider, accepted)
                result.recipe_recorded = True

            if not (click_submit and result.ready_for_final_click):
                result.failure_reason = None if result.ready_for_final_click else "not_ready_for_final_click"
                return result

            await _click_submit_and_verify(page, result)
            if db is not None and recipe_key and not result.captcha_required:
                # CAPTCHA outcomes are excluded from trust scoring -- they
                # reflect the site's bot-wall policy, not whether our fills
                # were correct, so they'd distort the success rate either way.
                await recipes_module.record_submit_outcome(db, recipe_key, provider, success=result.success_detected)
            return result


def _has_value(field: Dict[str, Any]) -> bool:
    if field.get("widget_type") in ("checkbox", "radio"):
        return bool(field.get("checked"))
    return bool(str(field.get("value_before") or field.get("current_value") or "").strip())


def _is_sensitive(field: Dict[str, Any]) -> bool:
    from .guardrails import is_sensitive_field
    return is_sensitive_field(field)


async def _frame_for(page: Any, field: Dict[str, Any]) -> Any:
    frame_index = field.get("frame_index") or 0
    frames = getattr(page, "frames", None) or [page.main_frame]
    if 0 <= frame_index < len(frames):
        return frames[frame_index]
    return page.main_frame


async def _apply_fills(
    page: Any,
    fields: List[Dict[str, Any]],
    accepted: List[Dict[str, Any]],
    resume_path: Optional[str],
    cover_letter_path: Optional[str],
    result: ApplyRunResult,
) -> bool:
    by_id = {f.get("stable_field_id"): f for f in fields}
    resume_uploaded = any(item.get("file_field") == "resume" for item in result.file_uploads)
    for fill in accepted:
        field = by_id.get(fill.get("stable_field_id"))
        if not field:
            continue
        try:
            frame = await _frame_for(page, field)
            locator = frame.locator(field["selector"]).first
            widget_type = field.get("widget_type") or field.get("type")
            value = fill.get("value")

            if widget_type == "file_upload":
                path = resume_path if value == "__resume_file__" else cover_letter_path if value == "__cover_letter_file__" else None
                if not path:
                    continue
                await locator.set_input_files(path, timeout=10000)
                filename = path.split("\\")[-1].split("/")[-1]
                result.file_uploads.append(BrowserFile(
                    field_name=field.get("name") or field.get("label") or "file",
                    filename=filename,
                    mime="application/octet-stream",
                    size_bytes=0,
                ))
                if value == "__resume_file__":
                    resume_uploaded = True
            elif widget_type == "select":
                await _fill_select(locator, field, str(value))
            elif widget_type in ("checkbox", "radio"):
                if str(value).strip().lower() not in ("", "false", "no", "0"):
                    await locator.check(timeout=3000)
            else:
                await locator.fill(str(value), timeout=5000)

            result.fields_filled.append({
                "stable_field_id": field.get("stable_field_id"),
                "label": field.get("label"),
                "value_preview": str(value)[:160],
                "source": fill.get("source"),
                "confidence": fill.get("confidence"),
            })
        except Exception as exc:
            result.blockers.append(blocker("field_fill_failed", f"{exc.__class__.__name__}: {str(exc)[:200]}", field))
    return resume_uploaded


async def _fill_select(locator: Any, field: Dict[str, Any], value: str) -> None:
    try:
        await locator.select_option(label=value, timeout=3000)
        return
    except Exception:
        pass
    try:
        await locator.select_option(value=value, timeout=3000)
        return
    except Exception:
        pass
    wanted = canonical(value)
    for option in field.get("options") or []:
        label = canonical(option.get("label") if isinstance(option, dict) else option)
        if wanted and (wanted == label or wanted in label or label in wanted):
            option_value = option.get("value") if isinstance(option, dict) else option
            await locator.select_option(value=str(option_value), timeout=3000)
            return
    raise ValueError(f"no matching select option for {value!r}")


async def _click_submit_and_verify(page: Any, result: ApplyRunResult) -> None:
    submit_selector = 'button[type="submit"], input[type="submit"], button:has-text("Submit")'
    try:
        locator = page.locator(submit_selector).first
        if not await locator.count():
            result.failure_reason = "submit_button_not_found"
            return
        captcha_before = await blockers.detect_captcha(page)
        if blockers.captcha_active(captcha_before):
            result.captcha_required = True
            result.action_required = True
            result.failure_reason = "captcha_required"
            result.screenshot_b64 = await screenshot_b64(page)
            return

        click_error = ""
        try:
            await locator.click(timeout=8000)
            result.submit_clicked = True
        except Exception as exc:
            click_error = str(exc)

        captcha_after = await blockers.detect_captcha(page, click_error=click_error)
        if blockers.captcha_active(captcha_after):
            result.captcha_required = True
            result.action_required = True
            result.failure_reason = "captcha_required"
            result.screenshot_b64 = await screenshot_b64(page)
            return
        if click_error:
            result.blockers.append(blocker("submit_click_failed", click_error[:300]))
            result.failure_reason = "submit_click_failed"
            return

        deadline = asyncio.get_running_loop().time() + 20
        while asyncio.get_running_loop().time() < deadline:
            if await blockers.submission_success_detected(page):
                break
            try:
                await page.wait_for_load_state("networkidle", timeout=2500)
            except Exception:
                await page.wait_for_timeout(1000)

        try:
            raw_text = await page.locator("body").inner_text(timeout=5000)
        except Exception:
            raw_text = ""
        text = " ".join(raw_text.split())
        canonical_text = canonical(text)
        result.confirmation_text_found = blockers.confirmation_text_found(canonical_text)
        result.post_submit_errors = blockers.collect_post_submit_errors(text)
        try:
            submit_still_visible = await locator.is_visible(timeout=1500)
        except Exception:
            submit_still_visible = False
        result.success_detected = bool(result.confirmation_text_found) or (not submit_still_visible and not result.post_submit_errors)
        result.failure_reason = None if result.success_detected else "submission_status_unknown"
        result.final_url = page.url
        result.screenshot_b64 = await screenshot_b64(page)
    except Exception as exc:
        result.blockers.append(blocker("submit_phase_error", f"{exc.__class__.__name__}: {str(exc)[:300]}"))
        result.failure_reason = "submit_phase_error"
