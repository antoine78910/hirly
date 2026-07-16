"""Human-like pointer and keyboard interactions for ATS browser drivers."""
from __future__ import annotations

import random
from typing import Any, List, Optional


async def human_pause(page: Any, min_ms: int = 600, max_ms: int = 1600) -> None:
    await page.wait_for_timeout(random.randint(min_ms, max_ms))


def keystroke_delays_ms(text: str) -> List[int]:
    """Per-character typing delays with occasional slower beats."""
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
        delays.append(base)
    return delays


def should_take_thinking_pause(*, force_seed: Optional[float] = None) -> bool:
    """~12% chance of a longer "read the field" pause between actions."""
    roll = force_seed if force_seed is not None else random.random()
    return roll < 0.12


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
    try:
        for char, delay in zip(value, delays):
            await page.keyboard.type(char, delay=0)
            await page.wait_for_timeout(delay)
            if should_take_thinking_pause() and random.random() < 0.35:
                await human_pause(page, 250, 700)
        return
    except Exception:
        pass
    # Fallback: Playwright sequential press on the locator.
    avg = int(sum(delays) / len(delays)) if delays else 80
    await locator.press_sequentially(value, delay=avg)


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
