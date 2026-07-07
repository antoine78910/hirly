"""Safety rules that constrain the agent -- enforced in code, not just prompted.

The agent proposes fills; nothing here trusts that proposal at face value.
Every fill must carry a `source` that traces back to one of the APPROVED_
SOURCE_PREFIXES below. Sensitive/legal fields additionally require the value
to already exist as an explicit saved default -- the agent is never allowed
to invent an answer to a visa/sponsorship/salary/demographic question.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

SENSITIVE_PATTERNS = (
    "visa",
    "sponsor",
    "sponsorship",
    "authorized to work",
    "work authorization",
    "salary",
    "compensation",
    "relocation",
    "criminal",
    "felony",
    "non compete",
    "non solicitation",
    "former employer",
    "third party",
    "disability",
    "veteran",
    "gender",
    "race",
    "ethnicity",
    "hispanic",
    "pronoun",
    "sexual orientation",
)

# Every fill the agent proposes must have a `source` starting with one of
# these. Anything else (e.g. the agent explaining its own guess) is rejected
# outright regardless of how plausible the value looks.
APPROVED_SOURCE_PREFIXES = (
    "profile.contact.",
    "profile.application_defaults.",
    "profile.application_answers_profile.",
    "profile.education",
    "application.tailored_cv_file",
    "application.cover_letter_file",
    "application.generated_answers",
    "application.motivation_summary",
    "prepared_application_payload",
    "safe_default.",
)


def canonical(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def is_sensitive_field(field: Dict[str, Any]) -> bool:
    haystack = canonical(" ".join(str(field.get(key) or "") for key in (
        "name",
        "id",
        "label",
        "placeholder",
        "aria_label",
        "nearby_text",
        "field_container_text",
    )))
    return any(pattern in haystack for pattern in SENSITIVE_PATTERNS)


def validate_agent_fill(field: Dict[str, Any], proposed: Dict[str, Any], profile: Dict[str, Any]) -> tuple[bool, str]:
    """Hard gate between the agent's proposal and actually typing it into the
    page. Returns (is_valid, reason). A False result must never be filled.
    """
    value = proposed.get("value")
    source = str(proposed.get("source") or "")
    if value in (None, ""):
        return False, "empty_value"
    if not source:
        return False, "missing_source_attribution"
    if not any(source.startswith(prefix) for prefix in APPROVED_SOURCE_PREFIXES):
        return False, f"unapproved_source:{source}"

    if is_sensitive_field(field):
        # Sensitive/legal fields may only be filled from an explicit saved
        # default or a pre-approved decline option -- never a freshly
        # generated/inferred value, no matter how confident the agent is.
        allowed_sensitive_prefixes = (
            "profile.application_defaults.",
            "profile.application_answers_profile.",
            "prepared_application_payload",
            "safe_default.eeo_decline",
        )
        if not any(source.startswith(prefix) for prefix in allowed_sensitive_prefixes):
            return False, "sensitive_field_requires_explicit_saved_default"

    return True, ""


def decline_option_value(field: Dict[str, Any]) -> Optional[str]:
    """For EEO/demographic fields with a decline-to-answer option, return its
    exact option value so we select the real widget option rather than
    typing free text into a constrained control.
    """
    decline_labels = (
        "prefer not to say",
        "decline to self identify",
        "decline to self-identify",
        "i do not wish to answer",
        "i don't wish to answer",
        "choose not to disclose",
        "not listed",
    )
    for option in field.get("options") or []:
        label = canonical(option.get("label") if isinstance(option, dict) else option)
        if any(decline in label for decline in decline_labels):
            return str(option.get("value") or option.get("label")) if isinstance(option, dict) else str(option)
    return None
