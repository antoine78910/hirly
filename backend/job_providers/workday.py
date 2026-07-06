"""Workday Candidate Experience Service (CXS) job board provider."""

from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from employment_kind import enrich_job_employment_kind
from job_normalization import normalize_company_logo_url
from .apply_eligibility import classify_apply_link
from .base import JobSearchQuery, ProviderResult

_WORKDAY_HOST_RE = re.compile(
    r"^(?P<tenant>[a-z0-9-]+)\.(?P<wd>wd\d+)\.myworkdayjobs\.com$",
    re.IGNORECASE,
)

_COUNTRY_FACET_HINTS = {
    "fr": ("france",),
    "us": ("united states", "usa"),
    "gb": ("united kingdom", "uk"),
    "uk": ("united kingdom", "uk"),
    "de": ("germany",),
    "es": ("spain",),
    "it": ("italy",),
    "ca": ("canada",),
    "ie": ("ireland",),
    "nl": ("netherlands",),
    "be": ("belgium",),
    "ch": ("switzerland",),
    "au": ("australia",),
    "il": ("israel",),
}


@dataclass(frozen=True)
class WorkdayBoardConfig:
    tenant: str
    site: str
    wd_server: str = "wd5"
    company_label: Optional[str] = None

    @property
    def public_base_url(self) -> str:
        return f"https://{self.tenant}.{self.wd_server}.myworkdayjobs.com"

    @property
    def cxs_base_url(self) -> str:
        return f"{self.public_base_url}/wday/cxs/{self.tenant}/{self.site}"

    @property
    def display_company(self) -> str:
        return (self.company_label or self.tenant).strip() or self.tenant


def parse_workday_board_url(url: str) -> Optional[WorkdayBoardConfig]:
    """Parse careers URLs like https://workday.wd5.myworkdayjobs.com/Workday."""
    raw = (url or "").strip()
    if not raw:
        return None
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    match = _WORKDAY_HOST_RE.match(host)
    if not match:
        return None
    path_parts = [part for part in (parsed.path or "").split("/") if part]
    if not path_parts:
        return None
    site = path_parts[0]
    return WorkdayBoardConfig(
        tenant=match.group("tenant").lower(),
        site=site,
        wd_server=match.group("wd").lower(),
        company_label=site.replace("-", " ").replace("_", " ").strip() or None,
    )


def build_workday_search_text(query: JobSearchQuery) -> str:
    role = (query.role or "").strip()
    location = (query.location or "").strip()
    if role and location:
        return f"{role} {location}"
    return role or location or ""


def _ascii_fold(value: str) -> str:
    return (value or "").strip().lower()


def _match_facet_values(
    facets: List[Dict[str, Any]],
    *,
    location: Optional[str],
    country: Optional[str],
) -> Dict[str, List[str]]:
    applied: Dict[str, List[str]] = {}
    if not facets:
        return applied

    location_text = _ascii_fold(location or "")
    country_text = _ascii_fold(country or "")
    country_hints = _COUNTRY_FACET_HINTS.get(country_text, ())
    if country_text and country_text not in country_hints:
        country_hints = (*country_hints, country_text)

    for facet in facets:
        if not isinstance(facet, dict):
            continue
        parameter = str(facet.get("facetParameter") or "").strip()
        values = facet.get("values") or []
        if not parameter or not isinstance(values, list):
            continue

        chosen: List[str] = []
        for value in values:
            if not isinstance(value, dict):
                continue
            facet_id = str(value.get("id") or "").strip()
            descriptor = _ascii_fold(str(value.get("descriptor") or ""))
            if not facet_id or not descriptor:
                continue
            if "country" in parameter.lower():
                if any(hint in descriptor for hint in country_hints):
                    chosen.append(facet_id)
                    break
            elif location_text and location_text in descriptor:
                chosen.append(facet_id)
                break
            elif location_text:
                city = location_text.split(",")[0].strip()
                if city and city in descriptor:
                    chosen.append(facet_id)
                    break

        if chosen:
            applied[parameter] = chosen[:1]

    return applied


class WorkdayProvider:
    name = "workday"

    def __init__(self, timeout: Optional[float] = None):
        if timeout is None:
            try:
                timeout = float(os.environ.get("WORKDAY_HTTP_TIMEOUT_SECONDS", "15"))
            except (TypeError, ValueError):
                timeout = 15.0
        self.timeout = max(3.0, min(float(timeout), 30.0))

    def _headers(self, board: WorkdayBoardConfig) -> Dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Accept-Language": "en-US",
            "User-Agent": "Mozilla/5.0 (compatible; Hirly/1.0; +https://tryhirly.com)",
            "Referer": f"{board.public_base_url}/en-US/{board.site}",
        }

    async def search_board(
        self,
        board: WorkdayBoardConfig,
        query: JobSearchQuery,
    ) -> ProviderResult:
        search_text = build_workday_search_text(query)
        max_pages = max(1, min(self._env_int("WORKDAY_MAX_PAGES", 3), 8))
        page_size = max(1, min(int(query.page_size or self._env_int("WORKDAY_PAGE_SIZE", 20)), 20))
        target_count = max(1, min(int(query.limit or 20), page_size * max_pages))

        listings: List[Dict[str, Any]] = []
        applied_facets: Dict[str, List[str]] = {}
        raw_pages: List[Dict[str, Any]] = []
        offset = 0

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            discovery = await client.post(
                f"{board.cxs_base_url}/jobs",
                json={
                    "appliedFacets": {},
                    "limit": min(5, page_size),
                    "offset": 0,
                    "searchText": search_text,
                },
                headers=self._headers(board),
            )
            discovery.raise_for_status()
            discovery_data = discovery.json()
            raw_pages.append(discovery_data)
            applied_facets = _match_facet_values(
                discovery_data.get("facets") or [],
                location=query.location,
                country=query.country,
            )

            for _page_index in range(max_pages):
                payload = {
                    "appliedFacets": applied_facets,
                    "limit": page_size,
                    "offset": offset,
                    "searchText": search_text,
                }
                response = await client.post(
                    f"{board.cxs_base_url}/jobs",
                    json=payload,
                    headers=self._headers(board),
                )
                response.raise_for_status()
                data = response.json()
                raw_pages.append(data)

                page_rows = [
                    row for row in (data.get("jobPostings") or [])
                    if isinstance(row, dict)
                ]
                if not page_rows:
                    break
                listings.extend(page_rows)
                offset += len(page_rows)
                if len(listings) >= target_count:
                    break
                if len(page_rows) < page_size:
                    break

            detail_limit = max(0, min(self._env_int("WORKDAY_DETAIL_FETCH_LIMIT", 12), target_count))
            imported_at = datetime.now(timezone.utc).isoformat()
            jobs: List[Dict[str, Any]] = []
            seen_paths: set[str] = set()

            for index, listing in enumerate(listings[:target_count]):
                external_path = str(listing.get("externalPath") or "").strip()
                if not external_path or external_path in seen_paths:
                    continue
                seen_paths.add(external_path)

                detail: Dict[str, Any] = {}
                if index < detail_limit:
                    try:
                        detail_response = await client.get(
                            f"{board.cxs_base_url}{external_path}",
                            headers=self._headers(board),
                        )
                        detail_response.raise_for_status()
                        detail_payload = detail_response.json()
                        detail = detail_payload.get("jobPostingInfo") or detail_payload
                    except Exception:
                        detail = {}

                normalized = self.normalize_job(
                    listing=listing,
                    detail=detail if isinstance(detail, dict) else {},
                    board=board,
                    query=query,
                    imported_at=imported_at,
                )
                if normalized:
                    jobs.append(normalized)

        return ProviderResult(
            jobs=jobs[:target_count],
            raw_response={"pages": raw_pages, "board": board.tenant, "site": board.site},
        )

    def normalize_job(
        self,
        *,
        listing: Dict[str, Any],
        detail: Dict[str, Any],
        board: WorkdayBoardConfig,
        query: JobSearchQuery,
        imported_at: str,
    ) -> Optional[Dict[str, Any]]:
        title = (detail.get("title") or listing.get("title") or "").strip()
        external_path = str(listing.get("externalPath") or "").strip()
        if not title or not external_path:
            return None

        external_url = (
            detail.get("externalUrl")
            or f"{board.public_base_url}{external_path}"
        )
        external_id = str(
            detail.get("jobReqId")
            or detail.get("jobPostingId")
            or (listing.get("bulletFields") or [None])[0]
            or external_path.rsplit("/", 1)[-1]
        ).strip()
        if not external_id:
            return None

        location = self._location(listing, detail)
        description = str(detail.get("jobDescription") or "").strip()
        apply_classification = classify_apply_link(external_url, source="workday")
        company = board.display_company

        job_doc = {
            "job_id": self._internal_job_id(board, external_id),
            "title": title,
            "company": company,
            "company_logo": normalize_company_logo_url(None),
            "location": location,
            "country_code": self._country_code(detail, query),
            "remote": self._remote(listing, detail, query),
            "salary_min": None,
            "salary_max": None,
            "currency": "USD",
            "description": description,
            "requirements": [],
            "tech_stack": [],
            "seniority": self._seniority(title),
            "posted_at": imported_at,
            "provider": self.name,
            "external_id": f"{board.tenant}:{board.site}:{external_id}",
            "external_url": external_url,
            "source": "workday",
            "ats_provider": "workday",
            "auto_apply_supported": False,
            "auto_apply_reason": "Workday auto-apply is not enabled in Hirly V1",
            **apply_classification,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "provider_query": build_workday_search_text(query),
            "provider_search_key": self.search_key(board, query),
            "board_token": f"{board.tenant}/{board.site}",
            "employment_type": detail.get("timeType") or listing.get("timeType"),
            "remote_type": listing.get("remoteType") or detail.get("remoteType"),
        }
        return enrich_job_employment_kind(job_doc)

    def search_key(self, board: WorkdayBoardConfig, query: JobSearchQuery) -> str:
        remote_preference = "remote" if (query.remote_preference or "").strip().lower() == "remote" else "any"
        bits = [
            self.name,
            board.tenant,
            board.site,
            board.wd_server,
            (query.role or "").strip().lower(),
            (query.location or "").strip().lower(),
            (query.country or "").strip().lower(),
            remote_preference,
        ]
        return hashlib.sha1("|".join(bits).encode("utf-8")).hexdigest()

    def _internal_job_id(self, board: WorkdayBoardConfig, external_id: str) -> str:
        digest = hashlib.sha1(f"{board.tenant}:{board.site}:{external_id}".encode("utf-8")).hexdigest()
        return f"workday_{digest[:24]}"

    def _location(self, listing: Dict[str, Any], detail: Dict[str, Any]) -> str:
        if isinstance(detail.get("location"), str) and detail.get("location").strip():
            return detail["location"].strip()
        if listing.get("locationsText"):
            return str(listing["locationsText"]).strip()
        country = detail.get("country")
        if isinstance(country, dict) and country.get("descriptor"):
            return str(country["descriptor"]).strip()
        return "Location not specified"

    def _country_code(self, detail: Dict[str, Any], query: JobSearchQuery) -> Optional[str]:
        country = detail.get("country")
        if isinstance(country, dict):
            descriptor = _ascii_fold(str(country.get("descriptor") or ""))
            for code, hints in _COUNTRY_FACET_HINTS.items():
                if any(hint in descriptor for hint in hints):
                    return code
        return (query.country or "").strip().lower() or None

    def _remote(self, listing: Dict[str, Any], detail: Dict[str, Any], query: JobSearchQuery) -> bool:
        remote_type = _ascii_fold(str(listing.get("remoteType") or detail.get("remoteType") or ""))
        if remote_type in {"remote", "flex", "hybrid"}:
            return True
        return (query.remote_preference or "").strip().lower() == "remote"

    def _seniority(self, title: str) -> Optional[str]:
        lowered = (title or "").lower()
        if any(token in lowered for token in ("principal", "staff", "distinguished")):
            return "principal"
        if "senior" in lowered or lowered.startswith("sr "):
            return "senior"
        if any(token in lowered for token in ("junior", "entry", "graduate", "intern")):
            return "junior"
        if any(token in lowered for token in ("lead", "head", "director")):
            return "lead"
        return "mid"

    def _env_int(self, name: str, default: int) -> int:
        try:
            return int(os.environ.get(name, default))
        except (TypeError, ValueError):
            return default
