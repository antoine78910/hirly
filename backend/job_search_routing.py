"""Lightweight routing helpers for multi-source job search."""

from __future__ import annotations

import os
from typing import List

from job_providers.base import JobSearchQuery
from job_providers.config import is_france_travail_provider, is_job_provider_configured, primary_job_provider_name


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _looks_like_france_location(location: str | None) -> bool:
    text = (location or "").strip().lower()
    if not text:
        return False
    fr_tokens = (
        "france", "paris", "lyon", "marseille", "toulouse", "bordeaux", "lille",
        "nantes", "strasbourg", "montpellier", "rennes", "grenoble",
    )
    return any(token in text for token in fr_tokens) or text.endswith(", fr")


def resolve_primary_provider(query: JobSearchQuery) -> str:
    """Pick the main search provider for a user query.

    France Travail is intentionally NOT auto-selected here even for French
    locations: it's a last-resort fallback tried only when the primary
    provider (JSearch) and the DB both come up empty for the request, handled
    explicitly in jobs_service.refresh_jobs_for_profile_if_needed. This
    function just returns whatever the operator configured as primary.
    """
    return primary_job_provider_name()


def supplemental_sources(query: JobSearchQuery, *, primary_provider: str) -> List[str]:
    """Ordered supplemental importers to run after the primary provider."""
    sources: List[str] = []

    if _env_bool("SMARTRECRUITERS_SEARCH_ENABLED", True) and (query.role or "").strip():
        sources.append("smartrecruiters")

    if primary_provider != "france_travail" or _env_bool("WORKDAY_SEARCH_FRANCE_SUPPLEMENT", False):
        if _env_bool("WORKDAY_SEARCH_ENABLED", True) and (query.role or "").strip():
            sources.append("workday")

    # France Travail harvest already runs in background; primary FT handles live queries.
    return sources
