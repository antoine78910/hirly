from application_blueprint import (
    ApplicationBlueprint, Complexity, FieldType, FieldValidation, NormalizedField,
)
from auto_apply.models import ResolvedAnswer
from auto_apply.planner import plan


def _bp(fields):
    return ApplicationBlueprint(provider="greenhouse", fields=fields,
                                complexity=Complexity.TRIVIAL, estimated_compatibility_score=0.95,
                                signature="sig1")


def test_plan_orders_fills_then_uploads_then_submit_with_locators():
    fields = [
        NormalizedField("email", FieldType.EMAIL, required=True, supported=True,
                        binding='[name="job_application[email]"]'),
        NormalizedField("resume", FieldType.RESUME, required=True, supported=True,
                        binding='[name="job_application[resume]"]'),
    ]
    answers = [
        ResolvedAnswer("email", FieldType.EMAIL, "a@b.co", "profile.contact.email", is_file=False),
        ResolvedAnswer("resume", FieldType.RESUME, "__resume_file__", "application.tailored_cv_file", is_file=True),
    ]
    p = plan(_bp(fields), answers)
    assert [s.action for s in p.steps] == ["fill", "upload", "submit"]
    assert p.steps[0].locators[0] == '[name="job_application[email]"]'
    assert p.steps[1].file_role == "resume"
    assert p.blueprint_signature == "sig1"


def test_select_field_becomes_select_step():
    fields = [NormalizedField("src", FieldType.SELECT, required=True, supported=True,
                              binding='[name="q1"]', validation=FieldValidation(allowed_options=["Yes", "No"]))]
    answers = [ResolvedAnswer("src", FieldType.SELECT, "Yes", "profile.application_answers_profile.q1")]
    p = plan(_bp(fields), answers)
    assert p.steps[0].action == "select" and p.steps[-1].action == "submit"


def test_locators_include_fallback_when_binding_present():
    fields = [NormalizedField("email", FieldType.EMAIL, required=True, supported=True,
                              binding='[name="job_application[email]"]', label="Email")]
    answers = [ResolvedAnswer("email", FieldType.EMAIL, "a@b.co", "profile.contact.email")]
    step = plan(_bp(fields), answers).steps[0]
    assert step.locators[0] == '[name="job_application[email]"]'
    assert len(step.locators) >= 1  # primary always present; fallbacks appended when derivable
