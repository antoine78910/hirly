"""Job provider registry."""

from .jsearch import JSearchProvider
from .greenhouse import GreenhouseProvider
from .lever import LeverProvider


def get_job_provider(name: str, api_key: str):
    provider = (name or "").lower()
    if provider == "jsearch":
        return JSearchProvider(api_key=api_key)
    raise ValueError(f"Unsupported job provider: {name}")


def get_board_provider(name: str):
    provider = (name or "").lower()
    if provider == "greenhouse":
        return GreenhouseProvider()
    if provider == "lever":
        return LeverProvider()
    raise ValueError(f"Unsupported board provider: {name}")
