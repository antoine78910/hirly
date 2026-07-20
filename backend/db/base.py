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
