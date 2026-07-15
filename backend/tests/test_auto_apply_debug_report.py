from application_blueprint import FieldType, NormalizedField
from apply_agent.models import ApplyAgentError
from auto_apply.debug_report import build_debug_report, data_availability, format_run_error


def test_data_availability_flags_missing_resume():
    avail = data_availability({"contact": {"email": "a@b.co"}}, {})
    assert avail["tailored_cv_file"] is False
    assert avail["email"] is True


def test_debug_report_marks_unresolved_resume():
    blueprint_fields = [
        NormalizedField("resume", FieldType.RESUME, required=True, supported=True, label="CV"),
        NormalizedField("email", FieldType.EMAIL, required=True, supported=True, label="Email"),
    ]

    class _Bp:
        provider = "smartrecruiters"
        signature = "abc"
        complexity = type("C", (), {"value": "standard"})()
        fields = blueprint_fields

    class _Decision:
        eligible = True
        category = "eligible"
        reason = "eligible"
        score = 0.95
        signals = {}

    debug = build_debug_report(
        job={"job_id": "j1", "ats_provider": "smartrecruiters"},
        profile={"contact": {"email": "u@example.com"}},
        app_doc={},
        blueprint=_Bp(),
        decision=_Decision(),
        answers=[],
        unresolved=[blueprint_fields[0]],
        candidate_context={"profile.contact.email": "u@example.com"},
    )
    by_key = {row["key"]: row for row in debug["field_status"]}
    assert by_key["resume"]["status"] == "missing"
    assert by_key["email"]["status"] == "optional_skipped"
    assert debug["data_availability"]["tailored_cv_file"] is False
    assert debug["timeline"]


def test_format_run_error_from_apply_agent_error():
    exc = ApplyAgentError("open_browser", "Playwright is not installed.", target_url="https://example.com")
    detail = format_run_error(exc, checkpoint="submit")
    assert detail["phase"] == "open_browser"
    assert detail["message"] == "Playwright is not installed."
    assert detail["target_url"] == "https://example.com"
    assert detail["hint"]


def test_format_run_error_from_generic_exception():
    detail = format_run_error(ValueError("smartrecruiters_publication_unresolved"), checkpoint="inspect")
    assert detail["exception_class"] == "ValueError"
    assert "publication_unresolved" in detail["message"]
    assert detail["checkpoint"] == "inspect"
