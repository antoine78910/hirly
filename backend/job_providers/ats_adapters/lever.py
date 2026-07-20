"""Direct Lever public postings ingestion."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .base import AtsJobAdapter


class LeverAtsAdapter(AtsJobAdapter):
    provider = "lever"
    hosts = {"jobs.lever.co"}

    def __init__(
        self,
        base_url: Optional[str] = None,
        eu_base_url: Optional[str] = None,
        timeout: float = 15.0,
    ):
        self.base_url = (base_url or os.environ.get("LEVER_BASE_URL") or "https://api.lever.co/v0/postings").rstrip("/")
        self.eu_base_url = (eu_base_url or os.environ.get("LEVER_EU_BASE_URL") or "https://api.eu.lever.co/v0/postings").rstrip("/")
        self.timeout = timeout

    def can_handle_url(self, url: str) -> bool:
        return self.extract_source_key_from_url(url) is not None

    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        return self.source_key_from_path(url, self.hosts)

    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        last_error: Optional[Exception] = None
        for base_url in (self.base_url, self.eu_base_url):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.get(f"{base_url}/{source_key}", params={"mode": "json"})
                    response.raise_for_status()
                    payload = response.json()
                if isinstance(payload, list):
                    return self.bounded_batch(payload, limit=limit)
            except Exception as exc:
                last_error = exc
        if last_error:
            raise last_error
        return []

    def normalize_job(self, raw_job: Dict[str, Any], *, source_key: str) -> Optional[Dict[str, Any]]:
        raw_id = raw_job.get("id")
        title = raw_job.get("text")
        if not raw_id or not title:
            return None
        imported_at = self.imported_at()
        external_id = f"{source_key}:{raw_id}"
        external_url = raw_job.get("hostedUrl") or raw_job.get("applyUrl") or f"https://jobs.lever.co/{source_key}/{raw_id}"
        description = self._description(raw_job)
        categories = raw_job.get("categories") if isinstance(raw_job.get("categories"), dict) else {}
        location = self._location(raw_job, categories)
        company = raw_job.get("company") or source_key
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
            "posted_at": self._posted_at(raw_job) or imported_at,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "external_url": external_url,
            "apply_url": raw_job.get("applyUrl"),
            "hosted_url": raw_job.get("hostedUrl"),
            "selected_apply_url": external_url,
            "apply_url_provider": self.provider,
            "apply_url_source": "Lever",
            "source": "Lever",
            "ats_provider": self.provider,
            "auto_apply_supported": True,
            "manual_fulfillment_ready": True,
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct public Lever apply URL.",
            "job_board_account_required": False,
            "board_token": source_key,
            "provider_query": source_key,
            "provider_search_key": f"{self.provider}:{source_key}",
            "department": categories.get("department"),
            "team": categories.get("team"),
            "commitment": categories.get("commitment"),
            "workplace_type": categories.get("workplaceType"),
            "raw_provider_payload": raw_job if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def _description(self, raw_job: Dict[str, Any]) -> str:
        parts: List[str] = []
        for key in ("descriptionPlain", "description", "additionalPlain", "additional"):
            value = self.clean_text(raw_job.get(key))
            if value:
                parts.append(value)
        lists = raw_job.get("lists")
        if isinstance(lists, list):
            for item in lists:
                if not isinstance(item, dict):
                    continue
                for key in ("text", "content"):
                    value = self.clean_text(item.get(key))
                    if value:
                        parts.append(value)
        return "\n\n".join(parts).strip()

    def _location(self, raw_job: Dict[str, Any], categories: Dict[str, Any]) -> str:
        country = categories.get("location") or categories.get("allLocations")
        if isinstance(country, list):
            return ", ".join(self.clean_text(item) for item in country if item) or "Remote"
        return self.clean_text(country) or "Remote"

    def _posted_at(self, raw_job: Dict[str, Any]) -> Optional[str]:
        value = raw_job.get("createdAt")
        if not value:
            return None
        try:
            return datetime.fromtimestamp(int(value) / 1000, timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            return None
