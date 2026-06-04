"""Job import/cache service.

MongoDB remains the source of truth. External providers only import normalized
jobs into the `jobs` collection.
"""

import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx

from job_providers import get_board_provider, get_job_provider
from job_providers.base import BoardQuery, JobSearchQuery

logger = logging.getLogger(__name__)
_PROVIDER_COOLDOWN_UNTIL: Dict[str, datetime] = {}
_PROVIDER_RATE_LIMIT_COOLDOWN_MINUTES = 15

GREENHOUSE_SEED_BOARDS = [
    ("stripe", "Stripe"),
    ("airbnb", "Airbnb"),
    ("discord", "Discord"),
    ("figma", "Figma"),
    ("reddit", "Reddit"),
    ("notion", "Notion"),
    ("coinbase", "Coinbase"),
    ("scaleai", "Scale AI"),
    ("chime", "Chime"),
    ("brex", "Brex"),
]


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _country_and_location(target_location: Optional[str]) -> Tuple[str, Optional[str]]:
    location = (target_location or "").strip() or None
    text = (location or "").lower()
    country = os.environ.get("JSEARCH_COUNTRY", "us")

    if any(term in text for term in ("royaume-uni", "united kingdom", "uk", "england", "london", "egham")):
        country = "gb"
        if location:
            location = location.replace("Royaume-Uni", "United Kingdom").replace("royaume-uni", "United Kingdom")
    elif any(term in text for term in ("morocco", "maroc", "casablanca")):
        country = "ma"

    return country, location


def _country_and_location_from_data(location_data: Optional[Dict[str, Any]], fallback_location: Optional[str]) -> Tuple[str, Optional[str]]:
    if not location_data:
        return _country_and_location(fallback_location)

    location = (
        location_data.get("location_label")
        or location_data.get("label")
        or fallback_location
    )
    country_code = (location_data.get("country_code") or "").strip().lower()
    if country_code:
        return country_code, location
    return _country_and_location(location)


def _next_radius(search_radius: str) -> Optional[str]:
    radius = _radius_km(search_radius)
    if radius is None or radius >= 500:
        return None
    return f"{min(500, radius + 50)}km"


def _radius_km(search_radius: str) -> Optional[int]:
    text = (search_radius or "").lower().strip()
    if not text.endswith("km"):
        return None
    try:
        return max(10, min(500, int(text[:-2])))
    except ValueError:
        return None


def build_profile_job_query(
    profile: Dict[str, Any],
    location_override: Optional[str] = None,
    location_data_override: Optional[Dict[str, Any]] = None,
    search_radius: str = "50km",
) -> JobSearchQuery:
    role = (
        profile.get("target_role")
        or ((profile.get("target_roles") or [None])[0])
        or "software engineer"
    )
    requested_location = location_override or profile.get("target_location")
    location_data = location_data_override or profile.get("target_location_data")
    country, location = _country_and_location_from_data(location_data, requested_location)
    if (search_radius or "").lower() in ("country", "country-wide"):
        location = _country_name(country) or location
    elif (search_radius or "").lower() in ("remote", "remote/worldwide", "worldwide"):
        location = None
    remote_preference = profile.get("remote_preference") or "any"
    if (search_radius or "").lower() in ("remote", "remote/worldwide"):
        remote_preference = "remote"
    logger.info("JSearch query location normalized: country=%s location=%s radius=%s role=%s", country, location, search_radius, role)
    return JobSearchQuery(
        role=role,
        location=location,
        remote_preference=remote_preference,
        country=country,
        language=os.environ.get("JSEARCH_LANGUAGE", "en"),
        limit=_env_int("JOB_IMPORT_LIMIT", 20),
    )


def _country_name(country: str) -> Optional[str]:
    return {"gb": "United Kingdom", "ma": "Morocco", "us": "United States"}.get((country or "").lower())


def _dedupe(values: List[Optional[str]]) -> List[Optional[str]]:
    seen = set()
    out: List[Optional[str]] = []
    for value in values:
        key = (value or "").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


def _cooldown_until(provider_name: str) -> Optional[datetime]:
    until = _PROVIDER_COOLDOWN_UNTIL.get(provider_name)
    if until and until > datetime.now(timezone.utc):
        return until
    if until:
        _PROVIDER_COOLDOWN_UNTIL.pop(provider_name, None)
    return None


def _set_rate_limit_cooldown(provider_name: str) -> datetime:
    until = datetime.now(timezone.utc) + timedelta(minutes=_PROVIDER_RATE_LIMIT_COOLDOWN_MINUTES)
    _PROVIDER_COOLDOWN_UNTIL[provider_name] = until
    return until


def _is_rate_limit_error(exc: Exception) -> bool:
    return (
        isinstance(exc, httpx.HTTPStatusError)
        and exc.response is not None
        and exc.response.status_code == 429
    )


def _nearby_locations(query: JobSearchQuery, search_radius: str) -> List[Optional[str]]:
    radius = (search_radius or "50km").lower()
    radius_km = _radius_km(radius)
    if radius_km is not None and radius_km <= 25:
        return [query.location]
    if radius_km is not None:
        return [query.location, *_fallback_locations(query)]
    if radius in ("country", "country-wide"):
        return [_country_name(query.country) or query.location]
    if radius in ("remote", "remote/worldwide", "worldwide"):
        return [None]
    return [query.location, *_fallback_locations(query)]


def _fallback_locations(query: JobSearchQuery) -> List[Optional[str]]:
    location_text = (query.location or "").lower()
    locations: List[Optional[str]] = []

    if query.country == "gb" or any(term in location_text for term in ("egham", "united kingdom", "royaume-uni", "london")):
        locations = ["Egham, United Kingdom", "London, United Kingdom", "United Kingdom"]
    elif query.country == "ma" or any(term in location_text for term in ("casablanca", "morocco", "maroc")):
        locations = ["Casablanca, Morocco", "Morocco"]
    elif query.country and query.country != os.environ.get("JSEARCH_COUNTRY", "us"):
        country_names = {"gb": "United Kingdom", "ma": "Morocco"}
        locations = [country_names.get(query.country)]

    seen = {query.location}
    return [loc for loc in locations if loc and loc not in seen]


async def _import_provider_jobs(db, provider, query: JobSearchQuery) -> Dict[str, int]:
    result = await provider.search(query)
    stats = {
        "total_imported": 0,
        "auto_apply_supported_imported": 0,
        "unknown_ats_imported": 0,
    }
    for job in result.jobs:
        await db.jobs.update_one(
            {"provider": job["provider"], "external_id": job["external_id"]},
            {"$set": job},
            upsert=True,
        )
        stats["total_imported"] += 1
        if job.get("auto_apply_supported") is True:
            stats["auto_apply_supported_imported"] += 1
        if job.get("ats_provider") == "unknown":
            stats["unknown_ats_imported"] += 1
    return stats


async def _upsert_job_batch(db, jobs: List[Dict[str, Any]]) -> Dict[str, int]:
    stats = {
        "total_imported": 0,
        "auto_apply_supported_imported": 0,
        "unknown_ats_imported": 0,
    }
    for job in jobs:
        await db.jobs.update_one(
            {"provider": job["provider"], "external_id": job["external_id"]},
            {"$set": job},
            upsert=True,
        )
        stats["total_imported"] += 1
        if job.get("auto_apply_supported") is True:
            stats["auto_apply_supported_imported"] += 1
        if job.get("ats_provider") == "unknown":
            stats["unknown_ats_imported"] += 1
    return stats


def _greenhouse_board_doc(token: str, company: str) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "board_id": f"greenhouse:{token}",
        "company": company,
        "ats_provider": "greenhouse",
        "board_token": token,
        "board_url": f"https://boards.greenhouse.io/{token}",
        "api_url": f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true",
        "enabled": True,
        "priority": 100,
        "countries": ["us", "gb", "remote"],
        "role_keywords": ["engineer", "analyst", "product", "marketing", "sales", "operations"],
        "last_synced_at": None,
        "last_success_at": None,
        "last_error": None,
        "failure_count": 0,
        "created_at": now,
        "updated_at": now,
    }


async def seed_greenhouse_company_boards(db) -> int:
    seeded = 0
    for token, company in GREENHOUSE_SEED_BOARDS:
        doc = _greenhouse_board_doc(token, company)
        result = await db.company_boards.update_one(
            {"board_id": doc["board_id"]},
            {
                "$setOnInsert": {
                    "board_id": doc["board_id"],
                    "created_at": doc["created_at"],
                },
                "$set": {
                    "company": doc["company"],
                    "ats_provider": "greenhouse",
                    "board_token": doc["board_token"],
                    "board_url": doc["board_url"],
                    "api_url": doc["api_url"],
                    "enabled": doc["enabled"],
                    "priority": doc["priority"],
                    "countries": doc["countries"],
                    "role_keywords": doc["role_keywords"],
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            },
            upsert=True,
        )
        if result.upserted_id is not None:
            seeded += 1
    return seeded


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


async def refresh_greenhouse_boards(
    db,
    profile: Optional[Dict[str, Any]] = None,
    limit_boards: int = 10,
    force: bool = False,
) -> Dict[str, Any]:
    await seed_greenhouse_company_boards(db)
    provider = get_board_provider("greenhouse")
    ttl_minutes = _env_int("GREENHOUSE_BOARD_IMPORT_TTL_MINUTES", 360)
    stale_cutoff = datetime.now(timezone.utc) - timedelta(minutes=ttl_minutes)
    boards = await db.company_boards.find(
        {"ats_provider": "greenhouse", "enabled": True},
        {"_id": 0},
    ).sort("priority", -1).limit(limit_boards).to_list(limit_boards)

    role = None
    location = None
    remote_preference = "any"
    country = None
    if profile:
        query = build_profile_job_query(profile)
        role = query.role
        location = query.location
        remote_preference = query.remote_preference
        country = query.country

    boards_checked = 0
    boards_successful = 0
    jobs_imported = 0
    auto_apply_supported_imported = 0
    sample_jobs: List[Dict[str, Any]] = []

    for board in boards:
        last_synced = _parse_iso_datetime(board.get("last_synced_at"))
        if not force and last_synced and last_synced >= stale_cutoff:
            continue

        boards_checked += 1
        now = datetime.now(timezone.utc).isoformat()
        board_query = BoardQuery(
            board_token=board["board_token"],
            company=board["company"],
            role=role,
            location=location,
            remote_preference=remote_preference,
            country=country,
            limit=_env_int("GREENHOUSE_BOARD_JOB_LIMIT", 100),
        )
        try:
            inspection = await provider.inspect_board(board["board_token"])
            logger.info(
                "Greenhouse board check: board_token=%s api_url=%s status=%s jobs_count=%s error_snippet=%s",
                board["board_token"],
                inspection["api_url"],
                inspection["status_code"],
                inspection["jobs_count"],
                inspection["error_snippet"],
            )
            if inspection["status_code"] != 200:
                raise httpx.HTTPStatusError(
                    f"Greenhouse board returned {inspection['status_code']}",
                    request=httpx.Request("GET", inspection["api_url"]),
                    response=httpx.Response(
                        inspection["status_code"],
                        request=httpx.Request("GET", inspection["api_url"]),
                        text=inspection["error_snippet"] or "",
                    ),
                )
            result = await provider.search_board(board_query)
            stats = await _upsert_job_batch(db, result.jobs)
            jobs_imported += stats["total_imported"]
            auto_apply_supported_imported += stats["auto_apply_supported_imported"]
            if result.jobs and len(sample_jobs) < 5:
                sample_jobs.extend(result.jobs[: 5 - len(sample_jobs)])
            boards_successful += 1
            await db.company_boards.update_one(
                {"board_id": board["board_id"]},
                {
                    "$set": {
                        "last_synced_at": now,
                        "last_success_at": now,
                        "last_error": None,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
            )
            logger.info(
                "Greenhouse board refreshed: board=%s total_imported=%s auto_apply_supported_imported=%s",
                board["board_token"],
                stats["total_imported"],
                stats["auto_apply_supported_imported"],
            )
        except Exception as exc:
            await db.company_boards.update_one(
                {"board_id": board["board_id"]},
                {
                    "$set": {
                        "last_synced_at": now,
                        "last_error": str(exc)[:500],
                        "updated_at": now,
                    },
                    "$inc": {"failure_count": 1},
                },
            )
            logger.warning("Greenhouse board refresh failed: board=%s error=%s", board.get("board_token"), exc)

    return {
        "boards_checked": boards_checked,
        "boards_successful": boards_successful,
        "jobs_imported": jobs_imported,
        "auto_apply_supported_imported": auto_apply_supported_imported,
        "sample_jobs": sample_jobs,
    }


async def _count_recent_auto_apply_jobs(db, provider_name: str, stale_cutoff: str) -> int:
    return await db.jobs.count_documents({
        "provider": provider_name,
        "auto_apply_supported": True,
        "imported_at": {"$gte": stale_cutoff},
    })


def _role_variants(role: str) -> List[str]:
    normalized = " ".join((role or "").split()) or "software engineer"
    lower = normalized.lower()
    variants = [normalized]
    if lower == "market analyst":
        variants.append("Analyst")
    elif lower == "software engineer":
        variants.append("Engineer")
    elif "software engineer" in lower and lower != "software engineer":
        variants.append("Software Engineer")
    elif lower.endswith(" analyst") and lower != "analyst":
        variants.append("Analyst")
    elif lower.endswith(" engineer") and lower != "engineer":
        variants.append("Engineer")
    return [value for value in _dedupe(variants) if value]


def _ats_attempt_countries(query: JobSearchQuery, search_radius: str) -> List[Optional[str]]:
    country = (query.country or "").lower() or None
    if (search_radius or "").lower() == "worldwide":
        return _dedupe([country, None, "us", "gb"])
    return _dedupe([country])


async def _import_ats_targeted_jobs(
    db,
    provider,
    query: JobSearchQuery,
    target_count: int,
    stale_cutoff: str,
    search_radius: str,
    max_attempts: int = 8,
) -> int:
    ats_domains = [
        "jobs.lever.co",
        "boards.greenhouse.io",
        "job-boards.greenhouse.io",
        "jobs.ashbyhq.com",
        "ashbyhq.com",
    ]
    total_imported = 0
    attempts = 0
    role_variants = _role_variants(query.role)
    country_variants = _ats_attempt_countries(query, search_radius)
    query_variants: List[Tuple[str, str, str]] = []
    for domain in ats_domains:
        query_variants.append((domain, role_variants[0], "{role} site:{domain}"))
    for domain in ats_domains:
        query_variants.append((domain, role_variants[0], "{role} {domain}"))
    for domain in ats_domains:
        query_variants.append((domain, role_variants[0], "{role} careers {domain}"))
    for role_variant in role_variants[1:]:
        for domain in ats_domains:
            query_variants.append((domain, role_variant, "{role} site:{domain}"))

    primary_domain_variants = query_variants[:len(ats_domains)]
    attempt_plan: List[Tuple[str, str, str, Optional[str]]] = []
    if (search_radius or "").lower() == "worldwide":
        profile_country = country_variants[0] if country_variants else query.country
        for ats_domain, role_variant, intent in primary_domain_variants:
            attempt_plan.append((ats_domain, role_variant, intent, profile_country))
        for country in country_variants[1:]:
            for ats_domain, role_variant, intent in primary_domain_variants:
                attempt_plan.append((ats_domain, role_variant, intent, country))
        for ats_domain, role_variant, intent in query_variants[len(ats_domains):]:
            for country in country_variants:
                attempt_plan.append((ats_domain, role_variant, intent, country))
    else:
        country = country_variants[0] if country_variants else query.country
        attempt_plan = [(ats_domain, role_variant, intent, country) for ats_domain, role_variant, intent in query_variants]

    for ats_domain, role_variant, template, country in attempt_plan:
        current_auto_count = await _count_recent_auto_apply_jobs(db, provider.name, stale_cutoff)
        if current_auto_count >= target_count:
            break

        if attempts >= max_attempts:
            return total_imported
        before_auto_count = await _count_recent_auto_apply_jobs(db, provider.name, stale_cutoff)
        targeted_query = JobSearchQuery(
            role=template.format(role=role_variant, domain=ats_domain),
            location=query.location if (search_radius or "").lower() != "worldwide" else None,
            remote_preference=query.remote_preference,
            country=country,
            language=query.language,
            limit=query.limit,
            raw_query=True,
        )
        attempts += 1
        stats = await _import_provider_jobs(db, provider, targeted_query)
        total_imported += stats["total_imported"]
        after_auto_count = await _count_recent_auto_apply_jobs(db, provider.name, stale_cutoff)
        auto_imported = max(0, after_auto_count - before_auto_count)
        logger.info(
            "JSearch ATS-targeted attempt: ats_domain=%s query=%s country=%s work_from_home=%s total_imported=%s auto_apply_supported_imported=%s unknown_ats_imported=%s",
            ats_domain,
            provider._query_string(targeted_query),
            country or "global",
            targeted_query.remote_preference == "remote",
            stats["total_imported"],
            auto_imported,
            stats["unknown_ats_imported"],
        )
        if after_auto_count >= target_count:
            return total_imported
    return total_imported


async def refresh_jobs_for_profile_if_needed(
    db,
    profile: Dict[str, Any],
    require_auto_apply: bool = False,
    target_auto_apply_count: int = 0,
    location_override: Optional[str] = None,
    location_data_override: Optional[Dict[str, Any]] = None,
    search_radius: str = "50km",
) -> Dict[str, Any]:
    query = build_profile_job_query(
        profile,
        location_override=location_override,
        location_data_override=location_data_override,
        search_radius=search_radius,
    )
    base_metadata = {
        "searched_location": query.location,
        "search_radius": search_radius,
        "suggested_next_radius": _next_radius(search_radius),
        "widened_search": False,
        "original_location": location_override or profile.get("target_location"),
        "final_location_used": query.location,
        "provider_rate_limited": False,
        "provider_cooldown_until": None,
    }

    greenhouse_result = None
    if require_auto_apply:
        existing_auto_count = await db.jobs.count_documents({
            "auto_apply_supported": True,
            "ats_provider": {"$in": ["greenhouse", "lever", "ashby"]},
        })
        if existing_auto_count < target_auto_apply_count:
            greenhouse_result = await refresh_greenhouse_boards(
                db,
                profile=profile,
                limit_boards=_env_int("GREENHOUSE_FEED_REFRESH_BOARD_LIMIT", 10),
            )
            existing_auto_count = await db.jobs.count_documents({
                "auto_apply_supported": True,
                "ats_provider": {"$in": ["greenhouse", "lever", "ashby"]},
            })
        if existing_auto_count >= target_auto_apply_count:
            return {
                "attempted": bool(greenhouse_result),
                "ok": True,
                "reason": "greenhouse_imported" if greenhouse_result else "cache_fresh_auto_apply",
                "count": existing_auto_count,
                "greenhouse": greenhouse_result,
                **base_metadata,
            }

    if not _env_bool("JSEARCH_ENABLED", True):
        return {"attempted": bool(greenhouse_result), "reason": "disabled", "greenhouse": greenhouse_result, **base_metadata}

    api_key = os.environ.get("JSEARCH_API_KEY")
    if not api_key:
        return {"attempted": bool(greenhouse_result), "reason": "missing_api_key", "greenhouse": greenhouse_result, **base_metadata}

    provider_name = os.environ.get("JOB_PROVIDER_PRIMARY", "jsearch")
    provider = get_job_provider(provider_name, api_key)
    cooldown_until = _cooldown_until(provider.name)
    if cooldown_until:
        logger.info("Skipping JSearch refresh during provider cooldown until %s", cooldown_until.isoformat())
        return {
            "attempted": False,
            "reason": "provider_rate_limited",
            **base_metadata,
            "provider_rate_limited": True,
            "provider_cooldown_until": cooldown_until.isoformat(),
        }

    search_key = provider.search_key(query)
    ttl_minutes = _env_int("JOB_IMPORT_TTL_MINUTES", 360)
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=ttl_minutes)).isoformat()

    fresh_count = await db.jobs.count_documents({
        "provider": provider.name,
        "provider_search_key": search_key,
        "imported_at": {"$gte": stale_cutoff},
    })
    if fresh_count > 0 and not require_auto_apply:
        return {"attempted": False, "reason": "cache_fresh", "search_key": search_key, "count": fresh_count, **base_metadata}
    any_cached = await db.jobs.count_documents({
        "provider": provider.name,
        "provider_search_key": search_key,
    })

    try:
        max_provider_requests = 2
        provider_requests = 1
        import_stats = await _import_provider_jobs(db, provider, query)
        imported = import_stats["total_imported"]
        logger.info(
            "JSearch refresh attempt: role=%s location=%s country=%s total_imported=%s auto_apply_supported_imported=%s unknown_ats_imported=%s",
            query.role,
            query.location,
            query.country,
            import_stats["total_imported"],
            import_stats["auto_apply_supported_imported"],
            import_stats["unknown_ats_imported"],
        )
        fallback_used = None
        if imported == 0:
            for fallback_location in _nearby_locations(query, search_radius):
                if fallback_location == query.location:
                    continue
                fallback_query = JobSearchQuery(
                    role=query.role,
                    location=fallback_location,
                    remote_preference=query.remote_preference,
                    country=query.country,
                    language=query.language,
                    limit=query.limit,
                )
                provider_requests += 1
                fallback_stats = await _import_provider_jobs(db, provider, fallback_query)
                imported = fallback_stats["total_imported"]
                logger.info(
                    "JSearch fallback attempt: role=%s location=%s country=%s total_imported=%s auto_apply_supported_imported=%s unknown_ats_imported=%s",
                    fallback_query.role,
                    fallback_query.location,
                    fallback_query.country,
                    fallback_stats["total_imported"],
                    fallback_stats["auto_apply_supported_imported"],
                    fallback_stats["unknown_ats_imported"],
                )
                if imported > 0:
                    fallback_used = fallback_query.location
                    break
                break
        ats_targeted_imported = 0
    except Exception as exc:
        if _is_rate_limit_error(exc):
            cooldown_until = _set_rate_limit_cooldown(provider.name)
            logger.warning("Job provider rate-limited; cooldown active until %s", cooldown_until.isoformat())
            return {
                "attempted": True,
                "ok": False,
                "reason": "provider_rate_limited",
                "search_key": search_key,
                "cached_count": any_cached,
                **base_metadata,
                "provider_rate_limited": True,
                "provider_cooldown_until": cooldown_until.isoformat(),
            }
        logger.warning("Job provider refresh failed: %s", exc)
        return {
            "attempted": True,
            "ok": False,
            "reason": "provider_error",
            "search_key": search_key,
            "cached_count": any_cached,
            **base_metadata,
        }

    return {
        "attempted": True,
        "ok": True,
        "reason": "imported",
        "search_key": search_key,
        "imported": imported,
        "fallback_used": fallback_used,
        "ats_targeted_imported": ats_targeted_imported,
        **base_metadata,
        "widened_search": fallback_used is not None,
        "final_location_used": fallback_used or query.location,
    }
