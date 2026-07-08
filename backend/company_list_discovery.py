"""Discover career pages for real, named companies via plain-text search.

company_discovery_crawlers.discover_via_serper_search tries `site:` queries
to enumerate ATS-hosted URLs directly -- confirmed live that Serper's free
plan rejects that query pattern outright ("Query pattern not allowed for
free accounts"). Plain-text queries work fine on the same plan (confirmed
live: "LVMH carrieres recrutement" returned LVMH's real careers page as the
top result). So this works backward instead: start from a curated list of
real companies, search for each one's career page by name, and only THEN
check what it actually is:

- If the top result resolves to a known ATS's hosted URL (e.g.
  boards.greenhouse.io/x), validate it via that adapter's own fetch_jobs
  and record it in ats_company_sources exactly like the other discovery
  paths do.
- Otherwise, run it through the same friendliness probe used for tier-C
  "unknown ATS" jobs (no login, no CAPTCHA) and, if friendly, record it in
  friendly_company_career_pages for the generic scraper.

A search hit is a lead, not proof, in both cases -- nothing gets written
without an actual successful validation/probe.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from ats_source_service import _careers_url, env_int
from company_career_page_prober import probe_career_page_friendliness
from job_providers.ats_adapters.registry import adapter_for_url, default_ats_adapters
from job_providers.ats_detection import detect_ats_from_url

logger = logging.getLogger(__name__)

SERPER_API_URL = "https://google.serper.dev/search"

# CAC 40 + CAC Next 20 -- France's 60 largest publicly traded companies, as
# a starting seed list. Deliberately not exhaustive: extend via
# COMPANY_DISCOVERY_COMPANY_NAMES (comma-separated) to widen coverage
# without a code change, e.g. adding mid-cap or sector-specific lists later.
DEFAULT_COMPANY_NAMES = [
    "Accor", "Air Liquide", "Airbus", "ArcelorMittal", "Axa", "BNP Paribas",
    "Bouygues", "Bureau Veritas", "Capgemini", "Carrefour", "Credit Agricole",
    "Danone", "Dassault Systemes", "Edenred", "Engie", "EssilorLuxottica",
    "Eurofins Scientific", "Hermes", "Kering", "L'Oreal", "Legrand", "LVMH",
    "Michelin", "Orange", "Pernod Ricard", "Publicis", "Renault", "Safran",
    "Saint-Gobain", "Sanofi", "Schneider Electric", "Societe Generale",
    "Stellantis", "STMicroelectronics", "Teleperformance", "Thales",
    "TotalEnergies", "Unibail-Rodamco-Westfield", "Veolia", "Vinci",
    "Air France-KLM", "Arkema", "BioMerieux", "Eiffage", "Euronext",
    "Faurecia", "Gecina", "Getlink", "Klepierre", "Remy Cointreau", "Rexel",
    "Sartorius Stedim Biooutsource", "Sodexo", "Soitec", "Solvay", "Ubisoft",
    "Valeo", "Vivendi",
]

_EXCLUDED_RESULT_HOSTS = {
    "linkedin.com", "fr.linkedin.com", "indeed.com", "fr.indeed.com",
    "glassdoor.com", "glassdoor.fr", "welcometothejungle.com",
    "hellowork.com", "wikipedia.org", "en.wikipedia.org", "fr.wikipedia.org",
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
    "apec.fr", "monster.fr", "monster.com", "indeed.fr",
}


def _company_names() -> List[str]:
    raw = os.environ.get("COMPANY_DISCOVERY_COMPANY_NAMES")
    if raw:
        return [item.strip() for item in raw.split(",") if item.strip()]
    return DEFAULT_COMPANY_NAMES


async def _search_career_page(client: httpx.AsyncClient, api_key: str, company: str) -> Optional[Dict[str, Any]]:
    try:
        response = await client.post(
            SERPER_API_URL,
            json={"q": f"{company} carriere recrutement offres emploi", "num": 10},
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        logger.info("company_career_search_failed company=%s error=%s", company, str(exc)[:150])
        return None
    for item in payload.get("organic") or []:
        link = item.get("link")
        if not isinstance(link, str) or not link:
            continue
        host = (urlparse(link).netloc or "").lower().removeprefix("www.")
        if host in _EXCLUDED_RESULT_HOSTS:
            continue
        return {"link": link, "title": item.get("title")}
    return None


async def discover_via_company_list(
    db,
    *,
    companies: Optional[List[str]] = None,
    dry_run: bool = False,
    max_companies_per_run: Optional[int] = None,
) -> Dict[str, Any]:
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        return {"enabled": False, "reason": "SERPER_API_KEY not configured"}

    companies = companies or _company_names()
    max_companies = max(1, min(int(max_companies_per_run or env_int("COMPANY_DISCOVERY_COMPANIES_PER_RUN", 15)), len(companies)))

    summary: Dict[str, Any] = {
        "dry_run": dry_run,
        "companies_total": len(companies),
        "companies_checked": 0,
        "career_pages_found": 0,
        "ats_matches": 0,
        "friendly_generic_pages": 0,
        "not_friendly": 0,
        "errors": [],
    }

    adapters = default_ats_adapters()
    async with httpx.AsyncClient(timeout=20) as client:
        for company in companies[:max_companies]:
            summary["companies_checked"] += 1
            result = await _search_career_page(client, api_key, company)
            if not result:
                continue
            link = result["link"]
            summary["career_pages_found"] += 1

            provider_name = detect_ats_from_url(link)
            adapter = adapters.get(provider_name) if provider_name else None
            if adapter:
                handled = await _try_ats_match(db, adapter=adapter, link=link, company=company, dry_run=dry_run, summary=summary)
                if handled:
                    continue

            await _try_generic_friendly(db, client=client, link=link, company=company, dry_run=dry_run, summary=summary)

    logger.info("company_list_discovery_complete summary=%s", {k: v for k, v in summary.items() if k != "errors"})
    return summary


async def _try_ats_match(db, *, adapter: Any, link: str, company: str, dry_run: bool, summary: Dict[str, Any]) -> bool:
    source_key = adapter.extract_source_key_from_url(link)
    if not source_key:
        return False
    try:
        jobs = await adapter.fetch_jobs(source_key, limit=1)
    except Exception as exc:
        summary["errors"].append({"company": company, "error": f"{exc.__class__.__name__}: {str(exc)[:150]}"})
        return False
    if not jobs:
        return False
    summary["ats_matches"] += 1
    if not dry_run:
        now = datetime.now(timezone.utc).isoformat()
        await db.ats_company_sources.update_one(
            {"id": f"{adapter.provider}:{source_key}"},
            {"$set": {
                "id": f"{adapter.provider}:{source_key}",
                "ats_provider": adapter.provider,
                "source_key": source_key,
                "company_name": company,
                "careers_url": _careers_url(adapter.provider, source_key),
                "country_code": "fr",
                "discovered_from_url": link,
                "discovered_from_job_id": None,
                "is_active": True,
                "failure_count": 0,
                "raw_metadata": {"source": "company_list_search"},
                "created_at": now,
                "updated_at": now,
            }},
            upsert=True,
        )
    return True


async def _try_generic_friendly(db, *, client: httpx.AsyncClient, link: str, company: str, dry_run: bool, summary: Dict[str, Any]) -> None:
    try:
        probe = await probe_career_page_friendliness(link, client=client)
    except Exception as exc:
        summary["errors"].append({"company": company, "error": f"{exc.__class__.__name__}: {str(exc)[:150]}"})
        return
    if not probe.get("is_friendly"):
        summary["not_friendly"] += 1
        return
    summary["friendly_generic_pages"] += 1
    if dry_run:
        return
    domain = (urlparse(link).netloc or "").lower().removeprefix("www.")
    if not domain:
        return
    now = datetime.now(timezone.utc).isoformat()
    await db.friendly_company_career_pages.update_one(
        {"id": domain},
        {"$set": {
            "id": domain,
            "company_name": company,
            "career_page_url": link,
            "domain": domain,
            "country_code": "fr",
            "discovered_from_url": link,
            "discovered_from_job_id": None,
            "is_friendly": True,
            "requires_login": probe.get("requires_login"),
            "captcha_detected": probe.get("captcha_detected"),
            "has_file_upload": probe.get("has_file_upload"),
            "last_checked_at": now,
            "updated_at": now,
        }},
        upsert=True,
    )
