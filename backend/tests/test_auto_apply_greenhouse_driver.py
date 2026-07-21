import asyncio
import copy
import json
import pathlib

import pytest

from application_blueprint import FieldType
from auto_apply.drivers.greenhouse import (
    GreenhouseApplyDriver,
    _blueprint_from_questions,
    _greenhouse_route_identity,
    _trusted_greenhouse_url,
)


def _payload():
    p = pathlib.Path(__file__).resolve().parent / "fixtures" / "greenhouse_questions.json"
    return json.loads(p.read_text(encoding="utf-8"))


def test_blueprint_maps_contact_and_resume_with_bindings():
    bp = _blueprint_from_questions(_payload())
    by_key = {f.key: f for f in bp.fields}
    assert by_key["job_application[first_name]"].type == FieldType.FIRST_NAME
    assert by_key["job_application[email]"].type == FieldType.EMAIL
    resume = by_key["job_application[resume]"]
    assert resume.type == FieldType.RESUME
    assert resume.binding == '[name="job_application[resume]"]'
    assert bp.provider == "greenhouse" and bp.signature


def test_sensitive_question_detected_with_options():
    bp = _blueprint_from_questions(_payload())
    visa = {f.key: f for f in bp.fields}["question_98"]
    assert visa.validation.sensitive is True
    assert visa.validation.allowed_options == ["Yes", "No"]
    assert visa.required is True


def test_required_flags_carried_through():
    bp = _blueprint_from_questions(_payload())
    by_key = {f.key: f for f in bp.fields}
    assert by_key["job_application[first_name]"].required is True
    assert by_key["question_99"].required is False


def test_identical_payloads_generate_identical_signatures():
    assert _blueprint_from_questions(_payload()).signature == _blueprint_from_questions(_payload()).signature


def test_changing_a_required_field_changes_the_signature():
    base = _blueprint_from_questions(_payload()).signature
    mutated = copy.deepcopy(_payload())
    mutated["questions"][-1]["required"] = True  # "How did you hear about us?" now required
    assert _blueprint_from_questions(mutated).signature != base


def test_unsupported_widget_becomes_unsupported_field():
    payload = copy.deepcopy(_payload())
    payload["questions"].append({
        "label": "Signature pad", "required": True,
        "fields": [{"name": "question_custom_pad", "type": "custom_signature_widget", "values": []}],
    })
    field = {f.key: f for f in _blueprint_from_questions(payload).fields}["question_custom_pad"]
    assert field.supported is False
    assert field.type == FieldType.UNKNOWN


def test_locator_bindings_are_deterministic_and_prefer_name():
    a = {f.key: f.binding for f in _blueprint_from_questions(_payload()).fields}
    b = {f.key: f.binding for f in _blueprint_from_questions(_payload()).fields}
    assert a == b
    assert a["job_application[email]"] == '[name="job_application[email]"]'


def test_application_url_prefers_external_url():
    d = GreenhouseApplyDriver()
    assert d.application_url({"external_url": "https://boards.greenhouse.io/acme/jobs/1"}) == \
        "https://boards.greenhouse.io/acme/jobs/1"


def test_application_url_falls_back_to_source_url_and_data():
    d = GreenhouseApplyDriver()
    assert d.application_url({"source_url": "https://job-boards.greenhouse.io/acme/jobs/9"}) == \
        "https://job-boards.greenhouse.io/acme/jobs/9"
    assert d.application_url({"data": {"absolute_url": "https://boards.greenhouse.io/acme/jobs/2"}}) == \
        "https://boards.greenhouse.io/acme/jobs/2"


def test_trusted_greenhouse_url_accepts_only_canonical_https_hosts():
    assert _trusted_greenhouse_url("https://boards.greenhouse.io/acme/jobs/1")
    assert _trusted_greenhouse_url("https://job-boards.greenhouse.com/acme/jobs/1")
    for value in (
        "http://boards.greenhouse.io/acme/jobs/1",
        "https://greenhouse.io.evil.example/acme/jobs/1",
        "https://user@boards.greenhouse.io/acme/jobs/1",
        "https://boards.greenhouse.io:8443/acme/jobs/1",
        "https://boards.greenhouse.io:not-a-port/acme/jobs/1",
        "https://support.greenhouse.io/acme/jobs/1",
        "https://api.greenhouse.io/acme/jobs/1",
        "https://boards-api.greenhouse.io/acme/jobs/1",
        "https://boards.greenhouse.io/acme/support/1",
        "https://boards.greenhouse.io/acme/jobs/1?source=campaign",
        "https://boards.greenhouse.io/acme//jobs/1",
        "https://boards.greenhouse.io/acme/jobs/1/",
        "https://boards.greenhouse.io/acme/jobs/1/extra",
        "https://boards.greenhouse.io/prefix/acme/jobs/1",
        "https://boards.greenhouse.io/acme/jobs%2f1",
        "https://boards.greenhouse.io/acme/jobs/%2fetc%2fpasswd",
    ):
        assert _trusted_greenhouse_url(value) is False


def test_greenhouse_route_identity_binds_exact_board_and_job():
    assert _greenhouse_route_identity(
        "https://boards.greenhouse.io/Acme-Board/jobs/Job_123"
    ) == ("acme-board", "job_123")
    assert _greenhouse_route_identity(
        "https://boards.greenhouse.io/acme/jobs/1#app",
        allow_fragment=True,
    ) == ("acme", "1")


def test_route_identity_rejects_explicit_job_metadata_mismatch():
    driver = GreenhouseApplyDriver()
    base = {
        "selected_apply_url": "https://boards.greenhouse.io/acme/jobs/123",
        "board_token": "acme",
        "provider_job_id": "123",
    }
    assert driver.route_identity(base) == ("acme", "123")
    assert driver.route_identity({**base, "board_token": "other"}) is None
    assert driver.route_identity({**base, "provider_job_id": "999"}) is None


def test_application_url_skips_unsafe_preferred_url_for_safe_nested_fallback():
    driver = GreenhouseApplyDriver()
    assert driver.application_url({
        "external_url": "https://evil.example/jobs/1",
        "data": {"selected_apply_url": "https://boards.greenhouse.io/acme/jobs/1"},
    }) == "https://boards.greenhouse.io/acme/jobs/1"


def test_inspection_validates_redirect_against_bound_api_identity(monkeypatch):
    calls = []

    class Response:
        status_code = 302
        headers = {"location": "https://evil.example/steal"}
        url = "https://boards-api.greenhouse.io/v1/boards/acme/jobs/123"

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, **kwargs):
            calls.append((url, kwargs))
            return Response()

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: Client())
    job = {
        "selected_apply_url": "https://boards.greenhouse.io/acme/jobs/123",
        "board_token": "acme",
        "provider_job_id": "123",
    }
    with pytest.raises(ValueError, match="greenhouse_api_route_denied"):
        asyncio.run(GreenhouseApplyDriver().inspect_application(job))
    assert len(calls) == 1
    assert calls[0][1]["follow_redirects"] is False


class _FormLocator:
    def __init__(self, action, count=1):
        self.action = action
        self._count = count
        self.first = self

    async def count(self):
        return self._count

    async def get_attribute(self, name):
        assert name == "action"
        return self.action


class _BoundaryPage:
    def __init__(self, url, action, form_count=1):
        self.url = url
        self._form = _FormLocator(action, form_count)

    def locator(self, selector):
        assert selector == 'form:has(button[type="submit"], input[type="submit"])'
        return self._form


def test_final_browser_url_and_form_action_remain_bound_to_same_job():
    driver = GreenhouseApplyDriver()
    job = {
        "selected_apply_url": "https://boards.greenhouse.io/acme/jobs/123",
        "board_token": "acme",
        "provider_job_id": "123",
    }
    safe = _BoundaryPage(
        "https://boards.greenhouse.io/acme/jobs/123#app",
        "/acme/jobs/123",
    )
    assert asyncio.run(driver.submission_boundary_failure(safe, job)) is None

    redirected = _BoundaryPage(
        "https://boards.greenhouse.io/other/jobs/123",
        "/other/jobs/123",
    )
    assert asyncio.run(driver.submission_boundary_failure(redirected, job)) == \
        "greenhouse_browser_route_mismatch"

    hostile_action = _BoundaryPage(
        "https://boards.greenhouse.io/acme/jobs/123",
        "https://evil.example/collect",
    )
    assert asyncio.run(driver.submission_boundary_failure(hostile_action, job)) == \
        "greenhouse_form_action_mismatch"

    ambiguous = _BoundaryPage(
        "https://boards.greenhouse.io/acme/jobs/123",
        "/acme/jobs/123",
        form_count=2,
    )
    assert asyncio.run(driver.submission_boundary_failure(ambiguous, job)) == \
        "greenhouse_submit_form_ambiguous"


def test_can_handle_and_exposes_version():
    d = GreenhouseApplyDriver()
    assert d.can_handle({"ats_provider": "greenhouse"}) is True
    assert d.can_handle({"ats_provider": "lever"}) is False
    assert isinstance(d.version, str) and d.version


def test_driver_is_registered():
    from auto_apply.driver import DRIVER_REGISTRY
    import auto_apply.drivers  # noqa: F401  (registers drivers)
    assert DRIVER_REGISTRY.for_job({"ats_provider": "greenhouse"}) is not None
