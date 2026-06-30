"""Helpers for deriving indexed job columns from the JSON job document."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any, Dict, Optional


def normalize_text(value: Any) -> Optional[str]:
    """Return a stable lowercase ASCII-ish token string for search/dedupe."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def normalize_company_name(value: Any) -> Optional[str]:
    text = normalize_text(value)
    if not text:
        return None
    suffixes = {
        "inc",
        "incorporated",
        "llc",
        "ltd",
        "limited",
        "corp",
        "corporation",
        "co",
        "company",
        "sa",
        "sas",
        "sarl",
        "gmbh",
        "plc",
    }
    parts = [part for part in text.split() if part not in suffixes]
    return " ".join(parts) or text


def normalize_title(value: Any) -> Optional[str]:
    text = normalize_text(value)
    if not text:
        return None
    replacements = {
        "sr": "senior",
        "jr": "junior",
        "mgr": "manager",
    }
    return " ".join(replacements.get(part, part) for part in text.split())


def _first_present(job: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = job.get(key)
        if value not in (None, ""):
            return value
    return None


def _as_bool(value: Any) -> Optional[bool]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "remote"}:
        return True
    if text in {"false", "0", "no", "onsite", "hybrid"}:
        return False
    return None


def _parse_location_parts(job: Dict[str, Any]) -> Dict[str, Optional[str]]:
    city = _first_present(job, "city", "job_city")
    region = _first_present(job, "region", "state", "job_state")
    country_code = _first_present(job, "country_code", "job_country_code")
    location = _first_present(job, "location", "job_location")

    if location and not city:
        parts = [part.strip() for part in str(location).split(",") if part.strip()]
        if parts:
            city = parts[0]
        if len(parts) >= 2 and not region:
            region = parts[1]
        if len(parts) >= 3 and not country_code:
            country_code = parts[-1]

    country_text = normalize_text(country_code)
    country_map = {
        "france": "fr",
        "united states": "us",
        "usa": "us",
        "united kingdom": "gb",
        "uk": "gb",
        "great britain": "gb",
        "morocco": "ma",
        "maroc": "ma",
    }
    if country_text in country_map:
        country_code = country_map[country_text]
    elif country_code:
        normalized_country = str(country_code).strip().lower()
        country_code = normalized_country if len(normalized_country) <= 3 else None

    return {
        "city": str(city).strip() if city not in (None, "") else None,
        "region": str(region).strip() if region not in (None, "") else None,
        "country_code": str(country_code).strip().lower() if country_code not in (None, "") else None,
    }


def build_job_fingerprint(job_dict: Dict[str, Any]) -> Optional[str]:
    normalized_company = normalize_company_name(job_dict.get("company") or job_dict.get("employer_name"))
    normalized_job_title = normalize_title(job_dict.get("title") or job_dict.get("job_title"))
    if not normalized_company or not normalized_job_title:
        return None

    location_parts = _parse_location_parts(job_dict)
    contract_type = normalize_text(_first_present(job_dict, "contract_type", "employment_type", "job_type"))
    description = normalize_text(job_dict.get("description") or job_dict.get("job_description")) or ""
    description = description[:500]
    bits = [
        normalized_company,
        normalized_job_title,
        normalize_text(location_parts.get("city")) or "",
        normalize_text(location_parts.get("region")) or "",
        normalize_text(location_parts.get("country_code")) or "",
        contract_type or "",
        description,
    ]
    raw = "|".join(bits)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def extract_normalized_job_columns(job_dict: Dict[str, Any]) -> Dict[str, Any]:
    location_parts = _parse_location_parts(job_dict)
    title = _first_present(job_dict, "title", "job_title")
    company = _first_present(job_dict, "company", "employer_name")
    selected_apply_url = _first_present(job_dict, "selected_apply_url", "external_url", "job_apply_link")
    return {
        "title": title,
        "normalized_title": normalize_title(title),
        "company": company,
        "normalized_company": normalize_company_name(company),
        "location": _first_present(job_dict, "location", "job_location"),
        "city": location_parts.get("city"),
        "region": location_parts.get("region"),
        "country_code": location_parts.get("country_code"),
        "remote": _as_bool(job_dict.get("remote")),
        "salary_min": _first_present(job_dict, "salary_min", "job_min_salary"),
        "salary_max": _first_present(job_dict, "salary_max", "job_max_salary"),
        "currency": _first_present(job_dict, "currency", "job_salary_currency"),
        "posted_at": _first_present(job_dict, "posted_at"),
        "imported_at": _first_present(job_dict, "imported_at"),
        "last_seen_at": _first_present(job_dict, "last_seen_at"),
        "provider_search_key": job_dict.get("provider_search_key"),
        "ats_provider": job_dict.get("ats_provider"),
        "auto_apply_supported": _as_bool(job_dict.get("auto_apply_supported")),
        "manual_fulfillment_ready": _as_bool(job_dict.get("manual_fulfillment_ready")),
        "apply_fulfillment_status": job_dict.get("apply_fulfillment_status"),
        "apply_url_provider": job_dict.get("apply_url_provider"),
        "selected_apply_url": selected_apply_url,
        "validation_status": job_dict.get("validation_status"),
        "validation_reason": job_dict.get("validation_reason"),
        "validation_checked_at": job_dict.get("validation_checked_at"),
        "requires_login": _as_bool(job_dict.get("requires_login")),
        "requires_account_creation": _as_bool(job_dict.get("requires_account_creation")),
        "captcha_detected": _as_bool(job_dict.get("captcha_detected")),
        "has_cv_upload": _as_bool(job_dict.get("has_cv_upload")),
        "has_cover_letter": _as_bool(job_dict.get("has_cover_letter")),
        "has_custom_questions": _as_bool(job_dict.get("has_custom_questions")),
        "applyability_score": job_dict.get("applyability_score"),
        "applyability_tier": job_dict.get("applyability_tier"),
        "rejection_reason": job_dict.get("rejection_reason"),
        "fingerprint": job_dict.get("fingerprint") or build_job_fingerprint(job_dict),
    }
