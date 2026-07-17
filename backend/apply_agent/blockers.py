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

from application_failure import text_indicates_offer_expired
from company_career_page_prober import CAPTCHA_MARKERS, LOGIN_MARKERS

from .guardrails import canonical

# SmartRecruiters (and similar) replace the Apply CTA with expired copy.
_APPLY_CTA_SELECTORS = (
    "#st-apply",
    'a[data-sr-track="apply"]',
    'a.js-oneclick[href*="oneclick-ui"]',
    'button:has-text("Je suis intéressé")',
    'a:has-text("Je suis intéressé")',
    'button:has-text("I\'m interested")',
    'a:has-text("I\'m interested")',
    'button:has-text("expir")',
    'a:has-text("expir")',
    'button:has-text("no longer")',
    'a:has-text("no longer")',
)

SUCCESS_PHRASES = (
    "application submitted",
    "thank you for applying",
    "your application has been submitted",
    "your application has been received",
    "application has been received",
    "thanks for applying",
    "we ve received your application",
    "we have received your application",
    "merci pour votre candidature",
    "votre candidature a ete envoyee",
    "votre candidature a été envoyée",
    "candidature envoyee",
    "candidature envoyée",
)

SUCCESS_URL_TOKENS = ("confirmation", "success", "submitted", "thank-you", "thank_you")

BOT_WALL_MARKERS = (
    "access is temporarily restricted",
    "temporarily restricted",
    "unusual activity from your device",
    "unusual activity",
    "automated (bot) activity",
    "verify you are human",
    "security challenge",
    # DataDome / PerimeterX style interstitials (JS is enabled; this copy is the block).
    "please enable js",
    "please enable javascript",
    "disable any ad blocker",
    "disable your ad blocker",
    "enable js and disable",
    # French SmartRecruiters / DataDome copy (canonicalized, accents stripped).
    "acces temporairement restreint",
    "temporairement restreint",
    "comportement du navigateur",
    "vitesse surhumaine",
    "un robot est sur le meme reseau",
    "quelque chose bloque le fonctionnement de javascript",
)

_POST_SUBMIT_ERROR_TERMS = ("required", "error", "invalid", "please", "missing", "failed", "could not", "must")


async def detect_captcha(page: Any, *, click_error: str = "") -> Dict[str, Any]:
    try:
        iframe_count = await page.locator(
            'iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="turnstile"], '
            'iframe[src*="captcha-delivery.com"]'
        ).count()
    except Exception:
        iframe_count = 0
    try:
        visible_captcha_count = await page.locator(
            'iframe[src*="hcaptcha"]:visible, iframe[src*="recaptcha"]:visible, iframe[src*="turnstile"]:visible, '
            'iframe[src*="captcha-delivery.com"]:visible, '
            '[class*="hcaptcha"]:visible, [class*="recaptcha"]:visible, [class*="turnstile"]:visible, '
            '[id*="hcaptcha"]:visible, [id*="recaptcha"]:visible, '
            '#ddv1-captcha-container:visible, .captcha__ddv1:visible'
        ).count()
    except Exception:
        visible_captcha_count = 0
    try:
        body_text = canonical(await page.locator("body").inner_text(timeout=3000))
    except Exception:
        body_text = ""
    captcha_text_detected = any(marker in body_text for marker in CAPTCHA_MARKERS) or any(
        text in body_text
        for text in (
            "security challenge",
            "verify you are human",
            # DataDome FR interstitial (SmartRecruiters oneclick).
            "non pas a un robot",
            "faites glisser vers la droite",
            "verification visuelle",
        )
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


async def detect_bot_wall(page: Any, *, http_status: Optional[int] = None) -> bool:
    if http_status == 403:
        return True
    try:
        body_text = canonical(await page.locator("body").inner_text(timeout=3000))
    except Exception:
        body_text = ""
    return any(marker in body_text for marker in BOT_WALL_MARKERS)


async def detect_offer_expired(page: Any) -> bool:
    """True when the posting page shows the role is closed / expired.

    SmartRecruiters typically swaps "Je suis intéressé(e)" for copy like
    "Cette offre a expiré" on the same apply control — catch that early so we
    never treat it as a missing submit button.
    """
    for selector in _APPLY_CTA_SELECTORS:
        try:
            loc = page.locator(selector)
            if not await loc.count():
                continue
            label = await loc.first.inner_text(timeout=2000)
            if text_indicates_offer_expired(label):
                return True
        except Exception:
            continue
    try:
        body_text = await page.locator("body").inner_text(timeout=3000)
    except Exception:
        body_text = ""
    return text_indicates_offer_expired(body_text)


# OneTrust is one of the most widely used cookie-consent widgets across
# career sites (confirmed live on SmartRecruiters). Its accept/close
# controls use the same stable element IDs regardless of the page's
# language, so trying these first is more reliable than any phrase list --
# confirmed live that a generic text-based click nearby can accidentally
# open its "preference center" instead of accepting, leaving a
# click-intercepting dark overlay over the whole page.
_ONETRUST_ACCEPT_SELECTORS = (
    "#onetrust-accept-btn-handler",
    "#accept-recommended-btn-handler",
    # Preference-center reject-all (SR often reopens this mid-apply).
    "#onetrust-reject-all-handler",
    "button:has-text('Tout refuser')",
    "button:has-text('Reject all')",
    "button:has-text('Autoriser tous les cookies')",
    "button:has-text('Allow all cookies')",
    "button:has-text('Confirmer la sélection')",
    "button:has-text('Confirm my choices')",
)
_ONETRUST_CLOSE_SELECTORS = (
    "#close-pc-btn-handler",
    ".ot-close-icon",
    "button:has-text('Continuer sans accepter')",
    "a:has-text('Continuer sans accepter')",
)


async def _click_first_match(page: Any, selectors: tuple[str, ...]) -> bool:
    for selector in selectors:
        try:
            button = page.locator(selector)
            if await button.count():
                await button.first.click(timeout=1500)
                return True
        except Exception:
            continue
    return False


async def dismiss_cookie_banner(page: Any) -> None:
    if await _click_first_match(page, _ONETRUST_ACCEPT_SELECTORS):
        return

    # French phrases matter as much as English ones here -- confirmed live
    # on a real Teamtailor posting where the cookie panel (only "Accepter
    # tous les cookies" / "Refuser les cookies facultatifs", no English
    # option) was never dismissed, stayed open over the page, and perception
    # picked up only the cookie panel's own checkboxes instead of the
    # actual application form.
    for text in (
        "Accept", "Accept all", "I agree", "Got it", "OK",
        "Reject all", "Refuse all",
        "Accepter", "Accepter tous les cookies", "Tout accepter", "J'accepte",
        "Autoriser tous les cookies", "Allow all cookies",
        "Tout refuser", "Refuser", "Continuer sans accepter",
    ):
        try:
            button = page.get_by_role("button", name=text)
            if await button.count():
                await button.first.click(timeout=1500)
                break
        except Exception:
            continue

    # Whatever was just clicked may have opened a OneTrust preference-center
    # panel instead of accepting outright (confirmed live) -- if its dark
    # overlay is now covering the page, get out of it via OneTrust's own
    # controls rather than leaving every subsequent click intercepted.
    try:
        overlay_visible = await page.locator(".onetrust-pc-dark-filter").is_visible(timeout=1000)
    except Exception:
        overlay_visible = False
    if overlay_visible:
        await _click_first_match(page, _ONETRUST_CLOSE_SELECTORS + _ONETRUST_ACCEPT_SELECTORS)


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
    # Accented and unaccented forms both included since Playwright's
    # accessible-name matching is case-insensitive but not accent-folding --
    # confirmed live: SmartRecruiters' real CTA is "Je suis intéressé(e)".
    "je suis interesse",
    "je suis intéressé",
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
