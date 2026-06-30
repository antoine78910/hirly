"""Shared interface for direct public ATS ingestion adapters."""

from __future__ import annotations

import hashlib
import html
import re
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


class AtsJobAdapter(ABC):
    provider: str

    @abstractmethod
    def can_handle_url(self, url: str) -> bool:
        raise NotImplementedError

    @abstractmethod
    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def normalize_job(self, raw_job: Dict[str, Any], *, source_key: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

    def internal_job_id(self, external_id: str) -> str:
        digest = hashlib.sha1(f"{self.provider}:{external_id}".encode("utf-8")).hexdigest()[:16]
        return f"job_{digest}"

    def imported_at(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def clean_text(self, value: Any) -> str:
        text = html.unescape(str(value or ""))
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
        text = re.sub(r"</p\s*>", "\n\n", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def remote_value(self, text: str, location: str = "") -> str:
        value = f"{text or ''} {location or ''}".lower()
        if "remote" in value or "work from home" in value:
            return "remote"
        if "hybrid" in value:
            return "hybrid"
        return "onsite"

    def source_key_from_path(self, url: str, allowed_hosts: set[str]) -> Optional[str]:
        parsed = urlparse((url or "").strip())
        host = (parsed.netloc or "").lower().removeprefix("www.")
        if host not in allowed_hosts:
            return None
        parts = [part for part in (parsed.path or "").split("/") if part]
        if not parts:
            return None
        return parts[0].strip().lower() or None
