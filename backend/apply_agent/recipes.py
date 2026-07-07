"""Recipe cache: replay a previously-learned per-site field mapping instead
of calling the LLM again, falling back to the agent for anything the recipe
doesn't cover.

Critically, a recipe stores *source keys* (e.g. "profile.contact.email"),
never literal values -- replaying a recipe for a different candidate looks
up that candidate's own value for the recorded source key via the same
candidate_context used by the live agent path. A recipe can never inject one
candidate's data into another's application, and a recipe-sourced proposal
still goes through the exact same guardrails.validate_agent_fill gate as a
fresh agent proposal, so a recipe can never bypass the sensitive-field rule
either -- it can only ever have learned safe fills in the first place,
because only validated, accepted fills get recorded.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def recipe_key_for_url(url: str) -> str:
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower().removeprefix("www.")
    parts = [part for part in (parsed.path or "").split("/") if part]
    first_segment = parts[0].lower() if parts else ""
    return f"{host}/{first_segment}" if first_segment else host


async def get_recipe(db, key: str) -> Optional[Dict[str, Any]]:
    try:
        row = await db.apply_agent_recipes.find_one({"id": key}, {"_id": 0})
    except Exception as exc:
        logger.warning("apply_agent_recipe_lookup_failed key=%s error=%s", key, str(exc)[:200])
        return None
    return row


def propose_fills_from_recipe(
    fields: List[Dict[str, Any]],
    recipe: Optional[Dict[str, Any]],
    candidate_context: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Returns proposals for whichever fields the recipe covers AND the
    current candidate has a value for. Anything else is left for the agent.
    """
    if not recipe:
        return []
    field_recipes = recipe.get("field_recipes") or {}
    proposals: List[Dict[str, Any]] = []
    for field in fields:
        stable_id = field.get("stable_field_id")
        entry = field_recipes.get(stable_id)
        if not entry:
            continue
        source = entry.get("source")
        value = candidate_context.get(source)
        if value in (None, ""):
            continue
        proposals.append({
            "stable_field_id": stable_id,
            "value": value,
            "source": source,
            "confidence": 0.97,
            "via_recipe": True,
        })
    return proposals


def uncovered_fields(fields: List[Dict[str, Any]], recipe_proposals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    covered = {item["stable_field_id"] for item in recipe_proposals}
    return [f for f in fields if f.get("stable_field_id") not in covered]


async def record_successful_fills(
    db,
    key: str,
    provider: str,
    accepted_fills: List[Dict[str, Any]],
) -> None:
    """Called after a run whose fills were validated and applied without
    error. Only ever records source keys (see module docstring) -- never
    literal values, and never anything the guardrail didn't already approve.
    """
    if not accepted_fills:
        return
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    try:
        existing = await db.apply_agent_recipes.find_one({"id": key}, {"_id": 0}) or {}
        field_recipes = dict(existing.get("field_recipes") or {})
        for fill in accepted_fills:
            stable_id = fill.get("stable_field_id")
            source = fill.get("source")
            if not stable_id or not source or fill.get("via_recipe"):
                continue
            field_recipes[stable_id] = {"source": source, "label": fill.get("label")}
        await db.apply_agent_recipes.update_one(
            {"id": key},
            {"$set": {
                "id": key,
                "provider": provider,
                "field_recipes": field_recipes,
                "success_count": int(existing.get("success_count") or 0) + 1,
                "last_success_at": now,
                "updated_at": now,
                "created_at": existing.get("created_at") or now,
            }},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("apply_agent_recipe_record_failed key=%s error=%s", key, str(exc)[:200])


async def record_recipe_failure(db, key: str) -> None:
    """A cached field mapping stopped matching reality (selector/label
    changed) -- track it so a persistently-failing recipe can eventually be
    dropped rather than retried forever. Does not delete the recipe itself;
    individual field entries are naturally replaced as new successful runs
    record fresh mappings.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    try:
        existing = await db.apply_agent_recipes.find_one({"id": key}, {"_id": 0}) or {}
        await db.apply_agent_recipes.update_one(
            {"id": key},
            {"$set": {
                "id": key,
                "failure_count": int(existing.get("failure_count") or 0) + 1,
                "updated_at": now,
            }},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("apply_agent_recipe_failure_record_failed key=%s error=%s", key, str(exc)[:200])
