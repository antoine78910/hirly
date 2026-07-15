"""ATS-agnostic eligibility classification from an ApplicationBlueprint.

Complexity is ONE signal among several -- never a veto. Hard vetoes are only:
a detected blocker, or a REQUIRED field we cannot fill safely (unsupported, or
sensitive with no saved answer). Everything else contributes to a confidence
score compared against a threshold.
"""
from __future__ import annotations

from application_blueprint import Complexity
from .models import EligibilityDecision


def classify(blueprint, *, known_successful_signatures=frozenset(), threshold: float = 0.7) -> EligibilityDecision:
    signals = {}

    if blueprint.blockers:
        return EligibilityDecision(False, reason=f"blocker_present:{blueprint.blockers[0]}",
                                   score=0.0, signals={"blockers": list(blueprint.blockers)})

    for f in blueprint.fields:
        if not f.required:
            continue
        if not f.supported:
            return EligibilityDecision(False, reason=f"required_unsupported:{f.key}", score=0.0,
                                       signals={"unsupported_required": f.key})
        if f.validation.sensitive:
            return EligibilityDecision(False, reason=f"required_sensitive_no_answer:{f.key}", score=0.0,
                                       signals={"sensitive_required": f.key})

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
    return EligibilityDecision(eligible, reason="eligible" if eligible else "below_threshold",
                               score=round(score, 3), signals=signals)
