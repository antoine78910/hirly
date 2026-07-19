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

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from ats_source_service import _careers_url, env_bool, env_int
from company_career_page_prober import probe_career_page_friendliness
from job_providers.ats_adapters.registry import adapter_for_url, default_ats_adapters
from job_providers.ats_detection import detect_ats_from_url
from jobs_service import _cooldown_until, _is_rate_limit_error, _set_rate_limit_cooldown

logger = logging.getLogger(__name__)

SERPER_API_URL = "https://google.serper.dev/search"

# Combined from several real, published sources rather than one narrow list,
# so coverage spans large-cap blue-chips down to mid-size scaleups instead of
# skewing toward only the handful of household names most likely to already
# be discovered some other way:
#  - CAC 40 + CAC Next 20 (France's 60 largest publicly traded companies)
#  - Wikipedia's "List of companies of France" (large/legacy employers
#    across industry, retail, media, luxury, transport, telecom)
#  - French Tech Next40/120 (the 120 fastest-growing French tech scaleups)
#  - Published French unicorn lists (mostly overlaps Next40/120, kept for
#    the few that don't)
# Deliberately not exhaustive -- extend via COMPANY_DISCOVERY_COMPANY_NAMES
# (comma-separated) to widen coverage further without a code change.
DEFAULT_COMPANY_NAMES = [
    # CAC 40 + CAC Next 20
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
    # Large/legacy employers (Wikipedia "List of companies of France")
    "Aeropostale", "Aerospatiale-Matra", "Alcatel Submarine Networks",
    "Alcatel-Lucent", "Ales Groupe", "Alstom", "Altran", "Alten",
    "Arianespace", "ArianeGroup", "Arkane Studios", "Arte", "Astrium",
    "AT Internet", "Atari SA", "Atisreal", "Atos", "Auchan", "Babolat",
    "Baccarat", "Banijay", "Banque de l'Indochine", "Bel Group", "Bollore",
    "Bonduelle", "Bouygues Telecom", "Brittany Ferries", "Bugatti Automobiles",
    "Canal+", "Cartier", "Celio", "Chanel", "Chantelle", "Christian Dior SE",
    "Citroen", "Clarins", "CMA CGM", "Credit Commercial de France",
    "Credit Mutuel", "Conforama", "Credit Foncier de France", "Credit Lyonnais",
    "Criteo", "Dassault Aviation", "De Dietrich", "Decathlon", "Dexia",
    "Diptyque", "E.Leclerc", "Editions Philippe Amaury", "EFI Automotive",
    "Electricite de France", "Elf Aquitaine", "Essilor", "Eutelsat", "Fnac",
    "Forvia", "Framatome", "Galeries Lafayette", "Gameloft", "Gandi",
    "Gaumont", "Genset", "Groupe BPCE", "Groupe Bull", "Groupe Casino",
    "Groupe SEB", "Hachette", "Hachette Filipacchi Medias", "Havas",
    "Hutchinson SA", "Iliad SA", "JCDecaux", "Keolis", "La Poste",
    "Laboratoires Expanscience", "Lacoste", "Lactalis", "Lafarge", "Lafuma",
    "Lagardere Group", "Lancome", "Louis Vuitton", "Mane", "Manuloc",
    "Matra Marconi Space", "Mavic", "Microids", "Montagut", "MoonScoop Group",
    "Motul", "Naval Group", "Neyco", "Norauto", "Opella", "OPmobility",
    "Orano", "Oxbow", "Panzani", "Parrot SA", "Pathe", "Pentalog", "Peugeot",
    "PSA Group", "Quantic Dream", "RATP Group", "Rhodia", "Rhone-Poulenc",
    "Robertet", "Saft", "SAGEM", "Sagemcom", "Salomon Group", "SCOR SE",
    "SDV International Logistics", "Sephora", "Servier", "SFR", "Sigfox",
    "SNCF", "Snecma", "Societe Bic", "Sogeti", "Suez", "Technicolor SA",
    "Technip", "TF1 Group", "Thomson-CSF", "Viseo", "Waterman", "Yoplait",
    "Yves Rocher",
    # French Tech Next40/120 + unicorns
    "Morpho", "Qonto", "AMI Labs", "Pasqal", "Harmattan AI", "Brevo",
    "DentalMonitoring", "Mistral AI", "Pigment", "Pennylane", "Dataiku",
    "Sorare", "Contentsquare", "ManoMano", "Believe", "Voodoo", "Blablacar",
    "Ledger", "Mirakl", "Alan", "Talend", "Doctolib", "Back Market",
    "Vestiaire Collective", "Meero", "Deezer", "Veepee", "Swile",
    "Shift Technology", "Lydia", "Alice & Bob", "Alma", "Aqemia", "Aura Aero",
    "Chapsvision", "Descartes Underwriting", "Ecovadis", "Ekimetrics",
    "Electra", "Exotec", "Flying Whales", "Foodles", "H Company", "Hublo",
    "Innovafeed", "Legalplace", "Malt", "Medadom", "Payfit", "Quobly",
    "Spendesk", "Tissium", "Verkor", "Wandercraft", "360 Learning", "Acheel",
    "Adikteev", "Agicap", "Agryco", "Akeneo", "AKUR8", "Animaj", "Bigblue",
    "Bump", "Chargemap", "ClubFunding", "CorWave", "Creme de la Creme",
    "Deepki", "ElicitPlant", "Energy Pool", "Exotrail", "FAIRMAT", "Flowdesk",
    "FoodFlow", "FreelanceRepublik", "GitGuardian", "Gradium", "GravitHy",
    "Greenly", "HelloCSE", "Homa", "HomeExchange", "iSupplier", "ITEN",
    "Jimmy", "La Fourche", "Latitude", "LeHibou", "Libon", "Locala", "Metron",
    "Mistertemp'Group", "Moon Surgical", "MWM", "Mylight150", "MyUnisoft",
    "Naboo", "Ornikar", "OuiHelp", "Papernest", "Partoo", "Planity",
    "Positive", "Qair", "Resilience", "Scintil Photonics", "Sekoia", "Seyna",
    "Shares", "Shippeo", "Shopopop", "SparingVision", "Spore.Bio",
    "Step Pharma", "Stockly", "Stoik", "Stych", "Superprof", "Swan", "Sweep",
    "TSE", "Unseenlabs", "Upsun", "Verley", "Voltalis", "Waat", "Weezevent",
    "Yespark", "Zeplug ChargeGuru",
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


def _normalized_company_key(company: str) -> str:
    return company.strip().lower()


# Rotating cursor across runs, same pattern as jsearch_harvest.py -- without
# this, every run re-slices companies[:max_companies_per_run], which for a
# fixed max always resolves to the exact same leading subset of the list and
# never reaches the rest.
_discovery_cursor = 0
_discovery_lock = asyncio.Lock()

# In-memory recheck dedup (module-level, same pattern as jsearch_harvest.py's
# _combo_backoff_level -- not DB-backed since company_discovery_checked isn't
# one of the tables the Supabase adapter has migrated/whitelisted, and adding
# a brand-new Postgres table isn't something this process can self-serve).
# Resets on a deploy/restart, which just means a handful of already-known
# companies get redundantly re-searched once rather than a correctness bug.
_checked_companies: Dict[str, datetime] = {}


async def _search_career_page(client: httpx.AsyncClient, api_key: str, company: str) -> Optional[Dict[str, Any]]:
    response = await client.post(
        SERPER_API_URL,
        json={"q": f"{company} carriere recrutement offres emploi", "num": 10},
        headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
    )
    response.raise_for_status()
    payload = response.json()
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
    start_offset: Optional[int] = None,
) -> Dict[str, Any]:
    global _discovery_cursor
    api_key = os.environ.get("SERPER_API_KEY")
    if not api_key:
        return {"enabled": False, "reason": "SERPER_API_KEY not configured"}

    # A confirmed 429 anywhere against Serper means every query below would
    # fail the same way -- bail before spending any of the planned queries.
    cooldown = _cooldown_until("serper")
    if cooldown is not None:
        logger.info("company_discovery_skipped_cooldown_active until=%s", cooldown.isoformat())
        return {"enabled": True, "reason": "provider_cooldown_active", "cooldown_until": cooldown.isoformat()}

    companies = companies or _company_names()
    if not companies:
        return {"enabled": True, "reason": "no_companies_configured"}
    default_companies = 80 if env_bool("JOBS_INVENTORY_BLITZ", True) else 40
    max_companies = max(1, min(int(max_companies_per_run or env_int("COMPANY_DISCOVERY_COMPANIES_PER_RUN", default_companies)), len(companies)))
    recheck_after_days = max(1, env_int("COMPANY_DISCOVERY_RECHECK_DAYS", 60))
    recheck_cutoff = datetime.now(timezone.utc) - timedelta(days=recheck_after_days)

    async with _discovery_lock:
        cursor = start_offset % len(companies) if start_offset is not None else _discovery_cursor % len(companies)
        selected = [companies[(cursor + i) % len(companies)] for i in range(max_companies)]
        if start_offset is None:
            _discovery_cursor = (cursor + max_companies) % len(companies)

    # Already-checked companies (within the recheck horizon) are skipped
    # without spending a Serper query -- otherwise every run re-burns budget
    # re-confirming companies we already resolved instead of reaching new
    # ones, which was the whole reason discovery never grew past ~15 names.
    recently_checked = {
        key for key in (_normalized_company_key(c) for c in selected)
        if _checked_companies.get(key, recheck_cutoff) > recheck_cutoff
    }

    summary: Dict[str, Any] = {
        "dry_run": dry_run,
        "companies_total": len(companies),
        "cursor_start": cursor,
        "companies_checked": 0,
        "companies_skipped_recent": 0,
        "career_pages_found": 0,
        "ats_matches": 0,
        "friendly_generic_pages": 0,
        "not_friendly": 0,
        "errors": [],
    }

    adapters = default_ats_adapters()
    async with httpx.AsyncClient(timeout=20) as client:
        for company in selected:
            key = _normalized_company_key(company)
            if key in recently_checked:
                summary["companies_skipped_recent"] += 1
                continue
            summary["companies_checked"] += 1
            try:
                result = await _search_career_page(client, api_key, company)
            except Exception as exc:
                summary["errors"].append({"company": company, "error": f"{exc.__class__.__name__}: {str(exc)[:150]}"})
                if _is_rate_limit_error(exc):
                    _set_rate_limit_cooldown("serper")
                    summary["aborted_reason"] = "rate_limited"
                    break
                continue
            if not dry_run:
                _checked_companies[key] = datetime.now(timezone.utc)
            if not result:
                continue
            link = result["link"]
            summary["career_pages_found"] += 1

            # Whole rest of this company's processing wrapped in one guard --
            # confirmed live that an exception anywhere in here (URL parsing,
            # adapter lookup, the probe, etc.) propagated uncaught all the
            # way up through the admin endpoint into a raw 500, abandoning
            # every not-yet-processed company in the run. Same per-item
            # isolation jsearch_harvest.py already uses for its combos.
            try:
                provider_name = detect_ats_from_url(link)
                adapter = adapters.get(provider_name) if provider_name else None
                if adapter:
                    handled = await _try_ats_match(db, adapter=adapter, link=link, company=company, dry_run=dry_run, summary=summary)
                    if handled:
                        continue

                await _try_generic_friendly(db, client=client, link=link, company=company, dry_run=dry_run, summary=summary)
            except Exception as exc:
                summary["errors"].append({"company": company, "error": f"{exc.__class__.__name__}: {str(exc)[:150]}"})

    summary["cursor_next"] = (cursor + max_companies) % len(companies)
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
        try:
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
        except Exception as exc:
            # One company's write failing (e.g. a transient Supabase upsert
            # timeout) must not abort the rest of the batch -- confirmed live
            # that an unhandled exception here propagates all the way up
            # through the admin endpoint into a raw 500, killing every
            # not-yet-processed company in the run.
            summary["errors"].append({"company": company, "error": f"{exc.__class__.__name__}: {str(exc)[:150]}"})
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
    try:
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
    except Exception as exc:
        summary["errors"].append({"company": company, "error": f"{exc.__class__.__name__}: {str(exc)[:150]}"})
