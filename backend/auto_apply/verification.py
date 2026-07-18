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

    # None = unknown (older evidence); True/False = explicitly observed in gather.
    form_still_open = (evidence.raw or {}).get("form_still_open")
    # "Envoyer" lives in SAP shadow DOM — locator miss ≠ success if form remains.
    submit_gone = evidence.submit_control_gone is True and form_still_open is not True
    positives = {
        "confirmation_text": bool(evidence.confirmation_text),
        "submit_control_gone": submit_gone,
        "url_changed": evidence.url_changed is True,
        "network_ok": evidence.network_ok is True,
        "form_cleared": form_still_open is False and bool(evidence.submit_performed),
    }
    if form_still_open is True and not evidence.confirmation_text:
        return Verdict(
            "unverified",
            reason="form_still_open_after_submit",
            signals=positives,
        )
    count = sum(
        1
        for key in ("confirmation_text", "submit_control_gone", "url_changed", "network_ok")
        if positives.get(key)
    )
    if bool(evidence.confirmation_text) and count >= 2:
        return Verdict("verified_success", reason="confirmed", signals=positives)
    if count >= 3:
        return Verdict("verified_success", reason="corroborated", signals=positives)
    # Explicit form leave + submit control gone + network (SR oneclick URL often stable).
    if (
        positives["form_cleared"]
        and submit_gone
        and evidence.network_ok is True
        and evidence.submit_performed
    ):
        return Verdict("verified_success", reason="form_cleared", signals=positives)
    return Verdict("unverified", reason="insufficient_corroboration", signals=positives)
