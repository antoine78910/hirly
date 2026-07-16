"""Human-like pointer and keyboard interactions for ATS browser drivers."""
from __future__ import annotations

import random
from typing import Any


async def human_pause(page: Any, min_ms: int = 500, max_ms: int = 1400) -> None:
    await page.wait_for_timeout(random.randint(min_ms, max_ms))


async def human_scroll(page: Any) -> None:
    # Two short scrolls look less like a single scripted jump.
    for _ in range(random.randint(1, 2)):
        delta = random.randint(90, 360)
        try:
            await page.mouse.wheel(0, delta)
        except Exception:
            pass
        await human_pause(page, 220, 650)


async def human_click(locator: Any, page: Any) -> None:
    try:
        await locator.scroll_into_view_if_needed(timeout=5000)
    except Exception:
        pass
    await human_pause(page, 220, 680)
    try:
        box = await locator.bounding_box()
        if box:
            x = box["x"] + box["width"] * random.uniform(0.25, 0.75)
            y = box["y"] + box["height"] * random.uniform(0.25, 0.75)
            steps = random.randint(12, 28)
            await page.mouse.move(x, y, steps=steps)
            await human_pause(page, 80, 260)
    except Exception:
        pass
    await locator.click(timeout=8000, delay=random.randint(45, 160))


async def human_type(locator: Any, page: Any, text: str) -> None:
    await human_click(locator, page)
    try:
        await locator.fill("", timeout=3000)
    except Exception:
        pass
    await human_pause(page, 160, 420)
    # Occasional longer gaps between keystrokes mimics real typing cadence.
    delay = random.randint(55, 125)
    await locator.press_sequentially(str(text), delay=delay)


async def human_check(locator: Any, page: Any) -> None:
    await human_click(locator, page)


async def human_select(locator: Any, page: Any, value: str) -> None:
    await human_click(locator, page)
    await human_pause(page, 200, 500)
    await locator.select_option(label=str(value), timeout=5000)


async def human_upload(locator: Any, page: Any, path: str) -> None:
    await human_pause(page, 350, 900)
    try:
        await locator.scroll_into_view_if_needed(timeout=5000)
    except Exception:
        pass
    await locator.set_input_files(path, timeout=10000)
    await human_pause(page, 400, 900)
