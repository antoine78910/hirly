"""JSearch job provider integration."""

import hashlib
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .base import JobSearchQuery, ProviderResult
from .apply_eligibility import classify_apply_link
from .ats_detection import PRIMARY_AUTO_APPLY_ATS, detect_job_platform


class JSearchProvider:
    name = "jsearch"

    def __init__(self, api_key: str, base_url: Optional[str] = None, timeout: float = 15.0):
        self.api_key = api_key
        self.base_url = (base_url or os.environ.get("JSEARCH_BASE_URL") or "https://api.openwebninja.com/jsearch").rstrip("/")
        self.timeout = timeout

    async def search(self, query: JobSearchQuery) -> ProviderResult:
        base_params: Dict[str, Any] = {
            "query": self._query_string(query),
            "language": query.language,
        }
        if query.country:
            base_params["country"] = query.country
        if query.remote_preference == "remote":
            base_params["work_from_home"] = "true"
        date_posted = os.environ.get("JSEARCH_DATE_POSTED")
        if date_posted:
            base_params["date_posted"] = date_posted

        max_pages = max(1, min(int(query.max_pages or self._env_int("JSEARCH_MAX_PAGES", 3)), 10))
        page_size = max(1, min(int(query.page_size or self._env_int("JSEARCH_PAGE_SIZE", query.limit)), 100))
        target_count = max(query.limit, min(page_size * max_pages, 300))

        payloads: List[Any] = []
        rows: List[Dict[str, Any]] = []
        seen_ids = set()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for page in range(1, max_pages + 1):
                params = dict(base_params)
                params["num_pages"] = max_pages if page == 1 else 1
                if page_size:
                    params["page_size"] = page_size
                if page > 1:
                    params["page"] = page
                response = await client.get(
                    f"{self.base_url}/search-v2",
                    params=params,
                    headers={"x-api-key": self.api_key},
                )
                response.raise_for_status()
                payload = response.json()
                payloads.append(payload)
                page_rows = self._extract_jobs(payload)
                new_rows = 0
                for row in page_rows:
                    external_id = row.get("job_id") or row.get("id") or row.get("job_google_link") or row.get("job_apply_link")
                    dedupe_key = str(external_id or hashlib.sha1(repr(sorted(row.items())).encode("utf-8")).hexdigest())
                    if dedupe_key in seen_ids:
                        continue
                    seen_ids.add(dedupe_key)
                    rows.append(row)
                    new_rows += 1
                if not page_rows or new_rows == 0 or len(rows) >= target_count:
                    break

        imported_at = datetime.now(timezone.utc).isoformat()
        jobs = [self.normalize_job(row, query, imported_at) for row in rows[:target_count]]
        jobs = [job for job in jobs if job is not None]
        return ProviderResult(raw_response={"pages": payloads, "rows_seen": len(rows)}, jobs=jobs[:target_count])

    def _env_int(self, name: str, default: int) -> int:
        try:
            return int(os.environ.get(name, default))
        except (TypeError, ValueError):
            return default

    def _extract_jobs(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]

        if not isinstance(payload, dict):
            raise ValueError(f"Unexpected JSearch response shape: top-level type={type(payload).__name__}")

        candidate_keys = ("jobs", "data", "results", "items")
        for key in candidate_keys:
            value = payload.get(key)
            if isinstance(value, list):
                return [row for row in value if isinstance(row, dict)]
            if isinstance(value, dict):
                for nested_key in candidate_keys:
                    nested_value = value.get(nested_key)
                    if isinstance(nested_value, list):
                        return [row for row in nested_value if isinstance(row, dict)]

        top_keys = sorted(payload.keys())
        typed_keys = {key: type(payload.get(key)).__name__ for key in top_keys}
        raise ValueError(f"Unexpected JSearch response shape: keys={top_keys}, types={typed_keys}")

    def _query_string(self, query: JobSearchQuery) -> str:
        if query.raw_query:
            return " ".join((query.role or "").split()) or "software engineer"
        parts = [query.role.strip() or "software engineer", "jobs"]
        location = (query.location or "").strip()
        if query.remote_preference == "remote":
            parts.append("remote")
            if location:
                parts.extend(["in", location])
        elif location:
            parts.extend(["in", location])
        return " ".join(parts)

    def normalize_job(
        self,
        row: Dict[str, Any],
        query: JobSearchQuery,
        imported_at: str,
    ) -> Optional[Dict[str, Any]]:
        external_id = row.get("job_id")
        title = row.get("job_title")
        company = row.get("employer_name")
        if not external_id or not title or not company:
            return None

        apply_options = row.get("apply_options") or []
        first_apply = apply_options[0] if apply_options else {}
        external_url = row.get("job_apply_link") or first_apply.get("apply_link") or row.get("job_google_link")
        source = row.get("job_publisher") or first_apply.get("publisher") or "JSearch"
        apply_classification = classify_apply_link(external_url, source=source, apply_options=apply_options)
        selected_apply_url = apply_classification.get("selected_apply_url") or external_url
        platform = detect_job_platform(selected_apply_url)
        ats_provider = platform.get("ats_provider") or "unknown"
        if ats_provider == "unknown" and apply_classification.get("apply_url_provider") not in {"company", "unknown"}:
            ats_provider = str(apply_classification.get("apply_url_provider") or "unknown")
        auto_apply_supported = ats_provider in PRIMARY_AUTO_APPLY_ATS

        return {
            "job_id": self._internal_job_id(external_id),
            "title": title,
            "company": company,
            "company_logo": row.get("employer_logo"),
            "location": self._location(row),
            "country_code": self._country_code(row, query),
            "remote": self._remote(row, query),
            "salary_min": self._salary(row.get("job_min_salary")),
            "salary_max": self._salary(row.get("job_max_salary")),
            "currency": row.get("job_salary_currency") or "USD",
            "description": row.get("job_description") or "",
            "requirements": self._requirements(row),
            "tech_stack": [],
            "seniority": self._seniority(title),
            "posted_at": self._posted_at(row) or imported_at,
            "provider": self.name,
            "external_id": external_id,
            "external_url": selected_apply_url,
            "source": source,
            "ats_provider": ats_provider,
            "auto_apply_supported": auto_apply_supported,
            "auto_apply_reason": (
                f"{ats_provider} supported for V1 auto-apply"
                if auto_apply_supported
                else "Unsupported or unknown ATS provider for V1 auto-apply"
            ),
            "apply_options": apply_options,
            **apply_classification,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "provider_query": self._query_string(query),
            "provider_search_key": self.search_key(query),
            "raw_provider_payload": row if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def search_key(self, query: JobSearchQuery) -> str:
        remote_preference = "remote" if (query.remote_preference or "").strip().lower() == "remote" else "any"
        bits = [
            self.name,
            (query.role or "").strip().lower(),
            (query.location or "").strip().lower(),
            remote_preference,
            (query.country or "").lower(),
            query.language.lower(),
        ]
        return ":".join(bits)

    def _internal_job_id(self, external_id: str) -> str:
        digest = hashlib.sha1(f"{self.name}:{external_id}".encode("utf-8")).hexdigest()[:16]
        return f"job_{digest}"

    def _location(self, row: Dict[str, Any]) -> str:
        if row.get("job_location"):
            return row["job_location"]
        parts = [row.get("job_city"), row.get("job_state"), row.get("job_country")]
        return ", ".join([p for p in parts if p]) or "Unknown"

    def _country_code(self, row: Dict[str, Any], query: JobSearchQuery) -> Optional[str]:
        raw = str(
            row.get("job_country_code")
            or row.get("job_country")
            or query.country
            or ""
        ).strip().lower()
        if not raw:
            return None
        if len(raw) == 2:
            return raw
        aliases = {
            "france": "fr",
            "united kingdom": "gb",
            "uk": "gb",
            "great britain": "gb",
            "england": "gb",
            "united states": "us",
            "usa": "us",
            "morocco": "ma",
            "maroc": "ma",
        }
        return aliases.get(raw)

    def _remote(self, row: Dict[str, Any], query: JobSearchQuery) -> str:
        if row.get("job_is_remote") is True or row.get("job_work_from_home") is True:
            return "remote"
        if query.remote_preference == "remote":
            return "remote"
        text = " ".join([str(row.get("job_title") or ""), str(row.get("job_description") or ""), str(row.get("job_location") or "")]).lower()
        if "hybrid" in text:
            return "hybrid"
        if "remote" in text or "work from home" in text:
            return "remote"
        return "onsite"

    def _salary(self, value: Any) -> Optional[int]:
        try:
            if value is None:
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    def _requirements(self, row: Dict[str, Any]) -> List[str]:
        highlights = row.get("job_highlights") or {}
        qualifications = highlights.get("Qualifications") or highlights.get("qualifications") or []
        if isinstance(qualifications, list):
            return [str(item) for item in qualifications[:8]]
        return []

    def _seniority(self, title: str) -> Optional[str]:
        text = (title or "").lower()
        if any(token in text for token in ("principal",)):
            return "principal"
        if any(token in text for token in ("staff", "lead", "head of")):
            return "lead"
        if any(token in text for token in ("senior", "sr.")):
            return "senior"
        if any(token in text for token in ("junior", "jr.", "entry", "graduate", "intern")):
            return "junior"
        return "mid"

    def _posted_at(self, row: Dict[str, Any]) -> Optional[str]:
        if row.get("job_posted_at_datetime_utc"):
            return row["job_posted_at_datetime_utc"]
        ts = row.get("job_posted_at_timestamp")
        try:
            if ts:
                return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
        except (TypeError, ValueError, OSError):
            return None
        return None
