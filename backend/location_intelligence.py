"""Global place resolution and radius expansion helpers.

This module is intentionally not wired into the production feed yet. It
provides the reusable foundation for later DB-first and JSearch radius work.
"""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any, Dict, List, Optional

EARTH_RADIUS_KM = 6371.0088


def normalize_place_name(value: Optional[str]) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return " ".join(text.split())


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    phi1 = math.radians(float(lat1))
    phi2 = math.radians(float(lat2))
    delta_phi = math.radians(float(lat2) - float(lat1))
    delta_lambda = math.radians(float(lng2) - float(lng1))
    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def radius_bounding_box(lat: float, lng: float, radius_km: float) -> Dict[str, float]:
    lat = float(lat)
    lng = float(lng)
    radius_km = max(0.0, float(radius_km))
    lat_delta = math.degrees(radius_km / EARTH_RADIUS_KM)
    cos_lat = math.cos(math.radians(lat))
    lng_delta = 180.0 if abs(cos_lat) < 1e-9 else math.degrees(radius_km / (EARTH_RADIUS_KM * cos_lat))
    return {
        "min_lat": max(-90.0, lat - lat_delta),
        "max_lat": min(90.0, lat + lat_delta),
        "min_lng": max(-180.0, lng - lng_delta),
        "max_lng": min(180.0, lng + lng_delta),
    }


def _as_float(value: Any) -> Optional[float]:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _place_document(row: Dict[str, Any], *, distance_km: Optional[float] = None, is_origin: bool = False) -> Dict[str, Any]:
    name = row.get("name") or row.get("location_label") or row.get("label") or ""
    country_code = str(row.get("country_code") or "").lower()
    out = {
        "name": name,
        "normalized_name": row.get("normalized_name") or normalize_place_name(name),
        "ascii_name": row.get("ascii_name"),
        "country_code": country_code,
        "latitude": _as_float(row.get("latitude") if row.get("latitude") is not None else row.get("lat")),
        "longitude": _as_float(row.get("longitude") if row.get("longitude") is not None else row.get("lng")),
        "population": int(row.get("population") or 0),
        "source": row.get("source") or "input",
    }
    if distance_km is not None:
        out["distance_km"] = round(float(distance_km), 2)
    if is_origin:
        out["is_origin"] = True
    return out


def _query_label(row: Dict[str, Any]) -> str:
    name = row.get("ascii_name") or row.get("name") or ""
    code = str(row.get("country_code") or "").upper()
    return f"{name}, {code}" if code else str(name)


async def _find_name_candidates(db: Any, normalized: str, country_hint: Optional[str]) -> List[Dict[str, Any]]:
    if db is None or not hasattr(db, "geo_places"):
        return []
    collection = db.geo_places
    filters = [
        {"normalized_name": normalized},
        {"ascii_name": normalized},
        {"name": normalized},
    ]
    rows: List[Dict[str, Any]] = []
    seen = set()
    for filter_value in filters:
        try:
            found = await collection.find(filter_value, {"_id": 0}).limit(50).to_list(50)
        except Exception:
            continue
        for row in found:
            key = row.get("geoname_id") or f"{row.get('name')}:{row.get('country_code')}:{row.get('latitude')}:{row.get('longitude')}"
            if key in seen:
                continue
            seen.add(key)
            rows.append(row)
    if not rows:
        try:
            found = await collection.find({}, {"_id": 0}).limit(5000).to_list(5000)
        except Exception:
            return []
        for row in found:
            names = [row.get("name"), row.get("ascii_name"), *(row.get("alternate_names") or [])]
            if any(normalize_place_name(str(name)) == normalized for name in names if name):
                rows.append(row)

    hint = str(country_hint or "").lower().strip()
    if hint:
        hinted = [row for row in rows if str(row.get("country_code") or "").lower() == hint]
        if hinted:
            rows = hinted
    rows.sort(key=lambda row: int(row.get("population") or 0), reverse=True)
    return rows


async def resolve_location(
    location_label: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    country_hint: Optional[str] = None,
    db: Any = None,
) -> Optional[Dict[str, Any]]:
    lat_value = _as_float(lat)
    lng_value = _as_float(lng)
    if lat_value is not None and lng_value is not None:
        name = location_label or ""
        return {
            "name": name,
            "normalized_name": normalize_place_name(name),
            "country_code": str(country_hint or "").lower() or None,
            "latitude": lat_value,
            "longitude": lng_value,
            "population": 0,
            "source": "frontend_coordinates",
        }

    normalized = normalize_place_name(location_label)
    if not normalized:
        return None
    candidates = await _find_name_candidates(db, normalized, country_hint)
    if candidates:
        return _place_document(candidates[0])
    return {
        "name": location_label or "",
        "normalized_name": normalized,
        "country_code": str(country_hint or "").lower() or None,
        "latitude": None,
        "longitude": None,
        "population": 0,
        "source": "unresolved_text",
    }


async def _bbox_candidates(
    db: Any,
    bbox: Dict[str, float],
    *,
    min_population: int,
    country_codes: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    if db is None or not hasattr(db, "geo_places"):
        return []
    collection = db.geo_places
    if hasattr(collection, "find_geo_places_by_bounding_box"):
        return await collection.find_geo_places_by_bounding_box(
            min_lat=bbox["min_lat"],
            max_lat=bbox["max_lat"],
            min_lng=bbox["min_lng"],
            max_lng=bbox["max_lng"],
            min_population=min_population,
            country_codes=country_codes,
            limit=2000,
        )
    rows = await collection.find({}, {"_id": 0}).limit(5000).to_list(5000)
    out = []
    allowed = {str(code).lower() for code in (country_codes or []) if code}
    for row in rows:
        lat = _as_float(row.get("latitude"))
        lng = _as_float(row.get("longitude"))
        if lat is None or lng is None:
            continue
        if not (bbox["min_lat"] <= lat <= bbox["max_lat"] and bbox["min_lng"] <= lng <= bbox["max_lng"]):
            continue
        if int(row.get("population") or 0) < min_population:
            continue
        if allowed and str(row.get("country_code") or "").lower() not in allowed:
            continue
        out.append(row)
    return out


async def expand_location_radius(
    location_label: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    country_hint: Optional[str] = None,
    radius_km: Optional[int] = None,
    max_cities: int = 10,
    include_cross_border: bool = True,
    min_population: int = 1000,
    db: Any = None,
) -> List[Dict[str, Any]]:
    origin = await resolve_location(location_label, lat, lng, country_hint, db)
    if not origin:
        return []
    origin_lat = _as_float(origin.get("latitude"))
    origin_lng = _as_float(origin.get("longitude"))
    origin_doc = {
        **origin,
        "distance_km": 0.0,
        "is_origin": True,
        "query_label": _query_label(origin),
    }
    max_cities = max(1, int(max_cities or 1))
    try:
        radius_value = float(radius_km) if radius_km is not None else None
    except (TypeError, ValueError):
        radius_value = None
    if radius_value is None or radius_value <= 0 or origin_lat is None or origin_lng is None:
        return [origin_doc]

    country_codes = None
    origin_country = str(origin.get("country_code") or country_hint or "").lower()
    if not include_cross_border and origin_country:
        country_codes = [origin_country]

    bbox = radius_bounding_box(origin_lat, origin_lng, radius_value)
    candidates = await _bbox_candidates(db, bbox, min_population=min_population, country_codes=country_codes)
    expanded: List[Dict[str, Any]] = []
    seen = set()
    origin_key = normalize_place_name(origin.get("name") or location_label)
    for candidate in candidates:
        cand_lat = _as_float(candidate.get("latitude"))
        cand_lng = _as_float(candidate.get("longitude"))
        if cand_lat is None or cand_lng is None:
            continue
        distance = haversine_km(origin_lat, origin_lng, cand_lat, cand_lng)
        if distance > radius_value:
            continue
        key = candidate.get("geoname_id") or f"{normalize_place_name(candidate.get('name'))}:{candidate.get('country_code')}"
        if key in seen:
            continue
        seen.add(key)
        doc = _place_document(candidate, distance_km=distance, is_origin=normalize_place_name(candidate.get("name")) == origin_key)
        doc["query_label"] = _query_label(doc)
        expanded.append(doc)

    if not any(item.get("is_origin") for item in expanded):
        expanded.append(origin_doc)

    expanded.sort(
        key=lambda item: (
            0 if item.get("is_origin") else 1,
            -(int(item.get("population") or 0)),
            float(item.get("distance_km") or 0),
        )
    )
    return expanded[:max_cities]


def country_to_jsearch_language(country_code: Optional[str]) -> str:
    mapping = {
        "fr": "fr",
        "es": "es",
        "us": "en",
        "gb": "en",
        "uk": "en",
        "de": "de",
        "it": "it",
        "pt": "pt",
        "nl": "nl",
        "ma": "fr",
    }
    return mapping.get(str(country_code or "").lower(), "en")
