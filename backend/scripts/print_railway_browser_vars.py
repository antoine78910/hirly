"""Print Railway-ready browser vars from local secrets + storage file.

Agents edit ``.browser-secrets.env``; you (or CI) paste into Railway when needed.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apply_agent.browser_env import STORAGE_RAILWAY_PATH, load_browser_secrets


def main() -> None:
    load_browser_secrets(override=True)
    keys = [
        "BROWSER_PROXY",
        "BROWSER_PROXY_STICKY",
        "BROWSER_PROXY_STICKY_SID",
        "BROWSER_PROXY_STICKY_TTL",
        "BROWSER_ENGINE",
        "BROWSER_LOCALE",
        "BROWSER_TIMEZONE",
        "BROWSER_NAVIGATION_TIMEOUT_MS",
        "AUTO_APPLY_ALLOW_DIRECT",
        "AUTO_APPLY_DRIVER_DEADLINE_S",
    ]
    print("=== Railway variables (from .browser-secrets.env) ===")
    print("BROWSER_HEADLESS=false")
    print("BROWSER_SUBMIT_DRY_RUN=false")
    for key in keys:
        val = (os.environ.get(key) or "").strip()
        if val:
            print(f"{key}={val}")
    if STORAGE_RAILWAY_PATH.exists():
        raw = STORAGE_RAILWAY_PATH.read_text(encoding="utf-8").strip()
        print()
        print(f"BROWSER_STORAGE_STATE_JSON  <- paste contents of {STORAGE_RAILWAY_PATH.name}")
        print(f"  ({len(raw)} chars)")
    else:
        print()
        print("WARNING: sr-storage-state.railway.txt missing — run capture first.")


if __name__ == "__main__":
    main()
