"""Greenhouse driver: deterministic blueprint from the public Questions API,
deterministic submission inherited from BrowserApplyDriver.

Isolation: this module knows nothing about the Executor, Metrics, or Database.
It depends only on the frozen ApplicationBlueprint contract, the ApplyDriver
base, and the Greenhouse ingestion adapter (for the board token / API base URL).

Determinism: inspect_application() maps ONLY from the Questions API payload --
each field's exact hosted-form `name`, `type`, and select `values`. No LLM, no
DOM interpretation, no fuzzy guessing. The same payload always yields the same
ApplicationBlueprint (and therefore the same blueprint signature).
"""
from __future__ import annotations

from typing import Any, Dict, List
from urllib.parse import urlparse

from application_blueprint import (
    ApplicationBlueprint, FieldType, FieldValidation, NormalizedField,
    derive_complexity, estimate_compatibility_score,
)
from apply_agent.guardrails import canonical
from job_providers.ats_adapters.greenhouse import GreenhouseAtsAdapter

from ..driver import DRIVER_REGISTRY, BrowserApplyDriver
from ..models import compute_blueprint_signature

# name token -> FieldType for standard contact fields (checked in order; more
# specific tokens like first_name/last_name precede the generic "name").
_NAME_TYPE_MAP = {
    "first_name": FieldType.FIRST_NAME,
    "last_name": FieldType.LAST_NAME,
    "name": FieldType.FULL_NAME,
    "email": FieldType.EMAIL,
    "phone": FieldType.PHONE,
    "resume": FieldType.RESUME,
    "cover_letter": FieldType.COVER_LETTER,
}
_LABEL_TYPE_MAP = {
    "linkedin": FieldType.LINKEDIN,
    "website": FieldType.WEBSITE,
    "portfolio": FieldType.WEBSITE,
    "location": FieldType.LOCATION,
}
_SENSITIVE_TOKENS = (
    "visa", "sponsor", "authorized to work", "work authorization", "salary",
    "compensation", "gender", "race", "ethnicity", "veteran", "disability",
    "hispanic", "sexual orientation", "criminal",
)
_WIDGET_MAP = {
    "input_text": FieldType.TEXT,
    "textarea": FieldType.TEXTAREA,
    "input_file": FieldType.FILE_UPLOAD,
    "multi_value_single_select": FieldType.SELECT,
    "multi_value_multi_select": FieldType.MULTISELECT,
    "input_hidden": FieldType.UNKNOWN,
}
_SUPPORTED_WIDGETS = {"input_text", "textarea", "input_file",
                      "multi_value_single_select", "multi_value_multi_select"}


def _classify_field(name: str, label: str, widget: str) -> FieldType:
    lname = name.lower()
    for token, ftype in _NAME_TYPE_MAP.items():
        if token in lname:
            if ftype == FieldType.RESUME and widget != "input_file":
                continue
            return ftype
    clabel = canonical(label)
    if "cover letter" in clabel or "lettre de motivation" in clabel:
        return FieldType.COVER_LETTER
    for token, ftype in _LABEL_TYPE_MAP.items():
        if token in clabel:
            return ftype
    return _WIDGET_MAP.get(widget, FieldType.UNKNOWN)


def _blueprint_from_questions(payload: Dict[str, Any]) -> ApplicationBlueprint:
    fields: List[NormalizedField] = []
    for question in payload.get("questions") or []:
        label = str(question.get("label") or "")
        required = bool(question.get("required"))
        sensitive = any(tok in canonical(label) for tok in _SENSITIVE_TOKENS)
        for gh_field in question.get("fields") or []:
            name = str(gh_field.get("name") or "")
            if not name:
                continue
            widget = str(gh_field.get("type") or "")
            ftype = _classify_field(name, label, widget)
            options = [str(v.get("label")) for v in (gh_field.get("values") or []) if v.get("label") is not None]
            fields.append(NormalizedField(
                key=name,
                type=ftype,
                required=required,
                supported=widget in _SUPPORTED_WIDGETS,
                label=label,
                validation=FieldValidation(
                    allowed_options=options or None,
                    sensitive=sensitive,
                    accepted_file_types=["pdf", "doc", "docx"] if widget == "input_file" else None,
                ),
                binding=f'[name="{name}"]',
            ))
    return ApplicationBlueprint(
        provider="greenhouse", fields=fields, complexity=derive_complexity(fields),
        estimated_compatibility_score=estimate_compatibility_score(fields, []),
        blockers=[], signature=compute_blueprint_signature(fields),
    )


def _trusted_greenhouse_url(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = urlparse(value)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
    except ValueError:
        return False
    return bool(
        parsed.scheme == "https"
        and hostname
        and parsed.username is None
        and parsed.password is None
        and port in (None, 443)
        and any(
            hostname == suffix or hostname.endswith(f".{suffix}")
            for suffix in ("greenhouse.io", "greenhouse.com")
        )
    )


def _job_http_url(job: Dict[str, Any], *keys: str) -> str:
    data = job.get("data") if isinstance(job.get("data"), dict) else {}
    for source in (job, data):
        for key in keys:
            value = source.get(key)
            if _trusted_greenhouse_url(value):
                return value
    return ""


class GreenhouseApplyDriver(BrowserApplyDriver):
    provider = "greenhouse"
    version = "greenhouse-1.1.0"

    def __init__(self):
        self._adapter = GreenhouseAtsAdapter()

    def can_handle(self, job: Dict[str, Any]) -> bool:
        return str(job.get("ats_provider") or job.get("provider") or "").lower() == "greenhouse"

    def application_url(self, job: Dict[str, Any]) -> str:
        return _job_http_url(
            job,
            "external_url",
            "selected_apply_url",
            "apply_url",
            "absolute_url",
            "application_url",
            "source_url",
            "url",
            "job_url",
        )

    async def inspect_application(self, job: Dict[str, Any]) -> ApplicationBlueprint:
        import httpx
        app_url = self.application_url(job)
        token = job.get("board_token") or self._adapter.extract_source_key_from_url(app_url)
        job_id = job.get("provider_job_id")
        if not token or not job_id:
            raise ValueError("greenhouse_board_or_job_unresolved")
        url = f"{self._adapter.base_url}/{token}/jobs/{job_id}"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, params={"questions": "true"})
            resp.raise_for_status()
            payload = resp.json()
        return _blueprint_from_questions(payload)

    async def reveal_form(self, page: Any, evidence: Any = None) -> None:
        # job-boards.greenhouse.io often hides the form behind Apply / #app.
        for selector in (
            'a[href*="#app"]',
            'button#apply_button',
            'a#apply_button',
            'a.template-btn-submit',
            'button[data-provides="apply-button"]',
            'a[data-provides="apply-button"]',
        ):
            try:
                loc = page.locator(selector)
                if await loc.count():
                    await loc.first.click(timeout=3000)
                    await page.wait_for_timeout(400)
                    return
            except Exception:
                continue


DRIVER_REGISTRY.register(GreenhouseApplyDriver())
