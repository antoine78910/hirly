"""ATS-agnostic eligibility classification from an ApplicationBlueprint.

Emits a crisp 3-way category (never a single opaque "ineligible"):

- UNSUPPORTED      -> Hirly can't handle it yet: a detected blocker (CAPTCHA /
                      login wall) or a REQUIRED field whose widget type we can't
                      fill. These wait for future driver support.
- NEEDS_USER_INPUT -> a REQUIRED sensitive field (visa / salary / demographic)
                      that only the user can answer. Recoverable: once the user
                      provides it, the job becomes eligible. Carries the missing
                      field keys.
- ELIGIBLE         -> all required fields are supported and fillable now.

Complexity is ONE signal among several -- never a veto.
"""
from __future__ import annotations

from application_blueprint import Complexity
from .models import ELIGIBLE, NEEDS_USER_INPUT, UNSUPPORTED, EligibilityDecision


def classify(blueprint, *, known_successful_signatures=frozenset(), threshold: float = 0.7) -> EligibilityDecision:
    signals = {}

    if blueprint.blockers:
        return EligibilityDecision(False, reason=f"blocker_present:{blueprint.blockers[0]}",
                                   score=0.0, signals={"blockers": list(blueprint.blockers)},
                                   category=UNSUPPORTED)

    missing_user_fields = []
    for f in blueprint.fields:
        if not f.required:
            continue
        if not f.supported:
            return EligibilityDecision(False, reason=f"required_unsupported:{f.key}", score=0.0,
                                       signals={"unsupported_required": f.key}, category=UNSUPPORTED)
        if f.validation.sensitive:
            missing_user_fields.append(f.key)

    if missing_user_fields:
        return EligibilityDecision(
            False, reason="needs_user_input:" + ",".join(missing_user_fields[:5]),
            score=round(float(blueprint.estimated_compatibility_score), 3),
            signals={"missing_fields": missing_user_fields}, category=NEEDS_USER_INPUT,
        )

    score = float(blueprint.estimated_compatibility_score)
    signals["compatibility_score"] = score
    signals["complexity"] = blueprint.complexity.value

    known = bool(blueprint.signature) and blueprint.signature in known_successful_signatures
    signals["known_signature"] = known
    if known:
        score = max(score, 0.95)
    if blueprint.complexity == Complexity.COMPLEX and not known:
        score -= 0.1

    eligible = score >= threshold
    if eligible:
        return EligibilityDecision(True, reason="eligible", score=round(score, 3),
                                   signals=signals, category=ELIGIBLE)
    # Below-confidence with no specific missing user field -> Hirly won't submit
    # confidently; treat as unsupported (waits) rather than blaming the user.
    return EligibilityDecision(False, reason="below_threshold", score=round(score, 3),
                               signals=signals, category=UNSUPPORTED)
