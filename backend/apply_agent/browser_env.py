"""Load browser / proxy / cookie secrets from a gitignored file.

Agents can edit ``backend/.browser-secrets.env`` without touching Railway UI.
Local scripts and the API process both call ``load_browser_secrets()``.

Also auto-loads ``sr-storage-state.railway.txt`` into ``BROWSER_STORAGE_STATE_JSON``
when the env var is empty so cookies stay file-based locally.
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
    """Load ``.browser-secrets.env`` (and optional storage JSON file) into os.environ."""
    global _LOADED
    try:
        from dotenv import load_dotenv
    except ImportError:
        load_dotenv = None  # type: ignore

    if load_dotenv is not None:
        # Main .env first (DB/OAuth), then browser secrets win for BROWSER_* keys.
        load_dotenv(_BACKEND_ROOT / ".env", override=False)
        if SECRETS_PATH.exists():
            load_dotenv(SECRETS_PATH, override=override)

    _ensure_storage_state_json()
    _LOADED = True
    return SECRETS_PATH


def _ensure_storage_state_json() -> None:
    if (os.environ.get("BROWSER_STORAGE_STATE_JSON") or "").strip():
        return
    for path in (STORAGE_RAILWAY_PATH, STORAGE_JSON_PATH):
        if not path.exists():
            continue
        raw = path.read_text(encoding="utf-8").strip()
        if not raw:
            continue
        os.environ["BROWSER_STORAGE_STATE_JSON"] = raw
        # Prefer JSON secret over file path when both could apply.
        os.environ.pop("BROWSER_STORAGE_STATE", None)
        return


def secrets_path() -> Path:
    return SECRETS_PATH


def rotate_sticky_sid(new_sid: int) -> None:
    """Update BROWSER_PROXY_STICKY_SID in .browser-secrets.env (create file if needed)."""
    sid = max(1, min(1000, int(new_sid)))
    if not SECRETS_PATH.exists():
        raise FileNotFoundError(f"Missing {SECRETS_PATH}")
    lines = SECRETS_PATH.read_text(encoding="utf-8").splitlines()
    out = []
    found = False
    for line in lines:
        if line.startswith("BROWSER_PROXY_STICKY_SID="):
            out.append(f"BROWSER_PROXY_STICKY_SID={sid}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"BROWSER_PROXY_STICKY_SID={sid}")
    SECRETS_PATH.write_text("\n".join(out) + "\n", encoding="utf-8")
    os.environ["BROWSER_PROXY_STICKY_SID"] = str(sid)
