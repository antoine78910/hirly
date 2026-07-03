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

COUNTRY_NAME_TO_CODE = {
    "france": "fr",
    "espagne": "es",
    "spain": "es",
    "united states": "us",
    "usa": "us",
    "united kingdom": "gb",
    "uk": "gb",
    "great britain": "gb",
    "england": "gb",
    "germany": "de",
    "allemagne": "de",
    "italy": "it",
    "italie": "it",
    "portugal": "pt",
    "netherlands": "nl",
    "pays bas": "nl",
    "morocco": "ma",
    "maroc": "ma",
}


def normalize_place_name(value: Optional[str]) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return " ".join(text.split())


def _country_code_from_text(value: Optional[str]) -> Optional[str]:
    normalized = normalize_place_name(value)
    if not normalized:
        return None
    return COUNTRY_NAME_TO_CODE.get(normalized)


def _split_place_label(value: Optional[str]) -> tuple[List[str], Optional[str]]:
    raw = str(value or "").strip()
    if not raw:
        return [], None
    parts = [part.strip() for part in re.split(r"[,|/]", raw) if part.strip()]
    country_code = _country_code_from_text(parts[-1]) if len(parts) > 1 else None
    candidates = [raw]
    if parts:
        candidates.append(parts[0])
    if country_code and len(parts) > 1:
        without_country = ", ".join(parts[:-1]).strip()
        if without_country:
            candidates.append(without_country)
    normalized_seen = set()
    ordered = []
    for candidate in candidates:
        normalized = normalize_place_name(candidate)
        if normalized and normalized not in normalized_seen:
            normalized_seen.add(normalized)
            ordered.append(candidate)
    return ordered, country_code


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
        "alternate_names": row.get("alternate_names") or [],
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


async def _lookup_french_commune(label: str) -> Optional[Dict[str, Any]]:
    """Resolve a French city label to coordinates via geo.api.gouv.fr."""
    city = re.split(r"[,/|-]", str(label or ""), maxsplit=1)[0].strip()
    if len(city) < 2:
        return None
    try:
        import httpx

        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                "https://geo.api.gouv.fr/communes",
                params={
                    "nom": city,
                    "fields": "nom,code,codesPostaux,centre,population",
                    "boost": "population",
                    "limit": 1,
                },
            )
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list) or not rows:
                return None
            row = rows[0]
            centre = row.get("centre") if isinstance(row.get("centre"), dict) else {}
            coords = centre.get("coordinates") if isinstance(centre, dict) else None
            if not coords or len(coords) < 2:
                return None
            name = str(row.get("nom") or city)
            return {
                "name": name,
                "normalized_name": normalize_place_name(name),
                "ascii_name": name,
                "country_code": "fr",
                "latitude": float(coords[1]),
                "longitude": float(coords[0]),
                "population": int(row.get("population") or 0),
                "source": "geo_api_gouv",
            }
    except Exception:
        return None


async def resolve_location(
    location_label: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    country_hint: Optional[str] = None,
    db: Any = None,
) -> Optional[Dict[str, Any]]:
    lat_value = _as_float(lat)
    lng_value = _as_float(lng)
    label_candidates, label_country_hint = _split_place_label(location_label)
    effective_country_hint = str(country_hint or label_country_hint or "").lower().strip() or None
    if lat_value is not None and lng_value is not None:
        name = location_label or ""
        return {
            "name": name,
            "normalized_name": normalize_place_name(name),
            "country_code": effective_country_hint,
            "latitude": lat_value,
            "longitude": lng_value,
            "population": 0,
            "source": "frontend_coordinates",
        }

    if not label_candidates:
        return None
    normalized = normalize_place_name(label_candidates[0])
    for candidate_label in label_candidates:
        candidate_normalized = normalize_place_name(candidate_label)
        if not candidate_normalized:
            continue
        candidates = await _find_name_candidates(db, candidate_normalized, effective_country_hint)
        if candidates:
            return _place_document(candidates[0])
    country_from_label = _country_code_from_text(location_label) or effective_country_hint
    if country_from_label in (None, "fr", "france") or not country_from_label:
        geo = await _lookup_french_commune(label_candidates[0] if label_candidates else (location_label or ""))
        if geo:
            return _place_document(geo)
    return {
        "name": location_label or "",
        "normalized_name": normalized,
        "country_code": effective_country_hint,
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
