"""Sync PostgreSQL helpers for integration tests (MongoDB-compatible surface)."""
from __future__ import annotations

import json
from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional

import psycopg2.extensions

import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from database import TABLE_META, _apply_update, _matches  # noqa: E402

INSERT_SQL = {
    "users": (
        "INSERT INTO users (user_id, email, data) VALUES (%s, %s, %s::jsonb) "
        "ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data"
    ),
    "user_sessions": (
        "INSERT INTO user_sessions (session_token, user_id, data) VALUES (%s, %s, %s::jsonb) "
        "ON CONFLICT (session_token) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data"
    ),
    "profiles": (
        "INSERT INTO profiles (user_id, data) VALUES (%s, %s::jsonb) "
        "ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data"
    ),
    "jobs": (
        "INSERT INTO jobs (job_id, provider, external_id, data) VALUES (%s, %s, %s, %s::jsonb) "
        "ON CONFLICT (job_id) DO UPDATE "
        "SET provider = EXCLUDED.provider, external_id = EXCLUDED.external_id, data = EXCLUDED.data"
    ),
    "swipes": (
        "INSERT INTO swipes (user_id, job_id, data) VALUES (%s, %s, %s::jsonb) "
        "ON CONFLICT (user_id, job_id) DO UPDATE SET data = EXCLUDED.data"
    ),
    "applications": (
        "INSERT INTO applications (application_id, user_id, job_id, data) VALUES (%s, %s, %s, %s::jsonb) "
        "ON CONFLICT (application_id) DO UPDATE "
        "SET user_id = EXCLUDED.user_id, job_id = EXCLUDED.job_id, data = EXCLUDED.data"
    ),
    "company_boards": (
        "INSERT INTO company_boards (board_id, data) VALUES (%s, %s::jsonb) "
        "ON CONFLICT (board_id) DO UPDATE SET data = EXCLUDED.data"
    ),
}


def _row_args(name: str, doc: Dict[str, Any]) -> tuple:
    payload = json.dumps(doc)
    if name == "users":
        return (doc["user_id"], doc.get("email"), payload)
    if name == "user_sessions":
        return (doc["session_token"], doc["user_id"], payload)
    if name == "profiles":
        return (doc["user_id"], payload)
    if name == "jobs":
        external_id = str(doc["external_id"]) if doc.get("external_id") is not None else None
        return (doc["job_id"], doc.get("provider"), external_id, payload)
    if name == "swipes":
        return (doc["user_id"], doc["job_id"], payload)
    if name == "applications":
        return (doc["application_id"], doc["user_id"], doc.get("job_id"), payload)
    if name == "company_boards":
        return (doc["board_id"], payload)
    raise ValueError(f"Unknown collection: {name}")


class TestCollection:
    def __init__(self, conn: psycopg2.extensions.connection, name: str):
        self._conn = conn
        self._name = name
        self._meta = TABLE_META[name]

    def _load_all(self) -> List[Dict[str, Any]]:
        cur = self._conn.cursor()
        cur.execute(f"SELECT data FROM {self._name}")
        rows = cur.fetchall()
        return [row[0] if isinstance(row[0], dict) else json.loads(row[0]) for row in rows]

    def _fetch_matching(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        simple = self._simple_sql_filter(query)
        if simple is not None:
            sql, args = simple
            cur = self._conn.cursor()
            cur.execute(sql, args)
            rows = cur.fetchall()
            docs = [row[0] if isinstance(row[0], dict) else json.loads(row[0]) for row in rows]
        else:
            docs = self._load_all()
        return [doc for doc in docs if _matches(doc, query)]

    def _simple_sql_filter(self, query: Dict[str, Any]) -> Optional[tuple]:
        if not query or "$or" in query or "$and" in query:
            return None
        clauses: List[str] = []
        args: List[Any] = []
        for key, val in query.items():
            if isinstance(val, dict):
                return None
            if key in (
                "user_id",
                "job_id",
                "session_token",
                "email",
                "application_id",
                "board_id",
                "provider",
                "external_id",
            ):
                clauses.append(f"{key} = %s")
                args.append(val)
            else:
                return None
        if not clauses:
            return None
        where = " AND ".join(clauses)
        return f"SELECT data FROM {self._name} WHERE {where}", tuple(args)

    def _save_doc(self, doc: Dict[str, Any]) -> None:
        cur = self._conn.cursor()
        cur.execute(INSERT_SQL[self._name], _row_args(self._name, doc))

    def _delete_doc(self, doc: Dict[str, Any]) -> None:
        cur = self._conn.cursor()
        pk = self._meta.get("pk")
        if pk and doc.get(pk):
            cur.execute(f"DELETE FROM {self._name} WHERE {pk} = %s", (doc[pk],))
        elif self._name == "user_sessions" and doc.get("session_token"):
            cur.execute("DELETE FROM user_sessions WHERE session_token = %s", (doc["session_token"],))
        elif self._name == "swipes":
            cur.execute(
                "DELETE FROM swipes WHERE user_id = %s AND job_id = %s",
                (doc.get("user_id"), doc.get("job_id")),
            )

    def insert_one(self, doc: Dict[str, Any]) -> None:
        self._save_doc(doc)

    def find_one(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        rows = self._fetch_matching(query)
        return deepcopy(rows[0]) if rows else None

    def find(self, query: Dict[str, Any]) -> List[Dict[str, Any]]:
        return [deepcopy(row) for row in self._fetch_matching(query)]

    def delete_many(self, query: Dict[str, Any]) -> int:
        docs = self._fetch_matching(query)
        for doc in docs:
            self._delete_doc(doc)
        return len(docs)

    def count_documents(self, query: Optional[Dict[str, Any]] = None) -> int:
        return len(self._fetch_matching(query or {}))

    def update_one(self, query: Dict[str, Any], update: Dict[str, Any], upsert: bool = False) -> None:
        existing = self.find_one(query)
        if existing:
            merged = _apply_update(existing, update, is_insert=False)
            self._save_doc(merged)
            return
        if upsert:
            base: Dict[str, Any] = {}
            for key, val in query.items():
                if isinstance(val, dict):
                    continue
                base[key] = val
            merged = _apply_update(base, update, is_insert=True)
            self._save_doc(merged)


class TestDatabase:
    def __init__(self, conn: psycopg2.extensions.connection):
        self.users = TestCollection(conn, "users")
        self.user_sessions = TestCollection(conn, "user_sessions")
        self.profiles = TestCollection(conn, "profiles")
        self.jobs = TestCollection(conn, "jobs")
        self.swipes = TestCollection(conn, "swipes")
        self.applications = TestCollection(conn, "applications")
        self.company_boards = TestCollection(conn, "company_boards")
