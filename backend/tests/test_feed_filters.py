"""
Backend tests for GET /api/jobs/feed new filter query params.

Covers (iteration_3):
- default call returns {jobs, total} (no params)
- min_salary filters jobs whose salary_max < min_salary
- work_location filter (single + multi)
- experience mapping entry→junior, executive→lead|principal
- only_company / hide_company
- include_unknown_location / include_unknown_salary flags
- POST /api/swipe right/left semantics (direction='left' must NOT create app)
"""
import os
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

SAMPLE_CV = (
    "Jane Doe — Senior Frontend Engineer\n"
    "6 years experience. React, TypeScript, Next.js, GraphQL.\n"
    "Acme Corp 2022-Present. Beta Inc 2019-2022.\n"
    "Education: BS CS, MIT 2018"
)


# Fresh per-module user (independent from the polish suite's session user so the
# swipes collection is empty for filter math).
@pytest.fixture(scope="module")
def filter_user(mongo_db):
    ts = int(time.time() * 1000)
    uid = f"test-user-filter-{ts}"
    tok = f"test_session_filter_{ts}"
    mongo_db.users.insert_one({
        "user_id": uid, "email": f"flt.{ts}@example.com",
        "name": "FilterUser", "picture": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo_db.user_sessions.insert_one({
        "user_id": uid, "session_token": tok,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    yield {"user_id": uid, "session_token": tok}
    mongo_db.user_sessions.delete_many({"user_id": uid})
    mongo_db.users.delete_many({"user_id": uid})
    mongo_db.profiles.delete_many({"user_id": uid})
    mongo_db.swipes.delete_many({"user_id": uid})
    mongo_db.applications.delete_many({"user_id": uid})


@pytest.fixture(scope="module")
def filter_client(filter_user):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {filter_user['session_token']}"})
    # ensure seed
    s.post(f"{BASE_URL}/api/seed", timeout=30)
    # upload CV so feed works
    files = {"file": ("cv.txt", SAMPLE_CV.encode("utf-8"), "text/plain")}
    r = s.post(f"{BASE_URL}/api/profile/cv", files=files, timeout=120)
    assert r.status_code == 200, f"CV upload failed: {r.status_code} {r.text[:300]}"
    return s


class TestFeedDefault:
    def test_default_returns_jobs_and_total(self, filter_client):
        r = filter_client.get(f"{BASE_URL}/api/jobs/feed", timeout=120)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert "jobs" in body and "total" in body
        assert isinstance(body["jobs"], list)
        assert isinstance(body["total"], int)
        # default limit is 5
        assert len(body["jobs"]) <= 5
        # with a fresh user + seeded mock jobs we expect at least 1
        assert body["total"] >= 1


class TestMinSalary:
    def test_min_salary_filters_out_low(self, filter_client, mongo_db):
        # baseline total (no filter)
        r0 = filter_client.get(f"{BASE_URL}/api/jobs/feed?limit=1", timeout=120)
        total_all = r0.json()["total"]

        # pick a high threshold + disable include_unknown_salary so result is strict
        r = filter_client.get(
            f"{BASE_URL}/api/jobs/feed?limit=10&min_salary=200000&include_unknown_salary=false",
            timeout=120,
        )
        assert r.status_code == 200
        body = r.json()
        for j in body["jobs"]:
            # salary_max must be >= threshold (per server clause)
            assert j.get("salary_max") is not None
            assert j["salary_max"] >= 200000, j
        assert body["total"] <= total_all


class TestWorkLocation:
    def test_work_location_remote(self, filter_client):
        r = filter_client.get(
            f"{BASE_URL}/api/jobs/feed?limit=10&work_location=remote&include_unknown_location=false",
            timeout=120,
        )
        assert r.status_code == 200
        for j in r.json()["jobs"]:
            assert j.get("remote") == "remote", j


class TestExperienceMapping:
    def test_entry_maps_to_junior(self, filter_client):
        r = filter_client.get(
            f"{BASE_URL}/api/jobs/feed?limit=10&experience=entry",
            timeout=120,
        )
        assert r.status_code == 200
        for j in r.json()["jobs"]:
            assert j.get("seniority") in ("junior",), j

    def test_executive_maps_to_lead_or_principal(self, filter_client):
        r = filter_client.get(
            f"{BASE_URL}/api/jobs/feed?limit=10&experience=executive",
            timeout=120,
        )
        assert r.status_code == 200
        for j in r.json()["jobs"]:
            assert j.get("seniority") in ("lead", "principal"), j


class TestCompanyFilter:
    def test_only_company(self, filter_client):
        # pick one company from the seeded data
        r0 = filter_client.get(f"{BASE_URL}/api/jobs/feed?limit=10", timeout=120)
        jobs = r0.json()["jobs"]
        assert jobs, "need at least 1 job to pick company from"
        target = jobs[0]["company"]
        r = filter_client.get(
            f"{BASE_URL}/api/jobs/feed?limit=10&only_company={target}",
            timeout=120,
        )
        assert r.status_code == 200
        for j in r.json()["jobs"]:
            assert j["company"].lower() == target.lower(), j

    def test_hide_company(self, filter_client):
        r0 = filter_client.get(f"{BASE_URL}/api/jobs/feed?limit=10", timeout=120)
        jobs = r0.json()["jobs"]
        target = jobs[0]["company"]
        r = filter_client.get(
            f"{BASE_URL}/api/jobs/feed?limit=10&hide_company={target}",
            timeout=120,
        )
        assert r.status_code == 200
        for j in r.json()["jobs"]:
            assert target.lower() not in j["company"].lower(), j


class TestSwipeSemantics:
    """direction='right' creates application; 'left' does not."""

    def test_left_does_not_create_application(self, filter_client, mongo_db, filter_user):
        # pick a fresh job (no prior swipe for this user)
        r0 = filter_client.get(f"{BASE_URL}/api/jobs/feed?limit=5", timeout=120)
        jobs = r0.json()["jobs"]
        swiped = {s["job_id"] for s in mongo_db.swipes.find({"user_id": filter_user["user_id"]})}
        candidate = next((j for j in jobs if j["job_id"] not in swiped), None)
        assert candidate is not None
        job_id = candidate["job_id"]

        before = mongo_db.applications.count_documents({"user_id": filter_user["user_id"]})
        r = filter_client.post(
            f"{BASE_URL}/api/swipe",
            json={"job_id": job_id, "direction": "left"},
            timeout=30,
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("applied", False) is False
        after = mongo_db.applications.count_documents({"user_id": filter_user["user_id"]})
        assert after == before, "left swipe must not create application"

    def test_right_creates_application(self, filter_client, mongo_db, filter_user):
        r0 = filter_client.get(f"{BASE_URL}/api/jobs/feed?limit=5", timeout=120)
        jobs = r0.json()["jobs"]
        swiped = {s["job_id"] for s in mongo_db.swipes.find({"user_id": filter_user["user_id"]})}
        candidate = next((j for j in jobs if j["job_id"] not in swiped), None)
        assert candidate is not None
        job_id = candidate["job_id"]

        r = filter_client.post(
            f"{BASE_URL}/api/swipe",
            json={"job_id": job_id, "direction": "right"},
            timeout=180,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("applied") is True
        assert "application_id" in body
