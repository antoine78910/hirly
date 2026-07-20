import asyncio

from apply_agent.human_browser import (
    browser_pace_scale,
    keystroke_delays_ms,
    should_take_thinking_pause,
    try_pass_datadome_slider,
)


def test_keystroke_delays_cover_each_character():
    delays = keystroke_delays_ms("AVNER")
    assert len(delays) == 5
    # Occasional mid-word hesitation can push a beat above 280ms.
    assert all(40 <= d <= 500 for d in delays)
    assert sum(delays) >= 5 * 40


def test_keystroke_delays_empty_text():
    assert keystroke_delays_ms("") == []


def test_thinking_pause_is_occasional_but_possible():
    hits = sum(1 for _ in range(200) if should_take_thinking_pause(force_seed=0.04))
    misses = sum(1 for _ in range(200) if not should_take_thinking_pause(force_seed=0.9))
    assert hits == 200
    assert misses == 200


class _NoFramePage:
    frames = []

    async def wait_for_timeout(self, ms):
        return None


def test_try_pass_datadome_slider_returns_false_without_iframe():
    """Compatibility shim always fails closed."""
    assert asyncio.run(try_pass_datadome_slider(_NoFramePage(), wait_for_frame_ms=0)) is False


def test_try_pass_datadome_slider_never_interacts_with_challenge_page():
    class _ChallengePage:
        @property
        def frames(self):
            raise AssertionError("challenge DOM must not be inspected or manipulated")

    assert asyncio.run(try_pass_datadome_slider(_ChallengePage())) is False


def test_browser_pace_scale_faster_with_brightdata(monkeypatch):
    monkeypatch.delenv("BROWSER_PACE_SCALE", raising=False)
    monkeypatch.setenv("BROWSER_REMOTE", "auto")
    monkeypatch.setenv("BRIGHTDATA_BROWSER_USER", "u")
    monkeypatch.setenv("BRIGHTDATA_BROWSER_PASSWORD", "p")
    assert browser_pace_scale() == 0.35
    monkeypatch.setenv("BROWSER_PACE_SCALE", "0.5")
    assert browser_pace_scale() == 0.5
