"""Direct Recruitee public offers ingestion.

Unlike Lever/Greenhouse/Ashby, Recruitee doesn't put the company slug in the
path -- it's the subdomain (https://{company}.recruitee.com/api/offers/,
confirmed live, no auth needed for published offers), so this adapter's
source_key extraction/URL building differs from the base helper the other
adapters share.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

from .base import AtsJobAdapter


class RecruiteeAtsAdapter(AtsJobAdapter):
    provider = "recruitee"
    host_suffix = ".recruitee.com"

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout

    def can_handle_url(self, url: str) -> bool:
        return self.extract_source_key_from_url(url) is not None

    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        parsed = urlparse((url or "").strip())
        host = (parsed.netloc or "").lower().removeprefix("www.")
        if not host.endswith(self.host_suffix) or host == f"careers{self.host_suffix}":
            return None
        subdomain = host[: -len(self.host_suffix)]
        return subdomain.strip().lower() or None

    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        url = f"https://{source_key}.recruitee.com/api/offers/"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, params={"format": "json"})
            response.raise_for_status()
            payload = response.json()
        offers = payload.get("offers") if isinstance(payload, dict) else None
        rows = [row for row in offers if isinstance(row, dict)] if isinstance(offers, list) else []
        return rows[:limit] if limit else rows

    def normalize_job(self, raw_job: Dict[str, Any], *, source_key: str) -> Optional[Dict[str, Any]]:
        raw_id = raw_job.get("id")
        title = raw_job.get("title")
        if not raw_id or not title or raw_job.get("status") != "published":
            return None
        imported_at = self.imported_at()
        external_id = f"{source_key}:{raw_id}"
        external_url = raw_job.get("careers_url") or raw_job.get("careers_apply_url") or f"https://{source_key}.recruitee.com/o/{raw_job.get('slug', raw_id)}"
        description = self.clean_text(raw_job.get("description"))
        location = self.clean_text(raw_job.get("location")) or self.clean_text(raw_job.get("city")) or "France"
        company = raw_job.get("company_name") or source_key
        country_code = str(raw_job.get("country_code") or "").strip().upper() or None
        return {
            "job_id": self.internal_job_id(external_id),
            "provider": self.provider,
            "external_id": str(external_id),
            "provider_job_id": str(raw_id),
            "title": self.clean_text(title),
            "company": self.clean_text(company),
            "location": location,
            "country_code": country_code,
            "remote": self.remote_value(description, location) if not raw_job.get("remote") else "remote",
            "salary_min": None,
            "salary_max": None,
            "currency": "EUR",
            "description": description,
            "clean_description": description,
            "requirements": [],
            "tech_stack": [],
            "posted_at": raw_job.get("published_at") or raw_job.get("created_at") or imported_at,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "external_url": external_url,
            "selected_apply_url": external_url,
            "apply_url_provider": self.provider,
            "apply_url_source": "Recruitee",
            "source": "Recruitee",
            "ats_provider": self.provider,
            "auto_apply_supported": True,
            "manual_fulfillment_ready": True,
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct public Recruitee apply URL.",
            "job_board_account_required": False,
            "board_token": source_key,
            "provider_query": source_key,
            "provider_search_key": f"{self.provider}:{source_key}",
            "department": raw_job.get("department"),
            "employment_type": raw_job.get("employment_type_code"),
            "raw_provider_payload": raw_job if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }
