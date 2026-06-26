"""Greenhouse public job board provider."""

import hashlib
import html
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx

from .base import BoardQuery, ProviderResult

logger = logging.getLogger(__name__)


class GreenhouseProvider:
    name = "greenhouse"

    def __init__(self, base_url: Optional[str] = None, timeout: float = 15.0):
        self.base_url = (base_url or os.environ.get("GREENHOUSE_BASE_URL") or "https://boards-api.greenhouse.io/v1/boards").rstrip("/")
        self.timeout = timeout

    def board_api_url(self, board_token: str) -> str:
        return f"{self.base_url}/{board_token}/jobs?content=true"

    async def inspect_board(self, board_token: str) -> Dict[str, Any]:
        url = f"{self.base_url}/{board_token}/jobs"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, params={"content": "true"})

        payload = None
        jobs_count = 0
        first_job_title = None
        error_snippet = None
        if response.status_code == 200:
            payload = response.json()
            rows = payload.get("jobs") if isinstance(payload, dict) else []
            if isinstance(rows, list):
                jobs_count = len(rows)
                if rows and isinstance(rows[0], dict):
                    first_job_title = rows[0].get("title")
        else:
            error_snippet = response.text[:500]

        return {
            "board_token": board_token,
            "api_url": self.board_api_url(board_token),
            "status_code": response.status_code,
            "jobs_count": jobs_count,
            "first_job_title": first_job_title,
            "error_snippet": error_snippet,
            "payload": payload,
        }

    async def search_board(self, query: BoardQuery) -> ProviderResult:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/{query.board_token}/jobs",
                params={"content": "true"},
            )
            response.raise_for_status()
            payload = response.json()

        rows = payload.get("jobs") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            rows = []
        imported_at = datetime.now(timezone.utc).isoformat()
        jobs = [self.normalize_job(row, query, imported_at) for row in rows[: query.limit]]
        jobs = [job for job in jobs if job is not None]
        return ProviderResult(jobs=jobs, raw_response=payload)

    async def inspect_application_form(self, board_token: str, greenhouse_job_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/{board_token}/jobs/{greenhouse_job_id}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, params={"questions": "true"})
            response.raise_for_status()
            payload = response.json()

        fields = self._application_fields(payload)
        blockers = self._application_blockers(fields)
        return {
            "application_url": payload.get("absolute_url") or f"https://boards.greenhouse.io/{board_token}/jobs/{greenhouse_job_id}",
            "fields": fields,
            "supports_auto_submit": len(blockers) == 0,
            "blockers": blockers,
            "raw_response": payload,
        }

    def normalize_job(self, row: Dict[str, Any], query: BoardQuery, imported_at: str) -> Optional[Dict[str, Any]]:
        raw_external_id = row.get("id")
        title = row.get("title")
        if not raw_external_id or not title:
            return None

        external_id = f"{query.board_token}:{raw_external_id}"
        external_url = row.get("absolute_url") or f"https://boards.greenhouse.io/{query.board_token}/jobs/{raw_external_id}"
        content_html = row.get("content") or ""
        description = self._plain_text(content_html)
        sections = self._description_sections(content_html, description)
        sections = self._sanitize_sections(sections)
        location = self._location(row)
        if self._contains_html(description) or self._sections_contain_html(sections):
            logger.warning("Greenhouse sanitized output still contains HTML-like text: job_id=%s title=%s", external_id, title)

        return {
            "job_id": self._internal_job_id(str(external_id)),
            "title": title,
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
            "requirements": [self.sanitize_text(item) for item in self._requirements(description) if self.sanitize_text(item)],
            "tech_stack": [],
            "seniority": self._seniority(title),
            "posted_at": row.get("updated_at") or imported_at,
            "provider": self.name,
            "external_id": str(external_id),
            "provider_job_id": str(raw_external_id),
            "board_token": query.board_token,
            "external_url": external_url,
            "source": "Greenhouse",
            "ats_provider": "greenhouse",
            "auto_apply_supported": True,
            "auto_apply_reason": "greenhouse supported for V1 auto-apply",
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct apply URL available via greenhouse.",
            "apply_url_provider": "greenhouse",
            "apply_url_source": "Greenhouse",
            "selected_apply_url": external_url,
            "manual_fulfillment_ready": True,
            "job_board_account_required": False,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "provider_query": query.board_token,
            "provider_search_key": self.search_key(query),
            "raw_provider_payload": row if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def _application_fields(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        fields = [
            {"name": "first_name", "label": "First name", "type": "input_text", "required": True, "options": [], "field_category": "candidate"},
            {"name": "last_name", "label": "Last name", "type": "input_text", "required": True, "options": [], "field_category": "candidate"},
            {"name": "email", "label": "Email", "type": "input_text", "required": True, "options": [], "field_category": "candidate"},
            {"name": "phone", "label": "Phone", "type": "input_text", "required": False, "options": [], "field_category": "candidate"},
            {"name": "resume", "label": "Resume", "type": "file", "required": True, "options": [], "field_category": "document"},
        ]
        for question in payload.get("questions") or []:
            if not isinstance(question, dict):
                continue
            fields.append(self._question_field(question))
        for question in payload.get("demographic_questions") or []:
            if not isinstance(question, dict):
                continue
            field = self._question_field(question)
            field["field_category"] = "demographic"
            fields.append(field)
        for question in payload.get("eeoc_questions") or []:
            if not isinstance(question, dict):
                continue
            field = self._question_field(question)
            field["field_category"] = "eeoc"
            fields.append(field)
        return fields

    def _question_field(self, question: Dict[str, Any]) -> Dict[str, Any]:
        question_id = question.get("id") or question.get("question_id")
        label = self.sanitize_text(question.get("label") or question.get("question") or question.get("name") or f"Question {question_id}")
        raw_type = str(question.get("type") or question.get("field_type") or "").lower()
        values = question.get("values") or question.get("options") or []
        options = []
        if isinstance(values, list):
            for option in values:
                if isinstance(option, dict):
                    options.append({
                        "value": option.get("value") or option.get("id") or option.get("name"),
                        "label": self.sanitize_text(option.get("label") or option.get("name") or option.get("value")),
                    })
                else:
                    options.append({"value": option, "label": self.sanitize_text(option)})
        return {
            "name": f"question_{question_id}" if question_id is not None else label.lower().replace(" ", "_"),
            "label": label,
            "type": self._field_type(raw_type, options),
            "required": bool(question.get("required")),
            "options": options,
            "field_category": "custom_question",
        }

    def _field_type(self, raw_type: str, options: List[Dict[str, Any]]) -> str:
        if "textarea" in raw_type or "long" in raw_type:
            return "textarea"
        if "multi" in raw_type or "checkbox" in raw_type:
            return "multi_select"
        if "select" in raw_type or "radio" in raw_type or options:
            return "select"
        if "file" in raw_type:
            return "file"
        if "boolean" in raw_type:
            return "boolean"
        return raw_type or "input_text"

    def _application_blockers(self, fields: List[Dict[str, Any]]) -> List[str]:
        blockers = []
        supported_required_types = {"input_text", "textarea", "select", "multi_select", "boolean", "file"}
        for field in fields:
            label = (field.get("label") or "").lower()
            field_type = field.get("type")
            if "captcha" in label:
                blockers.append("captcha")
            if "login" in label or "sign in" in label:
                blockers.append("login_required")
            if field.get("required") and field_type not in supported_required_types:
                blockers.append("unknown_required_field")
            if field.get("required") and field_type == "file" and field.get("name") != "resume":
                blockers.append("unsupported_file_upload")
        return sorted(set(blockers))

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

    def _plain_text(self, content: str) -> str:
        soup = self._soup(content)
        for tag in soup(["script", "style"]):
            tag.decompose()
        return self.sanitize_text(soup.get_text("\n"))

    def _description_sections(self, content_html: str, fallback_text: str) -> List[Dict[str, List[str]]]:
        soup = self._soup(content_html)
        for tag in soup(["script", "style"]):
            tag.decompose()
        buckets: Dict[str, List[str]] = {
            "About the role": [],
            "Responsibilities": [],
            "Requirements": [],
            "Benefits / Compensation": [],
        }
        current_title = "About the role"

        for node in soup.find_all(["h1", "h2", "h3", "strong", "b", "li", "p", "div"]):
            text = self._normalize_text(node.get_text(" "))
            if not text:
                continue

            if node.name in ("h1", "h2", "h3", "strong", "b") and len(text) <= 120:
                current_title = self._section_title(text)
                continue
            if node.find_parent("li") and node.name not in ("li",):
                continue
            if node.name in ("div", "p") and node.find(["li", "h1", "h2", "h3", "strong", "b"]):
                continue
            buckets.setdefault(current_title, []).append(text)

        sections = []
        for title in ("About the role", "Responsibilities", "Requirements", "Benefits / Compensation"):
            bullets = self._clean_bullets(buckets.get(title, []))
            if bullets:
                sections.append({"title": title, "bullets": bullets[:8]})
        if sections:
            return sections

        fallback_bullets = self._clean_bullets([line for line in (fallback_text or "").splitlines() if line.strip()])
        return [{"title": "About the role", "bullets": fallback_bullets[:8]}] if fallback_bullets else []

    def _section_title(self, value: str) -> str:
        normalized = re.sub(r"[^a-z0-9' ]+", "", self.sanitize_text(value).lower()).strip()
        if any(term in normalized for term in ("responsibilities", "what you'll do", "what you will do", "your impact", "in this role")):
            return "Responsibilities"
        if any(term in normalized for term in ("requirements", "qualifications", "what we're looking for", "what we are looking for", "you have", "you bring", "skills")):
            return "Requirements"
        if any(term in normalized for term in ("benefits", "compensation", "perks", "pay", "salary", "rewards")):
            return "Benefits / Compensation"
        return "About the role"

    def _normalize_text(self, value: str) -> str:
        return self.sanitize_text(value).strip(" -•\t\r\n")

    def sanitize_text(self, value: Any) -> str:
        if value is None:
            return ""
        text = html.unescape(str(value))
        if self._contains_html(text):
            try:
                text = self._soup(text).get_text(" ", strip=True)
            except RuntimeError:
                text = re.sub(r"<[^>]+>", " ", text)
        text = html.unescape(text)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip(" -•\t\r\n")

    def _sanitize_sections(self, sections: List[Dict[str, Any]]) -> List[Dict[str, List[str]]]:
        cleaned_sections: List[Dict[str, List[str]]] = []
        for section in sections or []:
            title = self.sanitize_text(section.get("title"))
            bullets = self._clean_bullets(section.get("bullets") or [])
            if title and bullets:
                cleaned_sections.append({"title": title, "bullets": bullets})
        return cleaned_sections

    def _contains_html(self, value: Any) -> bool:
        return bool(re.search(r"</?[a-z][\s\S]*?>", str(value or ""), flags=re.IGNORECASE))

    def _sections_contain_html(self, sections: List[Dict[str, Any]]) -> bool:
        for section in sections or []:
            if self._contains_html(section.get("title")):
                return True
            if any(self._contains_html(bullet) for bullet in section.get("bullets") or []):
                return True
        return False

    def _soup(self, value: str):
        try:
            from bs4 import BeautifulSoup
        except ImportError as exc:
            raise RuntimeError("beautifulsoup4 is required for Greenhouse HTML parsing. Run pip install -r backend/requirements.txt") from exc
        return BeautifulSoup(html.unescape(value or ""), "html.parser")

    def _clean_bullets(self, lines: List[str]) -> List[str]:
        seen = set()
        bullets = []
        for line in lines:
            cleaned = self._normalize_text(line)
            if len(cleaned) > 240:
                cleaned = cleaned[:237].rstrip() + "..."
            key = cleaned.lower()
            if len(cleaned) < 12 or key in seen:
                continue
            seen.add(key)
            bullets.append(cleaned)
        return bullets

    def _location(self, row: Dict[str, Any]) -> str:
        location = row.get("location") or {}
        if isinstance(location, dict) and location.get("name"):
            return str(location["name"])
        return "Unknown"

    def _remote(self, row: Dict[str, Any], description: str) -> str:
        text = " ".join([str(row.get("title") or ""), self._location(row), description[:1000]]).lower()
        if "hybrid" in text:
            return "hybrid"
        if "remote" in text or "work from home" in text:
            return "remote"
        return "onsite"

    def _requirements(self, description: str) -> List[str]:
        lines = [self.sanitize_text(line) for line in (description or "").splitlines()]
        useful = [
            line
            for line in lines
            if 20 <= len(line) <= 220
            and any(term in line.lower() for term in ("experience", "skill", "proficient", "ability", "knowledge", "required", "preferred"))
        ]
        return useful[:8]

    def _seniority(self, title: str) -> Optional[str]:
        text = (title or "").lower()
        if "principal" in text:
            return "principal"
        if any(token in text for token in ("staff", "lead", "head of")):
            return "lead"
        if any(token in text for token in ("senior", "sr.")):
            return "senior"
        if any(token in text for token in ("junior", "jr.", "entry", "graduate", "intern")):
            return "junior"
        return "mid"
