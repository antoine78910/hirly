"""Career-coach helpers — wraps Claude Sonnet 4.5 for the Interviews and Improve tabs.

All callers go through the cache layer on `db.profiles` (`profile.coach.*`) with a 24h TTL,
so a re-visit to the page doesn't burn Claude credits.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from llm_client import complete_json_text

logger = logging.getLogger(__name__)


def _parse_json(text: str) -> Any:
    """Best-effort JSON extraction (LLMs sometimes wrap in code fences)."""
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3]
    # Find the outermost {...} or [...]
    for start, end in (("{", "}"), ("[", "]")):
        i, j = text.find(start), text.rfind(end)
        if i != -1 and j != -1 and j > i:
            try:
                return json.loads(text[i:j + 1])
            except json.JSONDecodeError:
                pass
    return json.loads(text)


async def claude_interview_prep(profile: Dict[str, Any]) -> Dict[str, Any]:
    role = (profile.get("target_roles") or ["Software Engineer"])[0]
    skills = ", ".join((profile.get("skills") or [])[:12]) or "general professional skills"
    seniority = profile.get("seniority") or "mid"

    system_message = "You are an elite interview coach. Output ONLY valid JSON (no fences, no prose)."

    prompt = f"""Generate role-specific interview prep for this candidate.

Target role: {role}
Seniority: {seniority}
Key skills: {skills}

Return JSON with this exact schema:
{{
  "likely_questions": [
    {{ "category": "Behavioral|Technical|System Design|Role-fit", "q": "the question", "why": "1 sentence on what the interviewer is probing" }},
    ... 8 items total ...
  ],
  "tips": [ "5 short, specific, actionable tips (max 14 words each) tailored to this role" ],
  "mock_questions": [
    "5 questions the candidate will answer in a 5-question mock interview. Mix 2 behavioral, 2 technical/role-specific, 1 closing 'why this role'."
  ]
}}

Tone: concise, modern, no fluff. Return ONLY the JSON object."""
    response = await complete_json_text(system_message, prompt)
    data = _parse_json(response)
    # safety defaults
    data.setdefault("likely_questions", [])
    data.setdefault("tips", [])
    data.setdefault("mock_questions", [])
    return data


async def claude_interview_score(
    profile: Dict[str, Any], questions: List[str], answers: List[str]
) -> Dict[str, Any]:
    role = (profile.get("target_roles") or ["Software Engineer"])[0]

    system_message = "You are a senior interview evaluator. Output ONLY valid JSON."

    pairs = "\n\n".join(
        f"Q{i + 1}: {q}\nA{i + 1}: {a or '(no answer)'}"
        for i, (q, a) in enumerate(zip(questions, answers))
    )

    prompt = f"""Score this candidate's mock interview for the role "{role}".

{pairs}

Return JSON with this exact schema:
{{
  "confidence": <int 0-100>,
  "communication": <int 0-100>,
  "technical": <int 0-100>,
  "overall": <int 0-100>,
  "headline": "one-line verdict (max 12 words)",
  "strengths": ["2-3 concrete strengths"],
  "improvements": ["2-3 specific improvements with examples"]
}}

Be honest, calibrated, and concise. Empty answers should drop scores. Return ONLY the JSON."""
    response = await complete_json_text(system_message, prompt)
    data = _parse_json(response)
    for k in ("confidence", "communication", "technical", "overall"):
        v = data.get(k, 0)
        try:
            data[k] = max(0, min(100, int(v)))
        except (TypeError, ValueError):
            data[k] = 0
    data.setdefault("headline", "")
    data.setdefault("strengths", [])
    data.setdefault("improvements", [])
    return data


async def claude_improve_analysis(profile: Dict[str, Any]) -> Dict[str, Any]:
    role = (profile.get("target_roles") or ["Software Engineer"])[0]
    skills = ", ".join((profile.get("skills") or [])[:20]) or "—"
    exp_summary = " | ".join(
        f"{(e or {}).get('role', '')} @ {(e or {}).get('company', '')}"
        for e in (profile.get("experience") or [])[:5]
    ) or "—"

    system_message = (
            "You are a senior career coach + recruiter. Output ONLY valid JSON. "
            "Be specific, modern, and honest — surface real gaps."
    )

    prompt = f"""Analyse this candidate's profile and produce concrete, actionable career improvements.

Target role: {role}
Current skills: {skills}
Experience: {exp_summary}

Return JSON with this exact schema:
{{
  "recruiter_view": {{
    "summary": "2-3 sentences describing how a senior recruiter would view this profile today",
    "score": <int 0-100>,
    "label": "Strong | Solid | Promising | Needs work"
  }},
  "resume_tips": [
    {{ "title": "Short imperative tip", "detail": "1-2 sentence concrete suggestion" }},
    ... 4-5 items
  ],
  "skill_gaps": [
    {{ "skill": "specific skill", "why": "why it matters for the target role", "impact": "high|medium|low" }},
    ... 4-5 items
  ],
  "certifications": [
    {{ "name": "certification or course name", "provider": "AWS / Coursera / etc", "why": "1 line on value", "duration": "approx weeks" }},
    ... 3-4 items
  ],
  "tips": [ "3-4 personalized improvement tips (max 16 words each)" ]
}}

Return ONLY the JSON object."""
    response = await complete_json_text(system_message, prompt)
    data = _parse_json(response)
    data.setdefault("resume_tips", [])
    data.setdefault("skill_gaps", [])
    data.setdefault("certifications", [])
    data.setdefault("tips", [])
    data.setdefault("recruiter_view", {"summary": "", "score": 0, "label": ""})
    return data


def is_fresh(cached: Dict[str, Any], hours: int = 24) -> bool:
    """Check whether a cached coach payload is still within TTL."""
    if not cached or not isinstance(cached, dict):
        return False
    ts = cached.get("_cached_at")
    if not ts:
        return False
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError:
        return False
    delta = datetime.now(timezone.utc) - dt
    return delta.total_seconds() < hours * 3600


def stamp(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {**payload, "_cached_at": datetime.now(timezone.utc).isoformat()}
