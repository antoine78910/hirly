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
import re
import shutil
import subprocess
import time
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
        # Do NOT set Upgrade-Insecure-Requests here: Playwright applies
        # extra_http_headers to every request (including module scripts /
        # XHR). That forces a CORS preflight SR/DataDome reject, so the
        # oneclick SPA never loads (infinite spinner, 0 form fields).
        "extra_http_headers": {
            "Accept-Language": (
                f"{locale},{lang_primary};q=0.9,en-US;q=0.8,en;q=0.7"
            ),
        },
    }
    # Prefer inline JSON (Railway-friendly secret) over a file path.
    storage_json = os.environ.get("BROWSER_STORAGE_STATE_JSON", "").strip()
    if storage_json:
        try:
            options["storage_state"] = json.loads(storage_json)
            logger.info("browser_storage_state_loaded source=json")
        except Exception as exc:
            logger.warning("browser_storage_state_json_invalid error=%s", str(exc)[:200])
    else:
        storage_state = os.environ.get("BROWSER_STORAGE_STATE", "").strip()
        if storage_state and Path(storage_state).exists():
            options["storage_state"] = storage_state
            logger.info("browser_storage_state_loaded source=file path=%s", storage_state)
    return options


def chromium_launch_args(*, headless: bool = False) -> List[str]:
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


def _strip_privateproxy_session_args(username: str) -> str:
    """Remove sid/ttl/swap suffixes so we can rebuild a clean sticky login.

    Keep country + city targeting (e.g. jw7ib-fr-city-montpellier).
    """
    cleaned = username or ""
    cleaned = re.sub(r"-sid-\d+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"-ttl-\d+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"-swap\b", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip("-")


# PrivateProxy (and similar) return these when an exit node cannot reach the ATS.
_PROXY_CONNECT_HTTP_STATUSES = frozenset({560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573})
_PROXY_CONNECT_TEXT_MARKERS = (
    "failed to connect to target host",
    "target host communication",
    "could not connect to target",
    "proxy error",
)


def is_proxy_connect_failure_status(http_status: Optional[int]) -> bool:
    """True for proxy-gateway statuses (e.g. PrivateProxy HTTP 572)."""
    if http_status is None:
        return False
    return int(http_status) in _PROXY_CONNECT_HTTP_STATUSES


def is_proxy_connect_failure_text(text: str) -> bool:
    lowered = (text or "").lower()
    return any(marker in lowered for marker in _PROXY_CONNECT_TEXT_MARKERS)


def is_transient_navigation_error(exc: BaseException) -> bool:
    text = f"{exc.__class__.__name__}: {exc}".lower()
    markers = (
        "err_timed_out",
        "err_empty_response",
        "err_connection_closed",
        "err_connection_reset",
        "err_tunnel_connection_failed",
        "err_proxy_connection_failed",
        "err_connection_refused",
        "timeout",
        "net::err_",
        "target host communication",
        "failed to connect to target host",
        "proxy could not reach",
        "http 572",
        "http 560",
        "http 561",
        "http 562",
        "http 563",
        "http 564",
        "http 565",
        "http 566",
        "http 567",
        "http 568",
        "http 569",
        "http 570",
        "http 571",
        "http 573",
    )
    return any(marker in text for marker in markers)


def browser_navigation_timeout_ms() -> int:
    """Longer timeout when traffic goes through a residential proxy.

    Keep proxy navigations bounded — dead exits should fail fast and rotate SID
    instead of burning ~90s per attempt (admin console looked "stuck" for minutes).
    """
    explicit = os.environ.get("BROWSER_NAVIGATION_TIMEOUT_MS", "").strip()
    if explicit.isdigit():
        return max(15000, int(explicit))
    if proxy_configured():
        return 45000
    return 30000


def privateproxy_sticky_username(
    username: str,
    *,
    sid: Optional[int] = None,
    ttl_minutes: int = 30,
) -> str:
    """Build PrivateProxy login: `{login}-{country}-sid-{n}-ttl-{minutes}`.

    Docs: parts separated by `-`; sid is 1..1000; ttl is minutes.
    Example: jw7ib-fr-sid-5-ttl-60
    """
    base = _strip_privateproxy_session_args(username)
    session_id = sid if sid is not None else random.randint(1, 1000)
    session_id = max(1, min(1000, int(session_id)))
    ttl = max(1, int(ttl_minutes))
    return f"{base}-sid-{session_id}-ttl-{ttl}"


def proxy_configured() -> bool:
    """True when any proxy env is set (does not mint a sticky sid)."""
    if os.environ.get("BROWSER_PROXY", "").strip():
        return True
    if os.environ.get("BROWSER_PROXY_URL", "").strip():
        return True
    if os.environ.get("BROWSER_PROXY_SERVER", "").strip():
        return True
    return False


def warm_session_configured() -> bool:
    """True when cookies/storage state are injected (usually IP-bound to sticky proxy)."""
    if os.environ.get("BROWSER_STORAGE_STATE_JSON", "").strip():
        return True
    if os.environ.get("BROWSER_COOKIES_JSON", "").strip():
        return True
    path = os.environ.get("BROWSER_STORAGE_STATE", "").strip()
    if path and Path(path).exists():
        return True
    cookies_file = os.environ.get("BROWSER_COOKIES_FILE", "").strip()
    if cookies_file and Path(cookies_file).exists():
        return True
    return False


def browser_proxy_settings(*, force_random_sid: bool = False) -> Optional[Dict[str, str]]:
    """Playwright proxy dict from env, or None when unset.

    Prefer one of:
      BROWSER_PROXY=user:pass:host:port
      BROWSER_PROXY_SERVER=http://host:port + BROWSER_PROXY_USERNAME + BROWSER_PROXY_PASSWORD
      BROWSER_PROXY_URL=http://user:pass@host:port

    Sticky sessions (PrivateProxy):
      BROWSER_PROXY_STICKY=1
      BROWSER_PROXY_STICKY_TTL=30   # minutes (optional)
      BROWSER_PROXY_STICKY_SID=7    # optional fixed sid so capture + prod share one IP
      -> username becomes jw7ib-fr-sid-7-ttl-30

    Each call with STICKY=1 mints a sid (random unless STICKY_SID is set) —
    call once per browser launch. Pass force_random_sid=True on retries after a
    dead exit (HTTP 572) so a fixed STICKY_SID does not keep failing the same IP.
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
    sticky = os.environ.get("BROWSER_PROXY_STICKY", "").strip().lower() in ("1", "true", "yes")
    if sticky and proxy.get("username"):
        ttl_raw = os.environ.get("BROWSER_PROXY_STICKY_TTL", "30").strip()
        try:
            ttl = int(ttl_raw or "30")
        except ValueError:
            ttl = 30
        sid_raw = os.environ.get("BROWSER_PROXY_STICKY_SID", "").strip()
        sid: Optional[int] = None
        if not force_random_sid and sid_raw.isdigit():
            sid = int(sid_raw)
        proxy["username"] = privateproxy_sticky_username(
            proxy["username"],
            sid=sid,
            ttl_minutes=ttl,
        )
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


_XVFB_PROC: Any = None


def ensure_virtual_display() -> bool:
    """Ensure a DISPLAY exists (native local UI, or Xvfb on Linux/Railway)."""
    global _XVFB_PROC
    if os.name == "nt":
        return True
    if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
        return True
    xvfb = shutil.which("Xvfb")
    if not xvfb:
        return False
    display = (os.environ.get("BROWSER_XVFB_DISPLAY") or ":99").strip() or ":99"
    try:
        _XVFB_PROC = subprocess.Popen(
            [xvfb, display, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        os.environ["DISPLAY"] = display
        time.sleep(0.4)
        if _XVFB_PROC.poll() is not None:
            logger.warning("xvfb_exited_early display=%s code=%s", display, _XVFB_PROC.returncode)
            return False
        logger.info("xvfb_started display=%s", display)
        return True
    except Exception as exc:
        logger.warning("xvfb_start_failed error=%s", str(exc)[:200])
        return False


def headed_browser_available() -> bool:
    """True when Chromium can run with a real window (local UI or Xvfb)."""
    if os.name == "nt":
        return True
    if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
        return True
    return ensure_virtual_display()


def env_forces_headless() -> bool:
    return os.environ.get("BROWSER_HEADLESS", "0").lower() in ("1", "true", "yes", "on")


def effective_headless(requested: bool = False) -> bool:
    """Prefer a real Chromium window. Headless only if env forces it or no display.

    ``requested=True`` is treated as a soft preference; BROWSER_HEADLESS=0 (runtime
    default) still wins so local + Railway stay headed after push.
    """
    if env_forces_headless():
        return True
    if headed_browser_available():
        if requested:
            logger.info("browser_headed_forced_over_client_request")
        return False
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


def normalize_storage_state(storage_state: Any) -> Optional[Dict[str, Any]]:
    """Load a Playwright storage_state dict from dict / JSON string / file path."""
    if not storage_state:
        return None
    if isinstance(storage_state, dict):
        return storage_state
    if isinstance(storage_state, str):
        raw = storage_state.strip()
        if not raw:
            return None
        if Path(raw).exists():
            raw = Path(raw).read_text(encoding="utf-8")
        try:
            data = json.loads(raw)
        except Exception as exc:
            logger.warning("browser_storage_state_normalize_failed error=%s", str(exc)[:200])
            return None
        return data if isinstance(data, dict) else None
    return None


async def inject_storage_state_cookies(context: Any, storage_state: Any) -> int:
    """Add cookies from a storage_state payload (for persistent contexts).

    `launch_persistent_context` rejects the `storage_state` kwarg — inject cookies
    after the context exists instead.
    """
    data = normalize_storage_state(storage_state)
    if not data:
        return 0
    cookies = data.get("cookies") or []
    if not isinstance(cookies, list) or not cookies:
        return 0
    try:
        await context.add_cookies(cookies)
        logger.info("browser_storage_state_cookies_injected count=%s", len(cookies))
        return len(cookies)
    except Exception as exc:
        logger.warning("browser_storage_state_cookies_failed error=%s", str(exc)[:200])
        return 0


@asynccontextmanager
async def launch_page(
    *,
    headless: bool = False,
    force_new_proxy_sid: bool = False,
    disable_proxy: bool = False,
) -> AsyncIterator[Any]:
    """Yields a ready-to-use Playwright `Page`. Closes browser/context/page on
    exit regardless of outcome.

    disable_proxy=True skips BROWSER_PROXY entirely (last-resort after HTTP 572
    SID retries — Railway egress can still reach some ATS hosts).
    """
    headless = effective_headless(headless)
    logger.info("browser_launch_mode=%s", "headless" if headless else "headed")
    # Prefer Patchright when available: it patches Playwright CDP leaks that
    # DataDome (SmartRecruiters) fingerprints. Opt out with BROWSER_ENGINE=playwright.
    engine = (os.environ.get("BROWSER_ENGINE") or "auto").strip().lower()
    async_playwright = None
    engine_name = "playwright"
    if engine in ("auto", "patchright"):
        try:
            from patchright.async_api import async_playwright as async_playwright
            engine_name = "patchright"
        except ImportError:
            if engine == "patchright":
                raise ApplyAgentError(
                    "open_browser",
                    "BROWSER_ENGINE=patchright but patchright is not installed. "
                    "Run `pip install patchright` and `python -m patchright install chromium`.",
                )
    if async_playwright is None:
        try:
            from playwright.async_api import async_playwright as async_playwright
            engine_name = "playwright"
        except ImportError as exc:
            raise ApplyAgentError(
                "open_browser",
                "Playwright is not installed. Run `pip install -r backend/requirements.txt` "
                "and `python -m playwright install chromium` (local dev only -- Railway uses "
                "the Nix chromium package instead, see nixpacks.toml).",
                exception_class=exc.__class__.__name__,
            ) from exc
    logger.info("browser_engine=%s", engine_name)

    executable_path = _chromium_executable_path()
    channel = (os.environ.get("BROWSER_CHANNEL") or "").strip() or None
    # Patchright ships its own Chromium; forcing channel=chrome can reintroduce
    # stock Chrome automation signals. Only honor BROWSER_CHANNEL for playwright.
    if engine_name == "patchright" and channel and engine == "auto":
        channel = None
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
            proxy = None if disable_proxy else browser_proxy_settings(
                force_random_sid=force_new_proxy_sid,
            )
            if disable_proxy and proxy_configured():
                logger.info("browser_proxy_disabled reason=direct_fallback")
            if proxy:
                launch_kwargs["proxy"] = proxy
                logger.info(
                    "browser_proxy_enabled server=%s user=%s force_new_sid=%s",
                    proxy.get("server"),
                    (proxy.get("username") or "")[:24] or "-",
                    force_new_proxy_sid,
                )
            browser_user_data_dir = (os.environ.get("BROWSER_USER_DATA_DIR") or "").strip() or None
            context_options = browser_context_options()
            if proxy and not browser_user_data_dir:
                # Non-persistent contexts also need proxy on the context.
                context_options["proxy"] = proxy
            # Prefer storage_state (Railway secret) over a persistent profile when both
            # are set — launch_persistent_context rejects the storage_state kwarg.
            pending_storage = None
            if browser_user_data_dir and context_options.get("storage_state") is not None:
                pending_storage = context_options.pop("storage_state", None)
                logger.info(
                    "browser_persistent_context_storage_state_deferred "
                    "reason=launch_persistent_context_rejects_storage_state"
                )
            init_script = stealth_init_script()
            if browser_user_data_dir:
                # Persistent profile keeps real cookies / localStorage across runs.
                if proxy:
                    launch_kwargs["proxy"] = proxy
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=browser_user_data_dir,
                    **launch_kwargs,
                    **context_options,
                )
                if pending_storage is not None:
                    await inject_storage_state_cookies(context, pending_storage)
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


def write_resume_file(
    app_doc: Dict[str, Any],
    tmpdir: str,
    profile: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Write the resume bytes to disk for Playwright upload.

    Prefer the tailored CV from Review; fall back to the profile original
    upload (every swiper has one).
    """
    resume_b64 = app_doc.get("tailored_cv_file_b64")
    filename = app_doc.get("tailored_cv_filename") or "tailored_cv.docx"
    if not resume_b64 and profile:
        resume_b64 = profile.get("cv_original_b64")
        filename = profile.get("cv_filename") or "resume.pdf"
    if not resume_b64:
        return None
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
