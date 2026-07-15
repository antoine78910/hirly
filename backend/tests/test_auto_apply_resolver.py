from application_blueprint import (
    ApplicationBlueprint, Complexity, FieldType, FieldValidation, NormalizedField,
)
from auto_apply.resolver import resolve


def _bp(fields):
    return ApplicationBlueprint(provider="greenhouse", fields=fields,
                                complexity=Complexity.TRIVIAL, estimated_compatibility_score=0.95)


def _ctx():
    return {
        "profile.contact.first_name": "Ada",
        "profile.contact.email": "ada@example.com",
        "application.tailored_cv_file": "__resume_file__",
    }


def test_maps_contact_and_resume_from_context():
    fields = [
        NormalizedField("first_name", FieldType.FIRST_NAME, required=True, supported=True,
                        binding='[name="job_application[first_name]"]'),
        NormalizedField("email", FieldType.EMAIL, required=True, supported=True,
                        binding='[name="job_application[email]"]'),
        NormalizedField("resume", FieldType.RESUME, required=True, supported=True,
                        binding='[name="job_application[resume]"]'),
    ]
    answers, unresolved = resolve(_bp(fields), _ctx(), profile={})
    by_key = {a.field_key: a for a in answers}
    assert by_key["first_name"].value == "Ada" and by_key["first_name"].is_file is False
    assert by_key["resume"].is_file is True and by_key["resume"].value == "__resume_file__"
    assert unresolved == []


def test_missing_required_field_is_unresolved_not_guessed():
    fields = [
        NormalizedField("first_name", FieldType.FIRST_NAME, required=True, supported=True),
        NormalizedField("phone", FieldType.PHONE, required=True, supported=True),  # not in context
    ]
    answers, unresolved = resolve(_bp(fields), _ctx(), profile={})
    assert {a.field_key for a in answers} == {"first_name"}
    assert [f.key for f in unresolved] == ["phone"]


def test_sensitive_required_field_is_never_resolved_from_generic_context():
    fields = [
        NormalizedField("visa", FieldType.VISA_STATUS, required=True, supported=True,
                        label="Are you authorized to work?", validation=FieldValidation(sensitive=True)),
    ]
    # Even if some context value exists, a sensitive field must come from a saved answer only.
    answers, unresolved = resolve(_bp(fields), {"profile.contact.first_name": "Ada"}, profile={})
    assert answers == []
    assert [f.key for f in unresolved] == ["visa"]
