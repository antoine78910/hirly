"""Direct Ashby public job board ingestion."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

from .base import AtsJobAdapter


class AshbyAtsAdapter(AtsJobAdapter):
    provider = "ashby"
    hosts = {"jobs.ashbyhq.com"}

    def __init__(self, base_url: Optional[str] = None, timeout: float = 15.0):
        self.base_url = (base_url or os.environ.get("ASHBY_PUBLIC_BASE_URL") or "https://jobs.ashbyhq.com/api/posting-api/job-board").rstrip("/")
        self.timeout = timeout

    def can_handle_url(self, url: str) -> bool:
        return self.extract_source_key_from_url(url) is not None

    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        return self.source_key_from_path(url, self.hosts)

    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(f"{self.base_url}/{source_key}")
            response.raise_for_status()
            payload = response.json()
        rows = self._job_rows(payload)
        return self.bounded_batch(rows, limit=limit)

    def normalize_job(self, raw_job: Dict[str, Any], *, source_key: str) -> Optional[Dict[str, Any]]:
        raw_id = raw_job.get("id") or raw_job.get("jobId")
        title = raw_job.get("title")
        if not raw_id or not title:
            return None
        imported_at = self.imported_at()
        external_id = f"{source_key}:{raw_id}"
        external_url = raw_job.get("jobUrl") or raw_job.get("url") or f"https://jobs.ashbyhq.com/{source_key}/{raw_id}"
        description = self.clean_text(
            raw_job.get("descriptionPlain")
            or raw_job.get("description")
            or raw_job.get("descriptionHtml")
            or raw_job.get("content")
        )
        location = self._location(raw_job)
        company = raw_job.get("companyName") or raw_job.get("organizationName") or source_key
        return {
            "job_id": self.internal_job_id(external_id),
            "provider": self.provider,
            "external_id": str(external_id),
            "provider_job_id": str(raw_id),
            "title": self.clean_text(title),
            "company": self.clean_text(company),
            "location": location,
            "remote": self.remote_value(description, location),
            "salary_min": None,
            "salary_max": None,
            "currency": "USD",
            "description": description,
            "clean_description": description,
            "requirements": [],
            "tech_stack": [],
            "posted_at": raw_job.get("publishedAt") or raw_job.get("postedAt") or raw_job.get("createdAt") or imported_at,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "external_url": external_url,
            "selected_apply_url": external_url,
            "apply_url_provider": self.provider,
            "apply_url_source": "Ashby",
            "source": "Ashby",
            "ats_provider": self.provider,
            "auto_apply_supported": True,
            "manual_fulfillment_ready": True,
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct public Ashby apply URL.",
            "job_board_account_required": False,
            "board_token": source_key,
            "provider_query": source_key,
            "provider_search_key": f"{self.provider}:{source_key}",
            "department": raw_job.get("departmentName") or raw_job.get("teamName"),
            "employment_type": raw_job.get("employmentType"),
            "raw_provider_payload": raw_job if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def _job_rows(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
        if not isinstance(payload, dict):
            return []
        for key in ("jobs", "jobPostings", "postings"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
        return []

    def _location(self, raw_job: Dict[str, Any]) -> str:
        for key in ("locationName", "location", "office"):
            value = raw_job.get(key)
            if isinstance(value, dict):
                text = value.get("name") or value.get("label")
            else:
                text = value
            cleaned = self.clean_text(text)
            if cleaned:
                return cleaned
        return "Remote"
