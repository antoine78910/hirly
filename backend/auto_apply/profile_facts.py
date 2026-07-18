"""Derive fillable facts from a candidate profile / CV structure.

Used by build_candidate_context + the auto-apply resolver so common ATS
questions (years of experience, education level, availability, city…) can be
answered from profile data instead of always escalating to the user.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


_MONTHS = {
    "jan": 1, "january": 1, "janvier": 1,
    "feb": 2, "february": 2, "fevrier": 2, "février": 2,
    "mar": 3, "march": 3, "mars": 3,
    "apr": 4, "april": 4, "avril": 4,
    "may": 5, "mai": 5,
    "jun": 6, "june": 6, "juin": 6,
    "jul": 7, "july": 7, "juillet": 7,
    "aug": 8, "august": 8, "aout": 8, "août": 8,
    "sep": 9, "sept": 9, "september": 9, "septembre": 9,
    "oct": 10, "october": 10, "octobre": 10,
    "nov": 11, "november": 11, "novembre": 11,
    "dec": 12, "december": 12, "decembre": 12, "décembre": 12,
}

_PRESENT = frozenset({
    "present", "now", "current", "aujourd hui", "aujourdhui", "actuel",
    "actuelle", "en cours", "ongoing", "today",
})

# Degree text → canonical FR education ladder label.
_EDUCATION_LEVELS: List[Tuple[Tuple[str, ...], str]] = [
    (("phd", "doctorat", "doctoral", "thèse", "these"), "Doctorat"),
    (("mba",), "Bac+5"),
    (("master", "masters", "msc", "ms ", "bac+5", "bac +5", "grande ecole",
      "grande école", "ingenieur", "ingénieur", "diplome d ingen", "bac+4", "bac +4"),
     "Bac+5"),
    (("licence", "bachelor", "bsc", "ba ", "bac+3", "bac +3", "undergraduate"), "Bac+3"),
    (("bts", "dut", "but", "deug", "associate", "bac+2", "bac +2"), "Bac+2"),
    (("baccalaureat", "baccalauréat", "high school", "lycee", "lycée", "bac "), "Bac"),
]

_SENIORITY_BY_YEARS = (
    (0, 1, "junior"),
    (1, 3, "junior"),
    (3, 6, "mid"),
    (6, 10, "senior"),
    (10, 99, "lead"),
)


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _norm(value: Any) -> str:
    text = _clean(value).lower()
    text = (
        text.replace("é", "e").replace("è", "e").replace("ê", "e")
        .replace("à", "a").replace("â", "a").replace("ù", "u")
        .replace("ô", "o").replace("î", "i").replace("ï", "i")
        .replace("ç", "c")
    )
    return re.sub(r"[^a-z0-9+]+", " ", text).strip()


def _parse_month_year(token: str) -> Optional[Tuple[int, int]]:
    raw = _clean(token)
    if not raw or _norm(raw) in _PRESENT:
        return None
    m = re.match(r"^(\d{1,2})\s*[/\-.]\s*(\d{4})$", raw)
    if m:
        month, year = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return year, month
    m = re.match(r"^(\d{4})\s*[/\-.]\s*(\d{1,2})$", raw)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return year, month
    m = re.match(r"^(\d{4})$", raw.strip())
    if m:
        return int(m.group(1)), 1
    norm = _norm(raw)
    for name, month in _MONTHS.items():
        m = re.match(rf"^{name}\s*(\d{{4}})$", norm)
        if m:
            return int(m.group(1)), month
        m = re.match(rf"^(\d{{4}})\s*{name}$", norm)
        if m:
            return int(m.group(1)), month
    return None


def _duration_years_from_text(duration: str) -> Optional[float]:
    """Estimate years covered by a free-text duration like '2020-2024' or '18 mois'."""
    raw = _clean(duration)
    if not raw:
        return None
    norm = _norm(raw)

    # Explicit counts: "4 ans", "18 mois", "2 years", "6 months"
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(ans?|years?|yrs?)\b", norm)
    if m:
        return float(m.group(1).replace(",", "."))
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(mois|months?|mos?)\b", norm)
    if m:
        return float(m.group(1).replace(",", ".")) / 12.0
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(semaines?|weeks?)\b", norm)
    if m:
        return float(m.group(1).replace(",", ".")) / 52.0

    # Range: "01/2020 - Present", "2021-2024", "Jan 2019 – Dec 2021"
    parts = re.split(
        r"\s*(?:–|—|->|→|until|to\b|au\b|jusqu.?\s*a)\s*|\s+-\s+",
        raw,
        maxsplit=1,
        flags=re.I,
    )
    if len(parts) == 1 and "-" in raw:
        # Compact year range "2020-2024"
        parts = re.split(r"-", raw, maxsplit=1)
    if len(parts) == 2:
        start = _parse_month_year(parts[0])
        end_token = _norm(parts[1])
        if end_token in _PRESENT or not end_token:
            now = datetime.now(timezone.utc)
            end = (now.year, now.month)
        else:
            end = _parse_month_year(parts[1])
        if start and end:
            months = (end[0] - start[0]) * 12 + (end[1] - start[1])
            if months >= 0:
                return max(months / 12.0, 0.08)

    # Single year only → treat as ~1 year if recent, else unknown
    single = _parse_month_year(raw)
    if single and re.fullmatch(r"\d{4}", raw.strip()):
        return 1.0
    return None


def estimate_years_experience(profile: Dict[str, Any]) -> Optional[float]:
    summary = profile.get("experience_summary") if isinstance(profile.get("experience_summary"), dict) else {}
    for key in ("years_experience", "years", "total_years"):
        raw = summary.get(key)
        if raw in (None, ""):
            continue
        try:
            return float(str(raw).replace(",", ".").strip())
        except ValueError:
            parsed = _duration_years_from_text(str(raw))
            if parsed is not None:
                return parsed

    experience = profile.get("experience") or []
    if not isinstance(experience, list):
        return None

    total = 0.0
    found = False
    for item in experience:
        if not isinstance(item, dict):
            continue
        duration = item.get("duration") or item.get("dates") or ""
        if not duration and (item.get("start_date") or item.get("end_date")):
            duration = f"{item.get('start_date') or ''} - {item.get('end_date') or 'Present'}"
        years = _duration_years_from_text(str(duration))
        if years is None:
            continue
        total += years
        found = True
    if not found:
        return None
    # Cap absurd sums from overlapping roles; still useful as an upper bound.
    return round(min(total, 45.0), 1)


def education_level_label(profile: Dict[str, Any]) -> Optional[str]:
    defaults = profile.get("application_defaults") or {}
    for key in ("education_level", "niveau_etude", "highest_education"):
        if defaults.get(key):
            return _clean(defaults.get(key))

    education = profile.get("education") or []
    if isinstance(education, dict):
        education = [education]
    for item in education:
        if not isinstance(item, dict):
            continue
        blob = " ".join(
            _clean(item.get(k))
            for k in ("degree", "qualification", "discipline", "field_of_study", "school")
            if item.get(k)
        )
        if not blob:
            continue
        norm = _norm(blob)
        for needles, label in _EDUCATION_LEVELS:
            if any(n.strip() in norm for n in needles):
                return label
        # Fallback: return the raw degree text for free-text fields.
        degree = _clean(item.get("degree") or item.get("qualification"))
        if degree:
            return degree
    return None


def seniority_label(profile: Dict[str, Any], years: Optional[float] = None) -> Optional[str]:
    explicit = _clean(profile.get("seniority") or (profile.get("extras") or {}).get("onboarding", {}).get("seniority"))
    if explicit:
        return explicit.lower()
    if years is None:
        years = estimate_years_experience(profile)
    if years is None:
        return None
    for low, high, label in _SENIORITY_BY_YEARS:
        if low <= years < high:
            return label
    return "senior"


def availability_label(profile: Dict[str, Any]) -> Optional[str]:
    defaults = profile.get("application_defaults") or {}
    answers = profile.get("application_answers_profile") or {}
    for source in (defaults, answers):
        for key in (
            "availability", "disponibilite", "disponibilité",
            "earliest_start_date", "earliest_start", "notice_period",
        ):
            value = source.get(key)
            if value in (None, ""):
                continue
            text = _clean(value)
            norm = _norm(text)
            if any(tok in norm for tok in ("immediat", "asap", "tout de suite", "disponible maintenant", "immediate")):
                return "Immédiate"
            if "15" in norm and ("jour" in norm or "day" in norm):
                return "Préavis de 15 jours"
            if re.search(r"\b1\b", norm) and ("mois" in norm or "month" in norm):
                return "Préavis de 1 mois"
            if re.search(r"\b2\b", norm) and ("mois" in norm or "month" in norm):
                return "Préavis de 2 mois"
            if re.search(r"\b3\b", norm) and ("mois" in norm or "month" in norm):
                return "Préavis de 3 mois"
            if "preavis" in norm or "notice" in norm:
                return text
            # ISO / FR date → "Disponible à partir du..."
            if re.search(r"\d{4}-\d{2}-\d{2}", text) or re.search(r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}", text):
                return text
            return text
    return None


def current_role(profile: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    summary = profile.get("experience_summary") if isinstance(profile.get("experience_summary"), dict) else {}
    title = _clean(summary.get("current_title"))
    company = _clean(summary.get("current_company"))
    if title or company:
        return title or None, company or None
    experience = profile.get("experience") or []
    if isinstance(experience, list) and experience and isinstance(experience[0], dict):
        first = experience[0]
        return (
            _clean(first.get("role") or first.get("title")) or None,
            _clean(first.get("company")) or None,
        )
    return None, None


def skills_summary(profile: Dict[str, Any], limit: int = 20) -> Optional[str]:
    skills = profile.get("skills") or []
    if not isinstance(skills, list):
        return None
    cleaned = [_clean(s) for s in skills if _clean(s)][:limit]
    return ", ".join(cleaned) if cleaned else None


def languages_summary(profile: Dict[str, Any]) -> Optional[str]:
    languages = profile.get("languages") or []
    if not isinstance(languages, list):
        return None
    cleaned = [_clean(item) for item in languages if _clean(item)]
    return ", ".join(cleaned) if cleaned else None


def experience_bucket_label(years: float) -> str:
    if years < 1:
        return "Moins d'1 an"
    if years < 2:
        return "1-2 ans"
    if years < 3:
        return "2-3 ans"
    if years < 5:
        return "3-5 ans"
    if years < 10:
        return "5-10 ans"
    return "10 ans et plus"


def match_select_option(value: Any, options: List[str]) -> Optional[str]:
    """Pick the best matching option for a derived value (exact / substring / range)."""
    if value in (None, "") or not options:
        return None
    needle = _norm(value)
    if not needle:
        return None

    # Exact / containment on normalized labels.
    scored: List[Tuple[int, str]] = []
    for opt in options:
        on = _norm(opt)
        if not on:
            continue
        if on == needle:
            return opt
        if needle in on or on in needle:
            scored.append((min(len(on), len(needle)), opt))
    if scored:
        scored.sort(key=lambda x: -x[0])
        return scored[0][1]

    # Numeric years → option ranges like "3-5 ans", "5 à 10 ans", "+10 ans"
    try:
        years = float(str(value).replace(",", "."))
    except ValueError:
        years = None
    if years is not None:
        for opt in options:
            on = _norm(opt)
            if "moins" in on and ("1" in on or "un an" in on) and years < 1:
                return opt
            if any(tok in on for tok in ("debutant", "junior", "entry")) and years < 2:
                return opt
            if any(tok in on for tok in ("confirme", "intermediate", "confirmee")) and 2 <= years < 6:
                return opt
            if "senior" in on and years >= 5:
                return opt
            m = re.search(r"(\d+)\s*(?:a|au|-|–|to)\s*(\d+)", on)
            if m:
                low, high = int(m.group(1)), int(m.group(2))
                if low <= years <= high:
                    return opt
            # Compact ranges after norm: "3 5 ans" (from "3-5 ans")
            m = re.search(r"(\d+)\s+(\d+)\s*(?:ans?|years?)?", on)
            if m:
                low, high = int(m.group(1)), int(m.group(2))
                if low <= years <= high:
                    return opt
            m = re.search(r"(?:plus de|more than|>|>=|\+|au moins)\s*(\d+)", on)
            if m and years >= int(m.group(1)):
                return opt
            m = re.search(r"^(\d+)\s*\+", on)
            if m and years >= int(m.group(1)):
                return opt
            m = re.search(r"(\d+)\s*(?:ans?|years?)\s*(?:et plus|or more|\+)?", on)
            if m and "plus" in on and years >= int(m.group(1)):
                return opt
            m = re.fullmatch(r"(\d+)\s*(?:ans?|years?)?", on)
            if m and abs(years - int(m.group(1))) < 0.51:
                return opt

    # Education ladder aliases
    edu_aliases = {
        "bac": ("bac", "baccalaureat", "high school"),
        "bac+2": ("bac+2", "bac 2", "bts", "dut", "but"),
        "bac+3": ("bac+3", "bac 3", "licence", "bachelor"),
        "bac+5": ("bac+5", "bac 5", "master", "mba", "ingenieur", "grande ecole"),
        "doctorat": ("doctorat", "phd", "doctoral"),
    }
    for _label, aliases in edu_aliases.items():
        if any(a in needle for a in aliases):
            for opt in options:
                on = _norm(opt)
                if any(a in on for a in aliases):
                    return opt

    return None


def derive_profile_facts(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Return flat facts suitable for candidate_context (values only)."""
    years = estimate_years_experience(profile)
    title, company = current_role(profile)
    facts: Dict[str, Any] = {}
    if years is not None:
        facts["years_experience"] = years
        facts["years_experience_int"] = int(round(years))
        facts["years_experience_text"] = str(int(round(years)))
        facts["experience_bucket"] = experience_bucket_label(years)
    level = education_level_label(profile)
    if level:
        facts["education_level"] = level
    seniority = seniority_label(profile, years)
    if seniority:
        facts["seniority"] = seniority
    availability = availability_label(profile)
    if availability:
        facts["availability"] = availability
    if title:
        facts["current_title"] = title
    if company:
        facts["current_company"] = company
    skills = skills_summary(profile)
    if skills:
        facts["skills"] = skills
    languages = languages_summary(profile)
    if languages:
        facts["languages"] = languages
    summary = _clean(profile.get("summary") or profile.get("professional_summary"))
    if summary:
        facts["summary"] = summary[:800]
    target = _clean(profile.get("target_role") or (profile.get("target_roles") or [None])[0])
    if target:
        facts["target_role"] = target
    location = _clean(
        (profile.get("contact") or {}).get("location")
        or profile.get("target_location")
        or ((profile.get("target_location_data") or {}).get("location_label"))
    )
    if location:
        facts["location"] = location
    defaults = profile.get("application_defaults") or {}
    for key in ("city", "country", "postal_code", "zip", "address", "phone_country_code",
                "education_school", "education_degree", "education_discipline",
                "education_graduation_year", "salary_expectation", "website_url", "linkedin_url"):
        if defaults.get(key) not in (None, ""):
            facts[key] = defaults[key]
    return facts


def put_derived_into_context(context: Dict[str, Any], profile: Dict[str, Any]) -> None:
    """Write derived + structured profile facts into candidate_context in-place."""
    facts = derive_profile_facts(profile)

    def put(key: str, value: Any) -> None:
        if value not in (None, "") and key not in context:
            context[key] = value

    for key, value in facts.items():
        put(f"profile.derived.{key}", value)
        # Also mirror high-value facts under application_defaults so existing
        # sensitive-field guardrails accept them without inventing answers.
        if key in {
            "years_experience", "years_experience_text", "years_experience_int",
            "experience_bucket", "education_level", "availability", "seniority",
            "current_title", "current_company", "city", "country", "postal_code",
            "salary_expectation",
        }:
            put(f"profile.application_defaults.{key}", value)

    summary = profile.get("experience_summary") if isinstance(profile.get("experience_summary"), dict) else {}
    for key, value in summary.items():
        put(f"profile.experience_summary.{key}", value)

    experience = profile.get("experience") or []
    if isinstance(experience, list):
        for idx, item in enumerate(experience[:8]):
            if not isinstance(item, dict):
                continue
            for field in ("role", "title", "company", "duration", "location"):
                raw = item.get(field)
                if field == "title" and not raw:
                    raw = item.get("role")
                put(f"profile.experience.{idx}.{field}", raw)

    education = profile.get("education") or []
    if isinstance(education, dict):
        education = [education]
    if isinstance(education, list):
        for idx, item in enumerate(education[:5]):
            if not isinstance(item, dict):
                continue
            for field in ("school", "degree", "discipline", "field_of_study", "graduation_year", "year"):
                put(f"profile.education.{idx}.{field}", item.get(field))
