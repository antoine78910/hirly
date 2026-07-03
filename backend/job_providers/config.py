"""Shared job provider configuration helpers."""

from __future__ import annotations

import os
from typing import Optional

from .france_travail import FranceTravailProvider
from .jsearch import JSearchProvider


def primary_job_provider_name() -> str:
    return (os.environ.get("JOB_PROVIDER_PRIMARY") or "jsearch").strip().lower()


def _france_travail_client_id() -> str:
    return (os.environ.get("FRANCE_TRAVAIL_CLIENT_ID") or os.environ.get("FT_CLIENT_ID") or "").strip()


def _france_travail_client_secret() -> str:
    return (os.environ.get("FRANCE_TRAVAIL_CLIENT_SECRET") or os.environ.get("FT_CLIENT_SECRET") or "").strip()


def is_france_travail_provider(name: Optional[str] = None) -> bool:
    provider = (name or primary_job_provider_name()).lower()
    return provider in ("france_travail", "francetravail", "ft")


def is_job_provider_configured(name: Optional[str] = None) -> bool:
    provider = (name or primary_job_provider_name()).lower()
    if is_france_travail_provider(provider):
        return bool(_france_travail_client_id() and _france_travail_client_secret())
    return bool(os.environ.get("JSEARCH_API_KEY"))


def is_job_provider_enabled(name: Optional[str] = None) -> bool:
    provider = (name or primary_job_provider_name()).lower()
    if is_france_travail_provider(provider):
        return os.environ.get("FRANCE_TRAVAIL_ENABLED", "true").lower() in ("1", "true", "yes", "on")
    return os.environ.get("JSEARCH_ENABLED", "true").lower() in ("1", "true", "yes", "on")


def get_job_provider(name: str, api_key: str = ""):
    provider = (name or "jsearch").strip().lower()
    if provider == "jsearch":
        key = api_key or os.environ.get("JSEARCH_API_KEY") or ""
        if not key:
            raise ValueError("JSEARCH_API_KEY is not configured")
        return JSearchProvider(api_key=key)
    if is_france_travail_provider(provider):
        client_id = _france_travail_client_id()
        client_secret = _france_travail_client_secret()
        if not client_id or not client_secret:
            raise ValueError("France Travail credentials are not configured")
        return FranceTravailProvider(client_id=client_id, client_secret=client_secret)
    raise ValueError(f"Unsupported job provider: {name}")


def get_configured_job_provider():
    name = primary_job_provider_name()
    if is_france_travail_provider(name):
        return get_job_provider(name, "")
    api_key = os.environ.get("JSEARCH_API_KEY") or ""
    return get_job_provider(name, api_key)
