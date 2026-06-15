"""Supabase/Postgres adapter skeleton.

This is intentionally not wired into routes in Phase 1. The eventual adapter
will translate the collection-port methods into Supabase/PostgREST calls while
preserving API response shapes.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from .base import CollectionPort, CursorPort, DatabaseAdapter, Document, Filter, Projection


MIGRATED_TABLES = {
    "users",
    "user_sessions",
    "jobs",
    "company_boards",
    "profiles",
    "swipes",
    "applications",
    "browser_submission_runs",
    "analytics_events",
    "stripe_events",
    "training_creators",
    "training_courses",
    "training_modules",
    "training_enrollments",
    "training_crm_leads",
}
TABLE_PRIMARY_KEYS = {
    "users": "user_id",
    "user_sessions": "session_token",
    "jobs": "job_id",
    "company_boards": "board_id",
    "profiles": "user_id",
    "swipes": "swipe_id",
    "applications": "application_id",
    "browser_submission_runs": "run_id",
    "analytics_events": "event_id",
    "stripe_events": "event_id",
    "training_creators": "creator_id",
    "training_courses": "course_id",
    "training_modules": "module_id",
    "training_enrollments": "enrollment_id",
    "training_crm_leads": "lead_id",
}
TABLE_FILTER_COLUMNS = {
    "users": {"user_id", "email", "name", "created_at"},
    "user_sessions": {"session_token", "user_id", "expires_at", "created_at"},
    "jobs": {
        "job_id",
        "provider",
        "external_id",
        "ats_provider",
        "auto_apply_supported",
        "company",
        "title",
        "location",
        "country_code",
        "remote",
        "posted_at",
        "imported_at",
        "last_seen_at",
    },
    "company_boards": {"board_id", "ats_provider", "company", "board_token", "enabled", "priority", "last_synced_at"},
    "profiles": {"user_id", "target_role", "target_location", "updated_at"},
    "swipes": {"swipe_id", "user_id", "job_id", "direction", "created_at"},
    "applications": {"application_id", "user_id", "job_id", "status", "package_status", "submission_status", "created_at", "updated_at"},
    "browser_submission_runs": {"run_id", "application_id", "job_id", "user_id", "provider", "status", "dry_run", "created_at"},
    "analytics_events": {"event_id", "user_id", "anonymous_id", "event", "page", "source", "created_at"},
    "stripe_events": {"event_id", "type", "created_at", "processed_at"},
    "training_creators": {"creator_id", "user_id", "email", "display_name", "created_at"},
    "training_courses": {"course_id", "creator_id", "title", "status", "published", "created_at", "updated_at"},
    "training_modules": {"module_id", "course_id", "title", "sort_order", "duration_seconds", "created_at"},
    "training_enrollments": {"enrollment_id", "user_id", "course_id", "progress_percent", "enrolled_at", "updated_at"},
    "training_crm_leads": {"lead_id", "creator_id", "email", "name", "stage", "source", "created_at", "updated_at"},
}
MAX_READ_ROWS = 10000
READ_PAGE_SIZE = 1000


class SupabaseWriteResult(dict):
    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as exc:
            raise AttributeError(name) from exc


def _supabase_headers(secret_key: str) -> Dict[str, str]:
    return {
        "apikey": secret_key,
        "Authorization": f"Bearer {secret_key}",
    }


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is not None and value.__class__.__name__ == "ObjectId":
        return str(value)
    return value


def _document_key(table: str, doc: Document) -> str:
    if table == "swipes":
        return str(doc.get("swipe_id") or f"{doc.get('user_id')}:{doc.get('job_id')}:{doc.get('direction')}:{doc.get('created_at')}")
    key = TABLE_PRIMARY_KEYS.get(table)
    value = doc.get(key) if key else None
    if not value:
        raise ValueError(f"{table} documents must contain {key}")
    return str(value)


def _supabase_row(table: str, document: Document) -> Dict[str, Any]:
    doc = _json_safe(document)
    if table == "users":
        return {
            "user_id": _document_key(table, doc),
            "email": doc.get("email"),
            "name": doc.get("name"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "user_sessions":
        return {
            "session_token": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "expires_at": doc.get("expires_at"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "jobs":
        return {
            "job_id": _document_key(table, doc),
            "provider": doc.get("provider"),
            "external_id": doc.get("external_id"),
            "ats_provider": doc.get("ats_provider"),
            "auto_apply_supported": bool(doc.get("auto_apply_supported")),
            "company": doc.get("company"),
            "title": doc.get("title"),
            "location": doc.get("location"),
            "country_code": doc.get("country_code"),
            "remote": bool(doc.get("remote")),
            "posted_at": doc.get("posted_at"),
            "imported_at": doc.get("imported_at"),
            "last_seen_at": doc.get("last_seen_at"),
            "data": doc,
        }
    if table == "company_boards":
        return {
            "board_id": _document_key(table, doc),
            "ats_provider": doc.get("ats_provider"),
            "company": doc.get("company"),
            "board_token": doc.get("board_token"),
            "enabled": bool(doc.get("enabled", True)),
            "priority": doc.get("priority"),
            "last_synced_at": doc.get("last_synced_at"),
            "data": doc,
        }
    if table == "profiles":
        return {
            "user_id": _document_key(table, doc),
            "target_role": doc.get("target_role"),
            "target_location": doc.get("target_location"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "swipes":
        swipe_id = _document_key(table, doc)
        doc.setdefault("swipe_id", swipe_id)
        return {
            "swipe_id": swipe_id,
            "user_id": doc.get("user_id"),
            "job_id": doc.get("job_id"),
            "direction": doc.get("direction"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "applications":
        return {
            "application_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "job_id": doc.get("job_id"),
            "status": doc.get("status"),
            "package_status": doc.get("package_status"),
            "submission_status": doc.get("submission_status"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "browser_submission_runs":
        return {
            "run_id": _document_key(table, doc),
            "application_id": doc.get("application_id"),
            "job_id": doc.get("job_id"),
            "user_id": doc.get("user_id"),
            "provider": doc.get("provider"),
            "status": doc.get("status"),
            "dry_run": bool(doc.get("dry_run")),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "analytics_events":
        return {
            "event_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "anonymous_id": doc.get("anonymous_id"),
            "event": doc.get("event"),
            "page": doc.get("page"),
            "source": doc.get("source"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "stripe_events":
        return {
            "event_id": _document_key(table, doc),
            "type": doc.get("type"),
            "created_at": doc.get("created_at"),
            "processed_at": doc.get("processed_at"),
            "data": doc,
        }
    if table == "training_creators":
        return {
            "creator_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "email": doc.get("email"),
            "display_name": doc.get("display_name"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "training_courses":
        return {
            "course_id": _document_key(table, doc),
            "creator_id": doc.get("creator_id"),
            "title": doc.get("title"),
            "status": doc.get("status"),
            "published": bool(doc.get("published")),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "training_modules":
        return {
            "module_id": _document_key(table, doc),
            "course_id": doc.get("course_id"),
            "title": doc.get("title"),
            "sort_order": int(doc.get("sort_order") or 0),
            "duration_seconds": doc.get("duration_seconds"),
            "created_at": doc.get("created_at"),
            "data": doc,
        }
    if table == "training_enrollments":
        return {
            "enrollment_id": _document_key(table, doc),
            "user_id": doc.get("user_id"),
            "course_id": doc.get("course_id"),
            "progress_percent": int(doc.get("progress_percent") or 0),
            "completed_module_ids": doc.get("completed_module_ids") or [],
            "enrolled_at": doc.get("enrolled_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    if table == "training_crm_leads":
        return {
            "lead_id": _document_key(table, doc),
            "creator_id": doc.get("creator_id"),
            "email": doc.get("email"),
            "name": doc.get("name"),
            "stage": doc.get("stage"),
            "source": doc.get("source"),
            "created_at": doc.get("created_at"),
            "updated_at": doc.get("updated_at"),
            "data": doc,
        }
    raise ValueError(f"Unsupported Supabase table: {table}")


def _restore_document(row: Dict[str, Any]) -> Document:
    data = row.get("data")
    if isinstance(data, dict):
        return dict(data)
    restored = dict(row)
    restored.pop("data", None)
    restored.pop("migrated_at", None)
    return restored


def _project_document(document: Document, projection: Projection) -> Document:
    if not projection:
        return dict(document)
    if projection.get("_id") == 0 and len(projection) == 1:
        return dict(document)

    include_keys = {key for key, value in projection.items() if value and key != "_id"}
    exclude_keys = {key for key, value in projection.items() if not value}
    if include_keys:
        projected: Document = {}
        for key in include_keys:
            value = _get_document_path(document, key)
            if value is not None:
                _set_document_path(projected, key, value)
        if projection.get("_id", 1) and "_id" in document:
            projected["_id"] = document["_id"]
        return projected
    projected = dict(document)
    for key in exclude_keys:
        projected.pop(key, None)
    return projected


def _comparable(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return value


def _match_operator(value: Any, operator: str, expected: Any, condition: Dict[str, Any]) -> bool:
    if operator == "$in":
        expected_values = expected or []
        if isinstance(value, list):
            return any(item in expected_values for item in value)
        return value in expected_values
    if operator == "$nin":
        expected_values = expected or []
        if isinstance(value, list):
            return all(item not in expected_values for item in value)
        return value not in expected_values
    if operator == "$gte":
        if value is None:
            return False
        left = _comparable(value)
        right = _comparable(expected)
        try:
            return left >= right
        except TypeError:
            return False
    if operator == "$exists":
        exists = value is not None
        return exists is bool(expected)
    if operator == "$regex":
        flags = re.IGNORECASE if "i" in str(condition.get("$options", "")) else 0
        return re.search(str(expected), str(value or ""), flags) is not None
    if operator == "$not":
        if isinstance(expected, dict):
            return not _match_condition(value, expected)
        return value != expected
    if operator == "$options":
        return True
    return False


def _match_condition(value: Any, condition: Any) -> bool:
    if isinstance(condition, dict):
        for operator, expected in condition.items():
            if operator.startswith("$"):
                if not _match_operator(value, operator, expected, condition):
                    return False
            elif value != condition:
                return False
        return True
    return value == condition


def _matches_filter(document: Document, filter: Optional[Filter]) -> bool:
    if not filter:
        return True
    for key, condition in filter.items():
        if key == "$or":
            clauses = condition or []
            if not any(_matches_filter(document, clause) for clause in clauses):
                return False
            continue
        if key == "$and":
            clauses = condition or []
            if not all(_matches_filter(document, clause) for clause in clauses):
                return False
            continue
        if not _match_condition(_get_document_path(document, key), condition):
            return False
    return True


def _get_document_path(document: Document, dotted_key: str) -> Any:
    target: Any = document
    for part in dotted_key.split("."):
        if not isinstance(target, dict) or part not in target:
            return None
        target = target[part]
    return target


def _set_document_path(document: Document, dotted_key: str, value: Any) -> None:
    parts = dotted_key.split(".")
    target = document
    for part in parts[:-1]:
        existing = target.get(part)
        if not isinstance(existing, dict):
            existing = {}
            target[part] = existing
        target = existing
    target[parts[-1]] = value


def _postgrest_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _postgrest_filter_params(table: str, filter: Optional[Filter]) -> Optional[Dict[str, str]]:
    if not filter:
        return {}
    columns = TABLE_FILTER_COLUMNS.get(table, set())
    params: Dict[str, str] = {}
    for key, condition in filter.items():
        if key.startswith("$") or "." in key or key not in columns:
            return None
        if isinstance(condition, dict):
            if "$in" in condition and len(condition) == 1:
                values = ",".join(_postgrest_value(item) for item in (condition.get("$in") or []))
                params[key] = f"in.({values})"
            elif "$gte" in condition and len(condition) == 1:
                params[key] = f"gte.{_postgrest_value(condition.get('$gte'))}"
            else:
                return None
        else:
            params[key] = f"eq.{_postgrest_value(condition)}"
    return params


class SupabaseCursorAdapter(CursorPort):
    def __init__(self, collection: "SupabaseCollectionAdapter", filter: Optional[Filter] = None, projection: Projection = None):
        self.collection = collection
        self.filter = filter or {}
        self.projection = projection
        self._sort_spec: List[tuple[str, int]] = []
        self._limit: Optional[int] = None
        self._iter_items: Optional[List[Document]] = None
        self._iter_index = 0

    def sort(self, key_or_list: Any, direction: Optional[int] = None) -> "SupabaseCursorAdapter":
        if direction is None and isinstance(key_or_list, list):
            self._sort_spec = [(key, int(dir_value)) for key, dir_value in key_or_list]
        elif direction is None and isinstance(key_or_list, tuple):
            self._sort_spec = [(key_or_list[0], int(key_or_list[1]))]
        else:
            self._sort_spec = [(str(key_or_list), int(direction or 1))]
        return self

    def limit(self, count: int) -> "SupabaseCursorAdapter":
        self._limit = count
        return self

    async def to_list(self, length: Optional[int]):
        limit = length if length is not None else self._limit
        pushed_limit = (limit if not self._sort_spec else None) or (self._limit if not self._sort_spec else None)
        rows = await self.collection._read_documents(self.filter, pushed_limit)
        if self._sort_spec:
            for key, direction in reversed(self._sort_spec):
                rows.sort(key=lambda item: (item.get(key) is None, item.get(key)), reverse=direction < 0)
        if self._limit is not None:
            rows = rows[: self._limit]
        if limit is not None:
            rows = rows[:limit]
        return [_project_document(row, self.projection) for row in rows]

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._iter_items is None:
            self._iter_items = await self.to_list(self._limit)
        if self._iter_index >= len(self._iter_items):
            raise StopAsyncIteration
        item = self._iter_items[self._iter_index]
        self._iter_index += 1
        return item


class SupabaseCollectionAdapter(CollectionPort):
    def __init__(self, table_name: str, supabase_url: Optional[str] = None, secret_key: Optional[str] = None):
        self.table_name = table_name
        self.supabase_url = supabase_url
        self.secret_key = secret_key

    @property
    def _read_supported(self) -> bool:
        return self.table_name in MIGRATED_TABLES and bool(self.supabase_url and self.secret_key)

    def _require_read_supported(self) -> None:
        if self.table_name not in MIGRATED_TABLES:
            raise RuntimeError(f"Supabase path is only implemented for {sorted(MIGRATED_TABLES)}.")
        if not self.supabase_url or not self.secret_key:
            raise RuntimeError("Supabase URL or secret key is missing.")

    async def _read_documents(self, filter: Optional[Filter] = None, read_limit: Optional[int] = None) -> List[Document]:
        self._require_read_supported()
        assert self.supabase_url is not None
        assert self.secret_key is not None

        url = self.supabase_url.rstrip("/") + f"/rest/v1/{self.table_name}"
        headers = _supabase_headers(self.secret_key)
        documents: List[Document] = []
        offset = 0
        remote_filter_params = _postgrest_filter_params(self.table_name, filter)
        async with httpx.AsyncClient(timeout=30.0) as client:
            while offset < MAX_READ_ROWS:
                page_limit = READ_PAGE_SIZE
                if read_limit is not None:
                    remaining = max(0, read_limit - len(documents))
                    if remaining <= 0:
                        break
                    page_limit = min(page_limit, remaining)
                params = {
                    "select": "data",
                    "limit": str(page_limit),
                    "offset": str(offset),
                }
                if remote_filter_params is not None:
                    params.update(remote_filter_params)
                response = await client.get(
                    url,
                    params=params,
                    headers=headers,
                )
                if response.status_code not in (200, 206):
                    raise RuntimeError(
                        f"Supabase {self.table_name} read returned HTTP {response.status_code}: {response.text[:300]}"
                    )
                rows = response.json()
                if not isinstance(rows, list) or not rows:
                    break
                documents.extend(_restore_document(row) for row in rows)
                if len(rows) < page_limit:
                    break
                offset += page_limit
        if remote_filter_params is not None:
            return documents
        return [document for document in documents if _matches_filter(document, filter)]

    async def find_one(self, filter: Filter, projection: Projection = None, sort: Optional[List[tuple[str, int]]] = None):
        cursor = SupabaseCursorAdapter(self, filter, projection)
        if sort:
            cursor.sort(sort)
        rows = await cursor.limit(1).to_list(1)
        return rows[0] if rows else None

    def find(self, filter: Optional[Filter] = None, projection: Projection = None):
        self._require_read_supported()
        return SupabaseCursorAdapter(self, filter, projection)

    async def insert_one(self, document: Document):
        result = await upsert_supabase_documents(self.supabase_url or "", self.secret_key or "", self.table_name, [document])
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or f"Supabase {self.table_name} insert failed")
        return SupabaseWriteResult(inserted_id=_document_key(self.table_name, _json_safe(document)))

    async def insert_many(self, documents):
        docs = list(documents)
        result = await upsert_supabase_documents(self.supabase_url or "", self.secret_key or "", self.table_name, docs)
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or f"Supabase {self.table_name} insert_many failed")
        return SupabaseWriteResult(inserted_count=result.get("rows", 0))

    async def update_one(self, filter: Filter, update: Document, upsert: bool = False):
        if upsert and self._can_fast_upsert(filter, update):
            document: Document = {}
            for key, value in filter.items():
                if not key.startswith("$") and not isinstance(value, dict):
                    _set_document_path(document, key, value)
            if "$setOnInsert" in update:
                for key, value in (update.get("$setOnInsert") or {}).items():
                    _set_document_path(document, key, value)
            if "$set" in update:
                for key, value in (update.get("$set") or {}).items():
                    _set_document_path(document, key, value)
            result = await upsert_supabase_documents(self.supabase_url or "", self.secret_key or "", self.table_name, [document])
            if not result.get("ok"):
                raise RuntimeError(result.get("error") or f"Supabase {self.table_name} update failed")
            return SupabaseWriteResult(matched_count=0, modified_count=1, upserted_id=_document_key(self.table_name, _json_safe(document)))

        existing = await self.find_one(filter, {"_id": 0})
        if not existing and not upsert:
            return SupabaseWriteResult(matched_count=0, modified_count=0, upserted_id=None)
        document = dict(existing or {})
        if "$set" in update:
            for key, value in (update.get("$set") or {}).items():
                _set_document_path(document, key, value)
        if "$setOnInsert" in update and not existing:
            for key, value in (update.get("$setOnInsert") or {}).items():
                _set_document_path(document, key, value)
        if "$inc" in update:
            for key, value in (update.get("$inc") or {}).items():
                document[key] = int(document.get(key) or 0) + int(value)
        if not any(key.startswith("$") for key in update):
            document.update(update)
        for key, value in filter.items():
            if not key.startswith("$") and not isinstance(value, dict):
                document.setdefault(key, value)
        result = await upsert_supabase_documents(self.supabase_url or "", self.secret_key or "", self.table_name, [document])
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or f"Supabase {self.table_name} update failed")
        return SupabaseWriteResult(matched_count=1 if existing else 0, modified_count=1, upserted_id=None if existing else _document_key(self.table_name, _json_safe(document)))

    def _can_fast_upsert(self, filter: Filter, update: Document) -> bool:
        if self.table_name == "profiles":
            return False
        if "$inc" in update:
            return False
        if any(key.startswith("$") for key in filter):
            return False
        if any(isinstance(value, dict) for value in filter.values()):
            return False
        allowed_update_keys = {"$set", "$setOnInsert"}
        if any(key.startswith("$") and key not in allowed_update_keys for key in update):
            return False
        if not any(key in update for key in allowed_update_keys):
            return not any(key.startswith("$") for key in update)
        return True

    async def update_many(self, filter: Filter, update: Document, upsert: bool = False):
        docs = await self._read_documents(filter)
        modified = 0
        for doc in docs:
            await self.update_one({TABLE_PRIMARY_KEYS[self.table_name]: _document_key(self.table_name, doc)}, update, upsert=False)
            modified += 1
        return SupabaseWriteResult(matched_count=len(docs), modified_count=modified)

    async def delete_one(self, filter: Filter):
        docs = await self._read_documents(filter)
        if not docs:
            return SupabaseWriteResult(deleted_count=0)
        await self._delete_by_key(_document_key(self.table_name, docs[0]))
        return SupabaseWriteResult(deleted_count=1)

    async def delete_many(self, filter: Filter):
        docs = await self._read_documents(filter)
        for doc in docs:
            await self._delete_by_key(_document_key(self.table_name, doc))
        return SupabaseWriteResult(deleted_count=len(docs))

    async def _delete_by_key(self, key_value: str) -> None:
        self._require_read_supported()
        key = TABLE_PRIMARY_KEYS[self.table_name]
        url = (self.supabase_url or "").rstrip("/") + f"/rest/v1/{self.table_name}"
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(
                url,
                params={key: f"eq.{key_value}"},
                headers=_supabase_headers(self.secret_key or ""),
            )
        if response.status_code not in (200, 202, 204):
            raise RuntimeError(f"Supabase {self.table_name} delete returned HTTP {response.status_code}: {response.text[:300]}")

    async def count_documents(self, filter: Filter) -> int:
        self._require_read_supported()
        remote_filter_params = _postgrest_filter_params(self.table_name, filter)
        if remote_filter_params is not None:
            assert self.supabase_url is not None
            assert self.secret_key is not None
            result = await count_supabase_table(self.supabase_url, self.secret_key, self.table_name, remote_filter_params)
            if result.get("ok"):
                return int(result.get("count") or 0)
        if not filter:
            assert self.supabase_url is not None
            assert self.secret_key is not None
            result = await count_supabase_table(self.supabase_url, self.secret_key, self.table_name)
            if result.get("ok"):
                return int(result.get("count") or 0)
        return len(await self._read_documents(filter))

    async def create_index(self, keys: Any, **kwargs: Any):
        raise RuntimeError("Supabase indexes are managed through SQL migrations, not runtime create_index calls.")


class SupabaseDatabaseAdapter(DatabaseAdapter):
    def __init__(self, supabase_url: str, secret_key: str, db_url: Optional[str] = None):
        self.supabase_url = supabase_url
        self.secret_key = secret_key
        self.db_url = db_url
        self.users = SupabaseCollectionAdapter("users", supabase_url, secret_key)
        self.user_sessions = SupabaseCollectionAdapter("user_sessions", supabase_url, secret_key)
        self.profiles = SupabaseCollectionAdapter("profiles", supabase_url, secret_key)
        self.jobs = SupabaseCollectionAdapter("jobs", supabase_url, secret_key)
        self.applications = SupabaseCollectionAdapter("applications", supabase_url, secret_key)
        self.swipes = SupabaseCollectionAdapter("swipes", supabase_url, secret_key)
        self.company_boards = SupabaseCollectionAdapter("company_boards", supabase_url, secret_key)
        self.browser_submission_runs = SupabaseCollectionAdapter("browser_submission_runs", supabase_url, secret_key)
        self.analytics_events = SupabaseCollectionAdapter("analytics_events", supabase_url, secret_key)
        self.stripe_events = SupabaseCollectionAdapter("stripe_events", supabase_url, secret_key)
        self.training_creators = SupabaseCollectionAdapter("training_creators", supabase_url, secret_key)
        self.training_courses = SupabaseCollectionAdapter("training_courses", supabase_url, secret_key)
        self.training_modules = SupabaseCollectionAdapter("training_modules", supabase_url, secret_key)
        self.training_enrollments = SupabaseCollectionAdapter("training_enrollments", supabase_url, secret_key)
        self.training_crm_leads = SupabaseCollectionAdapter("training_crm_leads", supabase_url, secret_key)

    async def close(self) -> None:
        return None


async def test_supabase_connection(
    supabase_url: str,
    secret_key: str,
    timeout: float = 10.0,
) -> dict:
    """Probe Supabase REST connectivity without reading or writing app data."""
    if not supabase_url or not secret_key:
        return {"ok": False, "error": "Supabase URL or secret key is missing."}

    url = supabase_url.rstrip("/") + "/rest/v1/"
    headers = _supabase_headers(secret_key)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url, headers=headers)
        if 200 <= response.status_code < 300:
            return {"ok": True, "error": None}
        return {
            "ok": False,
            "error": f"Supabase REST returned HTTP {response.status_code}: {response.text[:300]}",
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"{exc.__class__.__name__}: {str(exc)[:300]}",
        }


async def count_supabase_table(
    supabase_url: str,
    secret_key: str,
    table: str,
    filter_params: Optional[Dict[str, str]] = None,
    timeout: float = 10.0,
) -> Dict[str, Any]:
    """Return an exact Supabase row count through PostgREST without exposing secrets."""
    if table not in MIGRATED_TABLES:
        raise ValueError(f"Unsupported Supabase count table: {table}")
    if not supabase_url or not secret_key:
        return {"ok": False, "count": None, "error": "Supabase URL or secret key is missing."}

    url = supabase_url.rstrip("/") + f"/rest/v1/{table}"
    headers = {
        **_supabase_headers(secret_key),
        "Prefer": "count=exact",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            params = {"select": "*", "limit": "0"}
            if filter_params:
                params.update(filter_params)
            response = await client.get(url, params=params, headers=headers)
        if response.status_code not in (200, 206):
            return {
                "ok": False,
                "count": None,
                "error": f"Supabase {table} count returned HTTP {response.status_code}: {response.text[:300]}",
            }
        content_range = response.headers.get("content-range", "")
        count_text = content_range.rsplit("/", 1)[-1] if "/" in content_range else ""
        return {"ok": True, "count": int(count_text), "error": None}
    except Exception as exc:
        return {"ok": False, "count": None, "error": f"{exc.__class__.__name__}: {str(exc)[:300]}"}


async def upsert_supabase_documents(
    supabase_url: str,
    secret_key: str,
    table: str,
    documents: List[Document],
    timeout: float = 30.0,
) -> Dict[str, Any]:
    """Upsert application documents into Supabase jsonb-backed tables."""
    if table not in MIGRATED_TABLES:
        raise ValueError(f"Unsupported Supabase migration table: {table}")
    if not documents:
        return {"ok": True, "rows": 0, "error": None}
    if not supabase_url or not secret_key:
        return {"ok": False, "rows": 0, "error": "Supabase URL or secret key is missing."}

    conflict_key = TABLE_PRIMARY_KEYS[table]
    rows = [_supabase_row(table, document) for document in documents]
    url = supabase_url.rstrip("/") + f"/rest/v1/{table}"
    headers = {
        **_supabase_headers(secret_key),
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                params={"on_conflict": conflict_key},
                headers=headers,
                content=json.dumps(rows),
            )
        if response.status_code not in (200, 201, 204):
            return {
                "ok": False,
                "rows": 0,
                "error": f"Supabase {table} upsert returned HTTP {response.status_code}: {response.text[:500]}",
            }
        return {"ok": True, "rows": len(rows), "error": None}
    except Exception as exc:
        return {"ok": False, "rows": 0, "error": f"{exc.__class__.__name__}: {str(exc)[:500]}"}
