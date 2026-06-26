"""Lever public postings provider."""

import hashlib
import html
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup

from .base import BoardQuery, ProviderResult

logger = logging.getLogger(__name__)


class LeverProvider:
    name = "lever"

    def __init__(
        self,
        base_url: Optional[str] = None,
        eu_base_url: Optional[str] = None,
        timeout: float = 15.0,
    ):
        self.base_url = (base_url or os.environ.get("LEVER_BASE_URL") or "https://api.lever.co/v0/postings").rstrip("/")
        self.eu_base_url = (eu_base_url or os.environ.get("LEVER_EU_BASE_URL") or "https://api.eu.lever.co/v0/postings").rstrip("/")
        self.timeout = timeout

    def board_api_url(self, site: str, eu: bool = False) -> str:
        base = self.eu_base_url if eu else self.base_url
        return f"{base}/{site}?mode=json"

    async def inspect_board(self, site: str) -> Dict[str, Any]:
        site = site.strip().lower()
        primary_url = self.board_api_url(site)
        eu_url = self.board_api_url(site, eu=True)
        attempts: Dict[str, Dict[str, Any]] = {
            "primary": {"url": primary_url, "status": None, "error_snippet": None, "payload": None},
            "eu": {"url": eu_url, "status": None, "error_snippet": None, "payload": None},
        }
        selected_region = None
        selected_payload = None

        for region, url in (("primary", primary_url), ("eu", eu_url)):
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(url)
            attempts[region]["status"] = response.status_code
            if response.status_code == 200:
                try:
                    attempts[region]["payload"] = response.json()
                except ValueError:
                    attempts[region]["error_snippet"] = response.text[:500]
                    continue
                if selected_payload is None:
                    selected_region = region
                    selected_payload = attempts[region]["payload"]
            else:
                attempts[region]["error_snippet"] = response.text[:500]

        rows = selected_payload if isinstance(selected_payload, list) else []
        first_job_title = rows[0].get("text") if rows and isinstance(rows[0], dict) else None
        selected_attempt = attempts.get(selected_region or "primary", attempts["primary"])
        final_status = selected_attempt.get("status") or attempts["eu"].get("status")
        final_error = selected_attempt.get("error_snippet") or attempts["eu"].get("error_snippet")
        return {
            "site": site,
            "api_url": selected_attempt["url"],
            "region": "eu" if selected_region == "eu" else "us" if selected_region == "primary" else None,
            "status_code": final_status,
            "jobs_count": len(rows),
            "first_job_title": first_job_title,
            "error_snippet": final_error,
            "payload": selected_payload,
            "primary_url": primary_url,
            "primary_status": attempts["primary"]["status"],
            "primary_error_snippet": attempts["primary"]["error_snippet"],
            "eu_url": eu_url,
            "eu_status": attempts["eu"]["status"],
            "eu_error_snippet": attempts["eu"]["error_snippet"],
        }

    async def search_board(self, query: BoardQuery) -> ProviderResult:
        site = query.board_token.strip().lower()
        inspection = await self.inspect_board(site)
        if inspection["status_code"] != 200:
            raise httpx.HTTPStatusError(
                f"Lever board returned {inspection['status_code']}",
                request=httpx.Request("GET", inspection["api_url"]),
                response=httpx.Response(
                    inspection["status_code"] or 500,
                    request=httpx.Request("GET", inspection["api_url"]),
                    text=inspection["error_snippet"] or "",
                ),
            )

        rows = inspection.get("payload") if isinstance(inspection.get("payload"), list) else []
        imported_at = datetime.now(timezone.utc).isoformat()
        jobs = [self.normalize_job(row, query, imported_at, inspection.get("region")) for row in rows[: query.limit]]
        jobs = [job for job in jobs if job is not None]
        return ProviderResult(jobs=jobs, raw_response={"jobs": rows, "region": inspection.get("region")})

    def normalize_job(
        self,
        row: Dict[str, Any],
        query: BoardQuery,
        imported_at: str,
        region: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        raw_external_id = row.get("id")
        title = row.get("text")
        if not raw_external_id or not title:
            return None

        external_id = f"{query.board_token}:{raw_external_id}"
        external_url = row.get("hostedUrl") or row.get("applyUrl") or f"https://jobs.lever.co/{query.board_token}/{raw_external_id}"
        description = self._description(row)
        sections = self._description_sections(row, description)
        location = self._location(row)
        categories = row.get("categories") or {}

        return {
            "job_id": self._internal_job_id(str(external_id)),
            "title": self.sanitize_text(title),
            "company": query.company,
            "company_logo": None,
            "location": location,
            "remote": self._remote(row, description),
            "salary_min": None,
            "salary_max": None,
            "currency": "USD",
            "description": description,
            "clean_description": description,
            "job_description_sections": sections,
            "requirements": self._requirements(row, description),
            "tech_stack": [],
            "seniority": self._seniority(title),
            "posted_at": self._posted_at(row) or imported_at,
            "provider": self.name,
            "external_id": str(external_id),
            "provider_job_id": str(raw_external_id),
            "board_token": query.board_token,
            "external_url": external_url,
            "apply_url": row.get("applyUrl"),
            "hosted_url": row.get("hostedUrl"),
            "source": "Lever",
            "ats_provider": "lever",
            "auto_apply_supported": True,
            "auto_apply_reason": "lever supported through browser preparation flow",
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct apply URL available via lever.",
            "apply_url_provider": "lever",
            "apply_url_source": "Lever",
            "selected_apply_url": external_url,
            "manual_fulfillment_ready": True,
            "job_board_account_required": False,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "provider_query": query.board_token,
            "provider_search_key": self.search_key(query),
            "department": categories.get("department"),
            "team": categories.get("team"),
            "commitment": categories.get("commitment"),
            "workplace_type": categories.get("workplaceType"),
            "provider_region": region,
            "raw_provider_payload": row if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def search_key(self, query: BoardQuery) -> str:
        return ":".join([
            self.name,
            query.board_token.lower(),
            (query.role or "").strip().lower(),
            (query.location or "").strip().lower(),
            (query.remote_preference or "any").strip().lower(),
            (query.country or "").strip().lower(),
        ])

    def _internal_job_id(self, external_id: str) -> str:
        digest = hashlib.sha1(f"{self.name}:{external_id}".encode("utf-8")).hexdigest()[:16]
        return f"job_{digest}"

    def _description(self, row: Dict[str, Any]) -> str:
        parts = []
        for key in ("descriptionPlain", "description", "additionalPlain", "additional"):
            value = row.get(key)
            if value:
                parts.append(self.sanitize_text(value))
        lists = row.get("lists") or []
        if isinstance(lists, list):
            for section in lists:
                if not isinstance(section, dict):
                    continue
                text = self.sanitize_text(section.get("text"))
                content = self.sanitize_text(section.get("content"))
                if text:
                    parts.append(text)
                if content:
                    parts.append(content)
        return "\n\n".join(part for part in parts if part).strip()

    def _description_sections(self, row: Dict[str, Any], fallback_text: str) -> List[Dict[str, Any]]:
        sections = []
        intro = self.sanitize_text(row.get("descriptionPlain") or row.get("description"))
        if intro:
            sections.append({"title": "About the role", "bullets": self._paragraph_bullets(intro)[:5]})

        lists = row.get("lists") or []
        if isinstance(lists, list):
            for item in lists:
                if not isinstance(item, dict):
                    continue
                title = self.sanitize_text(item.get("text")) or "Details"
                bullets = self._paragraph_bullets(self.sanitize_text(item.get("content")))
                if bullets:
                    sections.append({"title": title, "bullets": bullets[:6]})

        if not sections and fallback_text:
            sections.append({"title": "About the role", "bullets": self._paragraph_bullets(fallback_text)[:5]})
        return sections

    def _requirements(self, row: Dict[str, Any], description: str) -> List[str]:
        requirements = []
        lists = row.get("lists") or []
        if isinstance(lists, list):
            for item in lists:
                if not isinstance(item, dict):
                    continue
                title = self.sanitize_text(item.get("text")).lower()
                if any(term in title for term in ("requirement", "qualification", "experience", "you have", "skills")):
                    requirements.extend(self._paragraph_bullets(self.sanitize_text(item.get("content"))))
        if requirements:
            return requirements[:12]
        return [line for line in self._paragraph_bullets(description) if len(line) > 25][:8]

    def _paragraph_bullets(self, text: str) -> List[str]:
        cleaned = self.sanitize_text(text)
        if not cleaned:
            return []
        candidates = re.split(r"(?:\n+| • | - )", cleaned)
        if len(candidates) == 1:
            candidates = re.split(r"(?<=[.!?])\s+(?=[A-Z])", cleaned)
        return [item.strip(" -•\t") for item in candidates if len(item.strip(" -•\t")) > 8]

    def _location(self, row: Dict[str, Any]) -> str:
        categories = row.get("categories") or {}
        location = categories.get("location") or row.get("country") or "Remote"
        return self.sanitize_text(location) or "Remote"

    def _remote(self, row: Dict[str, Any], description: str) -> str:
        categories = row.get("categories") or {}
        workplace = str(categories.get("workplaceType") or "").lower()
        text = " ".join([workplace, self._location(row).lower(), description.lower()])
        if "remote" in text:
            return "remote"
        if "hybrid" in text:
            return "hybrid"
        return "onsite"

    def _seniority(self, title: str) -> Optional[str]:
        text = (title or "").lower()
        if any(term in text for term in ("intern", "junior", "entry")):
            return "entry"
        if any(term in text for term in ("senior", "staff", "principal", "lead")):
            return "senior"
        if any(term in text for term in ("director", "vp ", "vice president", "head of")):
            return "lead"
        return None

    def _posted_at(self, row: Dict[str, Any]) -> Optional[str]:
        created_at = row.get("createdAt")
        if not created_at:
            return None
        try:
            return datetime.fromtimestamp(int(created_at) / 1000, timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            return None

    def sanitize_text(self, value: Any) -> str:
        if value is None:
            return ""
        text = html.unescape(str(value))
        if re.search(r"</?[a-z][\s\S]*?>", text, flags=re.IGNORECASE):
            text = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
        text = re.sub(r"</?[a-z][\s\S]*?>", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"\s+", " ", text)
        return text.strip()
