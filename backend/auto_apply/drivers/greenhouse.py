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

import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote_to_bytes, urljoin, urlparse

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
_REVIEWED_APPLICATION_HOSTS = frozenset({
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "boards.greenhouse.com",
    "job-boards.greenhouse.com",
})
_ROUTE_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _greenhouse_route_identity(
    value: Any,
    *,
    allow_fragment: bool = False,
) -> Optional[Tuple[str, str]]:
    """Parse the one reviewed hosted-form route shape into board/job identity."""
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
    except ValueError:
        return None
    if not (
        parsed.scheme == "https"
        and hostname in _REVIEWED_APPLICATION_HOSTS
        and parsed.username is None
        and parsed.password is None
        and port in (None, 443)
        and not parsed.query
        and (allow_fragment or not parsed.fragment)
        and not parsed.params
    ):
        return None
    try:
        raw_parts = parsed.path.split("/")
        if len(raw_parts) != 4 or raw_parts[0] or any(not part for part in raw_parts[1:]):
            return None
        if "%" in parsed.path:
            return None
        parts = [unquote_to_bytes(part).decode("utf-8") for part in raw_parts[1:]]
    except (UnicodeDecodeError, ValueError):
        return None
    if len(parts) != 3 or parts[1].lower() != "jobs":
        return None
    board_token, _, provider_job_id = parts
    if not _ROUTE_PART.fullmatch(board_token) or not _ROUTE_PART.fullmatch(provider_job_id):
        return None
    return board_token.lower(), provider_job_id.lower()


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
    return _greenhouse_route_identity(value) is not None


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

    def route_identity(self, job: Dict[str, Any]) -> Optional[Tuple[str, str]]:
        app_url = self.application_url(job)
        identity = _greenhouse_route_identity(app_url)
        if identity is None:
            return None
        board_token, provider_job_id = identity
        data = job.get("data") if isinstance(job.get("data"), dict) else {}
        explicit_board = str(job.get("board_token") or data.get("board_token") or "").strip().lower()
        explicit_job = str(job.get("provider_job_id") or data.get("provider_job_id") or "").strip().lower()
        if explicit_board and explicit_board != board_token:
            return None
        if explicit_job and explicit_job != provider_job_id:
            return None
        return identity

    async def inspect_application(self, job: Dict[str, Any]) -> ApplicationBlueprint:
        import httpx
        identity = self.route_identity(job)
        if identity is None:
            raise ValueError("greenhouse_board_or_job_unresolved")
        token, job_id = identity
        url = f"{self._adapter.base_url}/{token}/jobs/{job_id}"
        from ._html_forms import guarded_get

        async def validate_api_route(provider: str, candidate: str) -> None:
            parsed = urlparse(candidate)
            if not (
                provider == self.provider
                and parsed.scheme == "https"
                and (parsed.hostname or "").lower().rstrip(".") == "boards-api.greenhouse.io"
                and parsed.username is None
                and parsed.password is None
                and parsed.port in (None, 443)
                and not parsed.query
                and not parsed.fragment
                and parsed.path == f"/v1/boards/{token}/jobs/{job_id}"
            ):
                raise ValueError("greenhouse_api_route_denied")

        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            resp = await guarded_get(
                client,
                url,
                provider=self.provider,
                params={"questions": "true"},
                route_validator=validate_api_route,
            )
            resp.raise_for_status()
            payload = resp.json()
        return _blueprint_from_questions(payload)

    async def submission_locator_root(
        self,
        page: Any,
        job: Dict[str, Any],
    ) -> Tuple[Optional[Any], Optional[str]]:
        """Atomically validate the job route and return its sole submit form."""
        expected = self.route_identity(job)
        if expected is None:
            return None, "greenhouse_job_identity_unresolved"
        current_url = str(getattr(page, "url", "") or "")
        current = _greenhouse_route_identity(current_url, allow_fragment=True)
        if current != expected:
            return None, "greenhouse_browser_route_mismatch"

        forms = page.locator('form:has(button[type="submit"], input[type="submit"])')
        if await forms.count() != 1:
            return None, "greenhouse_submit_form_ambiguous"
        form = forms.first
        action = await form.get_attribute("action")
        action_url = urljoin(current_url, str(action or ""))
        if _greenhouse_route_identity(action_url, allow_fragment=True) != expected:
            return None, "greenhouse_form_action_mismatch"
        return form, None

    async def submission_boundary_failure(
        self,
        page: Any,
        job: Dict[str, Any],
    ) -> Optional[str]:
        """Compatibility hook for direct boundary checks and older callers."""
        _, failure = await self.submission_locator_root(page, job)
        return failure

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
