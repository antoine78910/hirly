"""Deterministic, ATS-agnostic answer resolution.

Maps a candidate_context (produced by apply_agent.agent.build_candidate_context)
onto each blueprint NormalizedField BY FieldType. Every candidate value passes
guardrails.validate_agent_fill before it becomes a ResolvedAnswer. No LLM: a
required field that can't be resolved deterministically is returned as
unresolved (-> the executor marks the job needs_user_input), never guessed.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

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
    FieldType.RESUME: ["application.tailored_cv_file"],
    FieldType.COVER_LETTER: ["application.cover_letter_file"],
}

_FILE_TYPES = {FieldType.RESUME, FieldType.COVER_LETTER}


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


def resolve(blueprint, candidate_context: Dict[str, Any], profile: Dict[str, Any]) -> Tuple[List[ResolvedAnswer], List[NormalizedField]]:
    answers: List[ResolvedAnswer] = []
    unresolved: List[NormalizedField] = []

    for field in blueprint.fields:
        # Sensitive fields are handled only via saved-answer sources, which are
        # not in the generic _TYPE_SOURCES map -> they never resolve here.
        source_keys = [] if field.validation.sensitive else _TYPE_SOURCES.get(field.type, [])
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
        if resolved is not None:
            answers.append(resolved)
        elif field.required:
            unresolved.append(field)

    return answers, unresolved
