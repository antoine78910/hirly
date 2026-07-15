"""Multi-signal submission verification. Success is DETECTED, never presumed.

verified_success requires corroborating positives (>=2 of: confirmation text,
submit control gone, URL/state change, 2xx network) AND no validation errors.
Validation errors or a non-2xx network response is verified_failure. Anything
ambiguous is unverified -- which counts as NOT success against the KPI.
"""
from __future__ import annotations

from .models import SubmissionEvidence, Verdict


def verify(evidence: SubmissionEvidence) -> Verdict:
    if evidence.blocked_reason:
        return Verdict("unverified", reason=f"blocked:{evidence.blocked_reason}")

    if evidence.validation_errors:
        return Verdict("verified_failure", reason="validation_errors",
                       signals={"errors": evidence.validation_errors[:5]})
    if evidence.network_ok is False:
        return Verdict("verified_failure", reason="network_not_ok")

    positives = {
        "confirmation_text": bool(evidence.confirmation_text),
        "submit_control_gone": evidence.submit_control_gone is True,
        "url_changed": evidence.url_changed is True,
        "network_ok": evidence.network_ok is True,
    }
    count = sum(1 for v in positives.values() if v)
    if bool(evidence.confirmation_text) and count >= 2:
        return Verdict("verified_success", reason="confirmed", signals=positives)
    if count >= 3:
        return Verdict("verified_success", reason="corroborated", signals=positives)
    return Verdict("unverified", reason="insufficient_corroboration", signals=positives)
