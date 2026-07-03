"""Job provider registry."""

from .config import (
    get_configured_job_provider,
    get_job_provider,
    is_france_travail_provider,
    is_job_provider_configured,
    is_job_provider_enabled,
    primary_job_provider_name,
)
from .greenhouse import GreenhouseProvider
from .lever import LeverProvider

__all__ = [
    "GreenhouseProvider",
    "LeverProvider",
    "get_board_provider",
    "get_configured_job_provider",
    "get_job_provider",
    "is_france_travail_provider",
    "is_job_provider_configured",
    "is_job_provider_enabled",
    "primary_job_provider_name",
]


def get_board_provider(name: str):
    provider = (name or "").lower()
    if provider == "greenhouse":
        return GreenhouseProvider()
    if provider == "lever":
        return LeverProvider()
    raise ValueError(f"Unsupported board provider: {name}")
