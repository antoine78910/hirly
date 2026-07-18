import auto_apply.drivers  # noqa: F401
from auto_apply.driver import DRIVER_REGISTRY
from auto_apply.drivers.jobaffinity import JobAffinityApplyDriver
from auto_apply.drivers.taleez import TaleezApplyDriver
from auto_apply.drivers.teamtailor import TeamtailorApplyDriver, _parse_screening_questions
from auto_apply.resolver import resolve
from application_blueprint import ApplicationBlueprint, Complexity, FieldType, FieldValidation, NormalizedField


def test_new_drivers_registered():
    assert DRIVER_REGISTRY.for_job({"ats_provider": "taleez"}) is not None
    assert DRIVER_REGISTRY.for_job({"ats_provider": "teamtailor"}) is not None
    assert DRIVER_REGISTRY.for_job({"ats_provider": "jobaffinity"}) is not None


def test_taleez_standard_blueprint_has_contact_and_cv():
    d = TaleezApplyDriver()
    import asyncio
    bp = asyncio.run(d.inspect_application({"ats_provider": "taleez"}))
    keys = {f.key for f in bp.fields}
    assert {"first_name", "last_name", "email", "phone", "resume"}.issubset(keys)


def test_jobaffinity_blueprint_includes_civility():
    d = JobAffinityApplyDriver()
    import asyncio
    bp = asyncio.run(d.inspect_application({"ats_provider": "jobaffinity"}))
    by_key = {f.key: f for f in bp.fields}
    assert by_key["title"].type == FieldType.SELECT
    assert by_key["title"].required is True


def test_teamtailor_parses_boolean_screening_questions():
    html = '''
    <div class="question mb-12" data-question-uuid="abc-123" data-question-mandatory="true" data-question-multiple-choice="false">
      <input type="hidden" value="1" name="candidate[answers_attributes][0][question_id]">
      <fieldset>
        <legend><span class="block">Acceptez vous de travailler le week end ?</span></legend>
        <input type="radio" value="true" name="candidate[answers_attributes][0][boolean]">
        <input type="radio" value="false" name="candidate[answers_attributes][0][boolean]">
      </fieldset>
    </div>
    </div>
    '''
    fields = _parse_screening_questions(html)
    assert len(fields) == 1
    assert fields[0].required is True
    assert fields[0].type == FieldType.CHECKBOX
    assert "week end" in fields[0].label.lower()


def test_resolver_reuses_saved_profile_answer_for_sensitive_question():
    fields = [
        NormalizedField(
            "q_weekend", FieldType.CHECKBOX, required=True, supported=True,
            label="Acceptez vous de travailler le week end ?",
            validation=FieldValidation(sensitive=True),
        ),
    ]
    bp = ApplicationBlueprint(
        provider="teamtailor", fields=fields, complexity=Complexity.STANDARD,
        estimated_compatibility_score=0.5,
    )
    ctx = {
        "profile.application_answers_profile.acceptez_vous_de_travailler_le_week_end": "true",
    }
    answers, unresolved = resolve(bp, ctx, profile={})
    assert unresolved == []
    assert answers[0].value == "true"
