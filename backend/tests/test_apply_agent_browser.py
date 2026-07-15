import pytest

from apply_agent.browser import effective_headless, headed_browser_available


def test_effective_headless_forces_headless_without_display(monkeypatch):
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.setattr("apply_agent.browser.os.name", "posix", raising=False)
    assert headed_browser_available() is False
    assert effective_headless(False) is True
    assert effective_headless(True) is True
