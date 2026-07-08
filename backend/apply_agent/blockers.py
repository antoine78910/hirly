"""Deterministic, non-AI blocker detection: CAPTCHA, login walls, success.

None of this is judgment-call territory, so none of it goes through the LLM
agent. A CAPTCHA is either present in the DOM or it isn't; we never attempt
to solve or bypass one -- detecting it just aborts the run and hands off to
manual fulfillment. Reuses the same marker vocabulary as
`company_career_page_prober.py`'s static pre-classification probe, extended
with live-DOM checks (iframes, password inputs) that only a rendered page
can reveal.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from company_career_page_prober import CAPTCHA_MARKERS, LOGIN_MARKERS

from .guardrails import canonical

SUCCESS_PHRASES = (
    "application submitted",
    "thank you for applying",
    "your application has been submitted",
    "your application has been received",
    "application has been received",
    "thanks for applying",
    "we ve received your application",
    "we have received your application",
)

SUCCESS_URL_TOKENS = ("confirmation", "success", "submitted", "thank-you", "thank_you")

_POST_SUBMIT_ERROR_TERMS = ("required", "error", "invalid", "please", "missing", "failed", "could not", "must")


async def detect_captcha(page: Any, *, click_error: str = "") -> Dict[str, Any]:
    try:
        iframe_count = await page.locator(
            'iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="turnstile"]'
        ).count()
    except Exception:
        iframe_count = 0
    try:
        visible_captcha_count = await page.locator(
            'iframe[src*="hcaptcha"]:visible, iframe[src*="recaptcha"]:visible, iframe[src*="turnstile"]:visible, '
            '[class*="hcaptcha"]:visible, [class*="recaptcha"]:visible, [class*="turnstile"]:visible, '
            '[id*="hcaptcha"]:visible, [id*="recaptcha"]:visible'
        ).count()
    except Exception:
        visible_captcha_count = 0
    try:
        body_text = canonical(await page.locator("body").inner_text(timeout=3000))
    except Exception:
        body_text = ""
    captcha_text_detected = any(marker in body_text for marker in CAPTCHA_MARKERS) or any(
        text in body_text for text in ("security challenge", "verify you are human")
    )
    click_lower = canonical(click_error)
    click_intercepted = any(text in click_lower for text in ("hcaptcha", "recaptcha", "captcha", "security challenge"))
    return {
        "iframe_count": iframe_count,
        "visible_captcha_count": visible_captcha_count,
        "captcha_overlay_detected": captcha_text_detected or visible_captcha_count > 0,
        "click_intercepted_by_captcha": click_intercepted,
    }


def captcha_active(debug: Dict[str, Any]) -> bool:
    return bool(
        debug.get("visible_captcha_count")
        or debug.get("captcha_overlay_detected")
        or debug.get("click_intercepted_by_captcha")
    )


async def detect_login_wall(page: Any) -> bool:
    try:
        password_input_count = await page.locator('input[type="password"]').count()
    except Exception:
        password_input_count = 0
    if password_input_count:
        return True
    try:
        body_text = canonical(await page.locator("body").inner_text(timeout=3000))
    except Exception:
        body_text = ""
    return any(marker in body_text for marker in LOGIN_MARKERS)


async def dismiss_cookie_banner(page: Any) -> None:
    for text in ("Accept", "Accept all", "I agree", "Got it", "OK"):
        try:
            button = page.get_by_role("button", name=text)
            if await button.count():
                await button.first.click(timeout=1500)
                return
        except Exception:
            continue


APPLY_CTA_PHRASES = (
    "apply for this job",
    "apply for this position",
    "apply now",
    "apply to this job",
    "i'm interested",
    "im interested",
    "postuler",
    "je postule",
    "candidater",
    "deposer ma candidature",
)


async def reveal_apply_form(page: Any) -> bool:
    """Several ATS (confirmed live on Ashby, Flatchr, and Lever's hosted
    posting page) render only a job-summary landing page until an explicit
    "Apply" call-to-action is clicked -- the real form doesn't exist in the
    DOM before that. Generic phrase list, not a per-provider selector, so it
    applies the same way to any ATS or arbitrary career portal with this
    pattern. Returns True if something was clicked (caller should re-run
    perception afterwards); False means no matching CTA was found, so the
    caller proceeds with whatever it already had.
    """
    for phrase in APPLY_CTA_PHRASES:
        for role in ("button", "link"):
            try:
                locator = page.get_by_role(role, name=phrase)
                if await locator.count():
                    await locator.first.click(timeout=3000)
                    return True
            except Exception:
                continue
    return False


def confirmation_text_found(page_text_canonical: str) -> Optional[str]:
    for phrase in SUCCESS_PHRASES:
        if phrase in page_text_canonical:
            return phrase
    return None


def collect_post_submit_errors(page_text: str) -> List[str]:
    lines = [line.strip() for line in page_text.splitlines() if line.strip()]
    errors: List[str] = []
    for line in lines:
        if any(term in canonical(line) for term in _POST_SUBMIT_ERROR_TERMS):
            errors.append(line[:300])
        if len(errors) >= 10:
            break
    return errors


async def submission_success_detected(page: Any) -> bool:
    try:
        await page.wait_for_timeout(1500)
        body_text = canonical(await page.locator("body").inner_text(timeout=5000))
    except Exception:
        body_text = ""
    if confirmation_text_found(body_text):
        return True
    url = str(page.url or "").lower()
    return any(token in url for token in SUCCESS_URL_TOKENS)
