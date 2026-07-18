"""Deterministic, ATS-agnostic answer resolution.

Maps a candidate_context (produced by apply_agent.agent.build_candidate_context)
onto each blueprint NormalizedField BY FieldType. Every candidate value passes
guardrails.validate_agent_fill before it becomes a ResolvedAnswer. No LLM: a
required field that can't be resolved deterministically is returned as
unresolved (-> the executor marks the job needs_user_input), never guessed.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from application_blueprint import FieldType, NormalizedField
from apply_agent.guardrails import canonical, validate_agent_fill

from .models import ResolvedAnswer

# FieldType -> ordered candidate_context keys to try.
_TYPE_SOURCES: Dict[FieldType, List[str]] = {
    FieldType.FIRST_NAME: ["profile.contact.first_name"],
    FieldType.LAST_NAME: ["profile.contact.last_name"],
    FieldType.FULL_NAME: ["profile.contact.full_name"],
    FieldType.EMAIL: ["profile.contact.email"],
    FieldType.PHONE: ["profile.contact.phone"],
    FieldType.LOCATION: ["profile.contact.location"],
    FieldType.LINKEDIN: ["profile.contact.linkedin"],
    FieldType.WEBSITE: ["profile.contact.website"],
    FieldType.RESUME: ["application.tailored_cv_file", "profile.cv_file"],
    FieldType.COVER_LETTER: ["application.cover_letter_file"],
    FieldType.SALARY_EXPECTATION: [
        "profile.application_defaults.salary_expectation",
        "profile.application_answers_profile.salary_expectation",
        "profile.application_answers_profile.salaire_annuel",
    ],
}

_FILE_TYPES = {FieldType.RESUME, FieldType.COVER_LETTER, FieldType.FILE_UPLOAD}


def _field_dict(field: NormalizedField) -> Dict[str, Any]:
    # Shape guardrails.validate_agent_fill / is_sensitive_field expect.
    return {
        "name": field.key,
        "label": field.label,
        "type": field.type.value,
        "required": field.required,
        "options": [{"label": o, "value": o} for o in (field.validation.allowed_options or [])],
        "_sensitive": field.validation.sensitive,
    }


def _canonical_key(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def _profile_saved_value(candidate_context: Dict[str, Any], field: NormalizedField) -> Optional[str]:
    """Reuse answers previously saved on the profile / application for this label."""
    candidates = [
        _canonical_key(field.label),
        _canonical_key(field.key),
        field.key,
    ]
    prefixes = (
        "profile.application_answers_profile.",
        "application.prepared_application_payload.",
        "profile.application_defaults.",
    )
    for prefix in prefixes:
        for key in candidates:
            if not key:
                continue
            value = candidate_context.get(f"{prefix}{key}")
            if value not in (None, ""):
                return str(value)
    # Fuzzy: any saved profile answer whose canonical label matches this field.
    needle = _canonical_key(field.label)
    if not needle:
        return None
    for ctx_key, value in candidate_context.items():
        if value in (None, ""):
            continue
        if not ctx_key.startswith("profile.application_answers_profile."):
            continue
        saved = ctx_key.split("profile.application_answers_profile.", 1)[-1]
        if saved == needle or needle in saved or saved in needle:
            return str(value)
    return None


def resolve(blueprint, candidate_context: Dict[str, Any], profile: Dict[str, Any]) -> Tuple[List[ResolvedAnswer], List[NormalizedField]]:
    answers: List[ResolvedAnswer] = []
    unresolved: List[NormalizedField] = []

    for field in blueprint.fields:
        source_keys = list(_TYPE_SOURCES.get(field.type, []))
        if field.key == "email_confirm" or (
            field.type == FieldType.EMAIL and "confirm" in canonical(field.label)
        ):
            source_keys = ["profile.contact.email"]
        if field.type == FieldType.CONSENT:
            answers.append(ResolvedAnswer(
                field_key=field.key, field_type=field.type, value="true",
                source="auto_apply.consent", is_file=False,
            ))
            continue

        resolved = None
        # Prefer previously answered custom / sensitive questions from profile.
        saved = _profile_saved_value(candidate_context, field)
        if saved is not None:
            saved_source = f"profile.application_answers_profile.{_canonical_key(field.label) or field.key}"
            ok, _reason = validate_agent_fill(
                _field_dict(field),
                {"value": saved, "source": saved_source},
                profile,
            )
            if ok:
                resolved = ResolvedAnswer(
                    field_key=field.key, field_type=field.type, value=saved,
                    source=saved_source,
                    is_file=field.type in _FILE_TYPES,
                )

        if resolved is None and not field.validation.sensitive:
            for source in source_keys:
                value = candidate_context.get(source)
                if value in (None, ""):
                    continue
                ok, _reason = validate_agent_fill(_field_dict(field), {"value": value, "source": source}, profile)
                if ok:
                    resolved = ResolvedAnswer(
                        field_key=field.key, field_type=field.type, value=str(value),
                        source=source, is_file=field.type in _FILE_TYPES,
                    )
                    break
        elif resolved is None and field.validation.sensitive:
            # Sensitive fields may still come from explicit type sources (salary defaults).
            for source in source_keys:
                value = candidate_context.get(source)
                if value in (None, ""):
                    continue
                ok, _reason = validate_agent_fill(_field_dict(field), {"value": value, "source": source}, profile)
                if ok:
                    resolved = ResolvedAnswer(
                        field_key=field.key, field_type=field.type, value=str(value),
                        source=source, is_file=False,
                    )
                    break

        if resolved is not None:
            answers.append(resolved)
        elif field.required:
            unresolved.append(field)

    return answers, unresolved
