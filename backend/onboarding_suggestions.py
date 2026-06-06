"""Region- and contract-aware job category/role suggestions for onboarding."""

from __future__ import annotations

import json
import re
from typing import Any

from llm_client import LLMProviderNotConfigured, complete_json_text

CONTRACT_LABELS = {
    "permanent": "Permanent contract (CDI)",
    "fixed_term": "Fixed-term contract (CDD)",
    "internship": "Internship",
    "apprenticeship": "Apprenticeship",
    "summer_job": "Summer job",
    "part_time": "Part-time",
    "seasonal": "Seasonal work",
    "freelance": "Freelance / contract",
}


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return slug[:48] or "category"


def _parse_json(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    return json.loads(text)


def _location_hint(location: str, location_data: dict[str, Any] | None) -> str:
    parts = [location or ""]
    if location_data:
        for key in ("location_label", "country", "country_code"):
            val = location_data.get(key)
            if val and val not in parts:
                parts.append(str(val))
    return ", ".join(p for p in parts if p).strip() or "Unknown region"


def _fallback_categories(location: str, contract_type: str) -> list[dict[str, str]]:
    loc = (location or "").lower()
    contract = contract_type or ""

    if contract == "summer_job":
        if any(k in loc for k in ("bordeaux", "bourgogne", "champagne", "languedoc", "provence", "alsace", "loire", "rhône", "rhone", "vineyard", "wine")):
            return [
                {"id": "agriculture", "label": "Agriculture & Harvest"},
                {"id": "retail", "label": "Retail & Sales Floor"},
                {"id": "hospitality_food", "label": "Hospitality & Food"},
                {"id": "transport", "label": "Transport & Delivery"},
            ]
        if any(k in loc for k in ("france", "paris", "lyon", "marseille", "toulouse", "nice")):
            return [
                {"id": "retail", "label": "Retail & Sales Floor"},
                {"id": "hospitality_food", "label": "Hospitality & Food"},
                {"id": "education_childcare", "label": "Education & Childcare"},
                {"id": "customer", "label": "Customer Success"},
            ]
        return [
            {"id": "retail", "label": "Retail & Sales Floor"},
            {"id": "hospitality_food", "label": "Hospitality & Food"},
            {"id": "agriculture", "label": "Agriculture & Harvest"},
            {"id": "customer", "label": "Customer Success"},
        ]

    if contract in ("internship", "apprenticeship"):
        return [
            {"id": "software", "label": "Software Engineering"},
            {"id": "marketing", "label": "Marketing"},
            {"id": "finance", "label": "Finance"},
            {"id": "design", "label": "Design"},
            {"id": "operations", "label": "Operations & Strategy"},
        ]

    if contract in ("seasonal", "part_time"):
        return [
            {"id": "retail", "label": "Retail & Sales Floor"},
            {"id": "logistics", "label": "Logistics & Warehouse"},
            {"id": "hospitality_food", "label": "Hospitality & Food"},
            {"id": "agriculture", "label": "Agriculture & Harvest"},
        ]

    return [
        {"id": "software", "label": "Software Engineering"},
        {"id": "operations", "label": "Operations & Strategy"},
        {"id": "sales", "label": "Sales"},
        {"id": "marketing", "label": "Marketing"},
        {"id": "healthcare", "label": "Healthcare"},
        {"id": "finance", "label": "Finance"},
    ]


def _fallback_roles(
    location: str,
    contract_type: str,
    categories: list[dict[str, str]],
) -> list[str]:
    loc = (location or "").lower()
    labels = " ".join(c.get("label", "") for c in categories).lower()
    contract = contract_type or ""

    if contract == "summer_job" and ("agriculture" in labels or "harvest" in labels):
        if any(k in loc for k in ("bordeaux", "bourgogne", "champagne", "vineyard", "wine", "grape")):
            return [
                "Manual grape harvester",
                "Vineyard worker",
                "Fruit picker",
                "Farm hand",
                "Agricultural laborer",
            ]
        return [
            "Fruit picker",
            "Farm hand",
            "Harvest worker",
            "Greenhouse assistant",
            "Agricultural laborer",
        ]

    if "retail" in labels or "sales" in labels:
        return [
            "Retail sales associate",
            "Cashier",
            "Stockroom assistant",
            "Visual merchandising assistant",
            "Customer advisor",
        ]

    if "hospitality" in labels or "food" in labels or "restaurant" in labels:
        return [
            "Server",
            "Waiter",
            "Waitress",
            "Bartender",
            "Kitchen Porter",
            "Barista",
            "Hotel Front Desk",
        ]

    if "technology" in labels or "software" in labels:
        return [
            "Software engineer intern",
            "Junior developer",
            "QA engineer",
            "IT support specialist",
            "Data analyst intern",
        ]

    return [
        "Administrative assistant",
        "Customer support representative",
        "Operations coordinator",
        "Sales representative",
        "Marketing assistant",
    ]


async def suggest_categories(
    location: str,
    contract_type: str,
    location_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    region = _location_hint(location, location_data)
    contract_label = CONTRACT_LABELS.get(contract_type, contract_type or "Not specified")

    try:
        system = (
            "You are a career advisor for job seekers. Return ONLY valid JSON. "
            "Suggest realistic job categories for the user's region and contract type."
        )
        prompt = f"""Region: {region}
Contract / duration type: {contract_label}

Return JSON:
{{
  "categories": [
    {{"id": "short_snake_case_id", "label": "Human-readable category name in English"}}
  ]
}}

Rules:
- Provide 6 to 10 categories relevant to this region and contract type.
- For summer jobs in wine regions (e.g. Bordeaux, Burgundy), include agriculture/harvest and retail.
- For permanent roles in cities, include professional categories suited to that market.
- Labels must be in English.
- ids must be unique snake_case."""
        raw = await complete_json_text(system, prompt)
        parsed = _parse_json(raw)
        items = parsed.get("categories") or []
        cleaned: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip()
            if not label:
                continue
            cid = str(item.get("id") or _slugify(label)).strip() or _slugify(label)
            if cid in seen:
                cid = f"{cid}_{len(seen)}"
            seen.add(cid)
            cleaned.append({"id": cid, "label": label})
            if len(cleaned) >= 10:
                break
        if cleaned:
            return {"categories": cleaned, "source": "ai"}
    except (LLMProviderNotConfigured, json.JSONDecodeError, KeyError, TypeError):
        pass

    return {
        "categories": _fallback_categories(region, contract_type),
        "source": "fallback",
    }


async def suggest_roles(
    location: str,
    contract_type: str,
    categories: list[dict[str, str]],
    location_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    region = _location_hint(location, location_data)
    contract_label = CONTRACT_LABELS.get(contract_type, contract_type or "Not specified")
    category_labels = [c.get("label", "") for c in categories if c.get("label")]

    try:
        system = (
            "You are a career advisor. Return ONLY valid JSON with specific job titles "
            "a candidate could search for in their region."
        )
        prompt = f"""Region: {region}
Contract / duration type: {contract_label}
Selected categories: {", ".join(category_labels) or "General"}

Return JSON:
{{
  "roles": ["Specific job title in English", "..."]
}}

Rules:
- Provide 12 to 18 concrete job titles.
- Titles must match the region (local industry) and contract type.
- For summer jobs in French wine regions, include examples like manual grape harvester and retail sales associate.
- English only. No duplicates."""
        raw = await complete_json_text(system, prompt)
        parsed = _parse_json(raw)
        roles = parsed.get("roles") or []
        cleaned = []
        seen: set[str] = set()
        for role in roles:
            title = str(role).strip()
            if not title:
                continue
            key = title.lower()
            if key in seen:
                continue
            seen.add(key)
            cleaned.append(title)
            if len(cleaned) >= 18:
                break
        if cleaned:
            return {"roles": cleaned, "source": "ai"}
    except (LLMProviderNotConfigured, json.JSONDecodeError, KeyError, TypeError):
        pass

    return {
        "roles": _fallback_roles(region, contract_type, categories),
        "source": "fallback",
    }
