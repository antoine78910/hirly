"""Test for /api/jobs/feed score param performance fix (iteration_5)."""
import os
import time
import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("REACT_APP_BACKEND_URL"),
    reason="REACT_APP_BACKEND_URL is required for live feed score endpoint tests",
)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://testserver").rstrip("/")

SAMPLE_CV = (
    "Jane Doe\n"
    "jane@example.com | +1-555-1234 | NYC\n"
    "Senior Frontend Engineer with 6 years. React, TypeScript.\n"
    "Acme Corp, Senior Frontend Engineer, 2022-Present.\n"
    "BS CS, MIT 2018"
)


@pytest.fixture(scope="module")
def uploaded_profile(auth_client):
    files = {"file": ("cv.txt", SAMPLE_CV.encode("utf-8"), "text/plain")}
    r = auth_client.post(f"{BASE_URL}/api/profile/cv", files=files, timeout=90)
    assert r.status_code == 200, f"CV upload failed: {r.status_code} {r.text[:300]}"
    return r.json()


# -- Default (no score) should return fast with fallback match_score & reasons --
class TestFeedDefaultFast:
    def test_default_feed_fast_and_shape(self, auth_client, uploaded_profile):
        t0 = time.time()
        r = auth_client.get(f"{BASE_URL}/api/jobs/feed?limit=10", timeout=10)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        body = r.json()
        assert "jobs" in body and "total" in body, body.keys()
        assert isinstance(body["jobs"], list)
        assert isinstance(body["total"], int)
        # Performance: default must be well under 3s
        assert elapsed < 3.0, f"Default feed took {elapsed:.2f}s, expected <3s"

    def test_default_feed_match_score_and_reasons(self, auth_client, uploaded_profile):
        r = auth_client.get(f"{BASE_URL}/api/jobs/feed?limit=10", timeout=10)
        assert r.status_code == 200
        jobs = r.json()["jobs"]
        assert len(jobs) > 0, "Expected seeded jobs"
        for j in jobs:
            assert "match_score" in j, f"missing match_score: {j.keys()}"
            score = j["match_score"]
            assert isinstance(score, (int, float))
            assert 78 <= score <= 96, f"match_score {score} out of expected fallback range 78-96"
            assert "match_reasons" in j, f"missing match_reasons: {j.keys()}"
            assert isinstance(j["match_reasons"], list)
            assert len(j["match_reasons"]) > 0, "match_reasons must be non-empty"


# -- score=true: same shape, may be slow --
class TestFeedScoreTrue:
    def test_score_true_returns_same_shape(self, auth_client, uploaded_profile):
        t0 = time.time()
        r = auth_client.get(f"{BASE_URL}/api/jobs/feed?limit=3&score=true", timeout=30)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        body = r.json()
        assert "jobs" in body and "total" in body
        jobs = body["jobs"]
        assert len(jobs) > 0
        for j in jobs:
            assert "match_score" in j
            assert "match_reasons" in j
            assert isinstance(j["match_reasons"], list)
        print(f"score=true elapsed={elapsed:.2f}s")
        # Loose bound — Claude scoring can take time
        assert elapsed < 30.0
