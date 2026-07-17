import json

import pytest

from apply_agent.browser import (
    browser_context_options,
    browser_navigation_timeout_ms,
    browser_proxy_settings,
    chromium_launch_args,
    effective_headless,
    env_forces_headless,
    headed_browser_available,
    is_proxy_connect_failure_status,
    is_proxy_connect_failure_text,
    is_transient_navigation_error,
    parse_proxy_credentials,
    privateproxy_sticky_username,
    proxy_configured,
    stealth_init_script,
    warm_session_configured,
    _load_cookies_from_env,
)


def test_effective_headless_prefers_headed_when_display_exists(monkeypatch):
    monkeypatch.setenv("BROWSER_HEADLESS", "0")
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setattr("apply_agent.browser.os.name", "posix", raising=False)
    assert headed_browser_available() is True
    assert effective_headless(False) is False
    # Client asking headless is ignored when runtime forces headed.
    assert effective_headless(True) is False


def test_effective_headless_env_can_force_headless(monkeypatch):
    monkeypatch.setenv("BROWSER_HEADLESS", "1")
    monkeypatch.setenv("DISPLAY", ":0")
    assert env_forces_headless() is True
    assert effective_headless(False) is True


def test_effective_headless_falls_back_without_display_or_xvfb(monkeypatch):
    monkeypatch.setenv("BROWSER_HEADLESS", "0")
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.setattr("apply_agent.browser.os.name", "posix", raising=False)
    monkeypatch.setattr("apply_agent.browser.ensure_virtual_display", lambda: False)
    assert headed_browser_available() is False
    assert effective_headless(False) is True


def test_stealth_init_script_hides_webdriver(monkeypatch):
    monkeypatch.setenv("BROWSER_LOCALE", "fr-FR")
    script = stealth_init_script()
    assert "webdriver" in script
    assert "fr-FR" in script
    assert "window.chrome" in script


def test_chromium_launch_args_use_new_headless_and_drop_automation_hints():
    args = chromium_launch_args(headless=True)
    assert "--headless=new" in args
    assert "--disable-blink-features=AutomationControlled" in args
    assert chromium_launch_args(headless=False).count("--headless=new") == 0


def test_browser_context_options_default_to_fr_locale(monkeypatch):
    monkeypatch.delenv("BROWSER_LOCALE", raising=False)
    monkeypatch.delenv("BROWSER_STORAGE_STATE", raising=False)
    opts = browser_context_options()
    assert opts["locale"] == "fr-FR"
    assert "fr-FR" in opts["extra_http_headers"]["Accept-Language"]
    assert opts["timezone_id"] == "Europe/Paris"


def test_load_cookies_from_json_env(monkeypatch):
    payload = [
        {
            "name": "sr_session",
            "value": "abc",
            "domain": ".smartrecruiters.com",
            "path": "/",
            "secure": True,
        },
        {"name": "incomplete"},
    ]
    monkeypatch.setenv("BROWSER_COOKIES_JSON", json.dumps(payload))
    monkeypatch.delenv("BROWSER_COOKIES_FILE", raising=False)
    cookies = _load_cookies_from_env()
    assert len(cookies) == 1
    assert cookies[0]["name"] == "sr_session"
    assert cookies[0]["domain"] == ".smartrecruiters.com"


def test_parse_privateproxy_user_pass_host_port():
    parsed = parse_proxy_credentials("jw7ib-fr:secretpass:edge1-us.privateproxy.me:8888")
    assert parsed == {
        "server": "http://edge1-us.privateproxy.me:8888",
        "username": "jw7ib-fr",
        "password": "secretpass",
    }


def test_browser_proxy_settings_from_env(monkeypatch):
    monkeypatch.setenv("BROWSER_PROXY", "jw7ib-fr:secret:edge1-us.privateproxy.me:8888")
    monkeypatch.delenv("BROWSER_PROXY_STICKY", raising=False)
    proxy = browser_proxy_settings()
    assert proxy["server"] == "http://edge1-us.privateproxy.me:8888"
    assert proxy["username"] == "jw7ib-fr"
    assert proxy["password"] == "secret"


def test_privateproxy_sticky_username_matches_docs():
    assert privateproxy_sticky_username("jw7ib-fr", sid=5, ttl_minutes=60) == "jw7ib-fr-sid-5-ttl-60"
    assert privateproxy_sticky_username("jw7ib-fr-sid-9-ttl-10", sid=3, ttl_minutes=30) == (
        "jw7ib-fr-sid-3-ttl-30"
    )
    # City targeting must survive sticky rebuild.
    assert privateproxy_sticky_username(
        "jw7ib-fr-city-montpellier", sid=1, ttl_minutes=17
    ) == "jw7ib-fr-city-montpellier-sid-1-ttl-17"


def test_browser_proxy_sticky_uses_sid_ttl(monkeypatch):
    monkeypatch.setenv("BROWSER_PROXY", "jw7ib-fr:secret:edge1-us.privateproxy.me:8888")
    monkeypatch.setenv("BROWSER_PROXY_STICKY", "1")
    monkeypatch.setenv("BROWSER_PROXY_STICKY_TTL", "45")
    monkeypatch.delenv("BROWSER_PROXY_STICKY_SID", raising=False)
    proxy = browser_proxy_settings()
    assert proxy["username"].startswith("jw7ib-fr-sid-")
    assert proxy["username"].endswith("-ttl-45")
    assert proxy["password"] == "secret"


def test_browser_proxy_sticky_fixed_sid(monkeypatch):
    monkeypatch.setenv("BROWSER_PROXY", "jw7ib-fr:secret:edge1-us.privateproxy.me:8888")
    monkeypatch.setenv("BROWSER_PROXY_STICKY", "1")
    monkeypatch.setenv("BROWSER_PROXY_STICKY_SID", "7")
    monkeypatch.setenv("BROWSER_PROXY_STICKY_TTL", "120")
    proxy = browser_proxy_settings()
    assert proxy["username"] == "jw7ib-fr-sid-7-ttl-120"


def test_browser_storage_state_json(monkeypatch, tmp_path):
    monkeypatch.delenv("BROWSER_STORAGE_STATE", raising=False)
    payload = {"cookies": [{"name": "a", "value": "b", "domain": ".example.com", "path": "/"}], "origins": []}
    monkeypatch.setenv("BROWSER_STORAGE_STATE_JSON", json.dumps(payload))
    opts = browser_context_options()
    assert opts["storage_state"]["cookies"][0]["name"] == "a"


def test_normalize_storage_state_and_inject():
    import asyncio
    from apply_agent.browser import inject_storage_state_cookies, normalize_storage_state

    payload = {"cookies": [{"name": "dd", "value": "1", "domain": ".smartrecruiters.com", "path": "/"}]}
    assert normalize_storage_state(payload)["cookies"][0]["name"] == "dd"
    assert normalize_storage_state(json.dumps(payload))["cookies"][0]["name"] == "dd"

    added = []

    class _Ctx:
        async def add_cookies(self, cookies):
            added.extend(cookies)

    count = asyncio.run(inject_storage_state_cookies(_Ctx(), payload))
    assert count == 1
    assert added[0]["name"] == "dd"


def test_persistent_context_options_drop_storage_state(monkeypatch):
    """launch_persistent_context must not receive storage_state (Playwright TypeError)."""
    monkeypatch.delenv("BROWSER_STORAGE_STATE", raising=False)
    payload = {"cookies": [{"name": "a", "value": "b", "domain": ".x.com", "path": "/"}]}
    monkeypatch.setenv("BROWSER_STORAGE_STATE_JSON", json.dumps(payload))
    opts = browser_context_options()
    assert "storage_state" in opts
    pending = opts.pop("storage_state", None)
    assert "storage_state" not in opts
    assert pending["cookies"][0]["name"] == "a"


def test_warm_session_configured(monkeypatch, tmp_path):
    monkeypatch.delenv("BROWSER_STORAGE_STATE_JSON", raising=False)
    monkeypatch.delenv("BROWSER_STORAGE_STATE", raising=False)
    monkeypatch.delenv("BROWSER_COOKIES_JSON", raising=False)
    monkeypatch.delenv("BROWSER_COOKIES_FILE", raising=False)
    assert warm_session_configured() is False
    path = tmp_path / "state.json"
    path.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("BROWSER_STORAGE_STATE", str(path))
    assert warm_session_configured() is True


def test_proxy_configured_and_nav_timeout(monkeypatch):
    monkeypatch.delenv("BROWSER_PROXY", raising=False)
    monkeypatch.delenv("BROWSER_PROXY_URL", raising=False)
    monkeypatch.delenv("BROWSER_PROXY_SERVER", raising=False)
    monkeypatch.delenv("BROWSER_NAVIGATION_TIMEOUT_MS", raising=False)
    assert proxy_configured() is False
    assert browser_navigation_timeout_ms() == 30000
    monkeypatch.setenv("BROWSER_PROXY", "jw7ib-fr:secret:edge1-us.privateproxy.me:8888")
    assert proxy_configured() is True
    assert browser_navigation_timeout_ms() == 45000


def test_transient_navigation_error_detects_timeout():
    assert is_transient_navigation_error(
        RuntimeError('Page.goto: net::ERR_TIMED_OUT at https://jobs.smartrecruiters.com/x')
    )
    assert not is_transient_navigation_error(RuntimeError("selector not found"))


def test_proxy_connect_failure_helpers():
    from apply_agent.browser import (
        is_proxy_connect_failure_status,
        is_proxy_connect_failure_text,
    )

    assert is_proxy_connect_failure_status(572) is True
    assert is_proxy_connect_failure_status(200) is False
    assert is_proxy_connect_failure_text("Failed to connect to target host") is True
    assert is_proxy_connect_failure_text("Thank you for applying") is False
    assert is_transient_navigation_error(
        RuntimeError("Proxy could not reach target host (HTTP 572).")
    )


def test_force_random_sid_ignores_fixed_sticky(monkeypatch):
    monkeypatch.setenv("BROWSER_PROXY", "jw7ib-fr:secret:edge1-us.privateproxy.me:8888")
    monkeypatch.setenv("BROWSER_PROXY_STICKY", "1")
    monkeypatch.setenv("BROWSER_PROXY_STICKY_SID", "7")
    monkeypatch.setenv("BROWSER_PROXY_STICKY_TTL", "30")
    fixed = browser_proxy_settings()
    assert fixed is not None
    assert "-sid-7-" in fixed["username"]
    forced = browser_proxy_settings(force_random_sid=True)
    assert forced is not None
    assert "-sid-7-" not in forced["username"]
    assert "-sid-" in forced["username"]
