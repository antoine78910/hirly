from application_blueprint import (
    ApplicationBlueprint,
    Complexity,
    FieldType,
    FieldValidation,
    NormalizedField,
    derive_complexity,
    estimate_compatibility_score,
)


def _std_fields():
    return [
        NormalizedField("first_name", FieldType.FIRST_NAME, required=True, supported=True),
        NormalizedField("last_name", FieldType.LAST_NAME, required=True, supported=True),
        NormalizedField("email", FieldType.EMAIL, required=True, supported=True),
        NormalizedField("resume", FieldType.RESUME, required=True, supported=True),
    ]


def test_field_type_values_are_lowercase_names():
    assert FieldType.COVER_LETTER.value == "cover_letter"
    assert FieldType.VISA_STATUS.value == "visa_status"


def test_trivial_when_only_standard_contact_and_resume():
    assert derive_complexity(_std_fields()) == Complexity.TRIVIAL


def test_standard_when_a_few_simple_custom_questions():
    fields = _std_fields() + [
        NormalizedField("q1", FieldType.SELECT, required=True, supported=True,
                        validation=FieldValidation(allowed_options=["Yes", "No"])),
    ]
    assert derive_complexity(fields) == Complexity.STANDARD


def test_complex_when_unsupported_required_field_present():
    fields = _std_fields() + [
        NormalizedField("visa", FieldType.VISA_STATUS, required=True, supported=True,
                        validation=FieldValidation(sensitive=True)),
    ]
    assert derive_complexity(fields) == Complexity.COMPLEX


def test_estimate_is_zero_when_blockers_present():
    assert estimate_compatibility_score(_std_fields(), ["captcha"]) == 0.0


def test_estimate_is_high_for_trivial_supported_form():
    score = estimate_compatibility_score(_std_fields(), [])
    assert score >= 0.9


def test_estimate_drops_when_required_field_unsupported():
    fields = _std_fields() + [
        NormalizedField("weird", FieldType.UNKNOWN, required=True, supported=False),
    ]
    assert estimate_compatibility_score(fields, []) < 0.5


def test_blueprint_is_constructable():
    bp = ApplicationBlueprint(
        provider="greenhouse",
        fields=_std_fields(),
        complexity=Complexity.TRIVIAL,
        estimated_compatibility_score=0.95,
    )
    assert bp.blockers == []
    assert bp.signature == ""
    assert bp.fields[0].type == FieldType.FIRST_NAME
