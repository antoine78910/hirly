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
        "country": str(location_data.get("country") or contact.get("country") or "").strip(),
        "linkedin": str(contact.get("linkedin") or "").strip(),
        "website": str(contact.get("website") or "").strip(),
        "portfolio": str(contact.get("website") or "").strip(),
        "github": str(contact.get("github") or contact.get("github_url") or "").strip(),
    }


def suggested_profile_key(field: Dict[str, Any]) -> Optional[str]:
    label = canonical(" ".join(str(field.get(key) or "") for key in (
        "name",
        "id",
        "label",
        "placeholder",
        "aria_label",
        "nearby_text",
        "field_container_text",
    )))
    if label in ("country", "country country") or "country of residence" in label or "current country" in label:
        return "country"
    if "location city" in label or "current location" in label or label in ("city", "location"):
        return "city"
    if "phone country code" in label or "country code" in label or "dial code" in label:
        return "phone_country_code"
    if any(term in label for term in ("how did you hear", "referral source", "referred by", "candidate source")):
        return "referral_source"
    if any(term in label for term in ("privacy policy", "data processing", "data protection", "i agree", "consent")) and not is_sensitive_field({"label": label}):
        return "privacy_consent"
    if any(term in label for term in ("authorized to work", "eligible to work", "legally in the united states", "legally authorized")):
        return "work_authorized_countries"
    if any(term in label for term in ("visa sponsorship", "immigration support", "require sponsorship", "sponsor")):
        return "requires_sponsorship"
    if any(term in label for term in ("currently located in", "currently based in", "are you based in", "are you currently located", "are you currently based")):
        return "current_location_country"
    if any(term in label for term in ("hybrid role", "onsite", "on site", "come into the office", "office four days")):
        return "current_location_city"
    if "relocation" in label or "relocate" in label:
        return "willing_to_relocate"
    if "gender" in label:
        return "eeo_gender"
    if any(term in label for term in ("race", "ethnicity", "hispanic")):
        return "eeo_race"
    if "veteran" in label:
        return "eeo_veteran"
    if "disability" in label:
        return "eeo_disability"
    if any(term in label for term in ("lgbtq", "sexual orientation", "transgender")):
        return "eeo_lgbtq"
    if any(term in label for term in ("ever worked for", "previously worked for", "previously been employed", "employee or contractor", "contractor consultant")):
        return "former_company_history"
    if any(term in label for term in ("non compete", "non solicitation", "former employer", "third party")):
        return "former_employer_restriction_or_noncompete"
    return None


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
        field_type = str(field.get("type") or "text").lower()
        if field_type != "file":
            return None

    field_type = str(field.get("type") or "text").lower()
    raw_label = " ".join(str(field.get(key) or "") for key in (
        "name",
        "id",
        "label",
        "placeholder",
        "aria_label",
        "nearby_text",
        "field_container_text",
    ))
    raw_label_lower = raw_label.lower()
    label = canonical(raw_label)
    values = contact_values(profile, user)
    generated = generated_answer_map(app_doc)
    summary = application_summary_text(app_doc)
    defaults = profile.get("application_defaults") or {}
    suggested_key = suggested_profile_key(field)

    if suggested_key and defaults.get(suggested_key) not in (None, ""):
        return {
            "value": str(defaults.get(suggested_key)),
            "source": f"profile.application_defaults.{suggested_key}",
            "confidence": 0.95,
        }

    payload = app_doc.get("prepared_application_payload") or {}
    for question in payload.get("questions") or []:
        if not isinstance(question, dict):
            continue
        question_value = question.get("value")
        if not question_value:
            continue
        question_key = canonical(" ".join(str(question.get(key) or "") for key in ("name", "label", "question")))
        if question_key and (question_key in label or label in question_key):
            return {"value": str(question_value), "source": "prepared_application_payload", "confidence": 0.9}

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
        "how did you hear" in label
        or "referral source" in label
        or "referred by" in label
        or label in ("source", "candidate source")
    ):
        value = option_value(field, ("swiipr", "other", "other website", "job board", "online"))
        return {"value": value or "Swiipr", "source": "auto_referral_source", "confidence": 0.95}

    if (
        "ded439b4-712a-4cd3-8f14-a8f652c8e2bc" in raw_label_lower
        or "data processing" in label
        or "data protection" in label
        or "privacy" in label
        or "consent" in label
    ) and not is_sensitive_field(field):
        value = option_value(field, ("i agree", "agree", "yes", "true"))
        return {"value": value or "I agree", "source": "auto_consent.data_processing", "confidence": 0.95}

    if any(term in label for term in (
        "i identify my gender",
        "i identify as",
        "race",
        "ethnicity",
        "veteran",
        "disability",
        "gender",
        "sexual orientation",
        "hispanic",
    )):
        value = option_value(field, (
            "i do not wish to answer",
            "decline to self identify",
            "decline to self-identify",
            "prefer not to say",
            "i don t wish to answer",
        ))
        return {"value": value or "I don't wish to answer", "source": "auto_eeo_decline", "confidence": 0.9}

    if (
        "c7220d88-6808-4b17-ad1d-fd72a01ad465" in raw_label_lower
        or "marketing" in label
        or "academy" in label
        or "updates" in label
        or "newsletter" in label
        or "promotional" in label
    ):
        value = option_value(field, ("no", "false"))
        return {"value": value or "No", "source": "auto_preference.marketing_opt_out", "confidence": 0.95}

    answers_profile = profile.get("application_answers_profile") or {}
    for key, value in answers_profile.items():
        if value and canonical(key) in label:
            return {"value": str(value), "source": f"profile.application_answers_profile.{key}", "confidence": 0.85}

    return None


def option_value(field: Dict[str, Any], preferred_labels: tuple[str, ...]) -> Optional[str]:
    options = field.get("options") or []
    for preferred in preferred_labels:
        preferred_key = canonical(preferred)
        for option in options:
            if not isinstance(option, dict):
                continue
            label = canonical(option.get("label") or option.get("value"))
            value = str(option.get("value") or option.get("label") or "").strip()
            if value and (label == preferred_key or preferred_key in label):
                return value
    return None
