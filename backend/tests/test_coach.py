"""Backend tests for the Coach (Interviews + Improve) endpoints.

Covers:
- GET /api/coach/interview — auth, 400 without cv_text, full payload + 24h cache, refresh=true
- POST /api/coach/interview/score — auth, validation, shape, streak increment side-effect
- GET /api/coach/improve — full payload + cache + refresh
- GET /api/coach/streak — shape; reflects today's session after score
"""
import os
import time
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
CLAUDE_TIMEOUT = 45  # first call can be 5-15s; 502s when LLM is unavailable


@pytest.fixture(scope="module")
def coach_user(mongo_db):
    """User WITH cv_text + skills + target_roles so coach endpoints unlock."""
    ts = int(time.time() * 1000)
    user_id = f"test-coach-{ts}"
    token = f"test_coach_sess_{ts}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": f"test.coach.{ts}@example.com",
        "name": "Coach Test User",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo_db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo_db.profiles.insert_one({
        "user_id": user_id,
        "cv_text": (
            "Senior Software Engineer with 6 years building React + Python web apps. "
            "Led the migration of a monolith to microservices at Acme Inc. "
            "Strong in TypeScript, FastAPI, AWS."
        ),
        "summary": "Senior FE/BE engineer.",
        "skills": ["React", "Python", "TypeScript", "FastAPI", "AWS"],
        "experience": [{"role": "Senior Engineer", "company": "Acme", "duration": "2020-now"}],
        "target_roles": ["Senior Software Engineer", "Full Stack Engineer"],
        "seniority": "senior",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    yield {"user_id": user_id, "session_token": token}
    mongo_db.user_sessions.delete_many({"user_id": user_id})
    mongo_db.users.delete_many({"user_id": user_id})
    mongo_db.profiles.delete_many({"user_id": user_id})


@pytest.fixture(scope="module")
def coach_client(coach_user):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {coach_user['session_token']}"})
    return s


@pytest.fixture(scope="module")
def no_cv_user(mongo_db):
    """User WITHOUT cv_text — should get 400 from coach endpoints."""
    ts = int(time.time() * 1000) + 1
    user_id = f"test-nocv-{ts}"
    token = f"test_nocv_sess_{ts}"
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": f"test.nocv.{ts}@example.com",
        "name": "No CV User",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo_db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield {"user_id": user_id, "session_token": token}
    mongo_db.user_sessions.delete_many({"user_id": user_id})
    mongo_db.users.delete_many({"user_id": user_id})
    mongo_db.profiles.delete_many({"user_id": user_id})


# ===================== /api/coach/interview =====================

class TestCoachInterview:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/coach/interview", timeout=10)
        assert r.status_code == 401

    def test_400_without_cv(self, no_cv_user):
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {no_cv_user['session_token']}"})
        r = s.get(f"{BASE_URL}/api/coach/interview", timeout=15)
        assert r.status_code == 400
        assert "cv" in r.json().get("detail", "").lower() or "upload" in r.json().get("detail", "").lower()

    def test_interview_prep_payload_and_cache(self, coach_client, mongo_db, coach_user):
        # Clear any pre-existing cache
        mongo_db.profiles.update_one({"user_id": coach_user["user_id"]}, {"$unset": {"coach.interview": ""}})

        r = coach_client.get(f"{BASE_URL}/api/coach/interview", timeout=CLAUDE_TIMEOUT)
        if r.status_code == 502:
            pytest.skip("Claude/LLM key unavailable (502)")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("likely_questions", "tips", "mock_questions", "_cached_at"):
            assert k in data, f"missing key {k}: {list(data.keys())}"
        assert isinstance(data["likely_questions"], list) and len(data["likely_questions"]) > 0
        assert isinstance(data["mock_questions"], list) and len(data["mock_questions"]) == 5
        # First item must have category + q
        q0 = data["likely_questions"][0]
        assert "category" in q0 and "q" in q0

        cached_at_1 = data["_cached_at"]

        # 2nd call should hit cache (<1s)
        t0 = time.time()
        r2 = coach_client.get(f"{BASE_URL}/api/coach/interview", timeout=10)
        elapsed = time.time() - t0
        assert r2.status_code == 200
        assert r2.json()["_cached_at"] == cached_at_1
        assert elapsed < 3.0, f"cached call took {elapsed:.1f}s; expected <3s"

    def test_refresh_regenerates(self, coach_client):
        r = coach_client.get(f"{BASE_URL}/api/coach/interview", timeout=10)
        if r.status_code != 200:
            pytest.skip("interview prep not available")
        ts_before = r.json()["_cached_at"]

        time.sleep(1.1)
        r2 = coach_client.get(f"{BASE_URL}/api/coach/interview?refresh=true", timeout=CLAUDE_TIMEOUT)
        if r2.status_code == 502:
            pytest.skip("Claude unavailable for refresh")
        assert r2.status_code == 200
        assert r2.json()["_cached_at"] != ts_before


# ===================== /api/coach/interview/score =====================

class TestCoachScore:
    def test_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/coach/interview/score",
                          json={"questions": ["x"], "answers": ["y"]}, timeout=10)
        assert r.status_code == 401

    def test_400_mismatched_lengths(self, coach_client):
        r = coach_client.post(
            f"{BASE_URL}/api/coach/interview/score",
            json={"questions": ["q1", "q2"], "answers": ["a1"]}, timeout=10,
        )
        assert r.status_code == 400

    def test_400_empty(self, coach_client):
        r = coach_client.post(
            f"{BASE_URL}/api/coach/interview/score",
            json={"questions": [], "answers": []}, timeout=10,
        )
        assert r.status_code == 400

    def test_score_payload_and_streak_increment(self, coach_client):
        questions = [
            "Tell me about a challenging project.",
            "How do you debug a memory leak?",
            "Why this role?",
        ]
        answers = [
            "Led a migration project from a monolith to microservices over 9 months, coordinating 4 teams and shipping zero-downtime.",
            "Profile with py-spy, check object growth with tracemalloc, then fix retained references.",
            "I want to ship product impact in a small senior team.",
        ]
        r = coach_client.post(
            f"{BASE_URL}/api/coach/interview/score",
            json={"questions": questions, "answers": answers},
            timeout=CLAUDE_TIMEOUT,
        )
        if r.status_code == 502:
            pytest.skip("Claude unavailable")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("confidence", "communication", "technical", "overall", "headline", "strengths", "improvements"):
            assert k in data, f"missing {k}"
        for k in ("confidence", "communication", "technical", "overall"):
            assert isinstance(data[k], int)
            assert 0 <= data[k] <= 100
        assert isinstance(data["strengths"], list)
        assert isinstance(data["improvements"], list)

        # Streak should now show >=1 for today
        r_streak = coach_client.get(f"{BASE_URL}/api/coach/streak", timeout=10)
        assert r_streak.status_code == 200
        s = r_streak.json()
        assert s["streak"] >= 1
        assert s["sessions_total"] >= 1
        assert s["sessions_week"] >= 1


# ===================== /api/coach/improve =====================

class TestCoachImprove:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/coach/improve", timeout=10)
        assert r.status_code == 401

    def test_improve_payload_and_cache(self, coach_client, mongo_db, coach_user):
        mongo_db.profiles.update_one({"user_id": coach_user["user_id"]}, {"$unset": {"coach.improve": ""}})
        r = coach_client.get(f"{BASE_URL}/api/coach/improve", timeout=CLAUDE_TIMEOUT)
        if r.status_code == 502:
            pytest.skip("Claude unavailable")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("recruiter_view", "resume_tips", "skill_gaps", "certifications", "tips", "_cached_at"):
            assert k in data, f"missing {k}"
        rv = data["recruiter_view"]
        for k in ("summary", "score", "label"):
            assert k in rv
        assert isinstance(rv["score"], int)
        assert 0 <= rv["score"] <= 100
        assert isinstance(data["resume_tips"], list) and len(data["resume_tips"]) > 0
        assert isinstance(data["skill_gaps"], list) and len(data["skill_gaps"]) > 0
        assert isinstance(data["certifications"], list)

        ts1 = data["_cached_at"]

        # cache hit
        r2 = coach_client.get(f"{BASE_URL}/api/coach/improve", timeout=10)
        assert r2.status_code == 200
        assert r2.json()["_cached_at"] == ts1

    def test_refresh_regenerates(self, coach_client):
        r = coach_client.get(f"{BASE_URL}/api/coach/improve", timeout=10)
        if r.status_code != 200:
            pytest.skip("improve not available")
        ts_before = r.json()["_cached_at"]
        time.sleep(1.1)
        r2 = coach_client.get(f"{BASE_URL}/api/coach/improve?refresh=true", timeout=CLAUDE_TIMEOUT)
        if r2.status_code == 502:
            pytest.skip("Claude unavailable")
        assert r2.status_code == 200
        assert r2.json()["_cached_at"] != ts_before


# ===================== /api/coach/streak =====================

class TestCoachStreak:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/coach/streak", timeout=10)
        assert r.status_code == 401

    def test_shape(self, coach_client):
        r = coach_client.get(f"{BASE_URL}/api/coach/streak", timeout=10)
        assert r.status_code == 200
        data = r.json()
        for k in ("streak", "sessions_total", "sessions_week", "best"):
            assert k in data
            assert isinstance(data[k], int)
