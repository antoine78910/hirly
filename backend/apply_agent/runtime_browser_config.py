"""Validate browser runtime secrets supplied by the environment.

Browser proxy credentials, sticky-session identifiers, and browser storage state
must come from an operator-controlled environment or secret store. This module
intentionally contains no production defaults and never copies secrets into the
process environment.
"""
from __future__ import annotations

import json
import os
from collections.abc import Mapping
from typing import Any


def _present(source: Mapping[str, str], name: str) -> bool:
    return bool((source.get(name) or "").strip())


def browser_storage_state_json(source: Mapping[str, str] | None = None) -> str:
    """Return validated inline storage-state JSON, or an empty string.

    File-backed state remains supported through ``BROWSER_STORAGE_STATE`` and is
    loaded by the browser layer. Supplying both forms is ambiguous and fails
    closed before a browser is launched.
    """
    env = os.environ if source is None else source
    inline = (env.get("BROWSER_STORAGE_STATE_JSON") or "").strip()
    path = (env.get("BROWSER_STORAGE_STATE") or "").strip()
    if inline and path:
        raise RuntimeError(
            "configure only one of BROWSER_STORAGE_STATE_JSON or BROWSER_STORAGE_STATE"
        )
    if not inline:
        return ""
    try:
        parsed: Any = json.loads(inline)
    except json.JSONDecodeError as exc:
        raise RuntimeError("BROWSER_STORAGE_STATE_JSON must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("BROWSER_STORAGE_STATE_JSON must contain a JSON object")
    cookies = parsed.get("cookies", [])
    origins = parsed.get("origins", [])
    if not isinstance(cookies, list) or not isinstance(origins, list):
        raise RuntimeError(
            "BROWSER_STORAGE_STATE_JSON cookies and origins must be arrays"
        )
    return inline


def validate_runtime_browser_environment(
    source: Mapping[str, str] | None = None,
) -> None:
    """Fail closed on partial or ambiguous secret-backed browser settings."""
    env = os.environ if source is None else source
    browser_storage_state_json(env)

    sticky_enabled = (env.get("BROWSER_PROXY_STICKY") or "").strip().lower()
    if sticky_enabled in {"1", "true", "yes", "on"} and not _present(
        env, "BROWSER_PROXY_STICKY_SID"
    ):
        raise RuntimeError(
            "BROWSER_PROXY_STICKY requires BROWSER_PROXY_STICKY_SID from secret storage"
        )
    if _present(env, "BROWSER_PROXY_STICKY_SID") and not _present(
        env, "BROWSER_PROXY"
    ):
        raise RuntimeError(
            "BROWSER_PROXY_STICKY_SID requires BROWSER_PROXY from secret storage"
        )


def apply_runtime_browser_defaults(*, force: bool = True) -> None:
    """Compatibility shim: validate environment-only configuration.

    ``force`` is retained for callers from the previous API. It has no effect;
    this function never injects or overrides credentials, cookies, sticky IDs,
    or headed/headless settings.
    """
    del force
    validate_runtime_browser_environment()
