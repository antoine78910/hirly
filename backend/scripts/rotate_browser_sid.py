"""Rotate BROWSER_PROXY_STICKY_SID in .browser-secrets.env.

Usage (from backend/):
  python scripts/rotate_browser_sid.py           # random 1..1000
  python scripts/rotate_browser_sid.py 312
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apply_agent.browser_env import load_browser_secrets, rotate_sticky_sid, secrets_path
from apply_agent.browser import browser_proxy_settings


def main() -> None:
    load_browser_secrets(override=True)
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        sid = int(sys.argv[1])
    else:
        sid = random.randint(1, 1000)
    rotate_sticky_sid(sid)
    load_browser_secrets(override=True)
    proxy = browser_proxy_settings() or {}
    print(f"Updated {secrets_path()}")
    print(f"BROWSER_PROXY_STICKY_SID={sid}")
    print(f"sticky username={proxy.get('username')}")
    print("Recapture cookies next: python scripts/capture_sr_storage_state.py")


if __name__ == "__main__":
    main()
