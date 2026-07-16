"""Capture a warm SmartRecruiters browser session THROUGH the residential proxy.

Why: DataDome cookies only help if prod uses the same exit IP. Capture and
Railway must share one PrivateProxy sticky sid.

Usage (from backend/):

  set BROWSER_PROXY=jw7ib-fr:PASSWORD:edge1-us.privateproxy.me:8888
  set BROWSER_PROXY_STICKY=1
  set BROWSER_PROXY_STICKY_SID=7
  set BROWSER_PROXY_STICKY_TTL=120
  set BROWSER_CHANNEL=chrome

  python scripts/capture_sr_storage_state.py

Then in the opened Chrome window:
  1. Accept cookies
  2. Open a SmartRecruiters job
  3. Click Apply until the real oneclick FORM is visible (not the block page)
  4. Come back here and press Enter

Writes:
  backend/sr-storage-state.json   (gitignored)
  prints Railway env hints
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Allow `python scripts/...` from backend/
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apply_agent.browser import (  # noqa: E402
    browser_context_options,
    browser_proxy_settings,
    chromium_launch_args,
    stealth_init_script,
)

DEFAULT_START = (
    "https://jobs.smartrecruiters.com/Accor/"
    "744000134945516-assistant-e-cheffe-de-reception"
)
OUT_PATH = ROOT / "sr-storage-state.json"


async def _current_ip(page) -> str:
    try:
        await page.goto("http://api.ipify.org?format=json", wait_until="commit", timeout=45000)
        body = await page.inner_text("body")
        return body.strip()
    except Exception as exc:
        return f"(ip check failed: {exc})"


async def main() -> None:
    start_url = (os.environ.get("SR_CAPTURE_URL") or DEFAULT_START).strip()
    proxy = browser_proxy_settings()
    if not proxy:
        raise SystemExit(
            "BROWSER_PROXY is required so cookies are minted on the proxy IP.\n"
            "Example: jw7ib-fr:PASS:edge1-us.privateproxy.me:8888"
        )

    sticky_sid = os.environ.get("BROWSER_PROXY_STICKY_SID", "").strip()
    if not sticky_sid:
        print(
            "WARNING: set BROWSER_PROXY_STICKY_SID (e.g. 7) so Railway reuses "
            "the SAME sticky IP as this capture session."
        )

    from playwright.async_api import async_playwright

    channel = (os.environ.get("BROWSER_CHANNEL") or "chrome").strip() or None
    print("Launching headed Chrome via proxy…")
    print("  server:", proxy.get("server"))
    print("  user  :", proxy.get("username"))
    print("  start :", start_url)
    print("  out   :", OUT_PATH)

    async with async_playwright() as p:
        launch_kwargs = {
            "headless": False,
            "args": chromium_launch_args(headless=False),
            "ignore_default_args": ["--enable-automation"],
            "proxy": proxy,
        }
        if channel:
            launch_kwargs["channel"] = channel

        browser = await p.chromium.launch(**launch_kwargs)
        context_opts = browser_context_options()
        # Capture must not preload an old storage state.
        context_opts.pop("storage_state", None)
        context_opts["proxy"] = proxy
        context = await browser.new_context(**context_opts)
        await context.add_init_script(stealth_init_script())
        page = await context.new_page()

        ip_body = await _current_ip(page)
        print("Exit IP via proxy:", ip_body)

        await page.goto(start_url, wait_until="domcontentloaded", timeout=90000)
        print()
        print("=" * 60)
        print("In the Chrome window:")
        print("  1) Accept cookie banners")
        print("  2) Click Apply / Je suis intéressé(e)")
        print("  3) Wait until the real application FORM fields appear")
        print("     (Prénom / Nom / Email) — NOT the block page")
        print("  4) Come back here and press Enter to save storage state")
        print("=" * 60)
        await asyncio.get_event_loop().run_in_executor(None, input, "Press Enter to save… ")

        state = await context.storage_state()
        OUT_PATH.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        cookie_count = len(state.get("cookies") or [])
        print(f"Saved {cookie_count} cookies -> {OUT_PATH}")

        # Compact one-line JSON for Railway secret (optional).
        compact = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        hint_path = ROOT / "sr-storage-state.railway.txt"
        hint_path.write_text(compact, encoding="utf-8")
        print(f"Also wrote compact JSON -> {hint_path}")
        print()
        print("Railway env (use the SAME sticky sid as this capture):")
        print(f"  BROWSER_PROXY={os.environ.get('BROWSER_PROXY')}")
        print("  BROWSER_PROXY_STICKY=1")
        if sticky_sid:
            print(f"  BROWSER_PROXY_STICKY_SID={sticky_sid}")
        print(f"  BROWSER_PROXY_STICKY_TTL={os.environ.get('BROWSER_PROXY_STICKY_TTL', '120')}")
        print("  BROWSER_STORAGE_STATE_JSON=<paste contents of sr-storage-state.railway.txt>")
        print()
        print("Do NOT commit these JSON files.")

        await context.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
