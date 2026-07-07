"""Direct Personio public XML job feed ingestion.

Every Personio career page (``https://<company>.jobs.personio.com`` or the
legacy ``.de`` domain) exposes an unauthenticated XML feed of all published
jobs at ``/xml`` -- documented by Personio for embedding jobs on a company's
own website, and confirmed reachable without any credentials. This lets us
pull a company's *entire* open-roles list in one request instead of relying
on JSearch to happen to surface each posting individually.
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from xml.etree import ElementTree as ET

import httpx

from .base import AtsJobAdapter

_HOST_RE = re.compile(r"^([a-z0-9-]+)\.jobs\.personio\.(com|de)$")


class PersonioAtsAdapter(AtsJobAdapter):
    provider = "personio"

    def __init__(self, timeout: Optional[float] = None):
        if timeout is None:
            try:
                timeout = float(os.environ.get("PERSONIO_HTTP_TIMEOUT_SECONDS", "15"))
            except (TypeError, ValueError):
                timeout = 15.0
        self.timeout = max(1.0, min(float(timeout), 30.0))

    def can_handle_url(self, url: str) -> bool:
        return self.extract_source_key_from_url(url) is not None

    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        parsed = urlparse((url or "").strip())
        host = (parsed.netloc or "").lower().removeprefix("www.")
        match = _HOST_RE.match(host)
        return match.group(1) if match else None

    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
            for tld in ("com", "de"):
                url = f"https://{source_key}.jobs.personio.{tld}/xml"
                try:
                    response = await client.get(url, params={"language": "en"})
                    response.raise_for_status()
                except httpx.HTTPError:
                    continue
                rows = self.parse_positions(response.text, tld=tld)
                if rows:
                    break
        return rows[:limit] if limit else rows

    def parse_positions(self, xml_text: str, *, tld: str = "com") -> List[Dict[str, Any]]:
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError:
            return []
        positions: List[Dict[str, Any]] = []
        for node in root.findall(".//position"):
            row: Dict[str, Any] = {
                child.tag: (child.text or "").strip()
                for child in node
                if child.tag != "jobDescriptions"
            }
            sections: List[Dict[str, str]] = []
            descriptions_node = node.find("jobDescriptions")
            if descriptions_node is not None:
                for desc in descriptions_node.findall("jobDescription"):
                    name_node = desc.find("name")
                    value_node = desc.find("value")
                    text = (value_node.text or "").strip() if value_node is not None else ""
                    if not text:
                        continue
                    sections.append({
                        "title": (name_node.text or "").strip() if name_node is not None else "",
                        "text": text,
                    })
            row["_sections"] = sections
            row["_tld"] = tld
            positions.append(row)
        return positions

    def normalize_job(self, raw_job: Dict[str, Any], *, source_key: str) -> Optional[Dict[str, Any]]:
        posting_id = str(raw_job.get("id") or "").strip()
        title = raw_job.get("name")
        if not posting_id or not title:
            return None

        tld = raw_job.get("_tld") or "com"
        sections = raw_job.get("_sections") or []
        description = "\n\n".join(
            f"{section['title']}\n{self.clean_text(section['text'])}" if section.get("title") else self.clean_text(section["text"])
            for section in sections
            if section.get("text")
        )
        location = self.clean_text(raw_job.get("office")) or "Remote"
        imported_at = self.imported_at()
        external_id = f"{source_key}:{posting_id}"
        job_url = f"https://{source_key}.jobs.personio.{tld}/job/{posting_id}"
        job_type = self.clean_text(raw_job.get("schedule")) or None
        department = self.clean_text(raw_job.get("department")) or None

        return {
            "job_id": self.internal_job_id(external_id),
            "provider": self.provider,
            "external_id": external_id,
            "provider_job_id": posting_id,
            "title": self.clean_text(title),
            "company": self.clean_text(raw_job.get("subcompany")) or source_key,
            "location": location,
            "department": department,
            "remote": self.remote_value(description, location),
            "salary_min": None,
            "salary_max": None,
            "currency": "EUR",
            "description": description,
            "clean_description": description,
            "requirements": [],
            "tech_stack": [],
            "job_type": job_type,
            "posted_at": raw_job.get("createdAt") or imported_at,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "external_url": job_url,
            "selected_apply_url": job_url,
            "apply_url_provider": self.provider,
            "apply_url_source": "Personio",
            "source": "Personio",
            "ats_provider": self.provider,
            "auto_apply_supported": True,
            "manual_fulfillment_ready": True,
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct public Personio apply URL.",
            "job_board_account_required": False,
            "board_token": source_key,
            "provider_query": source_key,
            "provider_search_key": f"{self.provider}:{source_key}",
            "raw_provider_payload": raw_job if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }
