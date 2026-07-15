from application_blueprint import (
    ApplicationBlueprint, Complexity, FieldType, FieldValidation, NormalizedField,
    derive_complexity, estimate_compatibility_score,
)
from auto_apply.classifier import classify


def _bp(fields, blockers=None):
    bl = blockers or []
    return ApplicationBlueprint(
        provider="greenhouse", fields=fields, complexity=derive_complexity(fields),
        estimated_compatibility_score=estimate_compatibility_score(fields, bl),
        blockers=bl, signature="sig1",
    )


def _std():
    return [
        NormalizedField("first_name", FieldType.FIRST_NAME, required=True, supported=True),
        NormalizedField("email", FieldType.EMAIL, required=True, supported=True),
        NormalizedField("resume", FieldType.RESUME, required=True, supported=True),
    ]


def test_trivial_supported_form_is_eligible():
    assert classify(_bp(_std())).eligible is True


def test_blocker_is_hard_veto():
    d = classify(_bp(_std(), blockers=["captcha_detected"]))
    assert d.eligible is False and "block" in d.reason.lower()


def test_unsupported_required_field_is_ineligible():
    fields = _std() + [NormalizedField("weird", FieldType.UNKNOWN, required=True, supported=False)]
    assert classify(_bp(fields)).eligible is False


def test_sensitive_required_without_answer_is_ineligible():
    fields = _std() + [NormalizedField("visa", FieldType.VISA_STATUS, required=True, supported=True,
                                       validation=FieldValidation(sensitive=True))]
    assert classify(_bp(fields)).eligible is False


def test_complex_but_all_supported_is_not_auto_rejected():
    # Many optional custom questions -> COMPLEX-ish, but all required fields supported.
    fields = _std() + [
        NormalizedField(f"q{i}", FieldType.TEXTAREA, required=False, supported=True)
        for i in range(6)
    ]
    d = classify(_bp(fields))
    assert d.eligible is True


def test_known_successful_signature_boosts_confidence():
    fields = _std()
    bp = _bp(fields)
    d = classify(bp, known_successful_signatures=frozenset({"sig1"}))
    assert d.eligible is True and d.signals.get("known_signature") is True
