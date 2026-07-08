"""Independent company/board discovery -- finds NEW companies on known ATS
platforms without depending on France Travail/Jsearch happening to cross-
link one, unlike ats_source_service.discover_ats_sources_from_cached_jobs
(which only recognizes a company already present in our own cached jobs).

Two complementary, free-standing mechanisms:

- Certificate Transparency (crt.sh): subdomain-based ATS (Recruitee,
  Teamtailor, Personio) issue every company a real TLS cert on their own
  subdomain, and every cert issuance is publicly logged. No API key, but
  crt.sh is a community-run service with no uptime guarantee (confirmed
  live: it 502'd mid-session) -- retried with backoff, never allowed to
  block the rest of the crawl.
- Serper (Google Search API wrapper): path-based ATS (Greenhouse, Lever,
  Ashby, SmartRecruiters) all share one domain with the company as a URL
  path segment, which certificate logs can't enumerate at all. A `site:`
  search finds real indexed company boards instead.

Both funnel into the same validation step before ever touching the
database: the real adapter's own fetch_jobs() is called for the candidate,
and it only gets written to ats_company_sources if that returns at least
one real job. A domain search hit or a cert subdomain is a lead, not proof
-- only a live, working job board earns a row here.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

import httpx

from ats_source_service import _careers_url, env_bool, env_int
from job_providers.ats_adapters.registry import default_ats_adapters

logger = logging.getLogger(__name__)

CRT_SH_URL = "https://crt.sh/"
SERPER_API_URL = "https://google.serper.dev/search"

# host_suffix each candidate subdomain is stripped of before being treated
# as a company slug -- only providers whose adapter expects exactly that
# shape of source_key (a single-label subdomain) belong here.
SUBDOMAIN_ATS_HOST_SUFFIXES = {
    "recruitee": "recruitee.com",
    "teamtailor": "teamtailor.com",
    "personio": "jobs.personio.com",
}

_EXCLUDED_SUBDOMAIN_TOKENS = {
    "www", "docs", "api", "app", "status", "mail", "cdn", "assets", "help",
    "support", "blog", "ns", "ns1", "ns2", "autodiscover", "cname", "mx",
    "smtp", "imap", "static", "img", "images", "go", "link", "email",
    "click", "track", "careers", "jobs", "s", "webmail", "dev", "staging",
    "test", "admin", "portal", "secure", "cdn2",
}

# site: query per path-based provider -- French-market terms appended so
# results skew toward companies actually worth harvesting for this app.
PATH_BASED_ATS_SITE_QUERIES = {
    "greenhouse": "site:boards.greenhouse.io OR site:job-boards.greenhouse.io",
    "lever": "site:jobs.lever.co",
    "ashby": "site:jobs.ashbyhq.com",
    "smartrecruiters": "site:jobs.smartrecruiters.com",
}

_FRENCH_MARKET_TERMS = ("France", "emploi", "recrutement", "CDI", "carrière")


async def _crt_sh_subdomains(client: httpx.AsyncClient, host_suffix: str) -> List[str]:
    for attempt in range(3):
        try:
            response = await client.get(CRT_SH_URL, params={"q": f"%.{host_suffix}", "output": "json"})
            if response.status_code != 200:
                await asyncio.sleep(2 * (attempt + 1))
                continue
            rows = response.json()
            if not isinstance(rows, list):
                return []
            candidates: Set[str] = set()
            suffix = f".{host_suffix}"
            for row in rows:
                if not isinstance(row, dict):
                    continue
                for line in str(row.get("name_value") or "").split("\n"):
                    name = line.strip().lower().lstrip("*.")
                    if not name.endswith(suffix):
                        continue
                    prefix = name[: -len(suffix)]
                    if prefix and "." not in prefix and prefix not in _EXCLUDED_SUBDOMAIN_TOKENS:
                        candidates.add(prefix)
            return sorted(candidates)
        except Exception as exc:
            logger.warning("crt_sh_query_failed host_suffix=%s attempt=%s error=%s", host_suffix, attempt, str(exc)[:200])
            await asyncio.sleep(2 * (attempt + 1))
    return []


async def _existing_source_keys(db, provider: str) -> Set[str]:
    rows = await db.ats_company_sources.find({"ats_provider": provider}, {"_id": 0, "source_key": 1}).limit(5000).to_list(5000)
    return {row.get("source_key") for row in rows if row.get("source_key")}


async def _validate_and_store(
    db,
    *,
    provider: str,
    source_key: str,
    adapter: Any,
    discovery_method: str,
    discovered_from_url: Optional[str],
    company_name: Optional[str],
    dry_run: bool,
) -> bool:
    try:
        jobs = await adapter.fetch_jobs(source_key, limit=1)
    except Exception as exc:
        logger.info("company_discovery_validation_failed provider=%s source_key=%s error=%s", provider, source_key, str(exc)[:150])
        return False
    if not jobs:
        return False
    if dry_run:
        return True
    now = datetime.now(timezone.utc).isoformat()
    await db.ats_company_sources.update_one(
        {"id": f"{provider}:{source_key}"},
        {"$set": {
            "id": f"{provider}:{source_key}",
            "ats_provider": provider,
            "source_key": source_key,
            "company_name": company_name,
            "careers_url": _careers_url(provider, source_key),
            "country_code": None,
            "discovered_from_url": discovered_from_url,
            "discovered_from_job_id": None,
            "is_active": True,
            "failure_count": 0,
            "raw_metadata": {"source": discovery_method},
            "created_at": now,
            "updated_at": now,
        }},
        upsert=True,
    )
    return True


async def discover_via_certificate_transparency(
    db,
    *,
    providers: Optional[List[str]] = None,
    dry_run: bool = False,
    max_candidates_per_provider: Optional[int] = None,
) -> Dict[str, Any]:
    providers = providers or list(SUBDOMAIN_ATS_HOST_SUFFIXES.keys())
    max_candidates = max(1, min(int(max_candidates_per_provider or env_int("CERT_TRANSPARENCY_MAX_CANDIDATES_PER_PROVIDER", 100)), 500))
    adapters = default_ats_adapters()
    summary: Dict[str, Any] = {
        "dry_run": dry_run, "providers": providers,
        "candidates_found": 0, "validated_count": 0, "discovered_count": 0, "errors": [],
    }
    async with httpx.AsyncClient(timeout=20) as client:
        for provider in providers:
            host_suffix = SUBDOMAIN_ATS_HOST_SUFFIXES.get(provider)
            adapter = adapters.get(provider)
            if not host_suffix or not adapter:
                continue
            candidates = await _crt_sh_subdomains(client, host_suffix)
            summary["candidates_found"] += len(candidates)
            existing = await _existing_source_keys(db, provider)
            new_candidates = [c for c in candidates if c not in existing][:max_candidates]
            for source_key in new_candidates:
                validated = await _validate_and_store(
                    db, provider=provider, source_key=source_key, adapter=adapter,
                    discovery_method="certificate_transparency", discovered_from_url=None,
                    company_name=None, dry_run=dry_run,
                )
                if validated:
                    summary["validated_count"] += 1
                    summary["discovered_count"] += 1
    logger.info("cert_transparency_discovery_complete summary=%s", {k: v for k, v in summary.items() if k != "errors"})
    return summary


async def discover_via_serper_search(
    db,
    *,
    providers: Optional[List[str]] = None,
    dry_run: bool = False,
    queries_per_provider: Optional[int] = None,
    results_per_query: Optional[int] = None,
) -> Dict[str, Any]:
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        return {"enabled": False, "reason": "SERPER_API_KEY not configured"}
    providers = providers or list(PATH_BASED_ATS_SITE_QUERIES.keys())
    queries_per_provider = max(1, min(int(queries_per_provider or env_int("SERPER_DISCOVERY_QUERIES_PER_PROVIDER", 5)), len(_FRENCH_MARKET_TERMS)))
    results_per_query = max(1, min(int(results_per_query or env_int("SERPER_DISCOVERY_RESULTS_PER_QUERY", 20)), 100))
    adapters = default_ats_adapters()
    summary: Dict[str, Any] = {
        "dry_run": dry_run, "providers": providers,
        "queries_run": 0, "candidates_found": 0, "validated_count": 0, "discovered_count": 0, "errors": [],
    }
    async with httpx.AsyncClient(timeout=15) as client:
        for provider in providers:
            site_query = PATH_BASED_ATS_SITE_QUERIES.get(provider)
            adapter = adapters.get(provider)
            if not site_query or not adapter:
                continue
            existing = await _existing_source_keys(db, provider)
            for term_index in range(queries_per_provider):
                query_text = f"{site_query} {_FRENCH_MARKET_TERMS[term_index]}"
                try:
                    response = await client.post(
                        SERPER_API_URL,
                        json={"q": query_text, "num": results_per_query},
                        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                    )
                    response.raise_for_status()
                    payload = response.json()
                except Exception as exc:
                    summary["errors"].append({"provider": provider, "query": query_text, "error": str(exc)[:150]})
                    continue
                summary["queries_run"] += 1
                for item in payload.get("organic") or []:
                    link = item.get("link") if isinstance(item, dict) else None
                    if not link:
                        continue
                    source_key = adapter.extract_source_key_from_url(link)
                    if not source_key or source_key in existing:
                        continue
                    existing.add(source_key)
                    summary["candidates_found"] += 1
                    validated = await _validate_and_store(
                        db, provider=provider, source_key=source_key, adapter=adapter,
                        discovery_method="serper_search", discovered_from_url=link,
                        company_name=item.get("title"), dry_run=dry_run,
                    )
                    if validated:
                        summary["validated_count"] += 1
                        summary["discovered_count"] += 1
    logger.info("serper_discovery_complete summary=%s", {k: v for k, v in summary.items() if k != "errors"})
    return summary


async def run_company_discovery(db, *, dry_run: bool = False) -> Dict[str, Any]:
    cert_result = None
    if env_bool("CERT_TRANSPARENCY_DISCOVERY_ENABLED", True):
        cert_result = await discover_via_certificate_transparency(db, dry_run=dry_run)
    serper_result = None
    if env_bool("SERPER_DISCOVERY_ENABLED", True):
        serper_result = await discover_via_serper_search(db, dry_run=dry_run)
    return {"dry_run": dry_run, "certificate_transparency": cert_result, "serper_search": serper_result}


_discovery_loop_lock = asyncio.Lock()
_last_discovery_summary: Optional[Dict[str, Any]] = None


def last_discovery_summary() -> Optional[Dict[str, Any]]:
    return _last_discovery_summary


def company_discovery_loop_enabled() -> bool:
    return env_bool("COMPANY_DISCOVERY_LOOP_ENABLED", True)


async def run_company_discovery_loop(db) -> None:
    """Runs as often as env config allows (default 20min, floor 10min) --
    SERPER_API_KEY is now configured, so there's no reason to sit on the
    original conservative 4h default. Still not as fast as the 5-minute
    ATS-direct refresh loop: this hits an external paid API (Serper) and a
    rate-limit-prone free one (crt.sh), so the floor exists to avoid
    burning through Serper quota or getting crt.sh to start hard-blocking.
    """
    if not company_discovery_loop_enabled():
        logger.info("company_discovery_loop_disabled")
        return
    interval_minutes = max(10, env_int("COMPANY_DISCOVERY_INTERVAL_MINUTES", 20))
    initial_delay = max(0, env_int("COMPANY_DISCOVERY_INITIAL_DELAY_SECONDS", 180))
    logger.info("company_discovery_loop_started interval_minutes=%s initial_delay_seconds=%s", interval_minutes, initial_delay)
    await asyncio.sleep(initial_delay)
    while True:
        global _last_discovery_summary
        try:
            if company_discovery_loop_enabled():
                async with _discovery_loop_lock:
                    _last_discovery_summary = await run_company_discovery(db)
        except Exception as exc:
            logger.warning("company_discovery_loop_error error=%s", str(exc)[:300])
        await asyncio.sleep(interval_minutes * 60)
