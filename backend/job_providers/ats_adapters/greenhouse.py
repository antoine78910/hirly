"""Direct Greenhouse public board ingestion."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import httpx

from .base import AtsJobAdapter


class GreenhouseAtsAdapter(AtsJobAdapter):
    provider = "greenhouse"
    hosts = {"boards.greenhouse.io", "job-boards.greenhouse.io"}

    def __init__(self, base_url: Optional[str] = None, timeout: float = 15.0):
        self.base_url = (base_url or os.environ.get("GREENHOUSE_BASE_URL") or "https://boards-api.greenhouse.io/v1/boards").rstrip("/")
        self.timeout = timeout

    def can_handle_url(self, url: str) -> bool:
        return self.extract_source_key_from_url(url) is not None

    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        return self.source_key_from_path(url, self.hosts)

    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(f"{self.base_url}/{source_key}/jobs", params={"content": "true"})
            response.raise_for_status()
            payload = response.json()
        rows = payload.get("jobs") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return []
        return rows[:limit] if limit else rows

    def normalize_job(self, raw_job: Dict[str, Any], *, source_key: str) -> Optional[Dict[str, Any]]:
        raw_id = raw_job.get("id")
        title = raw_job.get("title")
        if not raw_id or not title:
            return None
        imported_at = self.imported_at()
        external_id = f"{source_key}:{raw_id}"
        external_url = raw_job.get("absolute_url") or f"https://boards.greenhouse.io/{source_key}/jobs/{raw_id}"
        description = self.clean_text(raw_job.get("content") or raw_job.get("description"))
        location = self._location(raw_job)
        company = raw_job.get("company_name") or raw_job.get("company") or source_key
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
            "posted_at": raw_job.get("updated_at") or imported_at,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "external_url": external_url,
            "selected_apply_url": external_url,
            "apply_url_provider": self.provider,
            "apply_url_source": "Greenhouse",
            "source": "Greenhouse",
            "ats_provider": self.provider,
            "auto_apply_supported": True,
            "manual_fulfillment_ready": True,
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct public Greenhouse apply URL.",
            "job_board_account_required": False,
            "board_token": source_key,
            "provider_query": source_key,
            "provider_search_key": f"{self.provider}:{source_key}",
            "raw_provider_payload": raw_job if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def _location(self, raw_job: Dict[str, Any]) -> str:
        location = raw_job.get("location")
        if isinstance(location, dict):
            return self.clean_text(location.get("name")) or "Remote"
        return self.clean_text(location) or "Remote"
