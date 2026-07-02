import asyncio
import json
from pathlib import Path

from location_intelligence import (
    country_to_jsearch_language,
    expand_location_radius,
    haversine_km,
    normalize_place_name,
    radius_bounding_box,
    resolve_location,
)


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.count = None

    def limit(self, count):
        self.count = count
        return self

    async def to_list(self, length):
        count = length or self.count
        return list(self.rows[:count]) if count is not None else list(self.rows)


class _GeoPlaces:
    def __init__(self, rows):
        self.rows = list(rows)

    def find(self, filter=None, projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, filter or {})])

    async def find_geo_places_by_bounding_box(
        self,
        *,
        min_lat,
        max_lat,
        min_lng,
        max_lng,
        min_population=0,
        country_codes=None,
        limit=500,
    ):
        allowed = {str(code).lower() for code in (country_codes or []) if code}
        rows = []
        for row in self.rows:
            if not (min_lat <= row["latitude"] <= max_lat and min_lng <= row["longitude"] <= max_lng):
                continue
            if int(row.get("population") or 0) < min_population:
                continue
            if allowed and row.get("country_code") not in allowed:
                continue
            rows.append(dict(row))
        rows.sort(key=lambda item: int(item.get("population") or 0), reverse=True)
        return rows[:limit]


class _DB:
    def __init__(self, rows):
        self.geo_places = _GeoPlaces(rows)


def _matches(row, filter):
    for key, expected in (filter or {}).items():
        value = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$gte" in expected and (value is None or value < expected["$gte"]):
                return False
            if "$lte" in expected and (value is None or value > expected["$lte"]):
                return False
        elif value != expected:
            return False
    return True


def _fixture_rows():
    path = Path(__file__).parent / "fixtures" / "geo_places_sample.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _names(rows):
    return {row["name"] for row in rows}


def test_normalize_place_name_removes_accents_and_lowercases():
    assert normalize_place_name("  Saint-Étienne  ") == "saint etienne"
    assert normalize_place_name("Donostia / San Sebastián") == "donostia san sebastian"


def test_haversine_between_ciboure_and_biarritz_is_reasonable():
    distance = haversine_km(43.3849, -1.6682, 43.4832, -1.5586)
    assert 12 <= distance <= 16


def test_radius_bounding_box_is_sane():
    box = radius_bounding_box(43.3849, -1.6682, 50)
    assert box["min_lat"] < 43.3849 < box["max_lat"]
    assert box["min_lng"] < -1.6682 < box["max_lng"]
    assert box["max_lat"] - box["min_lat"] < 2


def test_resolve_location_uses_frontend_coordinates_when_present():
    result = asyncio.run(resolve_location("Ciboure, France", lat=43.3849, lng=-1.6682, country_hint="fr"))
    assert result["source"] == "frontend_coordinates"
    assert result["latitude"] == 43.3849
    assert result["longitude"] == -1.6682


def test_resolve_location_by_name_and_country_hint():
    result = asyncio.run(resolve_location("Ciboure", country_hint="fr", db=_DB(_fixture_rows())))
    assert result["name"] == "Ciboure"
    assert result["country_code"] == "fr"


def test_resolve_location_city_country_text_without_country_hint():
    result = asyncio.run(resolve_location("Toulouse, France", country_hint=None, db=_DB(_fixture_rows())))
    assert result["name"] == "Toulouse"
    assert result["country_code"] == "fr"
    assert result["latitude"] == 43.6047


def test_expand_location_radius_city_country_text_without_coordinates():
    rows = asyncio.run(expand_location_radius("Toulouse, France", radius_km=52, db=_DB(_fixture_rows()), max_cities=5))
    names = _names(rows)
    assert "Toulouse" in names
    assert "Montauban" in names
    assert all(row["country_code"] == "fr" for row in rows)


def test_expand_ciboure_radius_includes_nearby_cross_border_cities():
    rows = asyncio.run(expand_location_radius("Ciboure", country_hint="fr", radius_km=50, db=_DB(_fixture_rows()), max_cities=10))
    names = _names(rows)
    assert "Ciboure" in names
    assert "Biarritz" in names
    assert "Anglet" in names
    assert "Bayonne" in names
    assert "Irun" in names
    assert "San Sebastián" in names


def test_expand_ciboure_radius_can_exclude_cross_border_cities():
    rows = asyncio.run(expand_location_radius(
        "Ciboure",
        country_hint="fr",
        radius_km=50,
        include_cross_border=False,
        db=_DB(_fixture_rows()),
        max_cities=10,
    ))
    names = _names(rows)
    assert "Biarritz" in names
    assert "Irun" not in names
    assert "San Sebastián" not in names


def test_expand_paris_radius_does_not_include_lyon():
    rows = asyncio.run(expand_location_radius("Paris", country_hint="fr", radius_km=50, db=_DB(_fixture_rows()), max_cities=10))
    names = _names(rows)
    assert "Paris" in names
    assert "Lyon" not in names


def test_unknown_city_returns_safe_origin_only_fallback():
    rows = asyncio.run(expand_location_radius("Unknown City", country_hint="fr", radius_km=50, db=_DB(_fixture_rows())))
    assert len(rows) == 1
    assert rows[0]["name"] == "Unknown City"
    assert rows[0]["is_origin"] is True


def test_max_cities_is_respected():
    rows = asyncio.run(expand_location_radius("Ciboure", country_hint="fr", radius_km=50, db=_DB(_fixture_rows()), max_cities=3))
    assert len(rows) == 3
    assert rows[0]["name"] == "Ciboure"


def test_nearby_hubs_are_prioritized_without_dropping_origin():
    rows = asyncio.run(expand_location_radius("Ciboure", country_hint="fr", radius_km=50, db=_DB(_fixture_rows()), max_cities=8))
    assert rows[0]["name"] == "Ciboure"
    names_after_origin = [row["name"] for row in rows[1:]]
    assert "San Sebastián" in names_after_origin
    assert names_after_origin.index("San Sebastián") < names_after_origin.index("Biarritz")


def test_country_to_jsearch_language_mapping():
    assert country_to_jsearch_language("ES") == "es"
    assert country_to_jsearch_language("FR") == "fr"
    assert country_to_jsearch_language("unknown") == "en"
