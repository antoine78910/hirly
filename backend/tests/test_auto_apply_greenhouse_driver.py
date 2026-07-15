import copy
import json
import pathlib

from application_blueprint import FieldType
from auto_apply.drivers.greenhouse import GreenhouseApplyDriver, _blueprint_from_questions


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


def test_can_handle_and_exposes_version():
    d = GreenhouseApplyDriver()
    assert d.can_handle({"ats_provider": "greenhouse"}) is True
    assert d.can_handle({"ats_provider": "lever"}) is False
    assert isinstance(d.version, str) and d.version


def test_driver_is_registered():
    from auto_apply.driver import DRIVER_REGISTRY
    import auto_apply.drivers  # noqa: F401  (registers drivers)
    assert DRIVER_REGISTRY.for_job({"ats_provider": "greenhouse"}) is not None
