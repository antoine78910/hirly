"""
Supabase (PostgreSQL) database layer with a MongoDB-compatible API.

Documents are stored as JSONB so existing server code can keep using
find_one / update_one / $set / etc. without a full rewrite.
"""
from __future__ import annotations

import json
import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

import asyncpg

_pool: Optional[asyncpg.Pool] = None

TABLE_META: Dict[str, Dict[str, Any]] = {
    "users": {"pk": "user_id", "indexed": ["email"]},
    "user_sessions": {"pk": None, "token": "session_token", "indexed": ["session_token", "user_id"]},
    "profiles": {"pk": "user_id"},
    "jobs": {"pk": "job_id", "indexed": ["provider", "external_id"]},
    "swipes": {"pk": None, "composite": ("user_id", "job_id")},
    "applications": {"pk": "application_id", "indexed": ["user_id"]},
    "gmail_connections": {"pk": "user_id", "indexed": ["email"]},
    "application_emails": {"pk": "email_id", "indexed": ["user_id", "application_id", "gmail_message_id"]},
    "company_boards": {"pk": "board_id"},
    "analytics_events": {"pk": "event_id", "indexed": ["user_id", "anonymous_id", "event"]},
    "stripe_events": {"pk": "event_id", "indexed": ["type"]},
}


def _get_path(doc: Dict[str, Any], path: str) -> Any:
    cur: Any = doc
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _set_path(doc: Dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    cur = doc
    for part in parts[:-1]:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    cur[parts[-1]] = value


def _unset_path(doc: Dict[str, Any], path: str) -> None:
    parts = path.split(".")
    cur: Any = doc
    for part in parts[:-1]:
        if not isinstance(cur, dict) or part not in cur:
            return
        cur = cur[part]
    if isinstance(cur, dict):
        cur.pop(parts[-1], None)


def _apply_projection(doc: Dict[str, Any], projection: Optional[Dict[str, int]]) -> Dict[str, Any]:
    if not projection:
        return deepcopy(doc)
    if any(v == 1 for v in projection.values()):
        out: Dict[str, Any] = {}
        for key, mode in projection.items():
            if key == "_id" or mode != 1:
                continue
            val = _get_path(doc, key) if "." in key else doc.get(key)
            if val is not None:
                if "." in key:
                    _set_path(out, key, deepcopy(val))
                else:
                    out[key] = deepcopy(val)
        return out
    out = deepcopy(doc)
    for key, mode in projection.items():
        if key == "_id" or mode != 0:
            continue
        if "." in key:
            parts = key.split(".")
            cur = out
            for part in parts[:-1]:
                if not isinstance(cur, dict):
                    break
                cur = cur.get(part)
            if isinstance(cur, dict):
                cur.pop(parts[-1], None)
        else:
            out.pop(key, None)
    return out


def _regex_match(value: Any, pattern: str, options: str = "") -> bool:
    if value is None:
        return False
    flags = re.IGNORECASE if "i" in (options or "") else 0
    try:
        return re.search(pattern, str(value), flags) is not None
    except re.error:
        return False


def _compare_values(left: Any, right: Any) -> bool:
    if left is None or right is None:
        return left == right
    try:
        return left >= right if isinstance(right, str) else left >= right
    except TypeError:
        return str(left) >= str(right)


def _matches(doc: Dict[str, Any], query: Dict[str, Any]) -> bool:
    if not query:
        return True
    for key, cond in query.items():
        if key == "$or":
            if not any(_matches(doc, sub) for sub in cond):
                return False
            continue
        if key == "$and":
            if not all(_matches(doc, sub) for sub in cond):
                return False
            continue
        value = _get_path(doc, key) if "." in key else doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond:
                if value not in cond["$in"]:
                    return False
                continue
            if "$nin" in cond:
                if value in cond["$nin"]:
                    return False
                continue
            if "$gte" in cond:
                if value is None or not _compare_values(value, cond["$gte"]):
                    return False
                continue
            if "$gt" in cond:
                if value is None or value <= cond["$gt"]:
                    return False
                continue
            if "$lte" in cond:
                if value is None or value > cond["$lte"]:
                    return False
                continue
            if "$lt" in cond:
                if value is None or value >= cond["$lt"]:
                    return False
                continue
            if "$exists" in cond:
                exists = value is not None
                if bool(cond["$exists"]) != exists:
                    return False
                continue
            if "$regex" in cond:
                if not _regex_match(value, cond["$regex"], cond.get("$options", "")):
                    return False
                continue
            if "$not" in cond:
                if _matches(doc, {key: cond["$not"]}):
                    return False
                continue
            if not _matches(doc, {key: cond}):
                return False
            continue
        if value != cond:
            return False
    return True


def _apply_update(doc: Dict[str, Any], update: Dict[str, Any], is_insert: bool) -> Dict[str, Any]:
    out = deepcopy(doc)
    if "$setOnInsert" in update and is_insert:
        for path, val in update["$setOnInsert"].items():
            current = _get_path(out, path) if "." in path else out.get(path)
            if current is None:
                _set_path(out, path, deepcopy(val)) if "." in path else out.__setitem__(path, deepcopy(val))
    if "$set" in update:
        for path, val in update["$set"].items():
            if "." in path:
                _set_path(out, path, deepcopy(val))
            else:
                out[path] = deepcopy(val)
    if "$unset" in update:
        for path in update["$unset"]:
            _unset_path(out, path)
    return out


class UpdateResult:
    def __init__(self, matched_count: int = 0, modified_count: int = 0, upserted_id: Any = None):
        self.matched_count = matched_count
        self.modified_count = modified_count
        self.upserted_id = upserted_id


class DeleteResult:
    def __init__(self, deleted_count: int = 0):
        self.deleted_count = deleted_count


class Cursor:
    def __init__(self, collection: "Collection", query: Dict[str, Any], projection: Optional[Dict[str, int]]):
        self._collection = collection
        self._query = query
        self._projection = projection
        self._sort: Optional[Tuple[str, int]] = None
        self._limit: Optional[int] = None

    def sort(self, field: str, direction: int = 1) -> "Cursor":
        self._sort = (field, direction)
        return self

    def limit(self, n: int) -> "Cursor":
        self._limit = n
        return self

    async def to_list(self, length: Optional[int] = None) -> List[Dict[str, Any]]:
        rows = await self._collection._fetch_matching(self._query)
        if self._sort:
            field, direction = self._sort
            reverse = direction < 0
            rows.sort(key=lambda d: _get_path(d, field) if "." in field else d.get(field), reverse=reverse)
        cap = self._limit if self._limit is not None else length
        if cap is not None:
            rows = rows[:cap]
        return [_apply_projection(row, self._projection) for row in rows]

    def __aiter__(self):
        self._iter_rows = None
        self._iter_index = 0
        return self

    async def __anext__(self) -> Dict[str, Any]:
        if self._iter_rows is None:
            self._iter_rows = await self.to_list(None)
        if self._iter_index >= len(self._iter_rows):
            raise StopAsyncIteration
        row = self._iter_rows[self._iter_index]
        self._iter_index += 1
        return row


class Collection:
    def __init__(self, name: str, pool: asyncpg.Pool):
        self.name = name
        self._pool = pool
        self._meta = TABLE_META[name]

    async def _load_all(self) -> List[Dict[str, Any]]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(f"SELECT data FROM {self.name}")
        return [json.loads(row["data"]) if isinstance(row["data"], str) else dict(row["data"]) for row in rows]

    async def _fetch_matching(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        simple = self._simple_sql_filter(query)
        if simple is not None:
            sql, args = simple
            async with self._pool.acquire() as conn:
                rows = await conn.fetch(sql, *args)
            docs = [json.loads(row["data"]) if isinstance(row["data"], str) else dict(row["data"]) for row in rows]
        else:
            docs = await self._load_all()
        return [doc for doc in docs if _matches(doc, query)]

    def _simple_sql_filter(self, query: Dict[str, Any]) -> Optional[Tuple[str, List[Any]]]:
        if not query or "$or" in query or "$and" in query:
            return None
        clauses = []
        args: List[Any] = []
        idx = 1
        for key, val in query.items():
            if isinstance(val, dict):
                return None
            if key in ("user_id", "job_id", "session_token", "email", "application_id", "board_id", "provider", "external_id"):
                clauses.append(f"{key} = ${idx}")
                args.append(val)
                idx += 1
            elif key == "user_id" and self.name == "swipes":
                clauses.append(f"user_id = ${idx}")
                args.append(val)
                idx += 1
            else:
                return None
        if not clauses:
            return None
        where = " AND ".join(clauses)
        return f"SELECT data FROM {self.name} WHERE {where}", args

    def _row_payload(self, doc: Dict[str, Any]) -> Tuple[List[str], List[Any]]:
        pk = self._meta.get("pk")
        cols = ["data"]
        vals: List[Any] = [json.dumps(doc)]
        if pk and doc.get(pk):
            cols.insert(0, pk)
            vals.insert(0, doc[pk])
        if self.name == "users" and doc.get("email"):
            cols.append("email")
            vals.append(doc["email"])
        if self.name == "user_sessions":
            cols.extend(["session_token", "user_id"])
            vals.extend([doc["session_token"], doc["user_id"]])
        if self.name == "jobs":
            if doc.get("provider") is not None:
                cols.append("provider")
                vals.append(doc["provider"])
            if doc.get("external_id") is not None:
                cols.append("external_id")
                vals.append(str(doc["external_id"]))
        if self.name == "swipes":
            cols.extend(["user_id", "job_id"])
            vals.extend([doc["user_id"], doc["job_id"]])
        if self.name == "applications":
            cols.extend(["user_id"])
            vals.append(doc["user_id"])
            if doc.get("job_id") is not None:
                cols.append("job_id")
                vals.append(doc["job_id"])
        if self.name == "gmail_connections":
            cols.append("email")
            vals.append(doc.get("email"))
        if self.name == "application_emails":
            cols.extend(["user_id", "application_id", "job_id"])
            vals.extend([doc.get("user_id"), doc.get("application_id"), doc.get("job_id")])
        return cols, vals

    async def find_one(
        self,
        query: Dict[str, Any],
        projection: Optional[Dict[str, int]] = None,
        sort: Optional[List[Tuple[str, int]]] = None,
    ) -> Optional[Dict[str, Any]]:
        rows = await self._fetch_matching(query)
        if not rows:
            return None
        if sort:
            for field, direction in reversed(sort):
                reverse = direction < 0
                rows.sort(
                    key=lambda d: _get_path(d, field) if "." in field else d.get(field),
                    reverse=reverse,
                )
        return _apply_projection(rows[0], projection)

    def find(self, query: Dict[str, Any], projection: Optional[Dict[str, int]] = None) -> Cursor:
        return Cursor(self, query, projection)

    async def _save_doc(self, doc: Dict[str, Any]) -> None:
        payload = json.dumps(doc)
        async with self._pool.acquire() as conn:
            if self.name == "users":
                await conn.execute(
                    """
                    INSERT INTO users (user_id, email, data)
                    VALUES ($1, $2, $3::jsonb)
                    ON CONFLICT (user_id) DO UPDATE
                    SET email = EXCLUDED.email, data = EXCLUDED.data
                    """,
                    doc["user_id"],
                    doc.get("email"),
                    payload,
                )
            elif self.name == "user_sessions":
                await conn.execute(
                    """
                    INSERT INTO user_sessions (session_token, user_id, data)
                    VALUES ($1, $2, $3::jsonb)
                    ON CONFLICT (session_token) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data
                    """,
                    doc["session_token"],
                    doc["user_id"],
                    payload,
                )
            elif self.name == "profiles":
                await conn.execute(
                    """
                    INSERT INTO profiles (user_id, data)
                    VALUES ($1, $2::jsonb)
                    ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data
                    """,
                    doc["user_id"],
                    payload,
                )
            elif self.name == "jobs":
                await conn.execute(
                    """
                    INSERT INTO jobs (job_id, provider, external_id, data)
                    VALUES ($1, $2, $3, $4::jsonb)
                    ON CONFLICT (job_id) DO UPDATE
                    SET provider = EXCLUDED.provider, external_id = EXCLUDED.external_id, data = EXCLUDED.data
                    """,
                    doc["job_id"],
                    doc.get("provider"),
                    str(doc["external_id"]) if doc.get("external_id") is not None else None,
                    payload,
                )
            elif self.name == "swipes":
                await conn.execute(
                    """
                    INSERT INTO swipes (user_id, job_id, data)
                    VALUES ($1, $2, $3::jsonb)
                    ON CONFLICT (user_id, job_id) DO UPDATE SET data = EXCLUDED.data
                    """,
                    doc["user_id"],
                    doc["job_id"],
                    payload,
                )
            elif self.name == "applications":
                await conn.execute(
                    """
                    INSERT INTO applications (application_id, user_id, job_id, data)
                    VALUES ($1, $2, $3, $4::jsonb)
                    ON CONFLICT (application_id) DO UPDATE
                    SET user_id = EXCLUDED.user_id, job_id = EXCLUDED.job_id, data = EXCLUDED.data
                    """,
                    doc["application_id"],
                    doc["user_id"],
                    doc.get("job_id"),
                    payload,
                )
            elif self.name == "gmail_connections":
                await conn.execute(
                    """
                    INSERT INTO gmail_connections (user_id, email, connected, last_synced_at, updated_at, data)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                    ON CONFLICT (user_id) DO UPDATE
                    SET email = EXCLUDED.email,
                        connected = EXCLUDED.connected,
                        last_synced_at = EXCLUDED.last_synced_at,
                        updated_at = EXCLUDED.updated_at,
                        data = EXCLUDED.data
                    """,
                    doc["user_id"],
                    doc.get("email"),
                    bool(doc.get("connected", True)),
                    doc.get("last_synced_at"),
                    doc.get("updated_at"),
                    payload,
                )
            elif self.name == "application_emails":
                await conn.execute(
                    """
                    INSERT INTO application_emails (
                        email_id, user_id, application_id, job_id, provider,
                        gmail_message_id, gmail_thread_id, received_at, classification, data
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
                    ON CONFLICT (email_id) DO UPDATE
                    SET user_id = EXCLUDED.user_id,
                        application_id = EXCLUDED.application_id,
                        job_id = EXCLUDED.job_id,
                        provider = EXCLUDED.provider,
                        gmail_message_id = EXCLUDED.gmail_message_id,
                        gmail_thread_id = EXCLUDED.gmail_thread_id,
                        received_at = EXCLUDED.received_at,
                        classification = EXCLUDED.classification,
                        data = EXCLUDED.data
                    """,
                    doc["email_id"],
                    doc.get("user_id"),
                    doc.get("application_id"),
                    doc.get("job_id"),
                    doc.get("provider"),
                    doc.get("gmail_message_id"),
                    doc.get("gmail_thread_id"),
                    doc.get("received_at"),
                    doc.get("classification"),
                    payload,
                )
            elif self.name == "company_boards":
                await conn.execute(
                    """
                    INSERT INTO company_boards (board_id, data)
                    VALUES ($1, $2::jsonb)
                    ON CONFLICT (board_id) DO UPDATE SET data = EXCLUDED.data
                    """,
                    doc["board_id"],
                    payload,
                )
            elif self.name == "analytics_events":
                await conn.execute(
                    """
                    INSERT INTO analytics_events (event_id, user_id, anonymous_id, event, page, source, created_at, data)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                    ON CONFLICT (event_id) DO UPDATE
                    SET user_id = EXCLUDED.user_id,
                        anonymous_id = EXCLUDED.anonymous_id,
                        event = EXCLUDED.event,
                        page = EXCLUDED.page,
                        source = EXCLUDED.source,
                        created_at = EXCLUDED.created_at,
                        data = EXCLUDED.data
                    """,
                    doc["event_id"],
                    doc.get("user_id"),
                    doc.get("anonymous_id"),
                    doc.get("event"),
                    doc.get("page"),
                    doc.get("source"),
                    doc.get("created_at"),
                    payload,
                )

    async def insert_one(self, doc: Dict[str, Any]) -> None:
        await self._save_doc(doc)

    async def insert_many(self, docs: Iterable[Dict[str, Any]]) -> None:
        for doc in docs:
            await self._save_doc(doc)

    async def update_one(
        self,
        query: Dict[str, Any],
        update: Dict[str, Any],
        upsert: bool = False,
    ) -> UpdateResult:
        existing = await self.find_one(query)
        if existing:
            merged = _apply_update(existing, update, is_insert=False)
            await self._save_doc(merged)
            return UpdateResult(matched_count=1, modified_count=1)
        if upsert:
            base: Dict[str, Any] = {}
            for key, val in query.items():
                if isinstance(val, dict):
                    continue
                if "." in key:
                    _set_path(base, key, val)
                else:
                    base[key] = val
            merged = _apply_update(base, update, is_insert=True)
            await self._save_doc(merged)
            pk = self._meta.get("pk")
            return UpdateResult(
                matched_count=0,
                modified_count=0,
                upserted_id=merged.get(pk) if pk else True,
            )
        return UpdateResult(matched_count=0, modified_count=0)

    async def delete_one(self, query: Dict[str, Any]) -> DeleteResult:
        doc = await self.find_one(query)
        if not doc:
            return DeleteResult(0)
        await self._delete_doc(doc)
        return DeleteResult(1)

    async def delete_many(self, query: Dict[str, Any]) -> DeleteResult:
        docs = await self._fetch_matching(query)
        for doc in docs:
            await self._delete_doc(doc)
        return DeleteResult(len(docs))

    async def _delete_doc(self, doc: Dict[str, Any]) -> None:
        pk = self._meta.get("pk")
        async with self._pool.acquire() as conn:
            if pk and doc.get(pk):
                await conn.execute(f"DELETE FROM {self.name} WHERE {pk} = $1", doc[pk])
            elif self.name == "user_sessions" and doc.get("session_token"):
                await conn.execute("DELETE FROM user_sessions WHERE session_token = $1", doc["session_token"])
            elif self.name == "swipes":
                await conn.execute(
                    "DELETE FROM swipes WHERE user_id = $1 AND job_id = $2",
                    doc.get("user_id"),
                    doc.get("job_id"),
                )

    async def count_documents(self, query: Optional[Dict[str, Any]] = None) -> int:
        docs = await self._fetch_matching(query or {})
        return len(docs)

    async def create_index(self, *args, **kwargs) -> None:
        return None


class Database:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool
        self.users = Collection("users", pool)
        self.user_sessions = Collection("user_sessions", pool)
        self.profiles = Collection("profiles", pool)
        self.jobs = Collection("jobs", pool)
        self.swipes = Collection("swipes", pool)
        self.applications = Collection("applications", pool)
        self.gmail_connections = Collection("gmail_connections", pool)
        self.application_emails = Collection("application_emails", pool)
        self.company_boards = Collection("company_boards", pool)
        self.analytics_events = Collection("analytics_events", pool)
        self.stripe_events = Collection("stripe_events", pool)


db: Optional[Database] = None


async def init_db() -> Database:
    global db, _pool
    database_url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL (or SUPABASE_DB_URL) is required for Supabase/PostgreSQL")
    ssl = "require" if "supabase" in database_url else None
    _pool = await asyncpg.create_pool(database_url, min_size=1, max_size=10, ssl=ssl)
    schema_path = Path(__file__).parent / "supabase_schema.sql"
    if schema_path.exists():
        async with _pool.acquire() as conn:
            await conn.execute(schema_path.read_text(encoding="utf-8"))
    db = Database(_pool)
    return db


async def close_db() -> None:
    global db, _pool
    if _pool:
        await _pool.close()
    _pool = None
    db = None


def get_db() -> Database:
    if db is None:
        raise RuntimeError("Database not initialized. Call init_db() on startup.")
    return db
