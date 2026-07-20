"""Helpers for deriving indexed job columns from the JSON job document."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_TITLE_HTML_RE = re.compile(r"<[^>]+>")
_TITLE_SENTENCE_SPLIT_RE = re.compile(r"[.!?]\s+")
_DESCRIPTION_START_RE = re.compile(
    r"^(nous |vous |votre |le candidat|missions?\s*:|profil\s*:|description\s*:|contexte\s*:|ce poste )",
    re.IGNORECASE,
)


def _clean_display_title_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    text = _TITLE_HTML_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if "\n" in text:
        for line in text.splitlines():
            candidate = line.strip()
            if candidate:
                text = candidate
                break
    return text or None


def _title_looks_like_description(text: str, *, max_len: int, max_words: int) -> bool:
    if len(text) > max_len:
        return True
    if len(text.split()) > max_words:
        return True
    if len(text) > 70 and _TITLE_SENTENCE_SPLIT_RE.search(text):
        return True
    return bool(_DESCRIPTION_START_RE.match(text))


def _shorten_display_title(text: str, *, max_len: int, max_words: int) -> str:
    if len(text) <= max_len and len(text.split()) <= max_words:
        return text
    if _TITLE_SENTENCE_SPLIT_RE.search(text) and len(text) > 50:
        first = _TITLE_SENTENCE_SPLIT_RE.split(text, maxsplit=1)[0].strip()
        if 8 <= len(first) <= max_len:
            return first
    words = text.split()
    if len(words) > max_words:
        return " ".join(words[:max_words])
    if len(text) > max_len:
        clipped = text[:max_len]
        if " " in clipped:
            return clipped.rsplit(" ", 1)[0].strip(" .,;:-")
        return clipped.strip(" .,;:-")
    return text


def sanitize_display_title(
    value: Any,
    *,
    fallback: Any = None,
    max_len: int = 90,
    max_words: int = 14,
) -> Optional[str]:
    """Keep card titles short; fall back to ROME label when intitule looks like a description."""
    primary = _clean_display_title_text(value)
    backup = _clean_display_title_text(fallback)

    if primary and not _title_looks_like_description(primary, max_len=max_len, max_words=max_words):
        return _shorten_display_title(primary, max_len=max_len, max_words=max_words)
    if backup and not _title_looks_like_description(backup, max_len=max_len, max_words=max_words):
        return _shorten_display_title(backup, max_len=max_len, max_words=max_words)
    if primary:
        return _shorten_display_title(primary, max_len=max_len, max_words=max_words)
    return backup


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


def canonicalize_apply_url(value: Any) -> Optional[str]:
    """Remove transport-only URL variance without changing the destination."""
    if value in (None, ""):
        return None
    try:
        parsed = urlsplit(str(value).strip())
    except ValueError:
        return None
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return None
    tracking_keys = {
        "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "referrer",
        "source", "tracking", "trk",
    }
    retained = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in tracking_keys
    ]
    path = re.sub(r"/+", "/", parsed.path or "/").rstrip("/") or "/"
    port = f":{parsed.port}" if parsed.port else ""
    return urlunsplit((
        parsed.scheme.lower(),
        f"{parsed.hostname.lower()}{port}",
        path,
        urlencode(sorted(retained)),
        "",
    ))


def classify_dedup_pair(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    """Classify occurrences without destructively fuzzy-merging distinct jobs."""
    left_occurrence = (
        str(left.get("provider") or "").strip().lower(),
        str(left.get("external_id") or "").strip(),
    )
    right_occurrence = (
        str(right.get("provider") or "").strip().lower(),
        str(right.get("external_id") or "").strip(),
    )
    if all(left_occurrence) and left_occurrence == right_occurrence:
        return {"classification": "exact_occurrence", "auto_merge": True, "preserve_provenance": True}

    left_url = canonicalize_apply_url(
        left.get("selected_apply_url") or left.get("external_url") or left.get("job_apply_link")
    )
    right_url = canonicalize_apply_url(
        right.get("selected_apply_url") or right.get("external_url") or right.get("job_apply_link")
    )
    left_ats = (str(left.get("ats_provider") or "").lower(), str(left.get("ats_job_id") or ""))
    right_ats = (str(right.get("ats_provider") or "").lower(), str(right.get("ats_job_id") or ""))
    if left_url and left_url == right_url:
        return {"classification": "canonical_url_candidate", "auto_merge": False, "preserve_provenance": True}
    if all(left_ats) and left_ats == right_ats:
        return {"classification": "ats_id_candidate", "auto_merge": False, "preserve_provenance": True}

    left_fingerprint = build_job_fingerprint(left)
    right_fingerprint = build_job_fingerprint(right)
    if left_fingerprint and left_fingerprint == right_fingerprint:
        return {"classification": "fingerprint_candidate", "auto_merge": False, "preserve_provenance": True}
    return {"classification": "distinct", "auto_merge": False, "preserve_provenance": True}


def normalize_company_logo_url(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.startswith("//"):
        return f"https:{text}"
    if text.startswith("/"):
        if text.startswith("/logo-employeur/"):
            return f"https://recrute.francetravail.fr/page-employeur/gw{text}"
        return f"https://www.francetravail.fr{text}"
    if text.lower().startswith(("http://", "https://")):
        return text
    return None


def extract_normalized_job_columns(job_dict: Dict[str, Any]) -> Dict[str, Any]:
    location_parts = _parse_location_parts(job_dict)
    raw_title = _first_present(job_dict, "title", "job_title")
    title = sanitize_display_title(raw_title, fallback=job_dict.get("rome_label"))
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
