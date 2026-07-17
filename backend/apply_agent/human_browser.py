"""Human-like pointer and keyboard interactions for ATS browser drivers."""
from __future__ import annotations

import logging
import math
import random
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


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


async def _datadome_frame(page: Any) -> Any:
    try:
        frames = page.frames
    except Exception:
        return None
    return next((f for f in frames if "captcha-delivery" in ((getattr(f, "url", None) or ""))), None)


async def wait_for_datadome_frame(page: Any, *, timeout_ms: int = 12000) -> Any:
    """Poll until the captcha-delivery iframe exists (slider often mounts a beat late)."""
    deadline_ms = max(0, int(timeout_ms))
    elapsed = 0
    while elapsed <= deadline_ms:
        frame = await _datadome_frame(page)
        if frame is not None:
            return frame
        await page.wait_for_timeout(150)
        elapsed += 150
    return None


async def try_pass_datadome_slider(
    page: Any,
    *,
    attempts: int = 4,
    wait_for_frame_ms: int = 12000,
) -> bool:
    """Drag the DataDome slider right as soon as it is laid out.

    Waits for `#ddv1-captcha-container .slider` inside the captcha-delivery
    iframe, converts iframe-local coords to page coords, then drags to
    `.sliderTarget`. Returns True when the iframe disappears.
    """
    frame = await wait_for_datadome_frame(page, timeout_ms=wait_for_frame_ms)
    if frame is None:
        logger.info("datadome_slider_no_iframe wait_ms=%s", wait_for_frame_ms)
        return False

    for attempt in range(max(1, attempts)):
        frame = await _datadome_frame(page)
        if frame is None:
            logger.info("datadome_slider_passed attempt=%s reason=iframe_gone", attempt + 1)
            return True

        # Ensure visual puzzle mode (not audio) is selected.
        try:
            puzzle_btn = frame.locator("#captcha__puzzle__button")
            if await puzzle_btn.count():
                cls = (await puzzle_btn.get_attribute("class")) or ""
                if "toggled" not in cls:
                    await puzzle_btn.click(timeout=1500)
                    await page.wait_for_timeout(250)
        except Exception:
            pass

        # Poll fast — drag the moment the handle + target are laid out.
        coords = None
        for _ in range(40):
            try:
                coords = await frame.evaluate(
                    """() => {
                      const root = document.querySelector('#ddv1-captcha-container')
                        || document.querySelector('#captcha__frame')
                        || document.body;
                      const s = root.querySelector('.sliderContainer .slider')
                        || root.querySelector('.slider');
                      const t = root.querySelector('.sliderContainer .sliderTarget')
                        || root.querySelector('.sliderTarget');
                      const container = root.querySelector('.sliderContainer');
                      if (!s || !t || !container) return null;
                      const rs = s.getBoundingClientRect();
                      const rt = t.getBoundingClientRect();
                      const rc = container.getBoundingClientRect();
                      // Track must be laid out (canvas height may still be 0).
                      if (rs.width < 14 || rs.height < 10 || rc.width < 80) return null;
                      if (rt.x <= rs.x + 20) return null;
                      return {
                        sx: rs.x + rs.width / 2,
                        sy: rs.y + rs.height / 2,
                        ex: rt.x + rt.width / 2,
                        ey: rt.y + rt.height / 2,
                      };
                    }"""
                )
            except Exception:
                coords = None
            if coords:
                break
            await page.wait_for_timeout(120)
        if not coords:
            logger.info("datadome_slider_not_ready attempt=%s", attempt + 1)
            try:
                await frame.click("#captcha__reload__button", timeout=1500)
                await page.wait_for_timeout(800)
            except Exception:
                pass
            continue

        # Frame getBoundingClientRect is iframe-local; page.mouse needs page coords.
        iframe_box = None
        try:
            iframe_box = await page.locator('iframe[src*="captcha-delivery"]').first.bounding_box()
        except Exception:
            iframe_box = None
        ox = float(iframe_box["x"]) if iframe_box else 0.0
        oy = float(iframe_box["y"]) if iframe_box else 0.0

        sx = ox + float(coords["sx"])
        sy = oy + float(coords["sy"])
        ex = ox + float(coords["ex"]) + random.uniform(6, 14)
        ey = oy + float(coords["ey"])
        logger.info(
            "datadome_slider_drag attempt=%s from=(%.1f,%.1f) to=(%.1f,%.1f)",
            attempt + 1,
            sx,
            sy,
            ex,
            ey,
        )
        try:
            # Grab quickly — long approach delays look like a stalled bot and
            # the user sees the handle disappear when we close the browser.
            await page.mouse.move(sx, sy, steps=4)
            await page.wait_for_timeout(random.randint(40, 90))
            await page.mouse.down()
            await page.wait_for_timeout(random.randint(20, 50))
            steps = random.randint(28, 40)
            for i in range(steps):
                t = (i + 1) / steps
                ease = 0.5 - 0.5 * math.cos(math.pi * t)
                x = sx + (ex - sx) * ease + random.gauss(0, 0.35)
                y = sy + math.sin(t * math.pi) * random.uniform(0.2, 1.4) + random.gauss(0, 0.25)
                await page.mouse.move(x, y)
                await page.wait_for_timeout(int(random.uniform(8, 16) + (8 if t > 0.85 else 0)))
            await page.mouse.move(ex + random.uniform(2, 8), ey + random.uniform(-1, 1), steps=3)
            await page.wait_for_timeout(random.randint(30, 70))
            await page.mouse.up()
        except Exception as exc:
            logger.info("datadome_slider_drag_failed error=%s", str(exc)[:160])
            continue

        await page.wait_for_timeout(random.randint(1400, 2200))
        if await _datadome_frame(page) is None:
            logger.info("datadome_slider_passed attempt=%s", attempt + 1)
            return True
        try:
            frame = await _datadome_frame(page)
            if frame:
                await frame.click("#captcha__reload__button", timeout=1500)
                await page.wait_for_timeout(900)
        except Exception:
            pass
    return await _datadome_frame(page) is None
