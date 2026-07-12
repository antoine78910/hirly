"""Minimal CV tailoring: preserve profile content, reorder only what GPT specifies."""

from __future__ import annotations

import re
from copy import deepcopy
from typing import Any, Dict, List, Sequence

from cv_quality import MAX_SUMMARY_CHARS, VALID_TEMPLATES, clean_cv_text, normalize_resume_structured


# Internal instructions that must never appear in candidate-facing CV text.
INTERNAL_CV_LEAK_PATTERNS = (
    r"à ajouter si",
    r"a ajouter si",
    r"informations techniques spécifiques",
    r"à ajouter manuellement",
    r"a ajouter manuellement",
    r"si détenues",
    r"si detenues",
    r"consigne interne",
    r"note interne",
    r"\btodo\b",
    r"à compléter",
    r"a completer",
)

GENERIC_SUMMARY_OPENERS = (
    "souhait de candidater",
    "je souhaite candidater",
    "candidature pour le poste",
)


def build_cv_tailoring_prompt_section(job_title: str) -> str:
    return f"""CV — REGLES DE TAILORING MINIMAL (PRIORITE MAXIMALE)

Ne reecris PAS le CV. Conserve 95 % du contenu tel quel.
Les experiences, bullet points, entreprises, dates et contexte (Big Four, filiales, equipes…) restent IDENTIQUES au profil candidat.

Tu ne peux modifier que via resume_tailoring :
1. headline (intitule / titre en haut du CV, segments separes par " | ", max 4 segments)
2. summary (resume professionnel, 4-5 lignes MAX, ton humain et factuel)
3. skills_order (indices pour reordonner les competences deja presentes dans le profil)
4. experience_order (indices pour reordonner les experiences deja presentes — contenu inchange)
5. template_recommendation (optionnel)
6. role_keywords (optionnel, max 10, uniquement si deja supporte par le CV)

INTERDIT dans le CV final (resume_tailoring.summary ou headline) :
- Consignes internes : "informations techniques … à ajouter si détenues", "à ajouter manuellement", etc.
- Supprimer des informations importantes (Big Four, Deloitte, duree, taille d'equipe, filiales, contexte metier)
- Inventer entreprise, poste, diplome, outil, chiffre ou resultat
- Raccourcir ou condenser les experiences / bullet points
- Reformuler les bullet points d'experience (le code conserve le texte original)
- Phrases robotiques du type "Souhait de candidater pour…" en ouverture du resume

OBLIGATOIRE pour le resume (summary) :
- Conserver les faits marquants du parcours (ex. 4 saisons Deloitte, Big Four, groupes de filiales)
- Adapter l'angle au poste "{job_title}" sans effacer le contexte
- 4-5 lignes maximum, phrases naturelles

OBLIGATOIRE pour skills_order :
- Remonter en premier les competences les plus alignees avec l'offre (ex. Excel, SQL, Python si poste data ; Audit si poste audit)
- Ne pas ajouter de competences absentes du profil

OBLIGATOIRE pour experience_order :
- Mettre en premier l'experience la plus pertinente pour l'offre
- Ne jamais modifier le texte des experiences — uniquement l'ordre

Exemple headline pour un auditeur visant un poste Data :
"Auditeur Financier | Data Analysis | Controle Interne | Excel Avance"
"""


def strip_internal_cv_instructions(text: str) -> str:
    cleaned = clean_cv_text(text)
    if not cleaned:
        return ""
    # Drop parenthetical internal notes, e.g. "(PySpark, Data Factory) à ajouter si détenues"
    cleaned = re.sub(r"\([^)]*(?:ajouter|détenu|detenu|spécifique|specifique|compléter|completer)[^)]*\)", "", cleaned, flags=re.IGNORECASE)
    for pattern in INTERNAL_CV_LEAK_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    # Remove orphaned parentheticals left after pattern stripping
    cleaned = re.sub(r"\([^)]{0,120}\)", "", cleaned)
    cleaned = re.sub(r"\(\s*\)", "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,;.-")
    lower = cleaned.lower()
    for opener in GENERIC_SUMMARY_OPENERS:
        if lower.startswith(opener):
            cleaned = cleaned[len(opener) :].lstrip(" :,-.")
            break
    return cleaned.strip()


def _normalize_experience_item(item: Dict[str, Any]) -> Dict[str, Any]:
    highlights = []
    for highlight in item.get("highlights") or []:
        cleaned = clean_cv_text(highlight)
        if cleaned:
            highlights.append(cleaned)
    return {
        "role": clean_cv_text(item.get("role")),
        "company": clean_cv_text(item.get("company")),
        "duration": clean_cv_text(item.get("duration")),
        "location": clean_cv_text(item.get("location")),
        "highlights": highlights,
    }


def _normalize_education_item(item: Dict[str, Any]) -> Dict[str, Any]:
    year = clean_cv_text(item.get("year") or item.get("graduation_year"))
    return {
        "degree": clean_cv_text(item.get("degree")),
        "school": clean_cv_text(item.get("school")),
        "year": year,
    }


CONTACT_MERGE_KEYS = (
    "name",
    "email",
    "phone",
    "location",
    "city",
    "country",
    "linkedin",
    "website",
    "portfolio",
    "picture",
    "photo",
    "photoUrl",
    "avatar",
)


def prepare_profile_for_application_generation(
    profile: Dict[str, Any],
    user: Any | None = None,
) -> Dict[str, Any]:
    """Normalize profile before swipe-right application generation."""
    out = deepcopy(profile or {})
    contact = dict(out.get("contact") or {})

    if user is not None:
        user_name = clean_cv_text(getattr(user, "name", "") or "")
        user_email = clean_cv_text(getattr(user, "email", "") or "")
        user_picture = clean_cv_text(getattr(user, "picture", "") or "")
        if user_name and not contact.get("name"):
            contact["name"] = user_name
        if user_email and not contact.get("email"):
            contact["email"] = user_email
        if user_picture and not any(contact.get(key) for key in ("picture", "photo", "photoUrl", "avatar")):
            contact["picture"] = user_picture

    out["contact"] = contact
    return out


def enrich_tailored_resume_contact(
    tailored: Dict[str, Any],
    profile: Dict[str, Any],
) -> Dict[str, Any]:
    """Fill missing tailored CV contact fields from the stored profile."""
    out = deepcopy(tailored or {})
    profile_contact = profile.get("contact") if isinstance(profile.get("contact"), dict) else {}
    contact = dict(out.get("contact") or {})
    for key in CONTACT_MERGE_KEYS:
        if not clean_cv_text(contact.get(key)) and clean_cv_text(profile_contact.get(key)):
            contact[key] = clean_cv_text(profile_contact.get(key))
    out["contact"] = contact
    return out


def enrich_cover_letter_from_profile(
    cover_letter: Dict[str, Any],
    profile: Dict[str, Any],
    user: Any | None = None,
) -> Dict[str, Any]:
    """Fill sender fields on generated cover letters from profile/user contact."""
    if not isinstance(cover_letter, dict):
        return {}
    out = deepcopy(cover_letter)
    contact = profile.get("contact") if isinstance(profile.get("contact"), dict) else {}
    user_name = clean_cv_text(getattr(user, "name", "") or "") if user is not None else ""
    user_email = clean_cv_text(getattr(user, "email", "") or "") if user is not None else ""

    if not clean_cv_text(out.get("sender_name")):
        out["sender_name"] = clean_cv_text(contact.get("name")) or user_name
    if not clean_cv_text(out.get("sender_email")):
        out["sender_email"] = clean_cv_text(contact.get("email")) or user_email
    if not clean_cv_text(out.get("sender_phone")):
        out["sender_phone"] = clean_cv_text(contact.get("phone"))
    if not clean_cv_text(out.get("sender_address")):
        out["sender_address"] = clean_cv_text(contact.get("location"))
    if not clean_cv_text(out.get("signature_name")):
        out["signature_name"] = out.get("sender_name") or user_name
    return out


def build_base_resume_from_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Source-of-truth resume from stored profile — experiences are never invented here."""
    contact = profile.get("contact") if isinstance(profile.get("contact"), dict) else {}
    template = clean_cv_text(profile.get("template_style") or "modern")
    template_map = {
        "modern": "modern_pro",
        "classic": "ats_classic",
        "minimal": "luxe_minimal",
        "two_column": "blue_split",
        "professional": "blue_split",
    }
    template_recommendation = template_map.get(template, template if template in VALID_TEMPLATES else "ats_classic")

    experience = [
        _normalize_experience_item(item)
        for item in (profile.get("experience") or [])
        if isinstance(item, dict)
    ]
    education = [
        _normalize_education_item(item)
        for item in (profile.get("education") or [])
        if isinstance(item, dict)
    ]
    skills = [clean_cv_text(skill) for skill in (profile.get("skills") or []) if clean_cv_text(skill)]
    languages = [clean_cv_text(lang) for lang in (profile.get("languages") or []) if clean_cv_text(lang)]

    return {
        "template_recommendation": template_recommendation,
        "contact": {key: clean_cv_text(value) for key, value in contact.items()},
        "headline": clean_cv_text(profile.get("headline") or ""),
        "summary": strip_internal_cv_instructions(profile.get("summary") or ""),
        "skills": skills,
        "languages": languages,
        "experience": experience,
        "education": education,
    }


def _apply_index_order(items: List[Any], order: Sequence[Any] | None) -> List[Any]:
    if not items or not order:
        return items
    indices: List[int] = []
    for raw in order:
        try:
            index = int(raw)
        except (TypeError, ValueError):
            continue
        if 0 <= index < len(items) and index not in indices:
            indices.append(index)
    for index, _item in enumerate(items):
        if index not in indices:
            indices.append(index)
    return [items[index] for index in indices]


def _skills_order_from_ai_list(base_skills: List[str], ai_skills: List[str]) -> List[int]:
    if not base_skills or not ai_skills:
        return list(range(len(base_skills)))
    lookup = {skill.casefold(): index for index, skill in enumerate(base_skills)}
    order: List[int] = []
    for skill in ai_skills:
        key = clean_cv_text(skill).casefold()
        if key in lookup and lookup[key] not in order:
            order.append(lookup[key])
    for index in range(len(base_skills)):
        if index not in order:
            order.append(index)
    return order


def _filter_role_keywords(keywords: Sequence[Any], base: Dict[str, Any]) -> List[str]:
    corpus = " ".join(
        [
            base.get("summary") or "",
            " ".join(base.get("skills") or []),
            " ".join(
                f"{item.get('role', '')} {item.get('company', '')} {' '.join(item.get('highlights') or [])}"
                for item in base.get("experience") or []
                if isinstance(item, dict)
            ),
        ]
    ).casefold()
    out: List[str] = []
    seen = set()
    for keyword in keywords:
        cleaned = clean_cv_text(keyword)
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        if key not in corpus and not any(part in corpus for part in key.split() if len(part) > 3):
            continue
        seen.add(key)
        out.append(cleaned)
        if len(out) >= 10:
            break
    return out


def _coerce_tailoring_from_legacy(
    legacy_resume: Dict[str, Any],
    base: Dict[str, Any],
) -> Dict[str, Any]:
    """Map old full-resume AI output to minimal tailoring deltas."""
    return {
        "headline": legacy_resume.get("headline"),
        "summary": legacy_resume.get("summary"),
        "skills_order": _skills_order_from_ai_list(base.get("skills") or [], legacy_resume.get("skills") or []),
        "experience_order": list(range(len(base.get("experience") or []))),
        "template_recommendation": legacy_resume.get("template_recommendation"),
        "role_keywords": legacy_resume.get("role_keywords") or [],
    }


def apply_minimal_resume_tailoring(
    profile: Dict[str, Any],
    generated: Dict[str, Any],
    job: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Build tailored resume from profile + minimal AI deltas. Experiences stay identical."""
    base = build_base_resume_from_profile(profile)
    tailoring = generated.get("resume_tailoring") if isinstance(generated.get("resume_tailoring"), dict) else {}

    if not tailoring:
        legacy = generated.get("tailored_resume_structured") or generated.get("tailored_resume")
        if isinstance(legacy, dict):
            tailoring = _coerce_tailoring_from_legacy(legacy, base)

    out = deepcopy(base)

    headline = strip_internal_cv_instructions(
        tailoring.get("headline") or tailoring.get("title") or "",
    )
    if headline:
        out["headline"] = headline

    summary = strip_internal_cv_instructions(tailoring.get("summary") or "")
    if summary:
        if len(summary) > MAX_SUMMARY_CHARS:
            summary = summary[:MAX_SUMMARY_CHARS].rsplit(" ", 1)[0].rstrip(" ,;") + "."
        out["summary"] = summary

    skills_order = tailoring.get("skills_order") or tailoring.get("skillsOrder")
    if out["skills"]:
        out["skills"] = _apply_index_order(out["skills"], skills_order)

    experience_order = tailoring.get("experience_order") or tailoring.get("experienceOrder")
    if out["experience"]:
        out["experience"] = _apply_index_order(out["experience"], experience_order)

    template = clean_cv_text(tailoring.get("template_recommendation") or "")
    if template in VALID_TEMPLATES:
        out["template_recommendation"] = template

    role_keywords = _filter_role_keywords(tailoring.get("role_keywords") or [], base)
    if role_keywords:
        out["role_keywords"] = role_keywords

    return normalize_resume_structured(out)


def validate_minimal_tailoring_preserved(
    profile: Dict[str, Any],
    tailored: Dict[str, Any],
) -> Dict[str, Any]:
    """Check that experience bullets were not rewritten or dropped."""
    base = build_base_resume_from_profile(profile)
    issues: List[str] = []
    warnings: List[str] = []

    base_exp = base.get("experience") or []
    tailored_exp = tailored.get("experience") or []
    if len(tailored_exp) < len(base_exp):
        issues.append("experience_entries_removed")

    base_highlight_count = sum(len(item.get("highlights") or []) for item in base_exp)
    tailored_highlight_count = sum(len(item.get("highlights") or []) for item in tailored_exp)
    if tailored_highlight_count < base_highlight_count:
        issues.append("experience_highlights_removed")

    summary = str(tailored.get("summary") or "").lower()
    for pattern in INTERNAL_CV_LEAK_PATTERNS:
        if re.search(pattern, summary, flags=re.IGNORECASE):
            issues.append("summary_contains_internal_instruction")
            break

    return {
        "status": "needs_review" if issues else "pass",
        "issues": issues,
        "warnings": warnings,
        "base_experience_count": len(base_exp),
        "tailored_experience_count": len(tailored_exp),
    }
