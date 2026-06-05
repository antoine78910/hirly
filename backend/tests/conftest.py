"""Shared fixtures for backend tests."""
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import psycopg2
import pytest
import requests

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from pg_helpers import TestDatabase  # noqa: E402

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
DATABASE_URL = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def pg_conn():
    if not DATABASE_URL:
        pytest.skip("DATABASE_URL is not configured")
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    schema_path = Path(__file__).resolve().parent.parent / "supabase_schema.sql"
    if schema_path.exists():
        with conn.cursor() as cur:
            cur.execute(schema_path.read_text(encoding="utf-8"))
    yield conn
    conn.close()


@pytest.fixture(scope="session")
def mongo_db(pg_conn):
    """MongoDB-compatible test DB backed by Supabase/PostgreSQL."""
    return TestDatabase(pg_conn)


@pytest.fixture(scope="session")
def test_user(pg_conn):
    """Create a fresh test user + session token directly in Supabase/Postgres."""
    ts = int(time.time() * 1000)
    user_id = f"test-user-{ts}"
    session_token = f"test_session_{ts}"
    user_doc = {
        "user_id": user_id,
        "email": f"test.user.{ts}@example.com",
        "name": "Test User",
        "picture": "https://via.placeholder.com/150",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    session_doc = {
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    cur = pg_conn.cursor()
    cur.execute(
        "INSERT INTO users (user_id, email, data) VALUES (%s, %s, %s::jsonb)",
        (user_id, user_doc["email"], json.dumps(user_doc)),
    )
    cur.execute(
        "INSERT INTO user_sessions (session_token, user_id, data) VALUES (%s, %s, %s::jsonb)",
        (session_token, user_id, json.dumps(session_doc)),
    )
    yield {"user_id": user_id, "session_token": session_token}
    cur.execute("DELETE FROM user_sessions WHERE user_id = %s", (user_id,))
    cur.execute("DELETE FROM users WHERE user_id = %s", (user_id,))
    cur.execute("DELETE FROM profiles WHERE user_id = %s", (user_id,))
    cur.execute("DELETE FROM swipes WHERE user_id = %s", (user_id,))
    cur.execute("DELETE FROM applications WHERE user_id = %s", (user_id,))


@pytest.fixture(scope="session")
def auth_client(test_user):
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {test_user['session_token']}"})
    return session


@pytest.fixture(scope="session")
def anon_client():
    return requests.Session()
