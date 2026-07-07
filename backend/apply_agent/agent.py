"""The agent: an LLM decision loop over the universal perception layer.

This replaces the old per-ATS hand-coded field-classification/answer-
resolution engines (~4000 lines across greenhouse.py/lever.py). Instead of
regex-matching field labels against per-provider rules, the candidate's
approved data sources and the page's perceived fields are handed to the LLM
once per page, and it proposes a fill for each field the same way a human
applicant would read the form -- by meaning, not by memorized selector.

The agent's output is a *proposal*, never trusted directly. Every single
proposed fill still passes through `guardrails.validate_agent_fill` before
anything is typed into the page -- the agent cannot fill a sensitive/legal
field unless the candidate already has an explicit saved answer for it, and
it cannot claim a value came from a source it wasn't given.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from llm_client import LLMProviderNotConfigured, complete_json_text

from .guardrails import canonical, is_sensitive_field, validate_agent_fill

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are filling a job application form on behalf of a candidate.

You will be given:
- "candidate_context": a flat map of source_key -> value. These are the ONLY
  values you may ever use. Never invent, infer, or guess a value that is not
  present here.
- "fields": every visible, fillable field on the page.
- "job": the job posting this application is for.

For each field in "fields", decide one of:
1. Fill it, using a value copied verbatim from "candidate_context", citing
   the exact source_key you used.
2. Leave it unfilled (omit it from your response) if no matching value
   exists in candidate_context, or if you are not confident it's the right
   match.

Hard rules, no exceptions:
- Sensitive/legal questions (visa status, work authorization, sponsorship,
  salary/compensation, relocation, criminal history, non-compete, disability,
  veteran status, gender, race, ethnicity, sexual orientation, and similar)
  may ONLY be filled if candidate_context already contains an explicit answer
  for that exact topic. If it does not, leave the field unfilled -- do not
  guess, do not pick a "safe-sounding" answer, do not use a decline option
  unless candidate_context explicitly says the candidate prefers to decline.
- For file upload fields, use the literal source_key as the value (the
  system handles the actual upload separately).
- For simple low-stakes questions with an obvious safe default (e.g. "how
  did you hear about us", marketing/newsletter opt-in, a general privacy/data
  -processing consent checkbox that is not itself a sensitive topic), you may
  answer using source "safe_default.<short_key>" with a reasonable value even
  if it's not literally in candidate_context.
- For open-ended fields that are clearly a "why do you want to work here" /
  motivation / cover-letter-style question, use
  candidate_context["application.generated_answers"] or
  candidate_context["application.motivation_summary"] if present.
- If a field's required options don't include anything matching the value
  you'd otherwise pick, leave it unfilled rather than picking something
  close-but-wrong.

Return ONLY a JSON object: {"fills": [{"stable_field_id": "...", "value": "...", "source": "...", "confidence": 0.0-1.0}, ...]}
Omit any field you're not filling. Do not include commentary.
"""


def build_candidate_context(profile: Dict[str, Any], app_doc: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    """The exhaustive list of everything the agent is allowed to use. If a
    value isn't in this dict, the agent has no way to reference it as a
    source, and guardrails.validate_agent_fill will reject any fill that
    doesn't cite an entry here anyway.
    """
    contact = profile.get("contact") or {}
    location_data = profile.get("target_location_data") or {}
    context: Dict[str, Any] = {}

    def put(key: str, value: Any) -> None:
        if value not in (None, ""):
            context[key] = value

    first_name = contact.get("first_name") or _first_name(contact.get("name") or user.get("name"))
    last_name = contact.get("last_name") or _last_name(contact.get("name") or user.get("name"))
    put("profile.contact.first_name", first_name)
    put("profile.contact.last_name", last_name)
    # A single atomic key for "full name" style fields -- without this the
    # agent tends to synthesize a compound expression like "first_name + ' '
    # + last_name" as its `source`, which is still guardrail-safe (it starts
    # with the approved profile.contact. prefix) but doesn't match any real
    # candidate_context key, so a recipe can never replay it for free.
    put("profile.contact.full_name", " ".join(part for part in (first_name, last_name) if part).strip())
    put("profile.contact.email", contact.get("email") or user.get("email"))
    put("profile.contact.phone", contact.get("phone"))
    put("profile.contact.location", contact.get("location") or location_data.get("location_label") or profile.get("target_location"))
    put("profile.contact.country", location_data.get("country") or contact.get("country"))
    put("profile.contact.linkedin", contact.get("linkedin"))
    put("profile.contact.website", contact.get("website") or contact.get("github"))

    for key, value in (profile.get("application_defaults") or {}).items():
        put(f"profile.application_defaults.{key}", value)
    for key, value in (profile.get("application_answers_profile") or {}).items():
        put(f"profile.application_answers_profile.{key}", value)

    education_items = profile.get("education") or []
    if isinstance(education_items, dict):
        education_items = [education_items]
    if education_items and isinstance(education_items[0], dict):
        first = education_items[0]
        put("profile.education.school", first.get("school") or first.get("institution"))
        put("profile.education.degree", first.get("degree") or first.get("qualification"))
        put("profile.education.discipline", first.get("discipline") or first.get("field_of_study"))
        put("profile.education.graduation_year", first.get("graduation_year") or first.get("year"))

    if app_doc.get("tailored_cv_file_b64") or app_doc.get("tailored_cv_text"):
        context["application.tailored_cv_file"] = "__resume_file__"
    cover_letter_text = _cover_letter_text(app_doc)
    if cover_letter_text:
        context["application.cover_letter_file"] = "__cover_letter_file__"
        context["application.motivation_summary"] = _concise(cover_letter_text)
    for item in app_doc.get("prepared_generated_answers") or app_doc.get("application_answers") or []:
        if isinstance(item, dict) and item.get("answer") and item.get("question"):
            context.setdefault("application.generated_answers", str(item["answer"]))

    payload = app_doc.get("prepared_application_payload") or {}
    for question in payload.get("questions") or []:
        if isinstance(question, dict) and question.get("value"):
            key = canonical(str(question.get("label") or question.get("name") or ""))
            if key:
                context[f"prepared_application_payload.{key}"] = str(question["value"])

    return context


def _first_name(name: Optional[str]) -> str:
    parts = [part for part in str(name or "").split() if part]
    return parts[0] if parts else ""


def _last_name(name: Optional[str]) -> str:
    parts = [part for part in str(name or "").split() if part]
    return " ".join(parts[1:]) if len(parts) > 1 else ""


def _cover_letter_text(app_doc: Dict[str, Any]) -> str:
    try:
        from application_documents import cover_letter_to_text
        return cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
    except Exception:
        return ""


def _concise(text: str, max_words: int = 140) -> str:
    words = text.split()
    return text if len(words) <= max_words else " ".join(words[:max_words]) + "..."


def _fillable_field_summary(field: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "stable_field_id": field.get("stable_field_id"),
        "label": field.get("label") or "",
        "widget_type": field.get("widget_type") or field.get("type"),
        "required": bool(field.get("required")),
        "options": [
            (opt.get("label") or opt.get("value")) if isinstance(opt, dict) else opt
            for opt in (field.get("options") or [])
        ][:40],
        "surrounding_question_text": (field.get("surrounding_question_text") or "")[:300],
    }


async def plan_fills(
    fields: List[Dict[str, Any]],
    job: Dict[str, Any],
    candidate_context: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """One planning call covering every visible fillable field. Returns raw
    agent proposals -- callers MUST still run each through
    guardrails.validate_agent_fill before touching the page.
    """
    fillable = [
        f for f in fields
        if f.get("visible") and not f.get("disabled") and f.get("widget_type") != "file_upload"
    ]
    if not fillable:
        return []

    prompt = {
        "job": {
            "company": job.get("company") or "",
            "title": job.get("title") or "",
            "location": job.get("location") or "",
        },
        "candidate_context": candidate_context,
        "fields": [_fillable_field_summary(f) for f in fillable],
    }
    try:
        raw = await complete_json_text(_SYSTEM_PROMPT, json.dumps(prompt, ensure_ascii=True))
        parsed = json.loads(raw)
    except LLMProviderNotConfigured:
        logger.info("apply_agent_llm_not_configured")
        return []
    except Exception as exc:
        logger.warning("apply_agent_plan_failed error=%s", f"{exc.__class__.__name__}: {exc}"[:300])
        return []

    fills = parsed.get("fills") if isinstance(parsed, dict) else None
    if not isinstance(fills, list):
        return []
    return [item for item in fills if isinstance(item, dict) and item.get("stable_field_id")]


def resolve_file_upload_fields(fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """File inputs never go through the LLM -- classified deterministically
    by label, same policy as the old system, just centralized here.
    """
    resolved = []
    for field in fields:
        if field.get("widget_type") != "file_upload" or not field.get("visible") or field.get("disabled"):
            continue
        label = canonical(" ".join(str(field.get(key) or "") for key in ("label", "name", "id", "aria_label")))
        if "cover" in label and "letter" in label:
            resolved.append({"stable_field_id": field.get("stable_field_id"), "value": "__cover_letter_file__", "source": "application.cover_letter_file", "confidence": 0.9})
        elif any(term in label for term in ("resume", "cv", "upload")):
            resolved.append({"stable_field_id": field.get("stable_field_id"), "value": "__resume_file__", "source": "application.tailored_cv_file", "confidence": 1.0})
    return resolved


def validated_plan(
    fields: List[Dict[str, Any]],
    proposals: List[Dict[str, Any]],
    profile: Dict[str, Any],
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Runs every agent proposal through the guardrail. Returns
    (accepted, rejected) -- rejected entries carry the rejection reason for
    audit/debugging, and are never applied to the page.
    """
    by_id = {f.get("stable_field_id"): f for f in fields}
    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    for proposal in proposals:
        field = by_id.get(proposal.get("stable_field_id"))
        if not field:
            rejected.append({**proposal, "reason": "unknown_field_id"})
            continue
        ok, reason = validate_agent_fill(field, proposal, profile)
        if ok:
            accepted.append({**proposal, "label": field.get("label")})
        else:
            rejected.append({**proposal, "label": field.get("label"), "reason": reason})
    return accepted, rejected
