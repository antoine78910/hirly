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
from .profile_facts import match_select_option

# FieldType -> ordered candidate_context keys to try.
_TYPE_SOURCES: Dict[FieldType, List[str]] = {
    FieldType.FIRST_NAME: ["profile.contact.first_name"],
    FieldType.LAST_NAME: ["profile.contact.last_name"],
    FieldType.FULL_NAME: ["profile.contact.full_name"],
    FieldType.EMAIL: ["profile.contact.email"],
    FieldType.PHONE: ["profile.contact.phone"],
    FieldType.LOCATION: [
        "profile.contact.location",
        "profile.derived.location",
        "profile.application_defaults.city",
        "profile.derived.city",
    ],
    FieldType.LINKEDIN: [
        "profile.contact.linkedin",
        "profile.application_defaults.linkedin_url",
        "profile.derived.linkedin_url",
    ],
    FieldType.WEBSITE: [
        "profile.contact.website",
        "profile.application_defaults.website_url",
        "profile.derived.website_url",
    ],
    FieldType.RESUME: ["application.tailored_cv_file", "profile.cv_file"],
    FieldType.COVER_LETTER: ["application.cover_letter_file"],
    FieldType.SALARY_EXPECTATION: [
        "profile.application_defaults.salary_expectation",
        "profile.derived.salary_expectation",
        "profile.application_answers_profile.salary_expectation",
        "profile.application_answers_profile.salaire_annuel",
    ],
}

# Label heuristics for TEXT / SELECT / CUSTOM / TEXTAREA when FieldType is generic.
# Each entry: (substring needles in canonical label, ordered context keys).
_LABEL_SOURCES: List[Tuple[Tuple[str, ...], List[str]]] = [
    (
        ("annees d experience", "years of experience", "years experience", "annee d experience",
         "nombre d annees", "experience professionnelle", "votre experience"),
        [
            "profile.derived.years_experience_text",
            "profile.derived.years_experience",
            "profile.application_defaults.years_experience",
            "profile.experience_summary.years_experience",
            "profile.derived.experience_bucket",
            "profile.derived.seniority",
        ],
    ),
    (
        ("niveau d etude", "niveau etude", "education level", "highest education",
         "degree level", "niveau de formation", "diplome"),
        [
            "profile.derived.education_level",
            "profile.application_defaults.education_level",
            "profile.education.degree",
            "profile.application_defaults.education_degree",
        ],
    ),
    (
        ("ecole", "universit", "school", "etablissement"),
        ["profile.education.school", "profile.application_defaults.education_school"],
    ),
    (
        ("discipline", "field of study", "filiere", "domaine d etude", "specialite"),
        [
            "profile.education.discipline",
            "profile.application_defaults.education_discipline",
        ],
    ),
    (
        ("annee d obtention", "graduation year", "annee de diplome", "date d obtention"),
        [
            "profile.education.graduation_year",
            "profile.application_defaults.education_graduation_year",
        ],
    ),
    (
        ("disponibilite", "availability", "date de disponibilite", "earliest start",
         "preavis", "notice period", "when can you start"),
        [
            "profile.derived.availability",
            "profile.application_defaults.availability",
            "profile.application_defaults.earliest_start_date",
            "profile.application_answers_profile.availability",
        ],
    ),
    (
        ("ville", "city", "town"),
        [
            "profile.application_defaults.city",
            "profile.derived.city",
            "profile.application_defaults.current_location_city",
        ],
    ),
    (
        ("code postal", "postal", "zip", "postcode"),
        [
            "profile.application_defaults.postal_code",
            "profile.application_defaults.zip",
            "profile.derived.postal_code",
        ],
    ),
    (
        ("pays", "country"),
        [
            "profile.contact.country",
            "profile.application_defaults.country",
            "profile.derived.country",
            "profile.application_defaults.current_location_country",
        ],
    ),
    (
        ("adresse", "address", "street"),
        ["profile.application_defaults.address", "profile.derived.address", "profile.contact.location"],
    ),
    (
        ("poste actuel", "titre actuel", "current title", "job title", "intitule du poste"),
        ["profile.derived.current_title", "profile.experience_summary.current_title", "profile.experience.0.role"],
    ),
    (
        ("employeur actuel", "entreprise actuelle", "current company", "current employer"),
        ["profile.derived.current_company", "profile.experience_summary.current_company", "profile.experience.0.company"],
    ),
    (
        ("motivation", "cover letter", "lettre de motivation", "pourquoi ce poste",
         "pourquoi voulez", "informations complementaires", "message de candidature"),
        ["application.motivation_summary", "application.generated_answers", "profile.derived.summary"],
    ),
    (
        ("competences", "skills", "soft skills"),
        ["profile.derived.skills"],
    ),
    (
        ("langue", "language", "languages"),
        ["profile.derived.languages"],
    ),
    (
        ("linkedin",),
        ["profile.contact.linkedin", "profile.application_defaults.linkedin_url"],
    ),
    (
        ("site web", "website", "portfolio", "github"),
        ["profile.contact.website", "profile.application_defaults.website_url"],
    ),
    (
        ("telephone", "phone", "mobile"),
        ["profile.contact.phone"],
    ),
    (
        ("seniorite", "seniority", "niveau d experience"),
        ["profile.derived.seniority", "profile.derived.experience_bucket"],
    ),
]

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
        "prepared_application_payload.",
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


def _label_source_keys(field: NormalizedField) -> List[str]:
    label = canonical(field.label or field.key or "")
    if not label:
        return []
    keys: List[str] = []
    for needles, sources in _LABEL_SOURCES:
        if any(n in label for n in needles):
            for src in sources:
                if src not in keys:
                    keys.append(src)
    return keys


def _coerce_for_options(value: Any, field: NormalizedField) -> Optional[str]:
    options = list(field.validation.allowed_options or [])
    if not options:
        return None if value in (None, "") else str(value)
    matched = match_select_option(value, options)
    return matched


def _try_resolve(
    field: NormalizedField,
    value: Any,
    source: str,
    profile: Dict[str, Any],
) -> Optional[ResolvedAnswer]:
    if value in (None, ""):
        return None
    options = list(field.validation.allowed_options or [])
    final_value = str(value)
    if options:
        matched = _coerce_for_options(value, field)
        if matched is None:
            # Don't force a free-text value into a constrained select.
            return None
        final_value = matched
    ok, _reason = validate_agent_fill(
        _field_dict(field),
        {"value": final_value, "source": source},
        profile,
    )
    if not ok:
        return None
    return ResolvedAnswer(
        field_key=field.key,
        field_type=field.type,
        value=final_value,
        source=source,
        is_file=field.type in _FILE_TYPES,
    )


def resolve(blueprint, candidate_context: Dict[str, Any], profile: Dict[str, Any]) -> Tuple[List[ResolvedAnswer], List[NormalizedField]]:
    answers: List[ResolvedAnswer] = []
    unresolved: List[NormalizedField] = []

    for field in blueprint.fields:
        if field.type == FieldType.CONSENT:
            # Consent is an irreversible candidate choice. It must be supplied
            # by an exact, versioned candidate mandate rather than inferred by
            # the resolver from the mere presence of a checkbox.
            consent_key = f"candidate_mandate.consent.{field.key}"
            if candidate_context.get(consent_key) is True:
                answers.append(ResolvedAnswer(
                    field_key=field.key,
                    field_type=field.type,
                    value="true",
                    source="candidate_mandate.consent",
                    is_file=False,
                ))
            else:
                unresolved.append(field)
            continue

        source_keys = list(_TYPE_SOURCES.get(field.type, []))
        if field.key == "email_confirm" or (
            field.type == FieldType.EMAIL and "confirm" in canonical(field.label)
        ):
            source_keys = ["profile.contact.email"]
        for key in _label_source_keys(field):
            if key not in source_keys:
                source_keys.append(key)

        if field.validation.sensitive:
            # Prefer application_defaults mirrors so sensitive guardrails pass;
            # profile.derived.* alone is rejected for sensitive fields.
            preferred = [
                k for k in source_keys
                if k.startswith((
                    "profile.application_defaults.",
                    "profile.application_answers_profile.",
                    "prepared_application_payload",
                ))
            ]
            mirrored: List[str] = []
            rest: List[str] = []
            for k in source_keys:
                if k in preferred:
                    continue
                if k.startswith("profile.derived."):
                    mirror = "profile.application_defaults." + k.split("profile.derived.", 1)[-1]
                    if mirror in candidate_context and mirror not in preferred and mirror not in mirrored:
                        mirrored.append(mirror)
                    rest.append(k)
                else:
                    rest.append(k)
            source_keys = preferred + mirrored + rest

        resolved = None
        # Prefer previously answered custom / sensitive questions from profile.
        saved = _profile_saved_value(candidate_context, field)
        if saved is not None:
            saved_source = f"profile.application_answers_profile.{_canonical_key(field.label) or field.key}"
            resolved = _try_resolve(field, saved, saved_source, profile)

        if resolved is None:
            for source in source_keys:
                value = candidate_context.get(source)
                if value in (None, ""):
                    continue
                candidate = _try_resolve(field, value, source, profile)
                if candidate is not None:
                    resolved = candidate
                    break

        if resolved is not None:
            answers.append(resolved)
        elif field.required:
            unresolved.append(field)

    return answers, unresolved
