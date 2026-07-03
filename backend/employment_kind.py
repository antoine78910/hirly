"""Contract / employment-type classification and feed filter matching."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Mapping, Optional, Sequence

JOB_TYPE_FILTER_VALUES = (
    "full_time",
    "part_time",
    "internship",
    "fixed_term",
    "apprenticeship",
    "summer_job",
    "seasonal",
    "freelance",
)

CONTRACT_TYPE_TO_JOB_TYPES: Dict[str, List[str]] = {
    "permanent": ["full_time"],
    "fixed_term": ["fixed_term"],
    "internship": ["internship"],
    "apprenticeship": ["apprenticeship"],
    "summer_job": ["summer_job"],
    "part_time": ["part_time"],
    "seasonal": ["seasonal"],
    "freelance": ["freelance"],
}

CONTRACT_TYPE_QUERY_HINTS: Dict[str, str] = {
    "permanent": "CDI",
    "fixed_term": "CDD",
    "internship": "stage",
    "apprenticeship": "alternance",
    "summer_job": "job été",
    "part_time": "temps partiel",
    "seasonal": "saisonnier",
    "freelance": "freelance",
}

JOB_TYPE_ALIASES: Dict[str, List[str]] = {
    "full_time": [
        "full time", "full-time", "permanent", "cdi", "temps plein",
        "contrat a duree indeterminee", "duree indeterminee",
    ],
    "part_time": ["part time", "part-time", "temps partiel", "mi temps", "mi-temps"],
    "internship": ["intern", "internship", "stage", "stagiaire", "stages"],
    "fixed_term": [
        "fixed term", "fixed-term", "cdd", "temporary", "interim", "interim",
        "contrat a duree determinee", "duree determinee",
    ],
    "apprenticeship": [
        "apprenticeship", "alternance", "apprentissage", "contrat pro",
        "contrat de professionnalisation", "work study", "work-study",
    ],
    "summer_job": [
        "summer job", "summer work", "job d ete", "job d'ete", "job ete",
        "emploi estival", "saison estivale", "student summer",
    ],
    "seasonal": [
        "seasonal", "saisonnier", "saisonniere", "vendanges", "harvest",
        "grape harvest", "tourist season", "holiday season",
    ],
    "freelance": [
        "freelance", "contractor", "independent", "self employed",
        "portage", "consultant mission",
    ],
}

_CLASSIFY_ORDER = (
    "apprenticeship",
    "internship",
    "summer_job",
    "seasonal",
    "fixed_term",
    "part_time",
    "freelance",
    "full_time",
)


def _normalize_match_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def resolve_profile_contract_type(profile: Optional[Mapping[str, Any]]) -> str:
    if not profile:
        return ""
    direct = str(profile.get("contract_type") or "").strip()
    if direct:
        return direct
    extras = profile.get("extras") if isinstance(profile.get("extras"), dict) else {}
    onboarding = extras.get("onboarding") if isinstance(extras.get("onboarding"), dict) else {}
    return str(onboarding.get("contract_type") or "").strip()


def contract_type_to_job_types(contract_type: Optional[str]) -> List[str]:
    key = str(contract_type or "").strip().lower()
    if not key:
        return []
    return list(CONTRACT_TYPE_TO_JOB_TYPES.get(key, []))


def contract_type_query_hint(contract_type: Optional[str]) -> Optional[str]:
    key = str(contract_type or "").strip().lower()
    if not key:
        return None
    return CONTRACT_TYPE_QUERY_HINTS.get(key)


def _job_contract_text(job: Mapping[str, Any]) -> str:
    parts = [
        job.get("employment_kind"),
        job.get("job_type"),
        job.get("employment_type"),
        job.get("contract_type"),
        job.get("title"),
        job.get("description"),
        job.get("clean_description"),
    ]
    return _normalize_match_text(" ".join(str(part) for part in parts if part))


def classify_employment_kind(job: Mapping[str, Any]) -> Optional[str]:
    text = _job_contract_text(job)
    if not text:
        return None
    best_kind: Optional[str] = None
    best_score = 0
    for kind in _CLASSIFY_ORDER:
        aliases = JOB_TYPE_ALIASES.get(kind, [])
        score = 0
        for alias in aliases:
            normalized_alias = _normalize_match_text(alias)
            if normalized_alias and normalized_alias in text:
                score += 4 if " " in normalized_alias else 3
        if score > best_score:
            best_score = score
            best_kind = kind
    return best_kind if best_score >= 3 else None


def enrich_job_employment_kind(job: Dict[str, Any]) -> Dict[str, Any]:
    if job.get("employment_kind"):
        return job
    kind = classify_employment_kind(job)
    if kind:
        job = dict(job)
        job["employment_kind"] = kind
    return job


def job_matches_job_types(job: Mapping[str, Any], job_types: Optional[Sequence[str]]) -> bool:
    wanted = [str(item).strip().lower() for item in (job_types or []) if str(item).strip()]
    if not wanted:
        return True
    kind = str(job.get("employment_kind") or classify_employment_kind(job) or "").strip().lower()
    if kind and kind in wanted:
        return True
    text = _job_contract_text(job)
    if not text:
        return False
    return any(
        any(_normalize_match_text(alias) in text for alias in JOB_TYPE_ALIASES.get(kind_key, [kind_key]))
        for kind_key in wanted
    )


def employment_kind_rank_bonus(job: Mapping[str, Any], job_types: Optional[Sequence[str]]) -> int:
    wanted = [str(item).strip().lower() for item in (job_types or []) if str(item).strip()]
    if not wanted:
        return 0
    kind = str(job.get("employment_kind") or classify_employment_kind(job) or "").strip().lower()
    if not kind:
        return 0
    if kind in wanted:
        return 20
    return -25
