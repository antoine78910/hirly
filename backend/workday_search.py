"""Keyword + location search across configured Workday career boards."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, List, Optional

from job_providers.base import JobSearchQuery
from job_providers.workday import WorkdayBoardConfig, WorkdayProvider, parse_workday_board_url
from job_validation import cheap_validate_job_applyability
from jobs_service import upsert_imported_jobs


logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def default_workday_board_urls() -> List[str]:
    raw = os.environ.get(
        "WORKDAY_BOARD_URLS",
        "https://workday.wd5.myworkdayjobs.com/Workday",
    )
    return [item.strip() for item in raw.split(",") if item.strip()]


def configured_workday_boards() -> List[WorkdayBoardConfig]:
    boards: List[WorkdayBoardConfig] = []
    seen: set[str] = set()
    for url in default_workday_board_urls():
        board = parse_workday_board_url(url)
        if not board:
            continue
        key = f"{board.tenant}:{board.wd_server}:{board.site}".lower()
        if key in seen:
            continue
        seen.add(key)
        boards.append(board)
    return boards


def _looks_like_france_location(location: Optional[str]) -> bool:
    text = (location or "").strip().lower()
    if not text:
        return False
    fr_tokens = (
        "france", "paris", "lyon", "marseille", "toulouse", "bordeaux", "lille",
        "nantes", "strasbourg", "montpellier", "rennes", "grenoble",
    )
    return any(token in text for token in fr_tokens) or text.endswith(", fr")


def should_run_workday_search(query: JobSearchQuery, *, primary_provider: str) -> bool:
    """Decide whether Workday CXS is a good supplemental source for this query."""
    if not _env_bool("WORKDAY_SEARCH_ENABLED", True):
        return False
    if not (query.role or "").strip():
        return False
    if not configured_workday_boards():
        return False

    country = (query.country or "").strip().lower()
    is_french = country == "fr" or _looks_like_france_location(query.location)
    if is_french and primary_provider == "france_travail":
        return _env_bool("WORKDAY_SEARCH_FRANCE_SUPPLEMENT", False)

    # Prefer Workday for international / US-style queries and as a JSearch supplement.
    return True


async def refresh_workday_jobs_for_query(
    db,
    *,
    query: JobSearchQuery,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    boards = configured_workday_boards()
    if not boards:
        return {"attempted": False, "reason": "no_boards", "imported_count": 0}

    provider = WorkdayProvider()
    board_limit = max(1, min(_env_int("WORKDAY_MAX_BOARDS", 3), len(boards)))
    target_count = max(1, min(int(limit or query.limit or 20), 40))
    per_board_limit = max(3, min(target_count, _env_int("WORKDAY_PER_BOARD_LIMIT", 12)))

    selected_boards = boards[:board_limit]
    board_query = JobSearchQuery(
        role=query.role,
        location=query.location,
        remote_preference=query.remote_preference,
        country=query.country,
        language=query.language,
        limit=per_board_limit,
        raw_query=query.raw_query,
        max_pages=query.max_pages,
        page_size=min(20, query.page_size or 20),
        contract_hint=query.contract_hint,
        radius_km=query.radius_km,
    )

    logger.info(
        "workday_search_start role=%s location=%s country=%s boards=%s",
        query.role,
        query.location,
        query.country,
        len(selected_boards),
    )

    sem = asyncio.Semaphore(max(1, min(_env_int("WORKDAY_SEARCH_CONCURRENCY", 2), 4)))

    async def _search_board(board: WorkdayBoardConfig):
        async with sem:
            try:
                result = await provider.search_board(board, board_query)
                return board, result.jobs, None
            except Exception as exc:
                logger.warning(
                    "workday_search_board_failed tenant=%s site=%s error=%s",
                    board.tenant,
                    board.site,
                    exc,
                )
                return board, [], f"{exc.__class__.__name__}: {str(exc)[:200]}"

    grouped = await asyncio.gather(*[_search_board(board) for board in selected_boards])
    normalized: List[Dict[str, Any]] = []
    seen_job_ids: set[str] = set()
    for _board, rows, _error in grouped:
        for row in rows:
            job_id = row.get("job_id")
            if not job_id or job_id in seen_job_ids:
                continue
            seen_job_ids.add(job_id)
            normalized.append({**row, **cheap_validate_job_applyability(row)})
            if len(normalized) >= target_count:
                break
        if len(normalized) >= target_count:
            break

    import_stats = await upsert_imported_jobs(db, normalized[:target_count]) if normalized else {"total_imported": 0}
    imported_count = int(import_stats.get("total_imported") or 0)
    logger.info(
        "workday_search_complete role=%s location=%s normalized=%s imported=%s",
        query.role,
        query.location,
        len(normalized),
        imported_count,
    )
    failures = [
        {"board": f"{board.tenant}/{board.site}", "error": error}
        for board, _rows, error in grouped
        if error
    ]
    if failures and len(failures) == len(grouped):
        reason = "failed"
    elif failures:
        reason = "partial_failure"
    else:
        reason = "imported" if imported_count else "no_results"
    return {
        "attempted": True,
        "reason": reason,
        "status": "failed" if reason == "failed" else ("partial" if failures else "completed"),
        "boards": [f"{board.tenant}/{board.site}" for board, _rows, _error in grouped],
        "errors": failures,
        "normalized_count": len(normalized),
        "imported_count": imported_count,
    }
