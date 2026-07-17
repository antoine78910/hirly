"""Committed SmartRecruiters browser runtime defaults (sticky SID + cookies).

These ship with the deploy so Railway does not need BROWSER_PROXY_STICKY_SID /
BROWSER_STORAGE_STATE_JSON in the dashboard. Update the bundled JSON by
recapturing locally, copying into ``data/sr_storage_state.json``, then push.

NOTE: cookies are session secrets. Prefer a private repo; rotate SID after leaks.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# Sticky PrivateProxy session shared by capture + production headed runs.
RUNTIME_STICKY_ENABLED = True
RUNTIME_STICKY_SID = 424
RUNTIME_STICKY_TTL_MINUTES = 60

# Always use a real Chromium window (Xvfb on Railway). Set True only to debug.
RUNTIME_HEADLESS = False

# Fallback when Railway/local BROWSER_PROXY is unset (same pack as local capture).
RUNTIME_BROWSER_PROXY = "jw7ib-fr:fw9fvvdy:edge1-us.privateproxy.me:8888"

_DATA_DIR = Path(__file__).resolve().parent / "data"
BUNDLED_STORAGE_STATE_PATH = _DATA_DIR / "sr_storage_state.json"


def bundled_storage_state_json() -> str:
    if not BUNDLED_STORAGE_STATE_PATH.exists():
        return ""
    raw = BUNDLED_STORAGE_STATE_PATH.read_text(encoding="utf-8").strip()
    if not raw:
        return ""
    # Normalize to compact single-line JSON for env injection.
    try:
        return json.dumps(json.loads(raw), ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return raw


def apply_runtime_browser_defaults(*, force: bool = True) -> None:
    """Inject sticky SID + bundled cookies + headed mode into os.environ.

    force=True (default): code wins over Railway/env so a push updates prod.
    """
    if force or not (os.environ.get("BROWSER_PROXY") or "").strip():
        if RUNTIME_BROWSER_PROXY:
            os.environ["BROWSER_PROXY"] = RUNTIME_BROWSER_PROXY

    if RUNTIME_STICKY_ENABLED:
        os.environ["BROWSER_PROXY_STICKY"] = "1"
        os.environ["BROWSER_PROXY_STICKY_SID"] = str(RUNTIME_STICKY_SID)
        os.environ["BROWSER_PROXY_STICKY_TTL"] = str(RUNTIME_STICKY_TTL_MINUTES)

    if force:
        os.environ["BROWSER_HEADLESS"] = "1" if RUNTIME_HEADLESS else "0"

    bundled = bundled_storage_state_json()
    if bundled and (force or not (os.environ.get("BROWSER_STORAGE_STATE_JSON") or "").strip()):
        os.environ["BROWSER_STORAGE_STATE_JSON"] = bundled
        os.environ.pop("BROWSER_STORAGE_STATE", None)
