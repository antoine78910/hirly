"""Field matching for browser-based application filling."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from application_documents import cover_letter_to_text


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
    "disability",
    "veteran",
    "gender",
    "race",
    "ethnicity",
    "hispanic",
    "pronoun",
    "sexual orientation",
)


def canonical(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def is_sensitive_field(field: Dict[str, Any]) -> bool:
    haystack = canonical(" ".join(str(field.get(key) or "") for key in ("name", "label", "placeholder")))
    return any(pattern in haystack for pattern in SENSITIVE_PATTERNS)


def generated_answer_map(app_doc: Dict[str, Any]) -> Dict[str, str]:
    answers: Dict[str, str] = {}
    for item in app_doc.get("prepared_generated_answers") or app_doc.get("application_answers") or []:
        if not isinstance(item, dict):
            continue
        answer = item.get("answer")
        if not answer:
            continue
        for key in ("field_name", "question", "label"):
            if item.get(key):
                answers[canonical(item[key])] = str(answer)
    return answers


def application_summary_text(app_doc: Dict[str, Any]) -> str:
    cover_letter = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
    if cover_letter.strip():
        return cover_letter.strip()
    structured = app_doc.get("tailored_resume_structured") or {}
    if isinstance(structured, dict):
        for key in ("summary", "professional_summary", "profile_summary"):
            value = structured.get(key)
            if value:
                return str(value).strip()
    return ""


def contact_values(profile: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, str]:
    contact = profile.get("contact") or {}
    name = str(contact.get("name") or user.get("name") or "").strip()
    first_name, last_name = split_name(name)
    location_data = profile.get("target_location_data") or {}
    location = (
        contact.get("location")
        or location_data.get("location_label")
        or profile.get("target_location")
        or ""
    )
    return {
        "name": name,
        "full name": name,
        "first name": first_name,
        "given name": first_name,
        "last name": last_name,
        "family name": last_name,
        "surname": last_name,
        "email": str(contact.get("email") or user.get("email") or "").strip(),
        "phone": str(contact.get("phone") or "").strip(),
        "mobile": str(contact.get("phone") or "").strip(),
        "location": str(location or "").strip(),
        "address": str(location or "").strip(),
        "linkedin": str(contact.get("linkedin") or "").strip(),
        "website": str(contact.get("website") or "").strip(),
        "portfolio": str(contact.get("website") or "").strip(),
    }


def split_name(name: str) -> tuple[str, str]:
    parts = [part for part in str(name or "").split() if part]
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def match_field(
    field: Dict[str, Any],
    profile: Dict[str, Any],
    app_doc: Dict[str, Any],
    user: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if field.get("disabled") or not field.get("visible"):
        return None

    field_type = str(field.get("type") or "text").lower()
    raw_label = " ".join(str(field.get(key) or "") for key in ("name", "label", "placeholder"))
    raw_label_lower = raw_label.lower()
    label = canonical(raw_label)
    values = contact_values(profile, user)
    generated = generated_answer_map(app_doc)
    summary = application_summary_text(app_doc)

    if field_type == "file":
        if "cover" in label and "letter" in label:
            return {"value": "__cover_letter_file__", "source": "tailored_cover_letter", "confidence": 0.9}
        if "resume" in label or "cv" in label or "upload" in label:
            return {"value": "__resume_file__", "source": "tailored_cv_file", "confidence": 1.0}
        return None

    for key, value in values.items():
        if value and key in label:
            return {"value": value, "source": f"profile.{key.replace(' ', '_')}", "confidence": 0.95}

    if "e mail" in label and values.get("email"):
        return {"value": values["email"], "source": "profile.email", "confidence": 0.95}

    for answer_key, answer in generated.items():
        if answer_key and (answer_key in label or label in answer_key):
            return {"value": answer, "source": "generated_answers", "confidence": 0.8}

    if summary and (
        "415e4314-19c5-45c4-8523-12565bb87917" in raw_label_lower
        or "comment" in label
        or "additional information" in label
        or "anything else" in label
    ):
        return {"value": summary, "source": "tailored_cover_letter", "confidence": 0.82}

    if (
        "ded439b4-712a-4cd3-8f14-a8f652c8e2bc" in raw_label_lower
        or "data processing" in label
        or "data protection" in label
        or "privacy" in label
        or "consent" in label
        or "agreement" in label
    ) and not is_sensitive_field(field):
        return {"value": "I agree", "source": "auto_consent.data_processing", "confidence": 0.95}

    if (
        "c7220d88-6808-4b17-ad1d-fd72a01ad465" in raw_label_lower
        or "marketing" in label
        or "academy" in label
        or "updates" in label
        or "newsletter" in label
        or "promotional" in label
    ):
        return {"value": "No", "source": "auto_preference.marketing_opt_out", "confidence": 0.95}

    answers_profile = profile.get("application_answers_profile") or {}
    for key, value in answers_profile.items():
        if value and canonical(key) in label:
            return {"value": str(value), "source": f"profile.application_answers_profile.{key}", "confidence": 0.85}

    return None
