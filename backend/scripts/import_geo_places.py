"""Import GeoNames-style places into Supabase geo_places.

Usage from backend directory:
    python scripts/import_geo_places.py ./data/cities1000.txt --min-population 1000 --dry-run
    python scripts/import_geo_places.py ./data/cities1000.txt --min-population 1000
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from db import create_database_adapter  # noqa: E402
from db.supabase_adapter import upsert_supabase_documents  # noqa: E402
from location_intelligence import normalize_place_name  # noqa: E402


def _int(value: str | None, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _float(value: str | None) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _alternate_names(value: str | None) -> List[str]:
    names = []
    seen = set()
    for item in (value or "").split(","):
        clean = item.strip()
        if not clean or clean in seen:
            continue
        seen.add(clean)
        names.append(clean)
    return names[:100]


def _row_to_place(row: List[str], *, min_population: int) -> tuple[Dict[str, Any] | None, str | None]:
    if len(row) < 19:
        return None, "short_row"
    geoname_id = row[0].strip()
    name = row[1].strip()
    ascii_name = row[2].strip()
    latitude = _float(row[4])
    longitude = _float(row[5])
    population = _int(row[14])
    country_code = row[8].strip().lower()
    if not geoname_id or not name:
        return None, "missing_identity"
    if latitude is None or longitude is None:
        return None, "missing_coordinates"
    if not country_code:
        return None, "missing_country"
    if population < min_population:
        return None, "population_below_minimum"
    now = datetime.now(timezone.utc).isoformat()
    return {
        "geoname_id": geoname_id,
        "name": name,
        "normalized_name": normalize_place_name(name),
        "ascii_name": normalize_place_name(ascii_name) if ascii_name else None,
        "alternate_names": _alternate_names(row[3]),
        "country_code": country_code,
        "admin1_code": row[10].strip() or None,
        "admin2_code": row[11].strip() or None,
        "feature_class": row[6].strip() or None,
        "feature_code": row[7].strip() or None,
        "latitude": latitude,
        "longitude": longitude,
        "population": population,
        "timezone": row[17].strip() or None,
        "source": "geonames",
        "created_at": now,
        "updated_at": now,
    }, None


def _iter_places(path: Path, *, min_population: int, limit: int | None) -> Iterable[tuple[Dict[str, Any] | None, str | None]]:
    emitted = 0
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t")
        for row in reader:
            place, reason = _row_to_place(row, min_population=min_population)
            yield place, reason
            if place:
                emitted += 1
                if limit and emitted >= limit:
                    break


async def _flush(collection, rows: List[Dict[str, Any]], *, dry_run: bool) -> int:
    if not rows:
        return 0
    if dry_run:
        return len(rows)
    result = await upsert_supabase_documents(
        collection.supabase_url or "",
        collection.secret_key or "",
        "geo_places",
        rows,
    )
    if not result.get("ok"):
        raise RuntimeError(result.get("error") or "Supabase geo_places import failed")
    return int(result.get("rows") or len(rows))


async def main() -> int:
    parser = argparse.ArgumentParser(description="Import GeoNames cities into geo_places.")
    parser.add_argument("path", help="Path to GeoNames cities1000/cities5000-style tab-separated file.")
    parser.add_argument("--min-population", type=int, default=1000)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        raise SystemExit(f"File not found: {path}")

    db = None if args.dry_run else create_database_adapter()
    batch_size = max(1, min(int(args.batch_size or 500), 5000))
    stats = {"imported": 0, "skipped": 0, "errors": 0}
    skipped_reasons: Dict[str, int] = {}
    batch: List[Dict[str, Any]] = []
    try:
        for place, reason in _iter_places(path, min_population=args.min_population, limit=args.limit):
            if not place:
                stats["skipped"] += 1
                skipped_reasons[reason or "unknown"] = skipped_reasons.get(reason or "unknown", 0) + 1
                continue
            batch.append(place)
            if len(batch) >= batch_size:
                stats["imported"] += await _flush(db.geo_places if db else None, batch, dry_run=args.dry_run)
                print(f"Imported {stats['imported']} places (dry_run={args.dry_run})")
                batch = []
        if batch:
            stats["imported"] += await _flush(db.geo_places if db else None, batch, dry_run=args.dry_run)
        print(
            "Geo places import complete: "
            f"imported={stats['imported']} skipped={stats['skipped']} errors={stats['errors']} dry_run={args.dry_run}"
        )
        if skipped_reasons:
            print(f"Skipped reasons: {skipped_reasons}")
        return 0
    finally:
        if db:
            await db.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
