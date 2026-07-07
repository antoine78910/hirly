"""Playwright browser/context lifecycle.

Kept deliberately thin and ATS-agnostic -- there is nothing per-provider
here, unlike the old browser_submission engines where each provider
subclassed a base engine. Any apply URL goes through the same launch path.
"""

from __future__ import annotations

import base64
import logging
import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Dict, Optional

from application_documents import cover_letter_to_text

from .models import ApplyAgentError

logger = logging.getLogger(__name__)


def _chromium_executable_path() -> Optional[str]:
    """Nixpacks builds run in a sandboxed Nix environment without apt, so
    Playwright's own bundled-browser download + `install-deps` doesn't work
    there. `nixpacks.toml` installs Nix's own self-contained `chromium`
    package instead; this points Playwright at it directly. Local dev
    machines where `playwright install chromium` was run normally have no
    such env var/binary and fall back to Playwright's default resolution.
    """
    explicit = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
    if explicit and Path(explicit).exists():
        return explicit
    for name in ("chromium", "chromium-browser", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def browser_context_options() -> Dict[str, Any]:
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


@asynccontextmanager
async def launch_page(*, headless: bool = True) -> AsyncIterator[Any]:
    """Yields a ready-to-use Playwright `Page`. Closes browser/context/page on
    exit regardless of outcome.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise ApplyAgentError(
            "open_browser",
            "Playwright is not installed. Run `pip install -r backend/requirements.txt` "
            "and `python -m playwright install chromium` (local dev only -- Railway uses "
            "the Nix chromium package instead, see nixpacks.toml).",
            exception_class=exc.__class__.__name__,
        ) from exc

    executable_path = _chromium_executable_path()
    async with async_playwright() as p:
        browser = None
        context = None
        try:
            launch_kwargs: Dict[str, Any] = {"headless": headless}
            if executable_path:
                launch_kwargs["executable_path"] = executable_path
            browser_user_data_dir = os.environ.get("BROWSER_USER_DATA_DIR")
            context_options = browser_context_options()
            if browser_user_data_dir:
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=browser_user_data_dir,
                    **launch_kwargs,
                    **context_options,
                )
            else:
                browser = await p.chromium.launch(**launch_kwargs)
                context = await browser.new_context(**context_options)
            page = await context.new_page()
            try:
                yield page
            finally:
                await page.close()
        except ApplyAgentError:
            raise
        except Exception as exc:
            raise ApplyAgentError(
                "open_browser",
                f"Failed to launch browser: {exc.__class__.__name__}: {str(exc)[:300]}",
                exception_class=exc.__class__.__name__,
            ) from exc
        finally:
            if context is not None:
                await context.close()
            if browser is not None:
                await browser.close()


def write_resume_file(app_doc: Dict[str, Any], tmpdir: str) -> Optional[str]:
    resume_b64 = app_doc.get("tailored_cv_file_b64")
    if not resume_b64:
        return None
    filename = app_doc.get("tailored_cv_filename") or "tailored_cv.docx"
    path = Path(tmpdir) / safe_filename(filename)
    path.write_bytes(base64.b64decode(resume_b64))
    return str(path)


def write_cover_letter_file(app_doc: Dict[str, Any], tmpdir: str) -> Optional[str]:
    text = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
    if not text.strip():
        return None
    path = Path(tmpdir) / "cover_letter.txt"
    path.write_text(text, encoding="utf-8")
    return str(path)


def safe_filename(filename: str) -> str:
    return "".join(char if char.isalnum() or char in "._-" else "_" for char in filename) or "tailored_cv.docx"


async def screenshot_b64(page: Any) -> str:
    try:
        raw = await page.screenshot(full_page=True, type="jpeg", quality=60)
        return base64.b64encode(raw).decode("ascii")
    except Exception as exc:
        logger.warning("apply_agent_screenshot_failed error=%s", str(exc)[:200])
        return ""
