"""Direct SmartRecruiters public posting ingestion."""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from .base import AtsJobAdapter


class SmartRecruitersAtsAdapter(AtsJobAdapter):
    provider = "smartrecruiters"
    hosts = {"jobs.smartrecruiters.com", "careers.smartrecruiters.com"}

    def __init__(self, base_url: Optional[str] = None, timeout: Optional[float] = None):
        self.base_url = (
            base_url or os.environ.get("SMARTRECRUITERS_API_BASE_URL") or "https://api.smartrecruiters.com/v1"
        ).rstrip("/")
        if timeout is None:
            try:
                timeout = float(os.environ.get("SMARTRECRUITERS_HTTP_TIMEOUT_SECONDS", "12"))
            except (TypeError, ValueError):
                timeout = 12.0
        self.timeout = max(1.0, min(float(timeout), 30.0))

    def can_handle_url(self, url: str) -> bool:
        return self.extract_source_key_from_url(url) is not None

    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        parsed = urlparse((url or "").strip())
        host = (parsed.netloc or "").lower().removeprefix("www.")
        if host not in self.hosts:
            return None
        parts = [part for part in (parsed.path or "").split("/") if part]
        if not parts:
            return None
        return parts[0].strip() or None

    @staticmethod
    def extract_posting_id_from_url(url: str) -> Optional[str]:
        parsed = urlparse((url or "").strip())
        parts = [part for part in (parsed.path or "").split("/") if part]
        if len(parts) < 2:
            return None
        slug = parts[1]
        match = re.match(r"^(\d+)", slug)
        return match.group(1) if match else slug

    async def fetch_postings(
        self,
        source_key: str,
        *,
        limit: int = 20,
        q: Optional[str] = None,
        city: Optional[str] = None,
        country: Optional[str] = None,
        language: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"limit": max(1, min(int(limit or 20), 100))}
        if q:
            params["q"] = q.strip()
        if city:
            params["city"] = city.strip()
        if country:
            params["country"] = country.strip().lower()
        if language:
            params["language"] = language.strip().lower()

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/companies/{source_key}/postings",
                params=params,
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()

        rows = payload.get("content") if isinstance(payload, dict) else []
        return rows if isinstance(rows, list) else []

    async def fetch_posting_detail(self, source_key: str, posting_id: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/companies/{source_key}/postings/{posting_id}",
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
        return payload if isinstance(payload, dict) else {}

    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        return await self.fetch_postings(source_key, limit=limit or 100)

    def normalize_job(
        self,
        raw_job: Dict[str, Any],
        *,
        source_key: str,
        detail: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        posting_id = str(raw_job.get("id") or "").strip()
        title = raw_job.get("name") or raw_job.get("title")
        if not posting_id or not title:
            return None

        detail = detail or {}
        company_info = raw_job.get("company") if isinstance(raw_job.get("company"), dict) else {}
        company_name = (
            self.clean_text(company_info.get("name"))
            or self.clean_text(detail.get("company", {}).get("name") if isinstance(detail.get("company"), dict) else None)
            or source_key
        )
        location_data = raw_job.get("location") if isinstance(raw_job.get("location"), dict) else {}
        if not location_data and isinstance(detail.get("location"), dict):
            location_data = detail.get("location")
        location = self._location_label(location_data)
        country_code = str(location_data.get("country") or location_data.get("countryCode") or "").lower().strip() or None

        posting_url = (
            detail.get("postingUrl")
            or raw_job.get("postingUrl")
            or f"https://jobs.smartrecruiters.com/{source_key}/{posting_id}"
        )
        apply_url = detail.get("applyUrl") or posting_url
        sections = self._description_sections(detail.get("jobAd") or raw_job.get("jobAd"))
        description = self._description_from_sections(sections)
        requirements = self._requirements_from_sections(sections)
        employment = raw_job.get("typeOfEmployment") if isinstance(raw_job.get("typeOfEmployment"), dict) else {}
        job_type = self.clean_text(employment.get("label")) or None
        imported_at = self.imported_at()
        external_id = f"{source_key}:{posting_id}"

        return {
            "job_id": self.internal_job_id(external_id),
            "provider": self.provider,
            "external_id": external_id,
            "provider_job_id": posting_id,
            "title": self.clean_text(title),
            "company": company_name,
            "location": location,
            "city": self.clean_text(location_data.get("city")) or None,
            "region": self.clean_text(location_data.get("region")) or None,
            "country_code": country_code,
            "remote": self.remote_value(description, location),
            "salary_min": None,
            "salary_max": None,
            "currency": "EUR" if country_code in {"fr", "be", "ch"} else "USD",
            "description": description,
            "clean_description": description,
            "job_description_sections": sections,
            "requirements": requirements,
            "tech_stack": [],
            "job_type": job_type,
            "posted_at": raw_job.get("releasedDate") or detail.get("releasedDate") or imported_at,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "external_url": posting_url,
            "selected_apply_url": apply_url,
            "apply_url_provider": self.provider,
            "apply_url_source": "SmartRecruiters",
            "source": "SmartRecruiters",
            "ats_provider": self.provider,
            "auto_apply_supported": True,
            "publication_uuid": detail.get("uuid") or raw_job.get("uuid"),
            "manual_fulfillment_ready": True,
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct public SmartRecruiters apply URL.",
            "job_board_account_required": False,
            "board_token": source_key,
            "provider_query": source_key,
            "provider_search_key": f"{self.provider}:{source_key}",
            "raw_provider_payload": raw_job if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def _location_label(self, location: Dict[str, Any]) -> str:
        if not location:
            return "Remote"
        full = self.clean_text(location.get("fullLocation"))
        if full:
            return full
        parts = [
            self.clean_text(location.get("city")),
            self.clean_text(location.get("region")),
            self.clean_text(location.get("country")),
        ]
        joined = ", ".join(part for part in parts if part)
        return joined or "Remote"

    def _description_sections(self, job_ad: Any) -> List[Dict[str, Any]]:
        if not isinstance(job_ad, dict):
            return []
        sections_root = job_ad.get("sections")
        if not isinstance(sections_root, dict):
            return []

        mapping = {
            "jobDescription": "About This Role",
            "qualifications": "Required Qualifications",
            "additionalInformation": "Additional Information",
            "companyDescription": "Company Description",
        }
        sections: List[Dict[str, Any]] = []
        for key, default_title in mapping.items():
            block = sections_root.get(key)
            if not isinstance(block, dict):
                continue
            text = self.clean_text(block.get("text"))
            if not text:
                continue
            title = self.clean_text(block.get("title")) or default_title
            bullets = self._bullets_from_text(text)
            if bullets:
                sections.append({"title": title, "bullets": bullets})
            else:
                sections.append({"title": title, "bullets": [text]})
        return sections

    def _bullets_from_text(self, text: str) -> List[str]:
        lines = [self.clean_text(line) for line in re.split(r"[\n\r]+", text or "")]
        bullets = [line.lstrip("•-* ").strip() for line in lines if line and len(line) > 2]
        if len(bullets) <= 1 and text:
            parts = re.split(r"(?<=[.!?])\s+", text)
            bullets = [self.clean_text(part) for part in parts if self.clean_text(part)]
        return [bullet for bullet in bullets if bullet]

    def _description_from_sections(self, sections: List[Dict[str, Any]]) -> str:
        for section in sections:
            if re.search(r"about|job description|description du poste|à propos", section.get("title") or "", re.I):
                bullets = section.get("bullets") or []
                return "\n\n".join(bullets)
        if sections:
            bullets = sections[0].get("bullets") or []
            return "\n\n".join(bullets)
        return ""

    def _requirements_from_sections(self, sections: List[Dict[str, Any]]) -> List[str]:
        requirements: List[str] = []
        for section in sections:
            title = section.get("title") or ""
            if re.search(r"qualification|requirement|profil|requis", title, re.I):
                requirements.extend(section.get("bullets") or [])
        return requirements
