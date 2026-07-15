from auto_apply.models import SubmissionEvidence
from auto_apply.verification import verify


def test_confirmation_plus_control_gone_is_success():
    ev = SubmissionEvidence(submit_performed=True, confirmation_text="thank you for applying",
                            submit_control_gone=True, url_changed=True, network_ok=True)
    assert verify(ev).status == "verified_success"


def test_validation_errors_is_failure():
    ev = SubmissionEvidence(submit_performed=True, validation_errors=["Email is required"])
    assert verify(ev).status == "verified_failure"


def test_network_not_ok_is_failure():
    ev = SubmissionEvidence(submit_performed=True, network_ok=False)
    assert verify(ev).status == "verified_failure"


def test_single_weak_signal_is_unverified():
    # Only URL changed, nothing else corroborating -> not enough.
    ev = SubmissionEvidence(submit_performed=True, url_changed=True)
    assert verify(ev).status == "unverified"


def test_blocked_is_unverified():
    ev = SubmissionEvidence(submit_performed=False, blocked_reason="login_wall")
    v = verify(ev)
    assert v.status == "unverified" and "block" in v.reason.lower()
