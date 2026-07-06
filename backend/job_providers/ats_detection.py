"""Central ATS and job-platform detection utilities."""

from __future__ import annotations

from typing import Any, Dict, Optional
from urllib.parse import urlparse


ATS_DOMAINS = {
    "boards.greenhouse.io": "greenhouse",
    "job-boards.greenhouse.io": "greenhouse",
    "greenhouse.io": "greenhouse",
    "jobs.lever.co": "lever",
    "api.lever.co": "lever",
    "jobs.ashbyhq.com": "ashby",
    "ashbyhq.com": "ashby",
    "recruitee.com": "recruitee",
    "careers.recruitee.com": "recruitee",
    "jobs.smartrecruiters.com": "smartrecruiters",
    "smartrecruiters.com": "smartrecruiters",
    "myworkdayjobs.com": "workday",
    "wd1.myworkdayjobs.com": "workday",
    "wd3.myworkdayjobs.com": "workday",
    "wd5.myworkdayjobs.com": "workday",
    "icims.com": "icims",
    "teamtailor.com": "teamtailor",
    "flatchr.io": "flatchr",
    "careers.flatchr.io": "flatchr",
    "taleez.com": "taleez",
    "werecruit.io": "werecruit",
    "digitalrecruiters.com": "digitalrecruiters",
    "jobaffinity.fr": "jobaffinity",
    "workable.com": "workable",
    "apply.workable.com": "workable",
    "jobs.personio.com": "personio",
    "personio.com": "personio",
    "bamboohr.com": "bamboohr",
    "applytojob.com": "bamboohr",
    "successfactors.com": "successfactors",
    "jobs.sap.com": "successfactors",
    "breezy.hr": "breezyhr",
}

LOGIN_REQUIRED_DOMAINS = {
    "linkedin.com": "linkedin",
    "indeed.com": "indeed",
    "glassdoor.com": "glassdoor",
    "francetravail.fr": "francetravail",
    "hellowork.com": "hellowork",
    "apec.fr": "apec",
    "welcometothejungle.com": "welcometothejungle",
    "monster.com": "monster",
    "ziprecruiter.com": "ziprecruiter",
}

DISCOVERY_ONLY_DOMAINS = {
    "simplyhired.com": "simplyhired",
    "talent.com": "talent",
    "adzuna.com": "adzuna",
    "jooble.org": "jooble",
    "jooble.com": "jooble",
}

GOOGLE_DISCOVERY_HOSTS = {"google.com", "www.google.com"}

PRIMARY_AUTO_APPLY_ATS = {
    "greenhouse",
    "lever",
    "ashby",
    # Confirmed via live application-flow audit (2026-07-06): no mandatory
    # candidate login/account creation, publicly reachable apply forms, and
    # (where verifiable) no confirmed CAPTCHA/bot-wall on the real apply flow.
    "teamtailor",
    "werecruit",
    "jobaffinity",
    "flatchr",
    "personio",
    "smartrecruiters",
    "breezyhr",
}


def detect_ats_from_url(url: Optional[str]) -> Optional[str]:
    host = _host(url)
    if not host:
        return None
    return _provider_for_host(host, ATS_DOMAINS)


def detect_ats_from_html(html: Optional[str]) -> Optional[str]:
    text = (html or "").lower()
    if not text:
        return None
    for marker, provider in (
        ("boards.greenhouse.io", "greenhouse"),
        ("job-boards.greenhouse.io", "greenhouse"),
        ("jobs.lever.co", "lever"),
        ("jobs.ashbyhq.com", "ashby"),
        ("smartrecruiters.com", "smartrecruiters"),
        ("myworkdayjobs.com", "workday"),
        ("teamtailor.com", "teamtailor"),
        ("recruitee.com", "recruitee"),
        ("flatchr.io", "flatchr"),
        ("taleez.com", "taleez"),
        ("werecruit.io", "werecruit"),
        ("digitalrecruiters.com", "digitalrecruiters"),
        ("jobaffinity.fr", "jobaffinity"),
        ("workable.com", "workable"),
        ("personio.com", "personio"),
        ("bamboohr.com", "bamboohr"),
        ("successfactors.com", "successfactors"),
        ("jobs.sap.com", "successfactors"),
        ("icims.com", "icims"),
        ("breezy.hr", "breezyhr"),
    ):
        if marker in text:
            return provider
    return None


def detect_job_platform(url: Optional[str], html: Optional[str] = None) -> Dict[str, Any]:
    host = _host(url)
    ats_provider = detect_ats_from_url(url) or detect_ats_from_html(html)
    login_provider = _provider_for_host(host, LOGIN_REQUIRED_DOMAINS)
    discovery_provider = _provider_for_host(host, DISCOVERY_ONLY_DOMAINS)
    if _is_google_jobs_url(url):
        discovery_provider = "google_jobs"

    if ats_provider:
        return {
            "provider": ats_provider,
            "ats_provider": ats_provider,
            "category": "direct_ats",
            "requires_login": False,
            "requires_account_creation": False,
            "is_discovery_only": False,
            "confidence": 0.95,
        }
    if login_provider:
        return {
            "provider": login_provider,
            "ats_provider": None,
            "category": "account_required",
            "requires_login": True,
            "requires_account_creation": True,
            "is_discovery_only": False,
            "confidence": 0.95,
        }
    if discovery_provider:
        return {
            "provider": discovery_provider,
            "ats_provider": None,
            "category": "discovery_only",
            "requires_login": False,
            "requires_account_creation": False,
            "is_discovery_only": True,
            "confidence": 0.9,
        }
    if host:
        return {
            "provider": "company",
            "ats_provider": None,
            "category": "company",
            "requires_login": False,
            "requires_account_creation": False,
            "is_discovery_only": False,
            "confidence": 0.55,
        }
    return {
        "provider": "unknown",
        "ats_provider": None,
        "category": "unknown",
        "requires_login": False,
        "requires_account_creation": False,
        "is_discovery_only": False,
        "confidence": 0.0,
    }


def is_known_login_required_domain(url: Optional[str]) -> bool:
    host = _host(url)
    return bool(_provider_for_host(host, LOGIN_REQUIRED_DOMAINS))


def is_known_job_board_or_discovery_domain(url: Optional[str]) -> bool:
    host = _host(url)
    return bool(_provider_for_host(host, DISCOVERY_ONLY_DOMAINS) or _is_google_jobs_url(url))


def _provider_for_host(host: str, domain_map: Dict[str, str]) -> Optional[str]:
    if not host:
        return None
    for domain, provider in domain_map.items():
        if host == domain or host.endswith(f".{domain}"):
            return provider
    return None


def _host(url: Optional[str]) -> str:
    parsed = urlparse((url or "").strip())
    host = parsed.netloc or parsed.path.split("/", 1)[0]
    return host.lower().removeprefix("www.")


def _is_google_jobs_url(url: Optional[str]) -> bool:
    parsed = urlparse((url or "").strip())
    raw_path = parsed.path or ""
    host = (parsed.netloc or raw_path.split("/", 1)[0]).lower().removeprefix("www.")
    path = raw_path.lower()
    if not parsed.netloc and "/" in raw_path:
        path = "/" + raw_path.split("/", 1)[1].lower()
    query = (parsed.query or "").lower()
    return host in GOOGLE_DISCOVERY_HOSTS and (path.startswith("/search") or "ibp=htl;jobs" in query or "google_jobs" in query)
