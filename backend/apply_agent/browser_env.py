"""Load local browser secrets and validate environment-only runtime settings.

Order:
  1. ``backend/.env`` (DB/OAuth, optional BROWSER_PROXY override)
  2. ``backend/.browser-secrets.env`` (optional local overrides)
  3. ``runtime_browser_config`` — validates secret-store supplied settings
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
    """Load ignored dotenv files, then validate browser secret configuration."""
    global _LOADED
    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None  # type: ignore

    if load_dotenv is not None:
        load_dotenv(_BACKEND_ROOT / ".env", override=False)
        if SECRETS_PATH.exists():
            load_dotenv(SECRETS_PATH, override=override)

    from apply_agent.runtime_browser_config import apply_runtime_browser_defaults

    apply_runtime_browser_defaults(force=False)
    _LOADED = True
    return SECRETS_PATH


def secrets_path() -> Path:
    return SECRETS_PATH


def rotate_sticky_sid(new_sid: int) -> None:
    """Rotate the current process SID without writing it to tracked source."""
    sid = max(1, min(1000, int(new_sid)))
    os.environ["BROWSER_PROXY_STICKY_SID"] = str(sid)
