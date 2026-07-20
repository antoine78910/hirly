import asyncio
import json

import pytest

import auto_apply.executor as ex
from application_blueprint import (
    ApplicationBlueprint, Complexity, FieldType, NormalizedField,
)
from auto_apply.models import SubmissionEvidence


class _FakeAttempts:
    def __init__(self):
        self.rows = []

    def _active(self, user_id, job_id):
        return any(r["user_id"] == user_id and r["job_id"] == job_id
                   and r["status"] in ("in_flight", "submitted_success") for r in self.rows)

    async def insert_one(self, doc):
        if doc.get("status") in ("in_flight", "submitted_success") and self._active(doc["user_id"], doc["job_id"]):
            raise RuntimeError("duplicate key")
        self.rows.append(dict(doc))
        return {"inserted_id": doc["id"]}

    async def update_one(self, filter, update, upsert=False):
        for r in self.rows:
            if all(r.get(k) == v for k, v in filter.items()):
                r.update(update.get("$set") or {})
                return {"matched_count": 1}
        return {"matched_count": 0}

    def find(self, filter=None, projection=None):
        f = filter or {}
        rows = [dict(r) for r in self.rows if all(r.get(k) == v for k, v in f.items())]

        class _C:
            def __init__(self, rows):
                self._rows = rows

            def limit(self, n):
                self._rows = self._rows[:n]
                return self

            async def to_list(self, n):
                return list(self._rows[:n])

        return _C(rows)


class _FakeDB:
    def __init__(self):
        self.auto_apply_attempts = _FakeAttempts()


def _trivial_blueprint():
    fields = [
        NormalizedField("job_application[first_name]", FieldType.FIRST_NAME, required=True, supported=True,
                        binding='[name="job_application[first_name]"]'),
        NormalizedField("job_application[email]", FieldType.EMAIL, required=True, supported=True,
                        binding='[name="job_application[email]"]'),
        NormalizedField("job_application[resume]", FieldType.RESUME, required=True, supported=True,
                        binding='[name="job_application[resume]"]'),
    ]
    return ApplicationBlueprint(provider="greenhouse", fields=fields, complexity=Complexity.TRIVIAL,
                               estimated_compatibility_score=0.95, signature="sigX")


class _FakeDriver:
    provider = "greenhouse"
    version = "greenhouse-test"

    def __init__(self, blueprint, evidence, *, submit_yield=False):
        self._bp = blueprint
        self._ev = evidence
        self._submit_yield = submit_yield
        self.submits = 0

    def can_handle(self, job):
        return True

    async def inspect_application(self, job):
        return self._bp

    async def submit(self, ctx):
        if self._submit_yield:
            await asyncio.sleep(0)  # let a concurrent execution reach its claim
        self.submits += 1
        return self._ev


@pytest.fixture(autouse=True)
def _patch_common(monkeypatch):
    monkeypatch.setattr(ex, "build_candidate_context", lambda profile, app_doc, user: {
        "profile.contact.first_name": "Ada",
        "profile.contact.email": "ada@example.com",
        "application.tailored_cv_file": "__resume_file__",
    })
    monkeypatch.setattr(ex, "write_resume_file", lambda app_doc, tmp, profile=None: "/tmp/cv.pdf")
    monkeypatch.setattr(ex, "write_cover_letter_file", lambda app_doc, tmp: None)
    monkeypatch.setattr(ex, "submission_policy_failure", lambda *args, **kwargs: None)


def _register(monkeypatch, driver):
    monkeypatch.setattr(ex.DRIVER_REGISTRY, "for_job", lambda job: driver)


JOB = {"job_id": "j1", "ats_provider": "greenhouse", "external_url": "https://boards.greenhouse.io/acme/jobs/1"}
USER = {"user_id": "u1", "name": "Ada Lovelace", "email": "ada@example.com"}
_SUCCESS_EV = SubmissionEvidence(submit_performed=True, confirmation_text="thank you for applying",
                                 submit_control_gone=True, url_changed=True, network_ok=True)


def test_unsupported_when_no_driver(monkeypatch):
    monkeypatch.setattr(ex.DRIVER_REGISTRY, "for_job", lambda job: None)
    out = asyncio.run(ex.execute_application(_FakeDB(), JOB, {}, {}, USER))
    assert out["status"] == "unsupported"


def test_needs_user_input_exits_before_submit(monkeypatch):
    fields = [NormalizedField("job_application[phone]", FieldType.PHONE, required=True, supported=True,
                              binding='[name="job_application[phone]"]')]
    bp = ApplicationBlueprint(provider="greenhouse", fields=fields, complexity=Complexity.TRIVIAL,
                              estimated_compatibility_score=0.95, signature="sigP")
    driver = _FakeDriver(bp, SubmissionEvidence())
    _register(monkeypatch, driver)
    db = _FakeDB()
    out = asyncio.run(ex.execute_application(db, JOB, {}, {}, USER))
    assert out["status"] == "needs_user_input" and driver.submits == 0
    assert out["missing_fields"] == ["job_application[phone]"]
    assert db.auto_apply_attempts.rows[0]["status"] == "needs_user_input"
    assert db.auto_apply_attempts.rows[0]["missing_fields"] == ["job_application[phone]"]


def test_unsupported_blocker_exits_before_submit(monkeypatch):
    fields = _trivial_blueprint().fields
    bp = ApplicationBlueprint(provider="greenhouse", fields=fields, complexity=Complexity.TRIVIAL,
                              estimated_compatibility_score=0.0, blockers=["captcha_detected"], signature="sigB")
    driver = _FakeDriver(bp, _SUCCESS_EV)
    _register(monkeypatch, driver)
    db = _FakeDB()
    out = asyncio.run(ex.execute_application(db, JOB, {}, {}, USER))
    assert out["status"] == "unsupported" and driver.submits == 0
    assert db.auto_apply_attempts.rows[0]["status"] == "unsupported"


def test_success_path_records_verified_success_and_timestamps(monkeypatch):
    driver = _FakeDriver(_trivial_blueprint(), _SUCCESS_EV)
    _register(monkeypatch, driver)
    db = _FakeDB()
    out = asyncio.run(ex.execute_application(db, JOB, {}, {}, USER))
    assert out["status"] == "submitted_success"
    assert out["verdict"] == "verified_success"
    assert driver.submits == 1
    row = db.auto_apply_attempts.rows[0]
    assert row["status"] == "submitted_success"
    assert row["claimed_at"] and row["submitted_at"] and row["verified_at"]


def test_verification_failure_is_persisted(monkeypatch):
    ev = SubmissionEvidence(submit_performed=True, validation_errors=["Email is required"])
    driver = _FakeDriver(_trivial_blueprint(), ev)
    _register(monkeypatch, driver)
    db = _FakeDB()
    out = asyncio.run(ex.execute_application(db, JOB, {}, {}, USER))
    assert out["status"] == "reconciliation_required"
    assert driver.submits == 1
    row = db.auto_apply_attempts.rows[0]
    assert row["status"] == "reconciliation_required"
    assert row["verdict"] == "verified_failure"
    assert row["submitted_at"] is not None


def test_concurrent_execution_results_in_exactly_one_submit(monkeypatch):
    driver = _FakeDriver(_trivial_blueprint(), _SUCCESS_EV, submit_yield=True)
    _register(monkeypatch, driver)
    db = _FakeDB()

    async def run():
        return await asyncio.gather(
            ex.execute_application(db, JOB, {}, {}, USER),
            ex.execute_application(db, JOB, {}, {}, USER),
        )

    results = asyncio.run(run())
    statuses = sorted(r["status"] for r in results)
    assert driver.submits == 1  # exactly one submission
    assert "submitted_success" in statuses
    assert "already_in_flight" in statuses


def test_second_call_after_success_is_already_submitted(monkeypatch):
    driver = _FakeDriver(_trivial_blueprint(), _SUCCESS_EV)
    _register(monkeypatch, driver)
    db = _FakeDB()
    asyncio.run(ex.execute_application(db, JOB, {}, {}, USER))
    out2 = asyncio.run(ex.execute_application(db, JOB, {}, {}, USER))
    assert out2["status"] == "already_submitted"
    assert driver.submits == 1


def test_report_has_standard_debug_fields_on_success(monkeypatch):
    driver = _FakeDriver(_trivial_blueprint(), _SUCCESS_EV)
    _register(monkeypatch, driver)
    out = asyncio.run(ex.execute_application(_FakeDB(), JOB, {}, {}, USER))
    for key in ("stage_reached", "status", "reason", "verdict", "missing_fields",
                "blueprint_signature", "driver_version", "submission_evidence",
                "screenshots", "timestamps", "duration_ms"):
        assert key in out, key
    assert out["stage_reached"] == "verify"
    assert out["driver_version"] == "greenhouse-test"
    assert out["blueprint_signature"] == "sigX"
    assert isinstance(out["duration_ms"], int)
    assert out["timestamps"]["claimed_at"] and out["timestamps"]["submitted_at"] and out["timestamps"]["verified_at"]
    assert out["submission_evidence"]["submit_performed"] is True


def test_report_omits_screenshot_when_present(monkeypatch):
    ev = SubmissionEvidence(submit_performed=True, confirmation_text="thank you for applying",
                            submit_control_gone=True, url_changed=True, network_ok=True,
                            screenshot_b64="ZmFrZQ==")
    driver = _FakeDriver(_trivial_blueprint(), ev)
    _register(monkeypatch, driver)
    out = asyncio.run(ex.execute_application(_FakeDB(), JOB, {}, {}, USER))
    assert out["screenshots"] == []
    assert "screenshot_b64" not in out["submission_evidence"]


def test_dry_run_prepares_without_submitting(monkeypatch):
    driver = _FakeDriver(_trivial_blueprint(), SubmissionEvidence())
    _register(monkeypatch, driver)
    db = _FakeDB()
    out = asyncio.run(ex.execute_application(db, JOB, {}, {}, USER, dry_run=True))
    assert out["status"] == "prepared" and driver.submits == 0
    assert db.auto_apply_attempts.rows[0]["status"] == "prepared"


def test_executor_surfaces_apply_agent_error_with_debug(monkeypatch):
    from apply_agent.models import ApplyAgentError

    class _BrokenDriver(_FakeDriver):
        async def submit(self, ctx):
            raise ApplyAgentError("open_browser", "Failed to launch browser: TargetClosedError")

    driver = _BrokenDriver(_trivial_blueprint(), SubmissionEvidence())
    _register(monkeypatch, driver)
    db = _FakeDB()
    out = asyncio.run(ex.execute_application(db, JOB, {}, {}, USER))
    assert out["status"] == "error"
    assert out["stage_reached"] == "submit"
    assert "Failed to launch browser" in out["reason"]
    assert out["error"]["phase"] == "open_browser"
    assert out["debug"]["error"]["message"]
    assert out["debug"]["timeline"][-1]["status"] == "error"
    assert db.auto_apply_attempts.rows[0]["reason"].startswith("Failed to launch browser")


def test_midflight_policy_revocation_aborts_before_driver_submit(monkeypatch):
    calls = {"count": 0}

    def gate(*args, **kwargs):
        calls["count"] += 1
        return None if calls["count"] == 1 else "submission_policy_inactive"

    monkeypatch.setattr(ex, "submission_policy_failure", gate)
    driver = _FakeDriver(_trivial_blueprint(), _SUCCESS_EV)
    _register(monkeypatch, driver)
    out = asyncio.run(ex.execute_application(_FakeDB(), JOB, {}, {}, USER))
    assert out["status"] == "policy_denied"
    assert out["reason"] == "submission_policy_inactive"
    assert driver.submits == 0


def test_execution_report_redacts_candidate_pii_and_raw_evidence(monkeypatch):
    canaries = ["ada+pii@example.com", "+33612345678", "secret-cv-name.pdf", "token-123"]
    ev = SubmissionEvidence(
        submit_performed=True,
        confirmation_text=f"Thanks {canaries[0]}",
        validation_errors=[canaries[1]],
        final_url=f"https://boards.greenhouse.io/thanks?token={canaries[3]}",
        screenshot_b64=canaries[3],
        raw={
            "step_log": [{
                "action": "fill",
                "status": "ok",
                "value_preview": canaries[0],
                "filename": canaries[2],
            }],
        },
    )
    driver = _FakeDriver(_trivial_blueprint(), ev)
    _register(monkeypatch, driver)
    out = asyncio.run(ex.execute_application(_FakeDB(), JOB, {}, {}, USER))
    encoded = json.dumps(out, sort_keys=True)
    assert all(canary not in encoded for canary in canaries)
