"""Quality guards for tailored CV content.

This module keeps AI-generated resume text human, factual, and ATS-friendly
before it reaches DOCX/PDF rendering or browser submission.
"""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Dict, Iterable, List


AI_PHRASES = (
    "as an ai",
    "as a language model",
    "i am excited to apply",
    "i am thrilled to apply",
    "i am passionate about leveraging",
    "in today's fast-paced",
)

GENERIC_RESUME_PHRASES = (
    "results-driven",
    "dynamic professional",
    "highly motivated",
    "seasoned professional",
    "proven track record",
    "go-getter",
)

SECTION_REQUIREMENTS = (
    "contact",
    "summary",
    "skills",
    "experience",
)

MAX_SUMMARY_CHARS = 520
MAX_SKILLS = 14
MAX_LANGUAGES = 6
MAX_ROLE_KEYWORDS = 10
MAX_EVIDENCE_NOTES = 8
MAX_HIGHLIGHT_CHARS = 260
VALID_TEMPLATES = {
    "ats_classic",
    "modern_pro",
    "executive_compact",
    "luxe_minimal",
    "studio_slate",
    "blue_split",
}

CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
MARKDOWN_DECORATION = re.compile(r"(\*\*|__|```|`)")
SPACED_DOUBLE_SLASH = re.compile(r"(?<!:)//+")
MULTI_SPACE = re.compile(r"[ \t]{2,}")


def clean_cv_text(value: Any) -> str:
    """Normalize resume text without destroying URLs or normal punctuation."""
    text = "" if value is None else str(value)
    text = CONTROL_CHARS.sub("", text)
    text = MARKDOWN_DECORATION.sub("", text)
    text = text.replace("•", "-")
    text = text.replace("·", ",")
    text = text.replace("–", "-").replace("—", "-")
    text = SPACED_DOUBLE_SLASH.sub(" / ", text)
    text = text.replace(" ,", ",").replace(" .", ".")
    text = MULTI_SPACE.sub(" ", text)
    return text.strip()


def normalize_resume_structured(resume: Dict[str, Any] | None) -> Dict[str, Any]:
    """Clean and cap generated resume structure while preserving schema."""
    source = deepcopy(resume or {})
    out: Dict[str, Any] = {}

    template = clean_cv_text(source.get("template_recommendation"))
    out["template_recommendation"] = template if template in VALID_TEMPLATES else "ats_classic"

    headline = clean_cv_text(source.get("headline"))
    if headline:
        out["headline"] = _trim_sentence_boundary(headline, 140)

    contact = source.get("contact") or {}
    if isinstance(contact, dict):
        out["contact"] = {key: clean_cv_text(value) for key, value in contact.items()}
    else:
        out["contact"] = {}

    summary = clean_cv_text(source.get("summary"))
    out["summary"] = _trim_sentence_boundary(summary, MAX_SUMMARY_CHARS)

    out["role_keywords"] = _unique_clean_list(source.get("role_keywords") or [], MAX_ROLE_KEYWORDS)
    out["skills"] = _unique_clean_list(source.get("skills") or [], MAX_SKILLS)
    out["languages"] = _unique_clean_list(source.get("languages") or [], MAX_LANGUAGES)

    experience: List[Dict[str, Any]] = []
    for item in source.get("experience") or []:
        if not isinstance(item, dict):
            continue
        highlights = []
        for highlight in item.get("highlights") or []:
            cleaned = clean_cv_text(highlight)
            if not cleaned:
                continue
            highlights.append(_trim_sentence_boundary(cleaned, MAX_HIGHLIGHT_CHARS))
        experience.append({
            "role": clean_cv_text(item.get("role")),
            "company": clean_cv_text(item.get("company")),
            "duration": clean_cv_text(item.get("duration")),
            "location": clean_cv_text(item.get("location")),
            "highlights": highlights[:5],
            "source_evidence": clean_cv_text(item.get("source_evidence")),
        })
    out["experience"] = experience

    education: List[Dict[str, Any]] = []
    for item in source.get("education") or []:
        if not isinstance(item, dict):
            continue
        education.append({
            "degree": clean_cv_text(item.get("degree")),
            "school": clean_cv_text(item.get("school")),
            "year": clean_cv_text(item.get("year")),
        })
    out["education"] = education

    if source.get("content_plan"):
        out["content_plan"] = _unique_clean_list(source.get("content_plan") or [], 8)
    if source.get("evidence_notes"):
        out["evidence_notes"] = _unique_clean_list(source.get("evidence_notes") or [], MAX_EVIDENCE_NOTES)
    if source.get("unsupported_requirements"):
        out["unsupported_requirements"] = _unique_clean_list(source.get("unsupported_requirements") or [], MAX_EVIDENCE_NOTES)
    return out


def validate_resume_quality(resume: Dict[str, Any] | None) -> Dict[str, Any]:
    """Return a lightweight quality report for generated resume content."""
    resume = resume or {}
    issues: List[str] = []
    warnings: List[str] = []

    for key in SECTION_REQUIREMENTS:
        value = resume.get(key)
        if value in (None, "", [], {}):
            issues.append(f"missing_{key}")

    text = _resume_text(resume).lower()
    if "//" in text.replace("https://", "").replace("http://", ""):
        issues.append("contains_double_slash_artifact")
    if any(phrase in text for phrase in AI_PHRASES):
        issues.append("contains_ai_phrase")
    if any(phrase in text for phrase in GENERIC_RESUME_PHRASES):
        warnings.append("contains_generic_resume_phrase")

    summary = str(resume.get("summary") or "")
    if len(summary) > MAX_SUMMARY_CHARS:
        warnings.append("summary_too_long")

    skills = resume.get("skills") or []
    if isinstance(skills, list) and len(skills) > MAX_SKILLS:
        warnings.append("too_many_skills")

    for index, item in enumerate(resume.get("experience") or []):
        if not isinstance(item, dict):
            issues.append(f"experience_{index}_not_object")
            continue
        if not item.get("role") or not item.get("company"):
            warnings.append(f"experience_{index}_missing_role_or_company")
        for bullet_index, highlight in enumerate(item.get("highlights") or []):
            if len(str(highlight)) > MAX_HIGHLIGHT_CHARS:
                warnings.append(f"experience_{index}_bullet_{bullet_index}_too_long")

    ats_score = _ats_readiness_score(resume, issues, warnings)
    recruiter_score = _recruiter_readiness_score(resume, issues, warnings)
    score = round((ats_score * 0.55) + (recruiter_score * 0.45))
    return {
        "score": score,
        "ats_score": ats_score,
        "recruiter_score": recruiter_score,
        "status": "pass" if not issues else "needs_review",
        "issues": issues,
        "warnings": warnings,
        "checks": {
            "has_contact": bool(resume.get("contact")),
            "has_summary": bool(resume.get("summary")),
            "has_skills": bool(resume.get("skills")),
            "has_experience": bool(resume.get("experience")),
            "uses_supported_template": resume.get("template_recommendation") in VALID_TEMPLATES,
            "avoids_ai_artifacts": "contains_double_slash_artifact" not in issues and "contains_ai_phrase" not in issues,
            "recruiter_concise": "summary_too_long" not in warnings,
        },
    }


def normalize_application_generation(generated: Dict[str, Any] | None) -> Dict[str, Any]:
    """Normalize generated application payload in-place-compatible form."""
    out = deepcopy(generated or {})
    resume = normalize_resume_structured(out.get("tailored_resume_structured") or out.get("tailored_resume") or {})
    out["tailored_resume_structured"] = resume
    out["tailored_resume"] = resume

    cover = out.get("tailored_cover_letter") or out.get("cover_letter")
    if isinstance(cover, dict):
        cleaned_cover = {
            "template": clean_cv_text(cover.get("template")) or "french_formal",
            "sender_name": clean_cv_text(cover.get("sender_name")),
            "sender_address": clean_cv_text(cover.get("sender_address")),
            "sender_phone": clean_cv_text(cover.get("sender_phone")),
            "sender_email": clean_cv_text(cover.get("sender_email")),
            "recipient_attention": clean_cv_text(cover.get("recipient_attention")),
            "recipient_company": clean_cv_text(cover.get("recipient_company")),
            "recipient_address": clean_cv_text(cover.get("recipient_address")),
            "date_line": clean_cv_text(cover.get("date_line")),
            "subject": clean_cv_text(cover.get("subject")),
            "greeting": clean_cv_text(cover.get("greeting")),
            "paragraphs": [clean_cv_text(item) for item in cover.get("paragraphs") or [] if clean_cv_text(item)],
            "sign_off": clean_cv_text(cover.get("sign_off")),
            "signature_name": clean_cv_text(cover.get("signature_name")),
        }
        out["tailored_cover_letter"] = cleaned_cover
        out["cover_letter"] = cleaned_cover

    out["resume_quality_report"] = validate_resume_quality(resume)
    return out


def _unique_clean_list(items: Iterable[Any], limit: int) -> List[str]:
    seen = set()
    out: List[str] = []
    for item in items:
        cleaned = clean_cv_text(item)
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= limit:
            break
    return out


def _trim_sentence_boundary(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit].rstrip()
    for marker in (". ", "; ", ", "):
        index = cut.rfind(marker)
        if index >= int(limit * 0.65):
            return cut[: index + 1].strip()
    return cut.rstrip(" ,;") + "."


def _resume_text(resume: Dict[str, Any]) -> str:
    parts: List[str] = []
    if isinstance(resume.get("contact"), dict):
        parts.extend(str(value) for value in resume["contact"].values())
    for key in ("summary", "role_keywords", "skills", "languages", "content_plan", "evidence_notes"):
        value = resume.get(key)
        if isinstance(value, list):
            parts.extend(str(item) for item in value)
        elif value:
            parts.append(str(value))
    for item in resume.get("experience") or []:
        if isinstance(item, dict):
            parts.extend(str(item.get(key) or "") for key in ("role", "company", "duration", "location"))
            parts.extend(str(item) for item in item.get("highlights") or [])
    for item in resume.get("education") or []:
        if isinstance(item, dict):
            parts.extend(str(item.get(key) or "") for key in ("degree", "school", "year"))
    return "\n".join(parts)


def _ats_readiness_score(resume: Dict[str, Any], issues: List[str], warnings: List[str]) -> int:
    score = 100
    for key in SECTION_REQUIREMENTS:
        if resume.get(key) in (None, "", [], {}):
            score -= 18
    if "contains_double_slash_artifact" in issues:
        score -= 18
    if "contains_ai_phrase" in issues:
        score -= 12
    if resume.get("template_recommendation") not in VALID_TEMPLATES:
        score -= 10
    if "too_many_skills" in warnings:
        score -= 8
    return max(0, min(100, score))


def _recruiter_readiness_score(resume: Dict[str, Any], issues: List[str], warnings: List[str]) -> int:
    score = 100
    if "contains_ai_phrase" in issues:
        score -= 20
    if "contains_generic_resume_phrase" in warnings:
        score -= 14
    if "summary_too_long" in warnings:
        score -= 10
    for item in resume.get("experience") or []:
        if not isinstance(item, dict):
            score -= 10
            continue
        highlights = item.get("highlights") or []
        if not highlights:
            score -= 8
        for highlight in highlights:
            text = str(highlight)
            if len(text.split()) < 8:
                score -= 3
            if len(text) > MAX_HIGHLIGHT_CHARS:
                score -= 5
    return max(0, min(100, score))
