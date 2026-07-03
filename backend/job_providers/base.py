"""Shared contracts for external job providers."""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class JobSearchQuery:
    role: str
    location: Optional[str] = None
    remote_preference: str = "any"
    country: Optional[str] = "us"
    language: str = "en"
    limit: int = 20
    raw_query: bool = False
    max_pages: Optional[int] = None
    page_size: Optional[int] = None
    contract_hint: Optional[str] = None


@dataclass(frozen=True)
class BoardQuery:
    board_token: str
    company: str
    role: Optional[str] = None
    location: Optional[str] = None
    remote_preference: str = "any"
    country: Optional[str] = None
    limit: int = 100


@dataclass
class ProviderResult:
    jobs: List[Dict[str, Any]]
    raw_response: Optional[Dict[str, Any]] = None
