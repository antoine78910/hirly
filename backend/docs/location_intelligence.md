# Location Intelligence

This module exists because a job API search radius is not enough for a reliable global feed. A user can search from a small town while the real hiring market is in nearby cities, sometimes across a national border. For example, a 50 km radius around a border town should be able to include nearby cities in another country when `only_my_country` is not enabled.

The foundation is implemented in `backend/location_intelligence.py` and is not connected to `/api/jobs/feed` yet. Feed integration is planned for Phase 3. JSearch query expansion is planned for Phase 4.

## Data Model

`geo_places` stores global city/place records with coordinates, population, country, and normalized names. It intentionally does not require PostGIS in this phase. Radius lookup uses a latitude/longitude bounding box first, then a Haversine distance check in Python.

Recommended datasets:

- GeoNames `cities1000.txt` for broad global coverage.
- GeoNames `cities5000.txt` if we want a smaller, cheaper initial dataset.

Full GeoNames data files should not be committed to the repo. They are operational data and can be imported locally or in staging/production.

## Import

From the backend directory:

```bash
python scripts/import_geo_places.py ./data/cities1000.txt --min-population 1000 --dry-run
python scripts/import_geo_places.py ./data/cities1000.txt --min-population 1000
```

Useful options:

- `--min-population`: defaults to `1000`.
- `--limit`: imports only the first N accepted rows.
- `--batch-size`: defaults to `500`.
- `--dry-run`: parses and counts rows without writing.

The importer expects GeoNames tab-separated columns:

```text
geonameid, name, asciiname, alternatenames, latitude, longitude,
feature class, feature code, country code, cc2, admin1 code,
admin2 code, admin3 code, admin4 code, population, elevation,
dem, timezone, modification date
```

## Cross-Border Radius

`expand_location_radius(...)` resolves an origin and returns nearby places within the requested radius. When `include_cross_border=True`, it does not restrict by country. When `include_cross_border=False`, it keeps only places in the origin country.

Frontend-selected latitude/longitude is preferred as the origin when available. If coordinates are missing, the module resolves by normalized place name from `geo_places`, using `country_hint` to disambiguate.

## Limitations

- This is not wired into `/api/jobs/feed` yet.
- JSearch fallback still uses the existing location behavior until Phase 4.
- Jobs do not yet have latitude/longitude columns.
- Cached job matching will remain city/country text based until later phases.
- The module needs `geo_places` to be imported before it can expand text-only origins reliably.

## Planned Phases

Phase 3 will use this module before DB feed filtering so radius searches can match nearby city names and cross-border country codes.

Phase 4 will use this module before JSearch fallback so the backend can query a capped list of nearby cities instead of a single selected city or hardcoded country fallback.
