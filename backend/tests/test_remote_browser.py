from apply_agent.remote_browser import (
    brightdata_username_with_country,
    brightdata_ws_endpoint,
    should_use_remote_browser,
)


def test_brightdata_username_appends_country_only_when_set(monkeypatch):
    monkeypatch.delenv("BROWSER_REMOTE_COUNTRY", raising=False)
    assert brightdata_username_with_country("brd-customer-1-zone-sb") == (
        "brd-customer-1-zone-sb"
    )
    monkeypatch.setenv("BROWSER_REMOTE_COUNTRY", "fr")
    assert brightdata_username_with_country("brd-customer-1-zone-sb") == (
        "brd-customer-1-zone-sb-country-fr"
    )
    assert brightdata_username_with_country("brd-customer-1-zone-sb-country-fr") == (
        "brd-customer-1-zone-sb-country-fr"
    )


def test_brightdata_ws_endpoint_builds_wss(monkeypatch):
    monkeypatch.setenv("BRIGHTDATA_BROWSER_USER", "brd-customer-1-zone-sb")
    monkeypatch.setenv("BRIGHTDATA_BROWSER_PASSWORD", "s3cret!")
    monkeypatch.delenv("BROWSER_REMOTE_COUNTRY", raising=False)
    monkeypatch.delenv("BRIGHTDATA_BROWSER_HOST", raising=False)
    monkeypatch.delenv("BRIGHTDATA_BROWSER_PORT", raising=False)
    ep = brightdata_ws_endpoint()
    assert ep is not None
    assert ep.startswith("wss://")
    assert "@brd.superproxy.io:9222" in ep
    assert "s3cret" in ep or "s3cret%21" in ep
    assert "country-fr" not in ep


def test_should_use_remote_only_when_preferred_and_configured(monkeypatch):
    monkeypatch.delenv("BRIGHTDATA_BROWSER_USER", raising=False)
    monkeypatch.delenv("BRIGHTDATA_BROWSER_PASSWORD", raising=False)
    monkeypatch.setenv("BROWSER_REMOTE", "auto")
    assert should_use_remote_browser(prefer_remote=True) is False

    monkeypatch.setenv("BRIGHTDATA_BROWSER_USER", "u")
    monkeypatch.setenv("BRIGHTDATA_BROWSER_PASSWORD", "p")
    assert should_use_remote_browser(prefer_remote=False) is False
    assert should_use_remote_browser(prefer_remote=True) is True

    monkeypatch.setenv("BROWSER_REMOTE", "off")
    assert should_use_remote_browser(prefer_remote=True) is False


def test_smartrecruiters_prefers_remote():
    from auto_apply.drivers.smartrecruiters import SmartRecruitersApplyDriver
    from auto_apply.drivers.greenhouse import GreenhouseApplyDriver

    assert SmartRecruitersApplyDriver().prefer_remote_browser() is True
    assert GreenhouseApplyDriver().prefer_remote_browser() is False
