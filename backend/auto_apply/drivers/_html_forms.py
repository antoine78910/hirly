"""Shared helpers for HTML-template ATS drivers (Taleez, TeamTailor, JobAffinity)."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

from application_blueprint import FieldType, FieldValidation, NormalizedField
from apply_agent.guardrails import canonical

_SENSITIVE_TOKENS = (
    "visa", "sponsor", "authorized to work", "work authorization", "salary",
    "salaire", "compensation", "gender", "race", "ethnicity", "veteran",
    "disability", "disponibilit", "availability", "expérience", "experience",
    "niveau d'étude", "education", "week end", "soirée", "extérieur",
    "distance", "parcourir",
)


def job_http_url(job: Dict[str, Any], *keys: str) -> str:
    data = job.get("data") if isinstance(job.get("data"), dict) else {}
    for source in (job, data):
        for key in keys:
            value = source.get(key)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
    return ""


def host_matches(url: str, *needles: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(n in host for n in needles)


def is_sensitive_label(label: str) -> bool:
    cl = canonical(label)
    return any(token in cl for token in _SENSITIVE_TOKENS)


def classify_label(label: str, *, widget: str = "text") -> FieldType:
    cl = canonical(label)
    if any(t in cl for t in ("cv", "resume", "curriculum")):
        return FieldType.RESUME
    if "cover letter" in cl or "lettre de motivation" in cl or "motivation" in cl:
        return FieldType.COVER_LETTER if "lettre" in cl or "cover" in cl else FieldType.TEXTAREA
    if "linkedin" in cl:
        return FieldType.LINKEDIN
    if "email" in cl or "e-mail" in cl or "mail" == cl:
        return FieldType.EMAIL
    if "phone" in cl or "téléphone" in cl or "telephone" in cl:
        return FieldType.PHONE
    if cl in {"prénom", "prenom", "first name", "firstname"} or "first_name" in cl:
        return FieldType.FIRST_NAME
    if cl in {"nom", "last name", "lastname", "nom de famille"} or "last_name" in cl:
        return FieldType.LAST_NAME
    if "civilité" in cl or "civility" in cl or cl == "title":
        return FieldType.SELECT
    if "salaire" in cl or "salary" in cl:
        return FieldType.SALARY_EXPECTATION
    if widget in {"select", "radio"}:
        return FieldType.SELECT
    if widget in {"checkbox", "boolean"}:
        return FieldType.CHECKBOX
    if widget == "textarea":
        return FieldType.TEXTAREA
    if widget == "file":
        return FieldType.FILE_UPLOAD
    if widget == "date":
        return FieldType.TEXT
    if is_sensitive_label(label):
        return FieldType.CUSTOM_QUESTION
    return FieldType.TEXT


def nf(
    key: str,
    ftype: FieldType,
    *,
    required: bool,
    label: str,
    binding: str,
    options: Optional[List[str]] = None,
    sensitive: Optional[bool] = None,
) -> NormalizedField:
    sens = bool(sensitive) if sensitive is not None else (
        ftype in {FieldType.CUSTOM_QUESTION, FieldType.SALARY_EXPECTATION, FieldType.DEMOGRAPHIC, FieldType.EEOC}
        or is_sensitive_label(label)
    )
    return NormalizedField(
        key=key,
        type=ftype,
        required=required,
        supported=True,
        label=label,
        validation=FieldValidation(
            sensitive=sens,
            allowed_options=list(options or []) or None,
        ),
        binding=binding,
    )


def slug_key(label: str, fallback: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", canonical(label)).strip("_")
    return (base or fallback)[:80]


async def fetch_html(url: str, *, timeout: float = 20.0) -> str:
    if not url:
        return ""
    import httpx
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 HirlyAutoApply/1.0"})
        resp.raise_for_status()
        return resp.text or ""


def absolute_url(base: str, href: str) -> str:
    return urljoin(base, href)
