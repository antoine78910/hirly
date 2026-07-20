"""Human-like pointer and keyboard interactions for ATS browser drivers."""
from __future__ import annotations

import logging
import os
import random
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


def browser_pace_scale() -> float:
    """Scale human delays. Bright Data sessions default faster (fingerprint is theirs)."""
    raw = (os.environ.get("BROWSER_PACE_SCALE") or "").strip()
    if raw:
        try:
            return max(0.15, min(1.5, float(raw)))
        except ValueError:
            pass
    try:
        from .remote_browser import brightdata_configured, remote_browser_mode

        mode = remote_browser_mode()
        if mode not in ("0", "false", "off", "no", "local", "none") and brightdata_configured():
            return 0.35
    except Exception:
        pass
    return 1.0


def _scaled_ms(min_ms: int, max_ms: int) -> int:
    scale = browser_pace_scale()
    lo = max(40, int(min_ms * scale))
    hi = max(lo, int(max_ms * scale))
    return random.randint(lo, hi)


async def human_pause(page: Any, min_ms: int = 600, max_ms: int = 1600) -> None:
    await page.wait_for_timeout(_scaled_ms(min_ms, max_ms))


def keystroke_delays_ms(text: str) -> List[int]:
    """Per-character typing delays with occasional slower beats."""
    scale = browser_pace_scale()
    delays: List[int] = []
    for index, char in enumerate(str(text)):
        if char in " @.-_/":
            base = random.randint(90, 220)
        elif char.isupper():
            base = random.randint(70, 180)
        else:
            base = random.randint(45, 140)
        # Humans sometimes hesitate mid-word.
        if index > 0 and random.random() < 0.08:
            base += random.randint(120, 320)
        delays.append(max(15, int(base * scale)))
    return delays


def should_take_thinking_pause(*, force_seed: Optional[float] = None) -> bool:
    """Longer mid-field pauses; rarer when pace is accelerated (Bright Data)."""
    roll = force_seed if force_seed is not None else random.random()
    threshold = 0.04 if browser_pace_scale() < 0.6 else 0.12
    return roll < threshold


async def human_mouse_wander(page: Any) -> None:
    """Idle mouse movement that does not target a control."""
    try:
        viewport = page.viewport_size or {"width": 1440, "height": 900}
        x = random.randint(80, max(120, viewport["width"] - 80))
        y = random.randint(100, max(140, viewport["height"] - 120))
        await page.mouse.move(x, y, steps=random.randint(10, 22))
    except Exception:
        return
    await human_pause(page, 180, 520)


async def human_scroll(page: Any, *, direction: str = "down") -> None:
    """Wheel-based scrolling in small bursts (not one big jump)."""
    sign = 1 if direction == "down" else -1
    bursts = random.randint(2, 4)
    for _ in range(bursts):
        delta = sign * random.randint(70, 280)
        try:
            # Slight horizontal jitter so wheel events are not perfectly vertical.
            await page.mouse.wheel(random.randint(-8, 8), delta)
        except Exception:
            pass
        await human_pause(page, 180, 480)
    if random.random() < 0.35:
        await human_mouse_wander(page)


async def human_scroll_to_locator(locator: Any, page: Any) -> None:
    """Bring a field into view with wheel motion, then fine-tune via scrollIntoView."""
    try:
        box = await locator.bounding_box()
    except Exception:
        box = None
    if box:
        viewport = page.viewport_size or {"width": 1440, "height": 900}
        mid_y = viewport["height"] * 0.45
        # If the control is far below/above, wheel toward it first.
        if box["y"] > mid_y + 120:
            await human_scroll(page, direction="down")
        elif box["y"] < 80:
            await human_scroll(page, direction="up")
    try:
        await locator.scroll_into_view_if_needed(timeout=5000)
    except Exception:
        pass
    await human_pause(page, 220, 650)


async def human_click(locator: Any, page: Any) -> None:
    await human_scroll_to_locator(locator, page)
    if should_take_thinking_pause():
        await human_pause(page, 450, 1100)
    try:
        box = await locator.bounding_box()
        if box:
            # Approach from a nearby point, then settle into the control.
            start_x = box["x"] + box["width"] * random.uniform(-0.4, 0.2)
            start_y = box["y"] + box["height"] * random.uniform(-0.8, -0.1)
            target_x = box["x"] + box["width"] * random.uniform(0.28, 0.72)
            target_y = box["y"] + box["height"] * random.uniform(0.28, 0.72)
            await page.mouse.move(max(1, start_x), max(1, start_y), steps=random.randint(6, 14))
            await human_pause(page, 60, 180)
            await page.mouse.move(target_x, target_y, steps=random.randint(10, 24))
            await human_pause(page, 90, 280)
            await page.mouse.click(
                target_x,
                target_y,
                delay=random.randint(50, 170),
            )
            return
    except Exception:
        pass
    await locator.click(timeout=8000, delay=random.randint(50, 170))


async def human_type(locator: Any, page: Any, text: str) -> None:
    await human_click(locator, page)
    await human_pause(page, 200, 520)
    # Clear existing value like a human (select-all + delete), not instant fill.
    try:
        await page.keyboard.press("Control+A")
        await human_pause(page, 60, 160)
        await page.keyboard.press("Backspace")
    except Exception:
        try:
            await locator.fill("", timeout=3000)
        except Exception:
            pass
    await human_pause(page, 180, 480)
    value = str(text)
    delays = keystroke_delays_ms(value)
    # Prefer real keyboard events when the locator is focused.
    typed_ok = False
    try:
        for char, delay in zip(value, delays):
            await page.keyboard.type(char, delay=0)
            await page.wait_for_timeout(delay)
            if should_take_thinking_pause() and random.random() < 0.35:
                await human_pause(page, 250, 700)
        typed_ok = True
    except Exception:
        typed_ok = False
    if not typed_ok:
        avg = int(sum(delays) / len(delays)) if delays else 80
        try:
            await locator.press_sequentially(value, delay=avg)
            typed_ok = True
        except Exception:
            typed_ok = False
    # SmartRecruiters spl-input shadow fields sometimes swallow keystrokes
    # (email/tel) — verify and fall back to fill so the value sticks.
    try:
        current = await locator.input_value(timeout=1500)
    except Exception:
        current = ""
    if (current or "").strip() != value.strip():
        try:
            await locator.fill(value, timeout=5000)
        except Exception:
            if not typed_ok:
                raise


async def human_check(locator: Any, page: Any) -> None:
    await human_click(locator, page)
    await human_pause(page, 250, 700)


async def human_select(locator: Any, page: Any, value: str) -> None:
    await human_click(locator, page)
    await human_pause(page, 280, 700)
    await locator.select_option(label=str(value), timeout=5000)
    await human_pause(page, 220, 560)


async def human_upload(locator: Any, page: Any, path: str) -> None:
    await human_scroll_to_locator(locator, page)
    await human_pause(page, 500, 1200)
    if should_take_thinking_pause():
        await human_mouse_wander(page)
    await locator.set_input_files(path, timeout=10000)
    await human_pause(page, 700, 1500)


async def try_pass_datadome_slider(
    page: Any,
    *,
    attempts: int = 4,
    wait_for_frame_ms: int = 12000,
) -> bool:
    """Deprecated fail-closed compatibility shim; challenges are never solved."""
    del page, attempts, wait_for_frame_ms
    logger.info("datadome_challenge_manual_fallback")
    return False
