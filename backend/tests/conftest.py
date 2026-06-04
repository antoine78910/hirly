"""Shared fixtures for backend tests."""
import os
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def mongo_db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="session")
def test_user(mongo_db):
    """Create a fresh test user + session token directly in mongo."""
    ts = int(time.time() * 1000)
    user_id = f"test-user-{ts}"
    session_token = f"test_session_{ts}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": f"test.user.{ts}@example.com",
        "name": "Test User",
        "picture": "https://via.placeholder.com/150",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo_db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield {"user_id": user_id, "session_token": session_token}
    # cleanup
    mongo_db.user_sessions.delete_many({"user_id": user_id})
    mongo_db.users.delete_many({"user_id": user_id})
    mongo_db.profiles.delete_many({"user_id": user_id})
    mongo_db.swipes.delete_many({"user_id": user_id})
    mongo_db.applications.delete_many({"user_id": user_id})


@pytest.fixture(scope="session")
def auth_client(test_user):
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {test_user['session_token']}"})
    return session


@pytest.fixture(scope="session")
def anon_client():
    return requests.Session()
