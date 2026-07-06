"""Heuristic friendliness prober for unrecognized ("company") career pages.

Mirrors the manual criteria used to audit known ATS platforms: no mandatory
candidate login/account creation, no CAPTCHA/bot-wall, and (where visible) a
real CV/resume upload field. This is a cheap, static-HTML heuristic — the same
limitation applies as elsewhere in this codebase's "cheap" validation: a
JavaScript-rendered application form won't reveal its real fields to a plain
HTTP GET, so a probe that can't see a form returns is_friendly=False rather
than guessing.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, Optional

import httpx

LOGIN_MARKERS = (
    "sign in",
    "log in",
    "login",
    "create an account",
    "create account",
    "already have an account",
    "register to apply",
)

CAPTCHA_MARKERS = (
    "recaptcha",
    "hcaptcha",
    "g-recaptcha",
    "grecaptcha",
    "turnstile",
    "px-captcha",
    "perimeterx",
)

FILE_UPLOAD_MARKERS = (
    "upload your resume",
    "upload your cv",
    "upload resume",
    "upload cv",
    "drop file",
    "drag and drop",
    "déposez votre cv",
    "select or drop files",
)

_PASSWORD_INPUT_RE = re.compile(r'type=["\']password["\']', re.IGNORECASE)
_FILE_INPUT_RE = re.compile(r'type=["\']file["\']', re.IGNORECASE)

_DEFAULT_TIMEOUT_SECONDS = 10.0
_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


async def probe_career_page_friendliness(
    url: str,
    *,
    client: Optional[httpx.AsyncClient] = None,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """Fetch a career/apply page and assess it against the friendliness criteria.

    Returns a dict with individual signal booleans plus an overall
    ``is_friendly`` verdict. On any fetch error, ``is_friendly`` is False and
    ``fetch_error`` carries the reason — callers should not upsert a page as
    friendly when the probe itself failed.
    """

    effective_timeout = timeout if timeout is not None else _env_float(
        "COMPANY_CAREER_PAGE_PROBE_TIMEOUT_SECONDS", _DEFAULT_TIMEOUT_SECONDS
    )
    owns_client = client is None
    active_client = client or httpx.AsyncClient(
        timeout=effective_timeout,
        headers={"User-Agent": _DEFAULT_USER_AGENT},
        follow_redirects=True,
    )
    try:
        response = await active_client.get(url)
        response.raise_for_status()
        html = response.text
    except Exception as exc:  # noqa: BLE001 - any network/HTTP failure is a probe failure
        return {
            "url": url,
            "is_friendly": False,
            "requires_login": None,
            "captcha_detected": None,
            "has_file_upload": None,
            "fetch_error": f"{exc.__class__.__name__}: {str(exc)[:200]}",
        }
    finally:
        if owns_client:
            await active_client.aclose()

    text = html.lower()
    requires_login = bool(_PASSWORD_INPUT_RE.search(html)) or any(marker in text for marker in LOGIN_MARKERS)
    captcha_detected = any(marker in text for marker in CAPTCHA_MARKERS)
    has_file_upload = bool(_FILE_INPUT_RE.search(html)) or any(marker in text for marker in FILE_UPLOAD_MARKERS)

    is_friendly = not requires_login and not captcha_detected

    return {
        "url": url,
        "is_friendly": is_friendly,
        "requires_login": requires_login,
        "captcha_detected": captcha_detected,
        "has_file_upload": has_file_upload,
        "fetch_error": None,
    }


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
