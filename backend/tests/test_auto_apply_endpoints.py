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
    async def fake_load(job_id, user):
        return ({"job_id": job_id, "ats_provider": "greenhouse"}, {"contact": {}}, {"application_id": "a1"})

    async def fake_execute(db, job, profile, app_doc, user, *, dry_run=False, headless=True):
        assert job["job_id"] == "j1" and dry_run is True
        return {"status": "prepared", "reason": "ready_not_submitted"}

    async def fake_latest(db, user_id, job_id):
        return {"status": "prepared", "stage_reached": "plan", "driver_version": "greenhouse-1.0.0",
                "blueprint_signature": "sigX", "missing_fields": [], "claimed_at": "t0",
                "submitted_at": None, "verified_at": None, "reason": "ready_not_submitted"}

    monkeypatch.setattr(server, "_load_or_create_agent_application", fake_load)
    monkeypatch.setattr(server, "auto_apply_execute_application", fake_execute)
    monkeypatch.setattr(server, "auto_apply_latest_attempt", fake_latest)
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    body = server.AdminAutoApplyExecuteRequest(job_id="j1", dry_run=True)
    result = asyncio.run(server.admin_auto_apply_execute(body, admin=admin))
    assert result["result"]["status"] == "prepared"
    # Debug fields exposed via the persisted attempt.
    assert result["attempt"]["driver_version"] == "greenhouse-1.0.0"
    assert result["attempt"]["blueprint_signature"] == "sigX"
    assert result["attempt"]["stage_reached"] == "plan"


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
