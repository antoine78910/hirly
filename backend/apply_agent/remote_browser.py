"""Remote anti-detect browsers (Bright Data Browser API / Scraping Browser).

SmartRecruiters + DataDome fingerprint local Chromium on Railway. When
``BRIGHTDATA_BROWSER_USER`` + ``BRIGHTDATA_BROWSER_PASSWORD`` are set and a
driver opts in via ``prefer_remote=True``, ``launch_page`` connects over CDP
instead of launching a local browser + PrivateProxy.
"""
from __future__ import annotations

import logging
import os
from typing import Optional
from urllib.parse import quote

logger = logging.getLogger(__name__)

_DEFAULT_HOST = "brd.superproxy.io"
_DEFAULT_PORT = "9222"


def remote_browser_mode() -> str:
    """off | auto | brightdata"""
    return (os.environ.get("BROWSER_REMOTE") or "auto").strip().lower()


def brightdata_credentials() -> Optional[tuple[str, str]]:
    user = (
        os.environ.get("BRIGHTDATA_BROWSER_USER")
        or os.environ.get("BRIGHT_DATA_BROWSER_USER")
        or ""
    ).strip()
    password = (
        os.environ.get("BRIGHTDATA_BROWSER_PASSWORD")
        or os.environ.get("BRIGHT_DATA_BROWSER_PASSWORD")
        or ""
    ).strip()
    if not user or not password:
        return None
    return user, password


def brightdata_configured() -> bool:
    return brightdata_credentials() is not None


def brightdata_username_with_country(username: str) -> str:
    """Append ``-country-XX`` when BROWSER_REMOTE_COUNTRY is set and missing."""
    country = (os.environ.get("BROWSER_REMOTE_COUNTRY") or "fr").strip().lower()
    if not country or len(country) != 2:
        return username
    token = f"-country-{country}"
    if token in username.lower():
        return username
    return f"{username}{token}"


def brightdata_ws_endpoint() -> Optional[str]:
    """Playwright ``connect_over_cdp`` WebSocket URL, or None if unset."""
    creds = brightdata_credentials()
    if not creds:
        return None
    user, password = creds
    user = brightdata_username_with_country(user)
    host = (os.environ.get("BRIGHTDATA_BROWSER_HOST") or _DEFAULT_HOST).strip() or _DEFAULT_HOST
    port = (os.environ.get("BRIGHTDATA_BROWSER_PORT") or _DEFAULT_PORT).strip() or _DEFAULT_PORT
    auth = f"{quote(user, safe='')}:{quote(password, safe='')}"
    return f"wss://{auth}@{host}:{port}"


def should_use_remote_browser(*, prefer_remote: bool) -> bool:
    if not prefer_remote:
        return False
    mode = remote_browser_mode()
    if mode in ("0", "false", "off", "no", "local", "none"):
        return False
    if mode in ("auto", "brightdata", "1", "true", "on", "yes"):
        return brightdata_configured()
    return False


def remote_fallback_to_local() -> bool:
    return os.environ.get("BROWSER_REMOTE_FALLBACK", "1").strip().lower() not in (
        "0", "false", "no", "off",
    )


def remote_browser_label() -> str:
    if brightdata_configured():
        return "brightdata"
    return "none"
