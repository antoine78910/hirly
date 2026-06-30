"""
Backend tests for SwipeJobs / Tinder-for-Jobs polish pass.

Covers:
- /api/seed idempotency
- /api/profile/cv upload + new structured fields (contact, template_style)
- /api/profile excludes cv_original_b64
- /api/profile/cv/original streams original bytes w/ correct Content-Type, 404 when missing
- /api/auth/me has_profile after CV upload
- /api/jobs/feed match_score + reasons
- /api/swipe right -> structured tailored_resume + cover_letter + interview_prep
- /api/applications + /api/applications/{id} include structured shapes
- PATCH /api/applications/{id}/status
- /api/swipe/undo (right -> removes application)
- /api/auth/logout via Bearer (regression for iter_1 fix)
"""
import os
import time
import pytest
import requests

pytestmark = pytest.mark.skipif(
    not os.environ.get("REACT_APP_BACKEND_URL"),
    reason="REACT_APP_BACKEND_URL is required for live swipe jobs endpoint tests",
)
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://testserver").rstrip("/")

SAMPLE_CV = (
    "Jane Doe\n"
    "jane@example.com | +1-555-1234 | NYC | linkedin.com/in/janedoe\n"
    "Senior Frontend Engineer with 6 years experience. React, TypeScript, Next.js, GraphQL.\n"
    "Experience:\n"
    "- Acme Corp, Senior Frontend Engineer, 2022-Present. Built design system used by 200 engineers. Improved perf 40%.\n"
    "- Beta Inc, Frontend Engineer, 2019-2022. Shipped React migration.\n"
    "Education: BS CS, MIT 2018"
)


# ---------- Health / seed ----------

class TestSeed:
    def test_root(self, anon_client):
        r = anon_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_seed_idempotent(self, anon_client):
        r1 = anon_client.post(f"{BASE_URL}/api/seed")
        assert r1.status_code == 200
        assert r1.json()["ok"] is True
        r2 = anon_client.post(f"{BASE_URL}/api/seed")
        assert r2.status_code == 200
        body = r2.json()
        assert body["ok"] is True
        # second call should report skipped OR a stable count
        assert body.get("skipped") is True or body.get("count", 0) >= 15


# ---------- CV upload + new structured fields ----------

@pytest.fixture(scope="session")
def uploaded_profile(auth_client):
    """Upload CV once for the session; share with all downstream tests."""
    files = {"file": ("jane_doe_cv.txt", SAMPLE_CV.encode("utf-8"), "text/plain")}
    r = auth_client.post(f"{BASE_URL}/api/profile/cv", files=files, timeout=90)
    assert r.status_code == 200, f"CV upload failed: {r.status_code} {r.text[:300]}"
    return r.json()


class TestCVUpload:
    def test_upload_returns_structured_fields(self, uploaded_profile):
        p = uploaded_profile
        # new fields
        assert "contact" in p, "contact missing"
        assert isinstance(p["contact"], dict)
        # contact subfields exist (may be empty strings)
        for k in ("name", "email", "phone", "location", "linkedin", "website"):
            assert k in p["contact"], f"contact.{k} missing"
        assert "template_style" in p
        assert p["template_style"] in ("modern", "classic", "minimal", "two_column")
        # legacy fields
        assert isinstance(p.get("skills"), list) and len(p["skills"]) > 0
        assert isinstance(p.get("experience"), list)
        assert isinstance(p.get("target_roles"), list)
        assert p.get("seniority") in ("junior", "mid", "senior", "lead", "principal")
        assert isinstance(p.get("summary"), str) and len(p["summary"]) > 0

    def test_upload_does_not_return_original_b64(self, uploaded_profile):
        assert "cv_original_b64" not in uploaded_profile, "cv_original_b64 leaked in upload response"
        assert "cv_text" not in uploaded_profile, "cv_text leaked in upload response"


class TestProfile:
    def test_get_profile_includes_structured_excludes_b64(self, auth_client, uploaded_profile):
        r = auth_client.get(f"{BASE_URL}/api/profile")
        assert r.status_code == 200
        p = r.json()
        assert p is not None
        assert "contact" in p
        assert isinstance(p["contact"], dict)
        assert "template_style" in p
        assert "cv_original_b64" not in p, "cv_original_b64 must NOT be returned by /api/profile"
        # cv_text may still be present (heavy field) — spec only excluded b64

    def test_auth_me_has_profile_true(self, auth_client, uploaded_profile):
        r = auth_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["has_profile"] is True


class TestCVOriginalDownload:
    def test_download_original_returns_bytes_and_mime(self, auth_client, uploaded_profile):
        r = auth_client.get(f"{BASE_URL}/api/profile/cv/original")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("text/plain")
        assert r.content == SAMPLE_CV.encode("utf-8")
        cd = r.headers.get("content-disposition", "")
        assert "jane_doe_cv.txt" in cd

    def test_download_original_404_when_no_profile(self, mongo_db):
        """Create a separate user with no profile and confirm 404."""
        from datetime import datetime, timezone, timedelta
        ts = int(time.time() * 1000)
        uid = f"test-user-noprofile-{ts}"
        tok = f"test_session_noprofile_{ts}"
        mongo_db.users.insert_one({
            "user_id": uid, "email": f"np.{ts}@example.com",
            "name": "NoProfile", "picture": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mongo_db.user_sessions.insert_one({
            "user_id": uid, "session_token": tok,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = requests.get(
                f"{BASE_URL}/api/profile/cv/original",
                headers={"Authorization": f"Bearer {tok}"},
                timeout=15,
            )
            assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text[:200]}"
        finally:
            mongo_db.user_sessions.delete_many({"user_id": uid})
            mongo_db.users.delete_many({"user_id": uid})


# ---------- Feed + swipe + applications ----------

@pytest.fixture(scope="session")
def feed_jobs(auth_client, uploaded_profile):
    r = auth_client.get(f"{BASE_URL}/api/jobs/feed?limit=3", timeout=90)
    assert r.status_code == 200, f"feed failed: {r.status_code} {r.text[:300]}"
    jobs = r.json().get("jobs", [])
    assert len(jobs) > 0, "feed returned no jobs"
    return jobs


class TestFeed:
    def test_feed_has_match_score_and_reasons(self, feed_jobs):
        j = feed_jobs[0]
        assert "match_score" in j
        assert isinstance(j["match_score"], int)
        assert 0 <= j["match_score"] <= 100
        assert isinstance(j.get("match_reasons"), list)
        assert len(j["match_reasons"]) >= 1


@pytest.fixture(scope="session")
def applied(auth_client, feed_jobs):
    """Swipe right on first feed job and return application_id + job_id."""
    job_id = feed_jobs[0]["job_id"]
    r = auth_client.post(
        f"{BASE_URL}/api/swipe",
        json={"job_id": job_id, "direction": "right"},
        timeout=120,
    )
    assert r.status_code == 200, f"swipe right failed: {r.status_code} {r.text[:300]}"
    body = r.json()
    assert body.get("applied") is True
    assert "application_id" in body
    return {"application_id": body["application_id"], "job_id": job_id}


class TestSwipeRight:
    def test_application_has_structured_resume_and_cover_letter(self, auth_client, applied):
        r = auth_client.get(f"{BASE_URL}/api/applications/{applied['application_id']}")
        assert r.status_code == 200
        a = r.json()
        # tailored_resume structure
        tr = a.get("tailored_resume")
        assert isinstance(tr, dict), "tailored_resume must be a dict"
        assert isinstance(tr.get("summary"), str) and len(tr["summary"]) > 0
        assert isinstance(tr.get("skills"), list) and len(tr["skills"]) > 0
        assert isinstance(tr.get("experience"), list) and len(tr["experience"]) >= 1
        exp0 = tr["experience"][0]
        assert "role" in exp0 and "company" in exp0
        assert isinstance(exp0.get("highlights", []), list)
        assert isinstance(tr.get("education"), list)
        # cover_letter structure
        cl = a.get("cover_letter")
        assert isinstance(cl, dict), "cover_letter must be a dict"
        assert isinstance(cl.get("greeting"), str) and len(cl["greeting"]) > 0
        assert isinstance(cl.get("paragraphs"), list) and len(cl["paragraphs"]) >= 1
        assert isinstance(cl.get("sign_off"), str) and len(cl["sign_off"]) > 0
        # interview prep
        assert isinstance(a.get("interview_prep"), list)
        # match
        assert isinstance(a.get("match_score"), int)
        assert isinstance(a.get("match_reasons"), list)
        # joined job
        assert a.get("job") is not None
        assert a["job"]["job_id"] == applied["job_id"]


class TestApplicationsList:
    def test_list_includes_structured_shape(self, auth_client, applied):
        r = auth_client.get(f"{BASE_URL}/api/applications")
        assert r.status_code == 200
        apps = r.json().get("applications", [])
        target = next((a for a in apps if a["application_id"] == applied["application_id"]), None)
        assert target is not None, "created application missing from list"
        assert isinstance(target["tailored_resume"], dict)
        assert isinstance(target["tailored_resume"].get("skills"), list)
        assert isinstance(target["cover_letter"], dict)
        assert isinstance(target["cover_letter"].get("paragraphs"), list)

    def test_patch_status(self, auth_client, applied):
        r = auth_client.patch(
            f"{BASE_URL}/api/applications/{applied['application_id']}/status",
            json={"status": "interview"},
        )
        assert r.status_code == 200
        # verify persisted
        r2 = auth_client.get(f"{BASE_URL}/api/applications/{applied['application_id']}")
        assert r2.status_code == 200
        assert r2.json()["status"] == "interview"


# ---------- Undo + logout regression ----------

class TestUndoAndLogout:
    def test_undo_right_swipe_removes_application(self, auth_client, feed_jobs, mongo_db, test_user):
        """Swipe right on a fresh job, then undo and ensure application is gone."""
        # find a job not yet swiped
        swiped_ids = {s["job_id"] for s in mongo_db.swipes.find({"user_id": test_user["user_id"]})}
        candidate = next((j for j in feed_jobs if j["job_id"] not in swiped_ids), None)
        if candidate is None:
            # fetch a fresh feed
            r = auth_client.get(f"{BASE_URL}/api/jobs/feed?limit=5", timeout=90)
            candidate = next(
                (j for j in r.json().get("jobs", []) if j["job_id"] not in swiped_ids),
                None,
            )
        assert candidate is not None, "no unseen job to test undo"
        job_id = candidate["job_id"]
        sr = auth_client.post(
            f"{BASE_URL}/api/swipe",
            json={"job_id": job_id, "direction": "right"},
            timeout=120,
        )
        assert sr.status_code == 200 and sr.json().get("applied") is True
        app_id = sr.json()["application_id"]

        ur = auth_client.post(f"{BASE_URL}/api/swipe/undo")
        assert ur.status_code == 200
        assert ur.json().get("ok") is True
        assert ur.json().get("job_id") == job_id

        # application should be gone
        gr = auth_client.get(f"{BASE_URL}/api/applications/{app_id}")
        assert gr.status_code == 404

    def test_logout_via_bearer(self, mongo_db):
        """Regression: logout must accept Bearer token (iteration_1 bug)."""
        from datetime import datetime, timezone, timedelta
        ts = int(time.time() * 1000)
        uid = f"test-user-logout-{ts}"
        tok = f"test_session_logout_{ts}"
        mongo_db.users.insert_one({
            "user_id": uid, "email": f"lo.{ts}@example.com",
            "name": "LogoutTest", "picture": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mongo_db.user_sessions.insert_one({
            "user_id": uid, "session_token": tok,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            headers = {"Authorization": f"Bearer {tok}"}
            # confirm logged in
            r0 = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
            assert r0.status_code == 200
            # logout via Bearer
            r1 = requests.post(f"{BASE_URL}/api/auth/logout", headers=headers, timeout=15)
            assert r1.status_code == 200
            assert r1.json().get("ok") is True
            # session should be deleted
            assert mongo_db.user_sessions.find_one({"session_token": tok}) is None, \
                "logout did not delete session for Bearer token"
            # next /me should fail
            r2 = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15)
            assert r2.status_code == 401
        finally:
            mongo_db.user_sessions.delete_many({"user_id": uid})
            mongo_db.users.delete_many({"user_id": uid})
