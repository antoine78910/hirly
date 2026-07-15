"""Human-like pointer and keyboard interactions for ATS browser drivers."""
from __future__ import annotations

import random
from typing import Any


async def human_pause(page: Any, min_ms: int = 400, max_ms: int = 1200) -> None:
    await page.wait_for_timeout(random.randint(min_ms, max_ms))


async def human_scroll(page: Any) -> None:
    delta = random.randint(120, 420)
    try:
        await page.mouse.wheel(0, delta)
    except Exception:
        pass
    await human_pause(page, 250, 700)


async def human_click(locator: Any, page: Any) -> None:
    try:
        await locator.scroll_into_view_if_needed(timeout=5000)
    except Exception:
        pass
    await human_pause(page, 180, 520)
    try:
        box = await locator.bounding_box()
        if box:
            x = box["x"] + box["width"] * random.uniform(0.25, 0.75)
            y = box["y"] + box["height"] * random.uniform(0.25, 0.75)
            steps = random.randint(10, 24)
            await page.mouse.move(x, y, steps=steps)
            await human_pause(page, 60, 220)
    except Exception:
        pass
    await locator.click(timeout=8000, delay=random.randint(35, 130))


async def human_type(locator: Any, page: Any, text: str) -> None:
    await human_click(locator, page)
    try:
        await locator.fill("", timeout=3000)
    except Exception:
        pass
    await human_pause(page, 120, 320)
    await locator.press_sequentially(str(text), delay=random.randint(48, 105))


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
