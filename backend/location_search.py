"""Worldwide location search — OpenStreetMap Nominatim (free) + optional Google Places."""

from __future__ import annotations

import os
import re
import time
import unicodedata
from typing import Any

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
GOOGLE_AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
USER_AGENT = "Swiipr/1.0 (https://github.com/swiipr; job-search onboarding)"

RELEVANT_OSM_TYPES = {
    "city",
    "town",
    "village",
    "hamlet",
    "municipality",
    "borough",
    "suburb",
    "locality",
    "isolated_dwelling",
    "farm",
    "county",
    "state",
    "region",
    "administrative",
    "postcode",
    "neighbourhood",
    "quarter",
    "district",
    "province",
    "state_district",
}

BLOCKED_PLACE_TYPES = {"", "yes", "no"}

# Common aliases → expanded search queries (regions, departments, states)
SEARCH_ALIASES: dict[str, list[str]] = {
    "bourgogne": ["Bourgogne-Franche-Comté, France", "Bourgogne, France"],
    "bourgogone": ["Bourgogne-Franche-Comté, France"],
    "franche-comte": ["Bourgogne-Franche-Comté, France"],
    "franche comte": ["Bourgogne-Franche-Comté, France"],
    "bretagne": ["Bretagne, France"],
    "normandie": ["Normandie, France"],
    "alsace": ["Grand Est, France", "Bas-Rhin, France", "Haut-Rhin, France"],
    "aquitaine": ["Nouvelle-Aquitaine, France"],
    "languedoc": ["Occitanie, France"],
    "midi-pyrenees": ["Occitanie, France"],
    "paca": ["Provence-Alpes-Côte d'Azur, France"],
    "provence": ["Provence-Alpes-Côte d'Azur, France"],
    "ile-de-france": ["Île-de-France, France"],
    "idf": ["Île-de-France, France"],
    "gironde": ["Gironde, Nouvelle-Aquitaine, France"],
    "marne": ["Marne, Grand Est, France"],
    "dordogne": ["Dordogne, Nouvelle-Aquitaine, France"],
    "cote-dor": ["Côte-d'Or, Bourgogne-Franche-Comté, France"],
    "cote d or": ["Côte-d'Or, Bourgogne-Franche-Comté, France"],
    "yonne": ["Yonne, Bourgogne-Franche-Comté, France"],
    "saone-et-loire": ["Saône-et-Loire, Bourgogne-Franche-Comté, France"],
    "catalonia": ["Catalonia, Spain", "Cataluña, Spain"],
    "cataluna": ["Catalonia, Spain"],
    "bavaria": ["Bavaria, Germany", "Bayern, Germany"],
    "bayern": ["Bavaria, Germany"],
    "lombardy": ["Lombardy, Italy", "Lombardia, Italy"],
    "tuscany": ["Tuscany, Italy", "Toscana, Italy"],
    "california": ["California, USA"],
    "texas": ["Texas, USA"],
    "ontario": ["Ontario, Canada"],
    "quebec": ["Quebec, Canada"],
}

_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_TTL_SEC = 300
_LAST_NOMINATIM_AT = 0.0


def _cache_get(key: str) -> list[dict[str, Any]] | None:
    row = _CACHE.get(key)
    if not row:
        return None
    ts, data = row
    if time.time() - ts > _CACHE_TTL_SEC:
        _CACHE.pop(key, None)
        return None
    return data


def _cache_set(key: str, data: list[dict[str, Any]]) -> None:
    if len(_CACHE) > 800:
        oldest = min(_CACHE.items(), key=lambda item: item[1][0])[0]
        _CACHE.pop(oldest, None)
    _CACHE[key] = (time.time(), data)


def _normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s-]", " ", text)
    return " ".join(text.split())


def _normalize_label(text: str) -> str:
    return _normalize_text(text)


def _alias_queries(query: str) -> list[str]:
    key = _normalize_text(query)
    extra = SEARCH_ALIASES.get(key, [])
    out = [query.strip()]
    for item in extra:
        if item not in out:
            out.append(item)
    deduped: list[str] = []
    for q in out:
        if q and q not in deduped:
            deduped.append(q)
    return deduped[:3]


def _is_duplicate(label: str, seen: set[str]) -> bool:
    norm = _normalize_label(label)
    if not norm or norm in seen:
        return True
    for existing in seen:
        if norm == existing:
            return True
    return False


def _is_too_generic(label: str, query: str) -> bool:
    norm_label = _normalize_label(label)
    norm_query = _normalize_label(query)
    generic = {
        "france metropolitaine france",
        "france",
        "metropolitan france",
    }
    if norm_label in generic:
        return True
    if norm_label == "france metropolitaine france" and norm_query not in norm_label:
        return True
    return False


def _format_nominatim_label(item: dict[str, Any]) -> str:
    addr = item.get("address") or {}
    osm_type = str(item.get("type") or "").lower()

    if osm_type == "administrative" and item.get("namedetails", {}).get("name"):
        name = str(item["namedetails"]["name"])
        country = str(addr.get("country") or "")
        state = str(addr.get("state") or addr.get("region") or "")
        if state and country:
            return f"{name}, {country}" if name == state else f"{name}, {state}, {country}"
        if country:
            return f"{name}, {country}"
        return name

    parts: list[str] = []
    for key in (
        "hamlet",
        "village",
        "town",
        "city",
        "municipality",
        "borough",
        "suburb",
        "county",
        "state_district",
        "state",
        "region",
        "country",
    ):
        val = addr.get(key)
        if val and str(val) not in parts:
            parts.append(str(val))

    if parts:
        if len(parts) >= 2 and parts[-1] == parts[-2]:
            parts = parts[:-1]
        return ", ".join(parts)

    display = str(item.get("display_name") or "").strip()
    if display:
        chunks = [part.strip() for part in display.split(",") if part.strip()]
        deduped: list[str] = []
        for chunk in chunks[:5]:
            if chunk not in deduped:
                deduped.append(chunk)
        return ", ".join(deduped)

    return str(item.get("name") or "").strip()


def _nominatim_kind(item: dict[str, Any]) -> str:
    osm_type = str(item.get("type") or "").lower()
    addr = item.get("address") or {}

    if osm_type == "administrative":
        admin_level = str(item.get("extratags", {}).get("admin_level") or addr.get("admin_level") or "")
        if admin_level in {"4", "5"}:
            return "region"
        if admin_level in {"6", "7", "8"}:
            return "county"

    for key in ("state", "region"):
        if addr.get(key):
            return "region"
    for key in ("county", "state_district"):
        if addr.get(key):
            return "county"
    for key in ("city", "town", "village", "hamlet", "municipality"):
        if addr.get(key):
            return key
    if osm_type in RELEVANT_OSM_TYPES:
        return osm_type
    return "place"


def _score_item(query: str, item: dict[str, Any], raw: dict[str, Any] | None = None) -> float:
    q = _normalize_text(query)
    label = _normalize_text(item.get("label") or "")
    country = _normalize_text(item.get("country") or "")
    kind = str(item.get("kind") or "")
    score = float(raw.get("importance") or 0) if raw else 0.0

    if not q or not label:
        return score

    if label.startswith(q) or q in label:
        score += 120
    if any(part == q or part.startswith(q) for part in label.split(",")):
        score += 90

    if kind in {"region", "state", "county"}:
        score += 45
    elif kind in {"city", "town"}:
        score += 25
    elif kind in {"village", "hamlet", "locality", "municipality"}:
        score += 18

    addr = (raw or {}).get("address") or {}
    for field in ("state", "region", "county", "state_district", "city", "town"):
        val = _normalize_text(str(addr.get(field) or ""))
        if val and (val == q or q in val or val in q):
            score += 70

    if _is_too_generic(item.get("label") or "", query):
        score -= 200

    if country and country not in label and q not in _normalize_text(country):
        if "france" not in q and country not in {"france", "fr"}:
            foreign_hits = sum(1 for token in q.split() if token in label)
            if foreign_hits == 0:
                score -= 35

    if any(token in label for token in ("casablanca", "maroc", "morocco")):
        if not any(token in q for token in ("casablanca", "maroc", "morocco")):
            score -= 250

    return score


def _item_from_nominatim(item: dict[str, Any], query: str) -> dict[str, Any] | None:
    osm_type = str(item.get("type") or "").lower()
    osm_class = str(item.get("class") or "").lower()

    if osm_class == "place":
        if osm_type in BLOCKED_PLACE_TYPES:
            return None
    elif osm_class == "boundary":
        if osm_type in {"historic", "yes"}:
            return None
    elif osm_class not in {"boundary", "place"}:
        return None

    label = _format_nominatim_label(item)
    if not label or _is_too_generic(label, query):
        return None

    addr = item.get("address") or {}
    country = str(addr.get("country") or "")
    country_code = str(addr.get("country_code") or "").lower()
    kind = _nominatim_kind(item)

    result = {
        "id": f"osm:{item.get('osm_type')}:{item.get('osm_id')}",
        "label": label,
        "source": "nominatim",
        "place_id": str(item.get("place_id") or item.get("osm_id") or ""),
        "country": country,
        "country_code": country_code,
        "lat": float(item["lat"]) if item.get("lat") else None,
        "lng": float(item["lon"]) if item.get("lon") else None,
        "kind": kind,
        "_score": _score_item(query, {"label": label, "country": country, "kind": kind}, item),
    }
    return result


async def _sleep(seconds: float) -> None:
    import asyncio

    await asyncio.sleep(seconds)


async def _nominatim_request(query: str, limit: int) -> list[dict[str, Any]]:
    global _LAST_NOMINATIM_AT

    elapsed = time.time() - _LAST_NOMINATIM_AT
    if elapsed < 1.05:
        await _sleep(1.05 - elapsed)

    async with httpx.AsyncClient(timeout=12.0) as client:
        response = await client.get(
            NOMINATIM_URL,
            params={
                "q": query,
                "format": "json",
                "addressdetails": 1,
                "namedetails": 1,
                "extratags": 1,
                "limit": max(limit * 4, 20),
                "dedupe": 1,
                "accept-language": "en",
            },
            headers={"User-Agent": USER_AGENT},
        )
        _LAST_NOMINATIM_AT = time.time()
        response.raise_for_status()
        payload = response.json()

    return payload if isinstance(payload, list) else []


def _collect_nominatim_rows(
    payload: list[dict[str, Any]],
    query: str,
    seen_ids: set[str],
    collected: list[dict[str, Any]],
) -> None:
    for raw in payload:
        osm_id = f"{raw.get('osm_type')}:{raw.get('osm_id')}"
        if osm_id in seen_ids:
            continue
        seen_ids.add(osm_id)
        item = _item_from_nominatim(raw, query)
        if item:
            collected.append(item)


async def _search_nominatim(query: str, limit: int = 10) -> list[dict[str, Any]]:
    cache_key = f"nominatim:{query.lower()}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    collected: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    queries = _alias_queries(query)

    try:
        payload = await _nominatim_request(queries[0], limit)
        _collect_nominatim_rows(payload, query, seen_ids, collected)
    except Exception:
        pass

    if len(collected) < max(2, limit // 2):
        for q in queries[1:]:
            try:
                payload = await _nominatim_request(q, limit)
            except Exception:
                continue
            _collect_nominatim_rows(payload, query, seen_ids, collected)
            if len(collected) >= limit:
                break

    collected.sort(key=lambda row: row.get("_score", 0), reverse=True)
    out = []
    for row in collected:
        clean = {k: v for k, v in row.items() if k != "_score"}
        out.append(clean)
        if len(out) >= limit:
            break

    _cache_set(cache_key, out)
    return out


async def _search_google(query: str, api_key: str, limit: int = 8, types: str = "(regions)") -> list[dict[str, Any]]:
    cache_key = f"google:{types}:{query.lower()}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            GOOGLE_AUTOCOMPLETE_URL,
            params={
                "input": query,
                "types": types,
                "language": "en",
                "key": api_key,
            },
        )
        response.raise_for_status()
        payload = response.json()

    if payload.get("status") not in {"OK", "ZERO_RESULTS"}:
        return []

    out: list[dict[str, Any]] = []
    for pred in (payload.get("predictions") or [])[:limit]:
        description = str(pred.get("description") or "").strip()
        place_id = str(pred.get("place_id") or "").strip()
        if not description or _is_too_generic(description, query):
            continue
        terms = pred.get("terms") or []
        country = str(terms[-1].get("value") or "") if terms else ""
        types_list = pred.get("types") or []
        kind = "region"
        if "locality" in types_list:
            kind = "city"
        elif "administrative_area_level_2" in types_list:
            kind = "county"
        elif "administrative_area_level_1" in types_list:
            kind = "region"

        out.append(
            {
                "id": f"google:{place_id}",
                "label": description,
                "source": "google",
                "place_id": place_id,
                "country": country,
                "country_code": "",
                "lat": None,
                "lng": None,
                "kind": kind,
            }
        )

    _cache_set(cache_key, out)
    return out


def to_location_payload(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "location_label": item.get("label") or "",
        "place_id": item.get("place_id") or "",
        "country": item.get("country") or "",
        "country_code": item.get("country_code") or "",
        "lat": item.get("lat"),
        "lng": item.get("lng"),
        "source": item.get("source") or "",
        "kind": item.get("kind") or "",
    }


def _merge_scored(query: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for row in rows:
        if "_score" not in row:
            row["_score"] = _score_item(query, row)
    rows.sort(key=lambda r: r.get("_score", 0), reverse=True)
    return [{k: v for k, v in row.items() if k != "_score"} for row in rows]


async def search_locations(query: str, limit: int = 10) -> dict[str, Any]:
    q = (query or "").strip()
    if len(q) < 1:
        return {"results": [], "source": "none"}

    limit = max(1, min(limit, 15))
    google_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    sources: list[str] = []

    search_queries = _alias_queries(q)

    if google_key:
        try:
            google_rows: list[dict[str, Any]] = []
            for gq in search_queries[:2]:
                google_rows.extend(await _search_google(gq, google_key, limit=limit, types="(regions)"))
                google_rows.extend(await _search_google(gq, google_key, limit=max(4, limit // 2), types="geocode"))
            if google_rows:
                sources.append("google")
            for row in _merge_scored(q, google_rows):
                label = row["label"]
                if _is_duplicate(label, seen):
                    continue
                seen.add(_normalize_label(label))
                merged.append(row)
        except Exception:
            pass

    try:
        nominatim_rows = await _search_nominatim(q, limit=limit * 2)
        if nominatim_rows:
            sources.append("nominatim")
        for row in nominatim_rows:
            label = row["label"]
            if _is_duplicate(label, seen):
                continue
            seen.add(_normalize_label(label))
            merged.append(row)
    except Exception:
        pass

    merged = _merge_scored(q, merged)
    filtered: list[dict[str, Any]] = []
    for row in merged:
        label_norm = _normalize_label(row.get("label") or "")
        if any(token in label_norm for token in ("casablanca", "maroc", "morocco")):
            if not any(token in _normalize_text(q) for token in ("casablanca", "maroc", "morocco")):
                continue
        if _is_too_generic(row.get("label") or "", q):
            continue
        filtered.append(row)

    merged = filtered[:limit]
    source = sources[0] if len(sources) == 1 else ("mixed" if sources else "none")
    return {"results": merged, "source": source}
