import asyncio

import pytest
from fastapi import HTTPException

import server


def test_admin_dependency_rejects_non_admin():
    user = server.User(user_id="u", email="user@example.com", name="User")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.require_admin_user(user))
    assert exc.value.status_code == 403


def test_execute_endpoint_calls_executor_and_returns_attempt(monkeypatch):
    async def fake_find_one(query, projection=None):
        if query.get("job_id") == "j1":
            return {"job_id": "j1"}
        return None

    monkeypatch.setattr(server.db.jobs, "find_one", fake_find_one)

    created = []

    def capture_task(coro):
        created.append(coro)
        coro.close()

        class _Done:
            def add_done_callback(self, cb):
                pass

        return _Done()

    monkeypatch.setattr(server.asyncio, "create_task", capture_task)

    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    body = server.AdminAutoApplyExecuteRequest(job_id="j1", dry_run=True)
    result = asyncio.run(server.admin_auto_apply_execute(body, admin=admin))
    assert result["accepted"] is True
    assert result["polling"] is True
    assert result["result"]["status"] == "in_flight"
    assert result["started_at"]
    assert created, "background task should be scheduled"


def test_execute_endpoint_returns_soft_error_when_job_missing(monkeypatch):
    async def fake_find_one(query, projection=None):
        return None

    monkeypatch.setattr(server.db.jobs, "find_one", fake_find_one)
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    body = server.AdminAutoApplyExecuteRequest(job_id="missing", dry_run=True)
    result = asyncio.run(server.admin_auto_apply_execute(body, admin=admin))
    assert result["accepted"] is False
    assert result["attempt"] is None
    assert result["result"]["status"] == "error"
    assert result["result"]["error"]["message"] == "Job not found"
    assert result["result"]["error"]["http_status"] == 404


def test_execute_endpoint_keeps_result_when_latest_attempt_fails(monkeypatch):
    """Background worker still finishes even if persist/latest fail."""
    async def fake_load(job_id, user, require_tailored_package=True):
        return ({"job_id": job_id}, {}, {})

    async def fake_execute(db, job, profile, app_doc, user, *, dry_run=False, headless=True):
        return {"status": "prepared", "stage_reached": "plan", "reason": "ready_not_submitted"}

    async def fake_persist(db, user_id, job_id, report):
        raise RuntimeError("mongo down")

    monkeypatch.setattr(server, "_load_or_create_agent_application", fake_load)
    monkeypatch.setattr(server, "auto_apply_execute_application", fake_execute)
    monkeypatch.setattr(server, "auto_apply_persist_execution_report", fake_persist)

    # Run the background helper directly (no HTTP scheduling).
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    asyncio.run(server._admin_auto_apply_background_run(
        job_id="j1", target_user=admin, dry_run=True, headless=True,
    ))


def test_metrics_endpoint_delegates_to_summary(monkeypatch):
    async def fake_summary(db, provider):
        assert provider == "greenhouse"
        return {"provider": "greenhouse", "verified_success": 3, "submit_attempts": 3, "success_rate": 1.0}

    monkeypatch.setattr(server, "auto_apply_metrics_summary", fake_summary)
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    result = asyncio.run(server.admin_auto_apply_metrics(provider="greenhouse", admin=admin))
    assert result["success_rate"] == 1.0


def test_status_endpoint_returns_latest_attempt(monkeypatch):
    async def fake_latest(db, user_id, job_id):
        return {"status": "needs_user_input", "missing_fields": ["visa"], "stage_reached": "resolve",
                "reason": "needs_user_input:visa"}

    monkeypatch.setattr(server, "auto_apply_latest_attempt", fake_latest)
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    result = asyncio.run(server.admin_auto_apply_status(job_id="j1", admin=admin))
    assert result["attempt"]["missing_fields"] == ["visa"]
    assert result["attempt"]["status"] == "needs_user_input"


def test_right_swipes_endpoint_joins_users_jobs_and_attempts(monkeypatch):
    import auto_apply.drivers  # noqa: F401  (register drivers as startup does)

    swipe_rows = [
        {"user_id": "u1", "job_id": "j-gh", "direction": "right", "created_at": "2026-07-15T10:00:00+00:00"},
        {"user_id": "u2", "job_id": "j-sr", "direction": "right", "created_at": "2026-07-15T09:00:00+00:00"},
    ]
    user_rows = [
        {"user_id": "u1", "email": "u1@example.com", "name": "User One"},
        {"user_id": "u2", "email": "u2@example.com", "name": "User Two"},
    ]
    attempt_rows = [
        {"user_id": "u1", "job_id": "j-gh", "status": "prepared", "stage_reached": "plan",
         "reason": "ready_not_submitted", "created_at": "2026-07-15T10:05:00+00:00",
         "updated_at": "2026-07-15T10:05:00+00:00", "missing_fields": []},
    ]
    jobs = [
        {"job_id": "j-gh", "title": "Analyst", "company": "Acme", "ats_provider": "greenhouse",
         "external_url": "https://boards.greenhouse.io/acme/jobs/1"},
        {"job_id": "j-sr", "title": "Consultant", "company": "Beta", "ats_provider": "smartrecruiters",
         "external_url": "https://jobs.smartrecruiters.com/beta/1"},
    ]

    async def fake_safe_find(collection, filter=None, limit=10000, sort=None):
        name = getattr(collection, "name", None) or getattr(collection, "table_name", "")
        if "swipe" in str(name):
            return swipe_rows
        if "user" in str(name):
            return user_rows
        if "attempt" in str(name):
            return attempt_rows
        return []

    async def fake_jobs_for_ids(job_ids):
        return [j for j in jobs if j["job_id"] in job_ids]

    monkeypatch.setattr(server, "_admin_safe_find", fake_safe_find)
    monkeypatch.setattr(server, "_admin_jobs_for_ids", fake_jobs_for_ids)
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    out = asyncio.run(server.admin_auto_apply_right_swipes(limit=100, admin=admin))

    assert "greenhouse" in out["supported_providers"]
    by_job = {row["job_id"]: row for row in out["swipes"]}
    gh = by_job["j-gh"]
    assert gh["user_email"] == "u1@example.com"
    assert gh["driver_supported"] is True
    assert gh["latest_attempt"]["status"] == "prepared"
    sr = by_job["j-sr"]
    assert sr["ats_provider"] == "smartrecruiters"
    assert sr["driver_supported"] is True
    assert sr["latest_attempt"] is None


def test_right_swipes_endpoint_includes_application_status(monkeypatch):
    import auto_apply.drivers  # noqa: F401

    swipe_rows = [
        {"user_id": "u1", "job_id": "j-gh", "direction": "right", "created_at": "2026-07-15T10:00:00+00:00"},
        {"user_id": "u2", "job_id": "j-sr", "direction": "right", "created_at": "2026-07-15T09:00:00+00:00"},
    ]
    jobs = [
        {"job_id": "j-gh", "title": "Analyst", "company": "Acme", "ats_provider": "greenhouse"},
        {"job_id": "j-sr", "title": "Consultant", "company": "Beta", "ats_provider": "smartrecruiters"},
    ]
    application_rows = [
        {"user_id": "u1", "job_id": "j-gh", "application_id": "app_1", "submission_status": "submitted",
         "created_at": "2026-07-15T10:05:00+00:00"},
    ]

    async def fake_safe_find(collection, filter=None, limit=10000, sort=None):
        name = getattr(collection, "name", None) or getattr(collection, "table_name", "")
        if "swipe" in str(name):
            return swipe_rows
        if "application" in str(name):
            return application_rows
        return []

    async def fake_jobs_for_ids(job_ids):
        return [j for j in jobs if j["job_id"] in job_ids]

    monkeypatch.setattr(server, "_admin_safe_find", fake_safe_find)
    monkeypatch.setattr(server, "_admin_jobs_for_ids", fake_jobs_for_ids)
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    out = asyncio.run(server.admin_auto_apply_right_swipes(limit=100, admin=admin))

    by_job = {row["job_id"]: row for row in out["swipes"]}
    assert by_job["j-gh"]["has_application"] is True
    assert by_job["j-gh"]["application_id"] == "app_1"
    assert by_job["j-gh"]["submission_status"] == "submitted"
    assert by_job["j-sr"]["has_application"] is False
    assert by_job["j-sr"]["application_id"] is None
    assert by_job["j-sr"]["submission_status"] == "not_submitted"


def test_sync_application_status_marks_submitted_on_success():
    rows = [{"application_id": "app_1", "user_id": "u1", "submission_status": "not_submitted"}]

    class _Apps:
        async def update_one(self, filt, update):
            for row in rows:
                if all(row.get(k) == v for k, v in filt.items()):
                    row.update(update["$set"])

    class _DB:
        applications = _Apps()

    import server as srv
    old_db = srv.db
    srv.db = _DB()
    try:
        asyncio.run(srv._sync_application_status_from_auto_apply_result(
            "app_1", "u1", {"status": "submitted_success"},
        ))
    finally:
        srv.db = old_db
    assert rows[0]["submission_status"] == "submitted"
    assert rows[0]["submitted_at"]


def test_sync_application_status_marks_failed_for_manual_review_statuses():
    rows = [{"application_id": "app_1", "user_id": "u1", "submission_status": "not_submitted"}]

    class _Apps:
        async def update_one(self, filt, update):
            for row in rows:
                if all(row.get(k) == v for k, v in filt.items()):
                    row.update(update["$set"])

    class _DB:
        applications = _Apps()

    import server as srv
    old_db = srv.db
    srv.db = _DB()
    try:
        for status in ("submit_failed", "verification_failed", "error", "unsupported", "needs_user_input"):
            rows[0]["submission_status"] = "not_submitted"
            asyncio.run(srv._sync_application_status_from_auto_apply_result(
                "app_1", "u1", {"status": status},
            ))
            assert rows[0]["submission_status"] == "failed"
    finally:
        srv.db = old_db


def test_sync_application_status_ignores_transient_statuses():
    calls = []

    class _Apps:
        async def update_one(self, filt, update):
            calls.append((filt, update))

    class _DB:
        applications = _Apps()

    import server as srv
    old_db = srv.db
    srv.db = _DB()
    try:
        for status in ("already_in_flight", "prepared", "in_flight"):
            asyncio.run(srv._sync_application_status_from_auto_apply_result(
                "app_1", "u1", {"status": status},
            ))
    finally:
        srv.db = old_db
    assert calls == []


def test_background_run_syncs_application_status_only_for_real_runs(monkeypatch):
    async def fake_load(job_id, user, require_tailored_package=True):
        return ({"job_id": job_id}, {}, {"application_id": "app_1"})

    async def fake_execute(db, job, profile, app_doc, user, *, dry_run=False, headless=True):
        return {"status": "submitted_success", "stage_reached": "verify"}

    async def fake_persist(db, user_id, job_id, report):
        return None

    synced = []

    async def fake_sync(application_id, user_id, result):
        synced.append((application_id, user_id, result["status"]))

    monkeypatch.setattr(server, "_load_or_create_agent_application", fake_load)
    monkeypatch.setattr(server, "auto_apply_execute_application", fake_execute)
    monkeypatch.setattr(server, "auto_apply_persist_execution_report", fake_persist)
    monkeypatch.setattr(server, "_sync_application_status_from_auto_apply_result", fake_sync)

    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")

    asyncio.run(server._admin_auto_apply_background_run(
        job_id="j1", target_user=admin, dry_run=True, headless=True,
    ))
    assert synced == [], "dry runs must not update the application record"

    asyncio.run(server._admin_auto_apply_background_run(
        job_id="j1", target_user=admin, dry_run=False, headless=True,
    ))
    assert synced == [("app_1", "admin", "submitted_success")]


def test_greenhouse_driver_registered_via_startup_import():
    import auto_apply.drivers  # noqa: F401  (startup performs this registration)
    from auto_apply.driver import DRIVER_REGISTRY
    assert DRIVER_REGISTRY.for_job({"ats_provider": "greenhouse"}) is not None


def test_greenhouse_url_parsing():
    job = server._greenhouse_job_from_url("https://boards.greenhouse.io/acme/jobs/12345")
    assert job["board_token"] == "acme"
    assert job["provider_job_id"] == "12345"
    assert job["ats_provider"] == "greenhouse"
    assert job["external_url"] == "https://boards.greenhouse.io/acme/jobs/12345"


def test_validate_endpoint_builds_context_and_calls_executor(monkeypatch):
    captured = {}

    async def fake_execute(db, job, profile, app_doc, user, *, dry_run=False, headless=True):
        captured.update(job=job, profile=profile, app_doc=app_doc, dry_run=dry_run)
        return {"stage_reached": "plan", "status": "prepared", "duration_ms": 1}

    monkeypatch.setattr(server, "auto_apply_execute_application", fake_execute)
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Ada Lovelace")
    body = server.AdminAutoApplyValidateRequest(
        greenhouse_url="https://boards.greenhouse.io/acme/jobs/12345",
        resume_b64="UkVTVU1F", resume_filename="cv.pdf", cover_letter_text="Dear team",
        additional_answers={"salary": "100k"}, dry_run=True,
    )
    out = asyncio.run(server.admin_auto_apply_lab_execute(body, admin=admin))
    assert out["status"] == "prepared"
    assert captured["job"]["board_token"] == "acme"
    assert captured["app_doc"]["tailored_cv_file_b64"] == "UkVTVU1F"
    assert captured["app_doc"]["cover_letter"]["paragraphs"] == ["Dear team"]
    assert captured["profile"]["application_answers_profile"] == {"salary": "100k"}
    assert captured["profile"]["contact"]["email"] == "anto.delbos@gmail.com"
    assert captured["dry_run"] is True


def test_validate_endpoint_rejects_non_greenhouse_url():
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    body = server.AdminAutoApplyValidateRequest(greenhouse_url="https://example.com/careers/1")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.admin_auto_apply_lab_execute(body, admin=admin))
    assert exc.value.status_code == 400
