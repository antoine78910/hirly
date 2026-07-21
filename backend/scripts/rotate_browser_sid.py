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

from apply_agent.browser_env import load_browser_secrets, rotate_sticky_sid  # noqa: E402


def main() -> None:
    load_browser_secrets(override=True)
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        sid = int(sys.argv[1])
    else:
        sid = random.randint(1, 1000)
    rotate_sticky_sid(sid)
    print("Rotated the in-process sticky browser session identifier.")
    print("Persist the new identifier in the approved runtime secret store.")
    print("Recapture browser storage state after the secret-store update:")
    print("  python scripts/capture_sr_storage_state.py")
    print("Store the generated state in BROWSER_STORAGE_STATE_JSON or an approved")
    print("BROWSER_STORAGE_STATE secret-mounted path; never commit it.")


if __name__ == "__main__":
    main()
