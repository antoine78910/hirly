from application_blueprint import FieldType, NormalizedField
from auto_apply.models import (
    ApplicationPlan, PlanStep, ResolvedAnswer, SubmissionEvidence, Verdict,
    EligibilityDecision, compute_blueprint_signature,
)


def test_planstep_defaults_and_plan_holds_steps():
    step = PlanStep(action="fill", locators=['[name="job_application[email]"]'], value="a@b.co", source="profile.contact.email")
    plan = ApplicationPlan(steps=[step], blueprint_signature="sig")
    assert plan.steps[0].action == "fill"
    assert plan.steps[0].file_role is None
    assert plan.blueprint_signature == "sig"


def test_evidence_and_verdict_defaults():
    ev = SubmissionEvidence(submit_performed=True)
    assert ev.validation_errors == [] and ev.raw == {}
    v = Verdict(status="verified_success")
    assert v.reason == "" and v.signals == {}


def test_eligibility_decision_shape():
    d = EligibilityDecision(eligible=True, reason="ok", score=0.95)
    assert d.eligible is True and d.signals == {}


def test_signature_is_stable_and_order_independent():
    a = [NormalizedField("first_name", FieldType.FIRST_NAME, required=True, supported=True),
         NormalizedField("email", FieldType.EMAIL, required=True, supported=True)]
    b = list(reversed(a))
    assert compute_blueprint_signature(a) == compute_blueprint_signature(b)
    assert isinstance(compute_blueprint_signature(a), str) and compute_blueprint_signature(a)
