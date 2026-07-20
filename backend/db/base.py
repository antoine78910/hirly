"""Database abstraction contracts for the Supabase-backed backend.

The collection surface preserves the small Mongo-style API the app routes use
while the runtime adapter stores documents in Supabase/Postgres.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


Filter = Dict[str, Any]
Document = Dict[str, Any]
Projection = Optional[Dict[str, Any]]
SortSpec = Sequence[Tuple[str, int]]


def is_missing_database_contract_error(
    error: BaseException,
    contract_name: str | None = None,
) -> bool:
    """Recognize PostgREST's missing-RPC response during additive rollouts.

    Application deploys and database migrations are not atomic. Callers may
    safely use their bounded legacy path only when PostgREST explicitly says
    the new function is absent; transport and execution failures still surface.
    """
    message = str(error).lower()
    missing_from_schema_cache = (
        "pgrst202" in message
        or ("could not find the function" in message and "schema cache" in message)
    )
    return missing_from_schema_cache and (
        not contract_name or contract_name.lower() in message
    )


class CursorPort(ABC):
    @abstractmethod
    def sort(self, key_or_list: Any, direction: Optional[int] = None) -> "CursorPort":
        raise NotImplementedError

    @abstractmethod
    def limit(self, count: int) -> "CursorPort":
        raise NotImplementedError

    @abstractmethod
    async def to_list(self, length: Optional[int]) -> List[Document]:
        raise NotImplementedError

    @abstractmethod
    def __aiter__(self):
        raise NotImplementedError


class CollectionPort(ABC):
    @abstractmethod
    async def find_one(self, filter: Filter, projection: Projection = None, sort: Optional[SortSpec] = None) -> Optional[Document]:
        raise NotImplementedError

    @abstractmethod
    def find(self, filter: Optional[Filter] = None, projection: Projection = None) -> CursorPort:
        raise NotImplementedError

    @abstractmethod
    async def insert_one(self, document: Document) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def insert_many(self, documents: Iterable[Document], *, ignore_duplicates: bool = False) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def update_one(self, filter: Filter, update: Document, upsert: bool = False) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def update_many(self, filter: Filter, update: Document, upsert: bool = False) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def delete_one(self, filter: Filter) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def delete_many(self, filter: Filter) -> Any:
        raise NotImplementedError

    @abstractmethod
    async def count_documents(self, filter: Filter) -> int:
        raise NotImplementedError

    @abstractmethod
    async def create_index(self, keys: Any, **kwargs: Any) -> Any:
        raise NotImplementedError


class DatabaseAdapter(ABC):
    users: CollectionPort
    user_sessions: CollectionPort
    profiles: CollectionPort
    jobs: CollectionPort
    applications: CollectionPort
    swipes: CollectionPort
    company_boards: CollectionPort
    browser_submission_runs: CollectionPort
    analytics_events: CollectionPort
    stripe_events: CollectionPort
    auto_apply_attempts: CollectionPort

    @abstractmethod
    async def close(self) -> None:
        raise NotImplementedError
