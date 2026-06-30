"""Dry-run smoke helper for job cache admin endpoints.

Environment:
  BACKEND_URL=https://your-backend.example.com
  ADMIN_AUTH_TOKEN=admin-session-or-service-token
  DRY_RUN=true

Optional:
  ATS_PROVIDER=greenhouse
  ATS_SOURCE_KEY=example
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, Optional
from urllib import request
from urllib.error import HTTPError, URLError


def main() -> int:
    backend_url = (os.environ.get("BACKEND_URL") or "").rstrip("/")
    token = os.environ.get("ADMIN_AUTH_TOKEN") or ""
    dry_run = _env_bool("DRY_RUN", True)
    if not backend_url or not token:
        print("BACKEND_URL and ADMIN_AUTH_TOKEN are required.", file=sys.stderr)
        return 2

    checks = [
        ("maintenance", "POST", "/api/admin/jobs/maintenance", {"dry_run": dry_run, "refresh_popular": False}),
        ("revalidate", "POST", "/api/admin/jobs/revalidate", {"older_than_hours": 24, "limit": 25, "dry_run": dry_run}),
        ("ats_discover_sources", "POST", "/api/admin/jobs/ats/discover-sources", {"limit": 100, "dry_run": dry_run}),
        ("ats_refresh_known_sources", "POST", "/api/admin/jobs/ats/refresh-known-sources", {"limit": 10, "older_than_hours": 12, "dry_run": dry_run}),
        ("cache_status", "GET", "/api/admin/jobs/cache-status", None),
    ]
    provider = os.environ.get("ATS_PROVIDER")
    source_key = os.environ.get("ATS_SOURCE_KEY")
    if provider and source_key:
        checks.append((
            "ats_refresh_source",
            "POST",
            "/api/admin/jobs/ats/refresh-source",
            {"ats_provider": provider, "source_key": source_key, "limit": 50, "dry_run": dry_run},
        ))

    failed = 0
    for name, method, path, payload in checks:
        status, body = _call(backend_url, token, method, path, payload)
        ok = 200 <= status < 300
        failed += 0 if ok else 1
        print(f"[{'ok' if ok else 'fail'}] {name} status={status}")
        print(json.dumps(body, indent=2, sort_keys=True)[:2000])
    return 1 if failed else 0


def _call(base_url: str, token: str, method: str, path: str, payload: Optional[Dict[str, Any]]) -> tuple[int, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = request.Request(
        base_url + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=60) as response:
            return response.status, _parse_body(response.read())
    except HTTPError as exc:
        return exc.code, _parse_body(exc.read())
    except URLError as exc:
        return 0, {"error": str(exc)}


def _parse_body(raw: bytes) -> Any:
    text = raw.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text[:2000]}


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    raise SystemExit(main())
