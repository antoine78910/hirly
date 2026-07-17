"""Compare headed vs headless SmartRecruiters access with identical proxy/cookies.

Mirrors prod env as closely as possible, then prints why local headed often wins.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apply_agent.blockers import captcha_active, detect_bot_wall, detect_captcha, dismiss_cookie_banner  # noqa: E402
from apply_agent.browser import (  # noqa: E402
    browser_proxy_settings,
    effective_headless,
    launch_page,
    proxy_configured,
    warm_session_configured,
)

URL = (
    "https://jobs.smartrecruiters.com/Accor/"
    "744000134455765-chef-de-reception-h-f-"
)


async def probe(*, headless: bool, label: str) -> dict:
    requested = headless
    effective = effective_headless(requested)
    result = {
        "label": label,
        "requested_headless": requested,
        "effective_headless": effective,
        "proxy_user": (browser_proxy_settings() or {}).get("username"),
        "url": "",
        "captcha": False,
        "bot_wall": False,
        "form_fields": 0,
        "body": "",
        "error": "",
    }
    try:
        async with launch_page(headless=requested) as page:
            await page.goto(URL, wait_until="domcontentloaded", timeout=90000)
            await dismiss_cookie_banner(page)
            for sel in ("#st-apply", 'button:has-text("Je suis intéressé")', 'a:has-text("Je suis intéressé")'):
                try:
                    loc = page.locator(sel)
                    if await loc.count():
                        await loc.first.click(timeout=3000)
                        await page.wait_for_timeout(3000)
                        break
                except Exception:
                    continue
            for _ in range(12):
                if captcha_active(await detect_captcha(page)) or await detect_bot_wall(page):
                    break
                if await page.locator("#first-name-input >> input, #first-name-input").count():
                    break
                await page.wait_for_timeout(1000)
            result["url"] = page.url
            result["captcha"] = captcha_active(await detect_captcha(page))
            result["bot_wall"] = await detect_bot_wall(page)
            result["form_fields"] = await page.locator(
                "#first-name-input >> input, #first-name-input"
            ).count()
            try:
                result["body"] = (await page.locator("body").inner_text(timeout=2500))[:220].replace("\n", " | ")
            except Exception:
                result["body"] = ""
    except Exception as exc:
        result["error"] = f"{exc.__class__.__name__}: {exc}"[:240]
    return result


async def main() -> None:
    storage = ROOT / "sr-storage-state.json"
    if storage.exists() and not os.environ.get("BROWSER_STORAGE_STATE"):
        os.environ["BROWSER_STORAGE_STATE"] = str(storage)

    print("=== shared env ===")
    print("proxy_configured:", proxy_configured())
    print("warm_session    :", warm_session_configured())
    print("sticky username :", (browser_proxy_settings() or {}).get("username"))
    print("BROWSER_CHANNEL :", os.environ.get("BROWSER_CHANNEL") or "(unset)")
    print("BROWSER_ENGINE  :", os.environ.get("BROWSER_ENGINE") or "auto")
    print()

    # Headless first (prod-like), then headed (local-like).
    headless_res = await probe(headless=True, label="HEADLESS (prod-like)")
    headed_res = await probe(headless=False, label="HEADED (local Chrome)")

    for res in (headless_res, headed_res):
        print(f"=== {res['label']} ===")
        for key in (
            "requested_headless", "effective_headless", "proxy_user", "url",
            "captcha", "bot_wall", "form_fields", "error", "body",
        ):
            print(f"  {key}: {res[key]}")
        print()

    print("=== why local often wins ===")
    print("1. Headed uses real Chrome UI + GPU/fonts; headless=new still fingerprints as automation.")
    print("2. Prod Railway has no display -> forced headless even if client asks visible.")
    print("3. Local BROWSER_CHANNEL=chrome uses installed Google Chrome; Railway uses Chromium/Patchright build.")
    print("4. Same sticky IP burned by headless hits will also fail headed soon after.")
    print("5. Cookies help only if sticky SID/IP matches the capture exactly.")


if __name__ == "__main__":
    asyncio.run(main())
