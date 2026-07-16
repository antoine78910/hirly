import json

import pytest

from apply_agent.browser import (
    browser_context_options,
    browser_proxy_settings,
    chromium_launch_args,
    effective_headless,
    headed_browser_available,
    parse_proxy_credentials,
    privateproxy_sticky_username,
    stealth_init_script,
    _load_cookies_from_env,
)


def test_effective_headless_forces_headless_without_display(monkeypatch):
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.setattr("apply_agent.browser.os.name", "posix", raising=False)
    assert headed_browser_available() is False
    assert effective_headless(False) is True
    assert effective_headless(True) is True


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


def test_browser_proxy_sticky_uses_sid_ttl(monkeypatch):
    monkeypatch.setenv("BROWSER_PROXY", "jw7ib-fr:secret:edge1-us.privateproxy.me:8888")
    monkeypatch.setenv("BROWSER_PROXY_STICKY", "1")
    monkeypatch.setenv("BROWSER_PROXY_STICKY_TTL", "45")
    proxy = browser_proxy_settings()
    assert proxy["username"].startswith("jw7ib-fr-sid-")
    assert proxy["username"].endswith("-ttl-45")
    assert proxy["password"] == "secret"
