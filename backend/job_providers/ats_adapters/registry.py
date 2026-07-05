"""Registry for direct public ATS ingestion adapters."""

from __future__ import annotations

from typing import Dict, Iterable, Optional

from .ashby import AshbyAtsAdapter
from .base import AtsJobAdapter
from .greenhouse import GreenhouseAtsAdapter
from .lever import LeverAtsAdapter
from .smartrecruiters import SmartRecruitersAtsAdapter


def default_ats_adapters() -> Dict[str, AtsJobAdapter]:
    adapters = [GreenhouseAtsAdapter(), LeverAtsAdapter(), AshbyAtsAdapter(), SmartRecruitersAtsAdapter()]
    return {adapter.provider: adapter for adapter in adapters}


def get_ats_adapter(provider: str, adapters: Optional[Dict[str, AtsJobAdapter]] = None) -> Optional[AtsJobAdapter]:
    return (adapters or default_ats_adapters()).get((provider or "").strip().lower())


def adapter_for_url(url: str, adapters: Optional[Dict[str, AtsJobAdapter]] = None) -> Optional[AtsJobAdapter]:
    for adapter in (adapters or default_ats_adapters()).values():
        if adapter.can_handle_url(url):
            return adapter
    return None


def supported_ats_providers() -> Iterable[str]:
    return tuple(default_ats_adapters().keys())
