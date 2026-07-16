"""Playwright browser/context lifecycle.

Kept deliberately thin and ATS-agnostic -- there is nothing per-provider
here, unlike the old browser_submission engines where each provider
subclassed a base engine. Any apply URL goes through the same launch path.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import random
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from application_documents import cover_letter_to_text

from .models import ApplyAgentError

logger = logging.getLogger(__name__)

# Keep UA on a recent Chrome major so headless fingerprints look less stale.
_DEFAULT_CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

_STEALTH_INIT_SCRIPT = """
(() => {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch (e) {}
  try {
    // Playwright / Chromium often expose an empty chrome object; real Chrome has runtime.
    window.chrome = window.chrome || { runtime: {} };
  } catch (e) {}
  try {
    const languages = %LANGUAGE_JSON%;
    Object.defineProperty(navigator, 'languages', { get: () => languages });
    Object.defineProperty(navigator, 'language', { get: () => languages[0] || 'en-US' });
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
  } catch (e) {}
  try {
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query
      ? window.navigator.permissions.query.bind(window.navigator.permissions)
      : null;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => (
        parameters && parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );
    }
  } catch (e) {}
  try {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
  } catch (e) {}
})();
"""


def _chromium_executable_path() -> Optional[str]:
    """Railway's builder (Railpack) installs Chromium via a `railpack.json`
    build step (`playwright install chromium`) into `PLAYWRIGHT_BROWSERS_PATH`
    -- Playwright finds that on its own via the env var, no explicit path
    needed here. This function is a fallback for the uncommon case of a
    system-installed `chromium`/`chromium-browser`/`google-chrome` binary on
    PATH (e.g. a container image that ships one directly); when nothing
    matches, `launch_page()` omits `executable_path` entirely and Playwright
    falls back to its own normal resolution (PLAYWRIGHT_BROWSERS_PATH if set,
    else its default cache dir -- exactly what local dev machines use after
    running `playwright install chromium` normally).
    """
    explicit = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH")
    if explicit and Path(explicit).exists():
        return explicit
    for name in ("chromium", "chromium-browser", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def browser_locale() -> str:
    return os.environ.get("BROWSER_LOCALE", "fr-FR")


def browser_context_options() -> Dict[str, Any]:
    locale = browser_locale()
    lang_primary = locale.split("-")[0] if locale else "fr"
    width = int(os.environ.get("BROWSER_VIEWPORT_WIDTH", "1440"))
    height = int(os.environ.get("BROWSER_VIEWPORT_HEIGHT", "960"))
    # Small jitter so every session is not pixel-identical.
    width += random.randint(-24, 24)
    height += random.randint(-18, 18)
    options: Dict[str, Any] = {
        "viewport": {"width": max(1200, width), "height": max(800, height)},
        "user_agent": os.environ.get("BROWSER_USER_AGENT", _DEFAULT_CHROME_UA),
        "locale": locale,
        "timezone_id": os.environ.get("BROWSER_TIMEZONE", "Europe/Paris"),
        "color_scheme": "light",
        "has_touch": False,
        "is_mobile": False,
        "device_scale_factor": 1,
        "extra_http_headers": {
            "Accept-Language": (
                f"{locale},{lang_primary};q=0.9,en-US;q=0.8,en;q=0.7"
            ),
            "Upgrade-Insecure-Requests": "1",
        },
    }
    storage_state = os.environ.get("BROWSER_STORAGE_STATE", "").strip()
    if storage_state and Path(storage_state).exists():
        options["storage_state"] = storage_state
    return options


def chromium_launch_args(*, headless: bool = True) -> List[str]:
    args = [
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-infobars",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--use-mock-keychain",
    ]
    # Prefer the "new" headless implementation when headless; it fingerprints
    # closer to real Chrome than the old headless shell.
    if headless:
        args.append("--headless=new")
    return args


def stealth_init_script() -> str:
    locale = browser_locale()
    languages = [locale]
    primary = locale.split("-")[0]
    if primary and primary not in languages:
        languages.append(primary)
    for extra in ("en-US", "en"):
        if extra not in languages:
            languages.append(extra)
    return _STEALTH_INIT_SCRIPT.replace("%LANGUAGE_JSON%", json.dumps(languages))


def parse_proxy_credentials(raw: str) -> Optional[Dict[str, str]]:
    """Parse PrivateProxy-style `user:pass:host:port` or a full proxy URL.

    Supported:
      jw7ib-fr:secret:edge1-us.privateproxy.me:8888
      http://user:pass@host:8888
      host:8888  (no auth)
    """
    value = (raw or "").strip()
    if not value:
        return None
    if "://" in value:
        # http://user:pass@host:port
        try:
            from urllib.parse import urlparse, unquote
            parsed = urlparse(value if "://" in value else f"http://{value}")
            if not parsed.hostname or not parsed.port:
                return None
            server = f"{parsed.scheme or 'http'}://{parsed.hostname}:{parsed.port}"
            out: Dict[str, str] = {"server": server}
            if parsed.username:
                out["username"] = unquote(parsed.username)
            if parsed.password:
                out["password"] = unquote(parsed.password)
            return out
        except Exception:
            return None
    parts = value.split(":")
    if len(parts) == 2:
        host, port = parts
        if host and port.isdigit():
            return {"server": f"http://{host}:{port}"}
        return None
    if len(parts) >= 4:
        # user:pass:host:port — password may contain ':' so take last two as host/port
        port = parts[-1]
        host = parts[-2]
        user = parts[0]
        password = ":".join(parts[1:-2])
        if not (host and port.isdigit() and user):
            return None
        return {
            "server": f"http://{host}:{port}",
            "username": user,
            "password": password,
        }
    return None


def browser_proxy_settings() -> Optional[Dict[str, str]]:
    """Playwright proxy dict from env, or None when unset.

    Prefer one of:
      BROWSER_PROXY=user:pass:host:port
      BROWSER_PROXY_SERVER=http://host:port + BROWSER_PROXY_USERNAME + BROWSER_PROXY_PASSWORD
      BROWSER_PROXY_URL=http://user:pass@host:port

    Optional sticky session (PrivateProxy-style): set BROWSER_PROXY_STICKY=1 to append
    `-session-<random>` to the username so each browser run keeps one IP.
    """
    raw = (
        os.environ.get("BROWSER_PROXY", "").strip()
        or os.environ.get("BROWSER_PROXY_URL", "").strip()
    )
    proxy = parse_proxy_credentials(raw) if raw else None
    if proxy is None:
        server = os.environ.get("BROWSER_PROXY_SERVER", "").strip()
        if server:
            if "://" not in server:
                server = f"http://{server}"
            proxy = {"server": server}
            user = os.environ.get("BROWSER_PROXY_USERNAME", "").strip()
            password = os.environ.get("BROWSER_PROXY_PASSWORD", "").strip()
            if user:
                proxy["username"] = user
            if password:
                proxy["password"] = password
    if not proxy:
        return None
    # Optional sticky username rewrite. PrivateProxy sticky formats vary — set
    # BROWSER_PROXY_SESSION_TEMPLATE explicitly, e.g.
    #   "{username}-session-{session}"  or  "{username}-sessionduration-15"
    # BROWSER_PROXY_STICKY=1 alone uses a conservative sessionduration suffix.
    template = os.environ.get("BROWSER_PROXY_SESSION_TEMPLATE", "").strip()
    sticky = os.environ.get("BROWSER_PROXY_STICKY", "").strip().lower() in ("1", "true", "yes")
    if proxy.get("username") and (template or sticky):
        session = f"{random.randint(100000, 999999)}{random.randint(1000, 9999)}"
        username = proxy["username"]
        if template:
            proxy["username"] = (
                template.replace("{username}", username).replace("{session}", session)
            )
        elif "sessionduration" not in username and "-session-" not in username:
            # Common PrivateProxy sticky pattern (minutes). Override via TEMPLATE if needed.
            proxy["username"] = f"{username}-sessionduration-15"
    return proxy


def _load_cookies_from_env() -> List[Dict[str, Any]]:
    """Optional cookie injection for warmer ATS sessions.

    Env formats:
      BROWSER_COOKIES_JSON='[{"name":"a","value":"b","domain":".smartrecruiters.com","path":"/"}]'
      BROWSER_COOKIES_FILE=/path/to/cookies.json
    """
    raw = os.environ.get("BROWSER_COOKIES_JSON", "").strip()
    path = os.environ.get("BROWSER_COOKIES_FILE", "").strip()
    payload = raw
    if not payload and path and Path(path).exists():
        payload = Path(path).read_text(encoding="utf-8")
    if not payload:
        return []
    try:
        data = json.loads(payload)
    except Exception as exc:
        logger.warning("browser_cookies_parse_failed error=%s", str(exc)[:200])
        return []
    if isinstance(data, dict) and isinstance(data.get("cookies"), list):
        data = data["cookies"]
    if not isinstance(data, list):
        return []
    cookies: List[Dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        value = item.get("value")
        domain = str(item.get("domain") or "").strip()
        if not name or value is None or not domain:
            continue
        cookie = {
            "name": name,
            "value": str(value),
            "domain": domain,
            "path": str(item.get("path") or "/"),
        }
        for key in ("expires", "httpOnly", "secure", "sameSite"):
            if key in item and item[key] is not None:
                cookie[key] = item[key]
        cookies.append(cookie)
    return cookies


def headed_browser_available() -> bool:
    """True when the host can open a visible Chromium window (local dev)."""
    if os.name == "nt":
        return True
    if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
        return True
    return False


def effective_headless(requested: bool = True) -> bool:
    """Servers without a display must stay headless even if the client asks otherwise."""
    if not requested and headed_browser_available():
        return False
    if not requested and not headed_browser_available():
        logger.warning("headed_browser_unavailable_forcing_headless")
    return True


async def _apply_cookies(context: Any) -> None:
    cookies = _load_cookies_from_env()
    if not cookies:
        return
    try:
        await context.add_cookies(cookies)
        logger.info("browser_cookies_injected count=%s", len(cookies))
    except Exception as exc:
        logger.warning("browser_cookies_inject_failed error=%s", str(exc)[:200])


@asynccontextmanager
async def launch_page(*, headless: bool = True) -> AsyncIterator[Any]:
    """Yields a ready-to-use Playwright `Page`. Closes browser/context/page on
    exit regardless of outcome.
    """
    headless = effective_headless(headless)
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
    channel = (os.environ.get("BROWSER_CHANNEL") or "").strip() or None
    async with async_playwright() as p:
        browser = None
        context = None
        try:
            launch_kwargs: Dict[str, Any] = {
                # When using --headless=new, Playwright still needs headless=True
                # for the API contract; the arg selects the newer implementation.
                "headless": headless,
                "args": chromium_launch_args(headless=headless),
                # Drop Playwright's default --enable-automation flag.
                "ignore_default_args": ["--enable-automation"],
            }
            if channel:
                launch_kwargs["channel"] = channel
            elif executable_path:
                launch_kwargs["executable_path"] = executable_path
            proxy = browser_proxy_settings()
            if proxy:
                launch_kwargs["proxy"] = proxy
                logger.info(
                    "browser_proxy_enabled server=%s user=%s",
                    proxy.get("server"),
                    (proxy.get("username") or "")[:24] or "-",
                )
            browser_user_data_dir = os.environ.get("BROWSER_USER_DATA_DIR")
            context_options = browser_context_options()
            if proxy and not browser_user_data_dir:
                # Non-persistent contexts also need proxy on the context.
                context_options["proxy"] = proxy
            init_script = stealth_init_script()
            if browser_user_data_dir:
                # Persistent profile keeps real cookies / localStorage across runs.
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=browser_user_data_dir,
                    **launch_kwargs,
                    **context_options,
                )
            else:
                browser = await p.chromium.launch(**launch_kwargs)
                context = await browser.new_context(**context_options)
            await context.add_init_script(init_script)
            await _apply_cookies(context)
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
