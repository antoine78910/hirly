"""Open Accor/SR in a REAL headed Chrome with sticky proxy + storage state.

Usage (from backend/):

  set BROWSER_PROXY=jw7ib-fr:PASS:edge1-us.privateproxy.me:8888
  set BROWSER_PROXY_STICKY=1
  set BROWSER_PROXY_STICKY_SID=7
  set BROWSER_PROXY_STICKY_TTL=120
  set BROWSER_STORAGE_STATE=sr-storage-state.json
  set BROWSER_CHANNEL=chrome

  python scripts/local_headed_sr_smoke.py

If DataDome appears, solve it in the Chrome window — the script waits up to 3 min
then checks for #first-name-input.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apply_agent.blockers import captcha_active, detect_captcha, dismiss_cookie_banner  # noqa: E402
from apply_agent.browser import (  # noqa: E402
    browser_proxy_settings,
    launch_page,
    proxy_configured,
    warm_session_configured,
)
from apply_agent.human_browser import try_pass_datadome_slider  # noqa: E402

DEFAULT_URL = (
    "https://jobs.smartrecruiters.com/Accor/"
    "744000134455765-chef-de-reception-h-f-"
)


async def main() -> None:
    url = (os.environ.get("SR_SMOKE_URL") or DEFAULT_URL).strip()
    storage = os.environ.get("BROWSER_STORAGE_STATE", "").strip()
    if not storage:
        candidate = ROOT / "sr-storage-state.json"
        if candidate.exists():
            os.environ["BROWSER_STORAGE_STATE"] = str(candidate)
            storage = str(candidate)

    print("proxy_configured:", proxy_configured())
    print("warm_session    :", warm_session_configured(), storage or "(none)")
    print("sticky username :", (browser_proxy_settings() or {}).get("username"))
    print("url             :", url)
    print("Launching HEADED Chrome (not headless)…")

    async with launch_page(headless=False) as page:
        await page.goto(url, wait_until="domcontentloaded", timeout=90000)
        await dismiss_cookie_banner(page)
        print("loaded:", page.url)

        # Click Apply if present
        for sel in (
            "#st-apply",
            'role=button[name=/je suis int\\u00e9ress/i]',
            'button:has-text("Je suis intéressé")',
            'a:has-text("Apply")',
        ):
            try:
                loc = page.locator(sel)
                if await loc.count():
                    await loc.first.click(timeout=3000)
                    print("clicked:", sel)
                    await page.wait_for_timeout(2500)
                    break
            except Exception as exc:
                print("click miss:", sel, type(exc).__name__)

        # Wait for the SPA / captcha to settle.
        for i in range(20):
            if captcha_active(await detect_captcha(page)):
                print(f"CAPTCHA at t+{i}s")
                break
            field = page.locator("#first-name-input >> input, #first-name-input")
            if await field.count():
                print(f"form ready at t+{i}s")
                break
            await page.wait_for_timeout(1000)

        if captcha_active(await detect_captcha(page)):
            print("CAPTCHA detected — trying slider, then waiting for you (3 min)…")
            try:
                await try_pass_datadome_slider(page, attempts=2)
            except Exception as exc:
                print("slider failed:", exc)
            deadline = asyncio.get_event_loop().time() + 180
            while asyncio.get_event_loop().time() < deadline:
                if not captcha_active(await detect_captcha(page)):
                    print("captcha cleared")
                    break
                await page.wait_for_timeout(2000)
            else:
                print("captcha still present after wait")

        try:
            body = (await page.locator("body").inner_text(timeout=3000))[:400]
        except Exception:
            body = "(no body)"
        print("body preview:", body.replace("\n", " | "))

        field = page.locator("#first-name-input >> input, #first-name-input, input[name*='first']")
        count = await field.count()
        print("form fields found:", count, "url=", page.url)
        print("Leave the window open 20s for visual check…")
        await page.wait_for_timeout(20000)


if __name__ == "__main__":
    asyncio.run(main())
