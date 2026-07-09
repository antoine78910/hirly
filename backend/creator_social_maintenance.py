"""Background refresh loop for admin creator social tracking."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from creator_social_config import get_configured_creators
from creator_social_service import refresh_all_creators
from creator_social_store import latest_snapshot_for_creator


logger = logging.getLogger(__name__)

_last_refresh_summary: Optional[Dict[str, Any]] = None
_refresh_loop_lock = asyncio.Lock()


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def refresh_interval_hours() -> int:
    return max(1, env_int("CREATOR_SOCIAL_REFRESH_INTERVAL_HOURS", 6))


def refresh_loop_enabled() -> bool:
    return env_bool("CREATOR_SOCIAL_REFRESH_LOOP_ENABLED", True)


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def should_refresh_creator_social(*, now: Optional[datetime] = None) -> bool:
    """Return True when at least one tracked creator is missing or stale."""
    creators = get_configured_creators()
    if not creators:
        return False

    current = now or datetime.now(timezone.utc)
    interval = timedelta(hours=refresh_interval_hours())

    for creator in creators:
        latest = latest_snapshot_for_creator(creator["creator_id"])
        if not latest:
            return True
        recorded_at = _parse_dt(latest.get("recorded_at"))
        if not recorded_at or (current - recorded_at) >= interval:
            return True
    return False


def run_creator_social_refresh(*, trigger: str = "scheduled") -> Dict[str, Any]:
    """Refresh all configured creators synchronously (safe for asyncio.to_thread)."""
    started_at = datetime.now(timezone.utc).isoformat()
    snapshots = refresh_all_creators()
    errors = [row for row in snapshots if row.get("error")]
    summary = {
        "started_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "creator_count": len(snapshots),
        "success_count": len(snapshots) - len(errors),
        "error_count": len(errors),
        "errors": errors,
        "ok": not errors or len(errors) < len(snapshots),
        "trigger": trigger,
    }
    record_refresh_summary(summary)
    return summary


def record_refresh_summary(summary: Dict[str, Any]) -> None:
    global _last_refresh_summary
    _last_refresh_summary = dict(summary)


def get_creator_social_refresh_status() -> Dict[str, Any]:
    interval_hours = refresh_interval_hours()
    last_run = _last_refresh_summary or {}
    last_finished = _parse_dt(last_run.get("finished_at"))
    next_due_at = None
    if last_finished:
        next_due_at = (last_finished + timedelta(hours=interval_hours)).isoformat()

    stale = should_refresh_creator_social()
    return {
        "loop_enabled": refresh_loop_enabled(),
        "interval_hours": interval_hours,
        "stale": stale,
        "last_run": last_run or None,
        "next_due_at": next_due_at,
    }


async def run_creator_social_refresh_loop() -> None:
    """Periodic creator social refresh, started from app startup."""
    if not refresh_loop_enabled():
        logger.info("creator_social_refresh_loop_disabled")
        return

    interval_hours = refresh_interval_hours()
    initial_delay = max(30, env_int("CREATOR_SOCIAL_REFRESH_INITIAL_DELAY_SECONDS", 120))
    logger.info(
        "creator_social_refresh_loop_started interval_hours=%s initial_delay_seconds=%s",
        interval_hours,
        initial_delay,
    )

    await asyncio.sleep(initial_delay)
    while True:
        global _last_refresh_summary
        try:
            if refresh_loop_enabled() and should_refresh_creator_social():
                async with _refresh_loop_lock:
                    if should_refresh_creator_social():
                        await asyncio.to_thread(run_creator_social_refresh)
                        logger.info(
                            "creator_social_refresh_loop_completed success=%s errors=%s",
                            (_last_refresh_summary or {}).get("success_count"),
                            (_last_refresh_summary or {}).get("error_count"),
                        )
            else:
                logger.info("creator_social_refresh_loop_skipped_still_fresh")
        except Exception as exc:
            logger.warning("creator_social_refresh_loop_error error=%s", str(exc)[:300])
        await asyncio.sleep(interval_hours * 3600)
