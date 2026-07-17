"""Load browser secrets, then apply committed runtime defaults (SID + cookies).

Order:
  1. ``backend/.env`` (DB/OAuth, optional BROWSER_PROXY override)
  2. ``backend/.browser-secrets.env`` (optional local overrides)
  3. ``runtime_browser_config`` — sticky SID + bundled cookies (wins on push)
"""
from __future__ import annotations

import os
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
SECRETS_PATH = _BACKEND_ROOT / ".browser-secrets.env"
STORAGE_RAILWAY_PATH = _BACKEND_ROOT / "sr-storage-state.railway.txt"
STORAGE_JSON_PATH = _BACKEND_ROOT / "sr-storage-state.json"

_LOADED = False


def load_browser_secrets(*, override: bool = True) -> Path:
    """Load dotenv files then apply committed sticky SID + storage state."""
    global _LOADED
    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None  # type: ignore

    if load_dotenv is not None:
        load_dotenv(_BACKEND_ROOT / ".env", override=False)
        if SECRETS_PATH.exists():
            load_dotenv(SECRETS_PATH, override=override)

    # Committed defaults win so `git push` updates Railway without dashboard edits.
    from apply_agent.runtime_browser_config import apply_runtime_browser_defaults

    apply_runtime_browser_defaults(force=True)
    _LOADED = True
    return SECRETS_PATH


def secrets_path() -> Path:
    return SECRETS_PATH


def rotate_sticky_sid(new_sid: int) -> None:
    """Update RUNTIME_STICKY_SID in runtime_browser_config.py (committed source of truth)."""
    sid = max(1, min(1000, int(new_sid)))
    config_path = Path(__file__).resolve().parent / "runtime_browser_config.py"
    text = config_path.read_text(encoding="utf-8")
    import re

    updated, n = re.subn(
        r"^RUNTIME_STICKY_SID\s*=\s*\d+",
        f"RUNTIME_STICKY_SID = {sid}",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if n != 1:
        raise RuntimeError(f"Could not update RUNTIME_STICKY_SID in {config_path}")
    config_path.write_text(updated, encoding="utf-8")
    os.environ["BROWSER_PROXY_STICKY_SID"] = str(sid)
