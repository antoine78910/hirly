import asyncio

from apply_agent.human_browser import (
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
    """Missing iframe must not report success (old bug closed the browser early)."""
    assert asyncio.run(try_pass_datadome_slider(_NoFramePage(), wait_for_frame_ms=0)) is False
