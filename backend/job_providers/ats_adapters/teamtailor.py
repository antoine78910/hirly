"""Direct Teamtailor public career-site ingestion.

Teamtailor does not offer an unauthenticated JSON API for arbitrary customers
-- their real API requires a partner integration and an API key. What every
public Teamtailor career site *does* expose without any auth is:
  - a server-rendered job listing page with plain ``<a href="/jobs/ID-slug">``
    links (confirmed via a live fetch: no JS execution needed), and
  - a schema.org ``JobPosting`` JSON-LD block on each job's detail page --
    the same structured data ATSes emit for Google for Jobs SEO indexing.

This adapter fetches the listing page for the job URLs, then fetches each
job's JSON-LD block, instead of calling a documented REST endpoint. It is
inherently more fragile than a real API (it depends on Teamtailor's public
page markup rather than a versioned contract) -- if Teamtailor changes their
career-site template, this adapter may need updating.
"""

from __future__ import annotations

import asyncio
import html
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx

from .base import AtsJobAdapter

_JOB_LINK_RE = re.compile(r'href="([^"]*?/jobs/\d+-[^"?#]*)"')
_LDJSON_RE = re.compile(r'<script type="application/ld\+json"[^>]*>(.*?)</script>', re.S)


class TeamtailorAtsAdapter(AtsJobAdapter):
    provider = "teamtailor"

    def __init__(self, timeout: Optional[float] = None, max_concurrency: Optional[int] = None):
        if timeout is None:
            try:
                timeout = float(os.environ.get("TEAMTAILOR_HTTP_TIMEOUT_SECONDS", "15"))
            except (TypeError, ValueError):
                timeout = 15.0
        self.timeout = max(1.0, min(float(timeout), 30.0))
        try:
            concurrency = int(
                max_concurrency
                if max_concurrency is not None
                else os.environ.get("TEAMTAILOR_DETAIL_FETCH_CONCURRENCY", "5")
            )
        except (TypeError, ValueError):
            concurrency = 5
        self.max_concurrency = max(1, min(concurrency, 20))

    def can_handle_url(self, url: str) -> bool:
        return self.extract_source_key_from_url(url) is not None

    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        parsed = urlparse((url or "").strip())
        host = (parsed.netloc or "").lower().removeprefix("www.")
        if host == "teamtailor.com" or not host.endswith(".teamtailor.com"):
            return None
        subdomain = host[: -len(".teamtailor.com")]
        return subdomain or None

    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        base_url = f"https://{source_key}.teamtailor.com"
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
            listing = await client.get(f"{base_url}/jobs")
            listing.raise_for_status()
            job_urls = self.extract_job_urls(listing.text, base_url)
            if limit:
                job_urls = job_urls[: int(limit)]
            semaphore = asyncio.Semaphore(self.max_concurrency)

            async def _fetch_detail(job_url: str) -> Optional[Dict[str, Any]]:
                async with semaphore:
                    try:
                        detail = await client.get(job_url)
                        detail.raise_for_status()
                    except httpx.HTTPError:
                        return None
                return self.extract_job_posting(detail.text, job_url)

            results = await asyncio.gather(*(_fetch_detail(url) for url in job_urls))
        return [row for row in results if row]

    def extract_job_urls(self, listing_html: str, base_url: str) -> List[str]:
        urls: List[str] = []
        seen = set()
        for match in _JOB_LINK_RE.finditer(listing_html or ""):
            absolute = urljoin(base_url + "/", html.unescape(match.group(1)))
            if absolute not in seen:
                seen.add(absolute)
                urls.append(absolute)
        return urls

    def extract_job_posting(self, detail_html: str, job_url: str) -> Optional[Dict[str, Any]]:
        match = _LDJSON_RE.search(detail_html or "")
        if not match:
            return None
        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict) or data.get("@type") != "JobPosting":
            return None
        data = dict(data)
        data["_url"] = job_url
        return data

    def normalize_job(self, raw_job: Dict[str, Any], *, source_key: str) -> Optional[Dict[str, Any]]:
        identifier = raw_job.get("identifier") if isinstance(raw_job.get("identifier"), dict) else {}
        posting_id = str(identifier.get("value") or "").strip()
        title = raw_job.get("title")
        job_url = raw_job.get("_url")
        if not posting_id or not title or not job_url:
            return None

        description = self.clean_text(raw_job.get("description"))
        location, country_code = self._location(raw_job.get("jobLocation"))
        hiring_org = raw_job.get("hiringOrganization") if isinstance(raw_job.get("hiringOrganization"), dict) else {}
        company = self.clean_text(hiring_org.get("name")) or source_key
        imported_at = self.imported_at()
        external_id = f"{source_key}:{posting_id}"
        employment_type = raw_job.get("employmentType")
        job_type = self.clean_text(str(employment_type)).replace("_", " ").title() if employment_type else None

        return {
            "job_id": self.internal_job_id(external_id),
            "provider": self.provider,
            "external_id": external_id,
            "provider_job_id": posting_id,
            "title": self.clean_text(title),
            "company": company,
            "location": location,
            "country_code": country_code,
            "remote": self.remote_value(description, location),
            "salary_min": None,
            "salary_max": None,
            "currency": "EUR" if country_code in {"fr", "se", "de", "es", "it", "nl", "be", "dk", "no", "fi"} else "USD",
            "description": description,
            "clean_description": description,
            "requirements": [],
            "tech_stack": [],
            "job_type": job_type,
            "posted_at": raw_job.get("datePosted") or imported_at,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "external_url": job_url,
            "selected_apply_url": job_url,
            "apply_url_provider": self.provider,
            "apply_url_source": "Teamtailor",
            "source": "Teamtailor",
            "ats_provider": self.provider,
            "auto_apply_supported": True,
            "manual_fulfillment_ready": True,
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct public Teamtailor apply URL.",
            "job_board_account_required": False,
            "board_token": source_key,
            "provider_query": source_key,
            "provider_search_key": f"{self.provider}:{source_key}",
            "raw_provider_payload": raw_job if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def _location(self, job_location: Any) -> Tuple[str, Optional[str]]:
        if isinstance(job_location, dict):
            places = [job_location]
        elif isinstance(job_location, list):
            places = job_location
        else:
            places = []
        for place in places:
            address = place.get("address") if isinstance(place, dict) else None
            if not isinstance(address, dict):
                continue
            parts = [address.get("addressLocality"), address.get("addressRegion")]
            country_code = str(address.get("addressCountry") or "").strip().lower() or None
            location = ", ".join(self.clean_text(part) for part in parts if part) or self.clean_text(address.get("addressCountry")) or "Remote"
            return location, country_code
        return "Remote", None
