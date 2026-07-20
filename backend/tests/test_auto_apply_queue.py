import asyncio

import auto_apply.drivers  # noqa: F401 — register drivers
from auto_apply import queue as q


class _FakeCursor:
    def __init__(self, rows):
        self._rows = list(rows)

    def sort(self, key_or_list, direction=None):
        if isinstance(key_or_list, list):
            for key, direction in reversed(key_or_list):
                reverse = direction == -1
                self._rows.sort(key=lambda r: r.get(key) or "", reverse=reverse)
        else:
            reverse = direction == -1
            self._rows.sort(key=lambda r: r.get(key_or_list) or "", reverse=reverse)
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    async def to_list(self, n):
        return list(self._rows[:n])


class _FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter=None, projection=None, sort=None):
        cursor = self.find(filter or {}, projection)
        if sort:
            cursor.sort(sort)
        rows = await cursor.limit(1).to_list(1)
        return rows[0] if rows else None

    def find(self, filter=None, projection=None):
        filter = filter or {}
        matched = [dict(r) for r in self.rows if _match(r, filter)]
        return _FakeCursor(matched)

    async def update_one(self, filter, update, upsert=False):
        for r in self.rows:
            if _match(r, filter):
                r.update(update.get("$set") or {})
                return type("R", (), {"matched_count": 1, "modified_count": 1})()
        return type("R", (), {"matched_count": 0, "modified_count": 0})()

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return {"inserted_id": doc.get("id") or doc.get("application_id")}


def _match(doc, filter):
    for key, expected in filter.items():
        value = doc.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$nin" in expected and value in expected["$nin"]:
                return False
            continue
        if value != expected:
            return False
    return True


class _FakeDB:
    def __init__(self):
        self.applications = _FakeCollection()
        self.jobs = _FakeCollection()
        self.users = _FakeCollection()
        self.profiles = _FakeCollection()
        self.auto_apply_attempts = _FakeCollection()


def _authorized(app, provider="smartrecruiters"):
    app = dict(app)
    app.setdefault("document_review_status", "approved")
    route = {
        "provider": provider,
        "tenant": "fixture-tenant",
        "route_id": "fixture-route",
        "transport": "hosted_candidate_form",
        "schema_version": "fixture-v1",
        "country": "FR",
        "policy_version": "policy-v1",
    }
    app["submission_route"] = route
    app["submission_policy"] = {
        **route,
        "enabled": True,
        "revoked": False,
        "expires_at": "2099-01-01T00:00:00+00:00",
    }
    app["candidate_mandate"] = {
        "active": True,
        "revoked": False,
        "expires_at": "2099-01-01T00:00:00+00:00",
        "user_id": app.get("user_id"),
        "job_id": app.get("job_id"),
        "scope": "submit_application",
        "policy_version": "policy-v1",
        "consent_version": "consent-v1",
        "blueprint_signature": "fixture-signature",
        "answer_set_digest": "fixture-digest",
    }
    return app


def test_provider_for_job_smartrecruiters_and_greenhouse():
    assert q.provider_for_job({"ats_provider": "smartrecruiters"}) == "smartrecruiters"
    assert q.provider_for_job({"ats_provider": "Greenhouse"}) == "greenhouse"
    assert q.provider_for_job({"ats_provider": "lever"}) is None


def test_environment_provider_filter_cannot_widen_reviewed_capabilities(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_QUEUE_PROVIDERS", "greenhouse,lever,recruitee,unknown")
    assert q.queue_providers() == {"greenhouse"}


def test_submission_policy_requires_exact_unexpired_route_and_mandate():
    app = _authorized({
        "application_id": "app_policy",
        "user_id": "u1",
        "job_id": "j1",
        "ats_provider": "smartrecruiters",
    })
    job = {"job_id": "j1", "ats_provider": "smartrecruiters"}
    assert q.submission_policy_failure(app, job, user_id="u1") is None
    assert q.submission_policy_failure(
        app,
        job,
        user_id="u1",
        blueprint_signature="different",
    ) == "candidate_mandate_blueprint_mismatch"
    app["submission_policy"]["expires_at"] = "2020-01-01T00:00:00+00:00"
    assert q.submission_policy_failure(app, job, user_id="u1") == "submission_policy_expired"


def test_enqueue_fails_closed_without_runtime_policy():
    db = _FakeDB()
    app = {
        "application_id": "app_denied",
        "user_id": "u1",
        "job_id": "j1",
        "package_status": "generated",
        "submission_status": "not_submitted",
        "ats_provider": "greenhouse",
    }
    assert asyncio.run(q.enqueue_application(
        db,
        app,
        {"job_id": "j1", "ats_provider": "greenhouse"},
    )) is None


def test_capability_catalogue_reconciles_registered_drivers_and_queue_defaults():
    registered = set(q.DRIVER_REGISTRY.providers())
    queue_defaults = set(q.DEFAULT_PROVIDERS)

    assert queue_defaults.issubset(registered)
    for provider, capability in q.APPLICATION_CAPABILITIES.items():
        assert capability["driverRegistered"] == (provider in registered)
        assert capability["queuePermitted"] == (provider in queue_defaults)
        assert capability["noSubmitVerified"] == (provider in queue_defaults)


def test_map_execution_success_and_needs_input():
    ok = q.map_execution_to_queue({"status": "submitted_success", "reason": "verified"})
    assert ok["auto_apply_queue_status"] == "succeeded"
    assert ok["submission_status"] == "submitted"

    need = q.map_execution_to_queue({
        "status": "needs_user_input",
        "reason": "needs_user_input:foo",
        "missing_fields": ["foo"],
    })
    assert need["auto_apply_queue_status"] == "failed"
    assert need["submission_status"] == "action_required"
    assert need["prepared_missing_information"][0]["field_name"] == "foo"

    expired = q.map_execution_to_queue({"status": "submit_failed", "reason": "offer_expired"})
    assert expired["auto_apply_queue_status"] == "skipped"


def test_enqueue_requires_document_review_by_default(monkeypatch):
    monkeypatch.delenv("AUTO_APPLY_REQUIRE_DOCUMENT_REVIEW", raising=False)
    db = _FakeDB()
    app = _authorized({
        "application_id": "app_1",
        "user_id": "u1",
        "job_id": "j1",
        "package_status": "generated",
        "submission_status": "not_submitted",
        "document_review_status": "awaiting_user",
        "ats_provider": "smartrecruiters",
    })
    db.applications.rows.append(dict(app))
    db.users.rows.append({"user_id": "u1", "require_review_before_send": True})
    job = {"job_id": "j1", "ats_provider": "smartrecruiters"}

    result = asyncio.run(q.enqueue_application(db, app, job))
    assert result["enqueued"] is True
    assert result["auto_apply_queue_status"] == "awaiting_review"


def test_environment_cannot_disable_required_document_review(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_REQUIRE_DOCUMENT_REVIEW", "false")
    assert q._needs_document_review(
        {"document_review_status": "awaiting_user"},
        {"require_review_before_send": False},
    ) is True


def test_missing_document_review_state_fails_closed(monkeypatch):
    monkeypatch.delenv("AUTO_APPLY_REQUIRE_DOCUMENT_REVIEW", raising=False)
    assert q._needs_document_review({}, None) is True


def test_enqueue_respects_document_review_when_enabled(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_REQUIRE_DOCUMENT_REVIEW", "true")
    db = _FakeDB()
    app = _authorized({
        "application_id": "app_1b",
        "user_id": "u1",
        "job_id": "j1",
        "package_status": "generated",
        "submission_status": "not_submitted",
        "document_review_status": "awaiting_user",
        "ats_provider": "smartrecruiters",
    })
    db.applications.rows.append(dict(app))
    db.users.rows.append({"user_id": "u1", "require_review_before_send": True})
    job = {"job_id": "j1", "ats_provider": "smartrecruiters"}

    result = asyncio.run(q.enqueue_application(db, app, job))
    assert result["enqueued"] is True
    assert result["auto_apply_queue_status"] == "awaiting_review"
    assert db.applications.rows[0]["auto_apply_queue_status"] == "awaiting_review"


def test_release_after_document_approval_moves_to_queued():
    db = _FakeDB()
    app = _authorized({
        "application_id": "app_2",
        "user_id": "u1",
        "job_id": "j1",
        "package_status": "generated",
        "submission_status": "not_submitted",
        "auto_apply_queue_status": "awaiting_review",
        "auto_apply_provider": "smartrecruiters",
        "ats_provider": "smartrecruiters",
    })
    db.applications.rows.append(dict(app))
    db.jobs.rows.append({"job_id": "j1", "ats_provider": "smartrecruiters"})
    result = asyncio.run(q.release_after_document_approval(db, app))
    assert result["auto_apply_queue_status"] == "queued"
    assert db.applications.rows[0]["auto_apply_queue_status"] == "queued"


def test_release_after_document_approval_rechecks_policy():
    db = _FakeDB()
    app = _authorized({
        "application_id": "app_revoked",
        "user_id": "u1",
        "job_id": "j1",
        "package_status": "generated",
        "submission_status": "not_submitted",
        "auto_apply_queue_status": "awaiting_review",
        "auto_apply_provider": "smartrecruiters",
        "ats_provider": "smartrecruiters",
    })
    app["submission_policy"]["revoked"] = True
    db.applications.rows.append(dict(app))
    db.jobs.rows.append({"job_id": "j1", "ats_provider": "smartrecruiters"})

    result = asyncio.run(q.release_after_document_approval(db, app))

    assert result["auto_apply_queue_status"] == "failed"
    assert result["submission_status"] == "blocked"
    assert result["auto_apply_queue_reason"] == "submission_policy_inactive"


def test_claim_next_rechecks_policy_before_running():
    db = _FakeDB()
    app = _authorized({
        "application_id": "app_stale_policy",
        "user_id": "u1",
        "job_id": "j1",
        "submission_status": "not_submitted",
        "auto_apply_queue_status": "queued",
        "ats_provider": "smartrecruiters",
    })
    app["candidate_mandate"]["active"] = False
    db.applications.rows.append(dict(app))

    assert asyncio.run(q._claim_next(db)) is None
    assert db.applications.rows[0]["auto_apply_queue_status"] == "failed"
    assert db.applications.rows[0]["submission_status"] == "blocked"
    assert db.applications.rows[0]["submission_error"] == "candidate_mandate_inactive"


def test_backfill_enqueues_ready_sr_apps(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_QUEUE_ENABLED", "true")
    db = _FakeDB()
    db.applications.rows.append(_authorized({
        "application_id": "app_old",
        "user_id": "u1",
        "job_id": "j_sr",
        "package_status": "generated",
        "submission_status": "not_submitted",
        "ats_provider": "smartrecruiters",
        "created_at": "2026-01-01T00:00:00+00:00",
        "document_review_status": "approved",
    }))
    db.jobs.rows.append({"job_id": "j_sr", "ats_provider": "smartrecruiters"})
    db.users.rows.append({"user_id": "u1", "require_review_before_send": False})

    count = asyncio.run(q.backfill_pending_applications(db, limit=50))
    assert count == 1
    assert db.applications.rows[0]["auto_apply_queue_status"] == "queued"


def test_backfill_falls_back_when_additive_rpc_is_not_migrated(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_QUEUE_ENABLED", "true")
    db = _FakeDB()
    db.applications.rows.append(_authorized({
        "application_id": "app_old",
        "user_id": "u1",
        "job_id": "j_sr",
        "package_status": "generated",
        "submission_status": "not_submitted",
        "ats_provider": "smartrecruiters",
        "created_at": "2026-01-01T00:00:00+00:00",
    }))
    db.jobs.rows.append({"job_id": "j_sr", "ats_provider": "smartrecruiters"})
    db.users.rows.append({"user_id": "u1", "require_review_before_send": False})

    async def missing_rpc(_providers, *, limit):
        raise RuntimeError(
            "PostgREST RPC backfill_auto_apply_queue returned HTTP 404: "
            "PGRST202 Could not find the function"
        )

    db.backfill_auto_apply_queue = missing_rpc
    assert asyncio.run(q.backfill_pending_applications(db, limit=50)) == 1
    assert db.applications.rows[0]["auto_apply_queue_status"] == "queued"


def test_backfill_does_not_hide_rpc_execution_failure(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_QUEUE_ENABLED", "true")
    db = _FakeDB()

    async def failed_rpc(_providers, *, limit):
        raise RuntimeError("PostgREST RPC returned HTTP 500: statement timeout")

    db.backfill_auto_apply_queue = failed_rpc
    try:
        asyncio.run(q.backfill_pending_applications(db, limit=50))
    except RuntimeError as error:
        assert "statement timeout" in str(error)
    else:
        raise AssertionError("non-migration RPC failures must surface")


def test_list_queue_assigns_positions():
    db = _FakeDB()
    db.applications.rows.extend([
        {
            "application_id": "a1",
            "user_id": "u1",
            "job_id": "j1",
            "auto_apply_queue_status": "running",
            "auto_apply_queued_at": "2026-01-01T00:00:00+00:00",
            "auto_apply_provider": "smartrecruiters",
        },
        {
            "application_id": "a2",
            "user_id": "u1",
            "job_id": "j2",
            "auto_apply_queue_status": "queued",
            "auto_apply_queued_at": "2026-01-01T01:00:00+00:00",
            "auto_apply_provider": "greenhouse",
        },
    ])
    db.jobs.rows.extend([
        {"job_id": "j1", "company": "Accor", "title": "Host"},
        {"job_id": "j2", "company": "Stripe", "title": "Eng"},
    ])
    payload = asyncio.run(q.list_queue_for_user(db, "u1"))
    assert payload["active_count"] == 2
    by_id = {item["application_id"]: item for item in payload["items"]}
    assert by_id["a1"]["position"] == 1
    assert by_id["a2"]["position"] == 2
    assert by_id["a1"]["company"] == "Accor"
