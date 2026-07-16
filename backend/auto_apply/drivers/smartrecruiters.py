"""SmartRecruiters driver: oneclick-ui hosted apply forms.

Flow: job posting -> "Je suis intéressé(e)" (#st-apply) -> oneclick-ui form.
inspect_application builds a deterministic blueprint from the standard oneclick
field layout (French + English accessible names) plus optional screening
questions when the oneclick configuration API responds. submit() navigates
directly to the oneclick URL and fills via Playwright role selectors.
"""
from __future__ import annotations

import logging
import random
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx

from application_blueprint import (
    ApplicationBlueprint,
    FieldType,
    FieldValidation,
    NormalizedField,
    derive_complexity,
    estimate_compatibility_score,
)
from apply_agent.guardrails import canonical
from apply_agent.human_browser import human_click, human_pause, human_scroll
from job_providers.ats_adapters.smartrecruiters import SmartRecruitersAtsAdapter

from ..driver import DRIVER_REGISTRY, BrowserApplyDriver
from ..models import SubmissionContext, SubmissionEvidence, compute_blueprint_signature

logger = logging.getLogger(__name__)

_ONECLICK_URL = "https://jobs.smartrecruiters.com/oneclick-ui/company/{company}/publication/{uuid}?dcr_ci={company}"
_CONFIG_URL = "https://jobs.smartrecruiters.com/oneclick-ui/api/company/{company}/publication/{uuid}/configuration"
_SUBMIT_SELECTORS = (
    'role=button[name="Envoyer"]',
    'role=button[name="Envoyer ma candidature"]',
    'role=button[name="Soumettre"]',
    'role=button[name="Send"]',
    'role=button[name="Submit"]',
    'role=button[name="Submit application"]',
    'button:has-text("Envoyer")',
)
_SR_FIELD_TYPE_MAP = {
    "INPUT_TEXT": FieldType.TEXT,
    "TEXTAREA": FieldType.TEXTAREA,
    "SINGLE_SELECT": FieldType.SELECT,
    "MULTI_SELECT": FieldType.MULTISELECT,
    "RADIO": FieldType.SELECT,
    "CHECKBOX": FieldType.CHECKBOX,
    "INFORMATION": FieldType.UNKNOWN,
}
_SENSITIVE_TOKENS = (
    "visa", "sponsor", "authorized to work", "work authorization", "salary",
    "compensation", "gender", "race", "ethnicity", "veteran", "disability",
    "diversity",
)
_SUPPORTED_CONFIG_TYPES = set(_SR_FIELD_TYPE_MAP) - {"INFORMATION"}


def _role_locators(role: str, labels: List[str]) -> List[str]:
    return [f'role={role}[name="{label}"]' for label in labels]


def _standard_fields() -> List[NormalizedField]:
    """Fields present on virtually every SmartRecruiters oneclick apply form."""
    specs: List[Tuple[str, FieldType, bool, List[str], Optional[str]]] = [
        ("first_name", FieldType.FIRST_NAME, True, ["Prénom", "First name"], None),
        ("last_name", FieldType.LAST_NAME, True, ["Nom", "Last name"], None),
        ("email", FieldType.EMAIL, True, ["E-mail", "Email"], None),
        ("email_confirm", FieldType.EMAIL, True, ["Confirmez votre e-mail", "Confirm your email"], None),
        ("city", FieldType.LOCATION, True, ["Ville", "City"], None),
        ("phone", FieldType.PHONE, True, ["Numéro de téléphone", "Phone number"], None),
        ("linkedin", FieldType.LINKEDIN, False, ["LinkedIn"], None),
        ("website", FieldType.WEBSITE, False, ["Site Web", "Website"], None),
        ("resume", FieldType.RESUME, True, [], 'input[type="file"] >> nth=-1'),
        ("consent", FieldType.CONSENT, True, [], "role=checkbox >> nth=0"),
    ]
    fields: List[NormalizedField] = []
    for key, ftype, required, labels, binding in specs:
        if binding:
            locators = [binding]
        elif ftype == FieldType.LOCATION:
            locators = _role_locators("combobox", labels)
        else:
            locators = _role_locators("textbox", labels) if labels else []
        fields.append(NormalizedField(
            key=key,
            type=ftype,
            required=required,
            supported=True,
            label=labels[0] if labels else key,
            binding=locators[0] if locators else None,
        ))
    return fields


def _classify_screening_field(label: str, field_type: str) -> FieldType:
    clabel = canonical(label)
    if "linkedin" in clabel:
        return FieldType.LINKEDIN
    if "website" in clabel or "portfolio" in clabel:
        return FieldType.WEBSITE
    if "phone" in clabel or "telephone" in clabel or "téléphone" in clabel:
        return FieldType.PHONE
    if "cover letter" in clabel or "lettre" in clabel:
        return FieldType.COVER_LETTER
    if "resume" in clabel or "cv" in clabel:
        return FieldType.RESUME
    return _SR_FIELD_TYPE_MAP.get(field_type, FieldType.UNKNOWN)


def _fields_from_configuration(payload: Dict[str, Any]) -> List[NormalizedField]:
    fields: List[NormalizedField] = []
    for question in payload.get("questions") or []:
        q_label = str(question.get("label") or "")
        for raw in question.get("fields") or []:
            field_id = str(raw.get("id") or "")
            if not field_id:
                continue
            label = str(raw.get("label") or q_label or field_id)
            field_type = str(raw.get("type") or "")
            required = bool(raw.get("required"))
            compliance = str(raw.get("complianceType") or "").upper()
            sensitive = compliance == "DIVERSITY" or any(tok in canonical(label) for tok in _SENSITIVE_TOKENS)
            ftype = _classify_screening_field(label, field_type)
            options = [str(v.get("label")) for v in (raw.get("values") or []) if v.get("label") is not None]
            supported = field_type in _SUPPORTED_CONFIG_TYPES and ftype != FieldType.UNKNOWN
            fields.append(NormalizedField(
                key=f"screening:{field_id}",
                type=ftype,
                required=required,
                supported=supported,
                label=label,
                validation=FieldValidation(allowed_options=options or None, sensitive=sensitive),
                binding=f'role=textbox[name="{label}"]' if ftype in {FieldType.TEXT, FieldType.TEXTAREA} else None,
            ))
    return fields


def _merge_fields(standard: List[NormalizedField], extra: List[NormalizedField]) -> List[NormalizedField]:
    """Keep standard oneclick fields; append screening questions not already covered."""
    covered_types = {f.type for f in standard if f.required}
    merged = list(standard)
    for field in extra:
        if field.type in covered_types and field.type in {
            FieldType.FIRST_NAME, FieldType.LAST_NAME, FieldType.EMAIL, FieldType.PHONE, FieldType.RESUME,
        }:
            continue
        merged.append(field)
    return merged


def _blueprint(fields: List[NormalizedField]) -> ApplicationBlueprint:
    return ApplicationBlueprint(
        provider="smartrecruiters",
        fields=fields,
        complexity=derive_complexity(fields),
        estimated_compatibility_score=estimate_compatibility_score(fields, []),
        blockers=[],
        signature=compute_blueprint_signature(fields),
    )


def _parse_oneclick_data(html: str) -> Dict[str, str]:
    match = re.search(
        r"window\.ONECLICKDATA\s*=\s*\{[^}]*cident:\s*'([^']+)'[^}]*puuid:\s*'([^']+)'",
        html,
        re.S,
    )
    if not match:
        return {}
    return {"company": match.group(1), "publication_uuid": match.group(2)}


def _company_slug(job: Dict[str, Any], posting_url: str) -> str:
    for key in ("board_token", "provider_query", "company_slug"):
        value = job.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    adapter = SmartRecruitersAtsAdapter()
    slug = adapter.extract_source_key_from_url(posting_url)
    return slug or ""


class SmartRecruitersApplyDriver(BrowserApplyDriver):
    provider = "smartrecruiters"
    version = "smartrecruiters-1.1.1"

    def __init__(self):
        self._adapter = SmartRecruitersAtsAdapter()

    def can_handle(self, job: Dict[str, Any]) -> bool:
        return str(job.get("ats_provider") or job.get("provider") or "").lower() == "smartrecruiters"

    def posting_url(self, job: Dict[str, Any]) -> str:
        for key in ("external_url", "selected_apply_url", "apply_url"):
            value = job.get(key)
            if isinstance(value, str) and "smartrecruiters.com" in value and "oneclick-ui" not in value:
                return value.split("?")[0]
        return ""

    async def resolve_publication(self, job: Dict[str, Any]) -> Dict[str, str]:
        pub_uuid = str(job.get("publication_uuid") or job.get("posting_uuid") or "").strip()
        company = _company_slug(job, self.posting_url(job))
        posting_url = self.posting_url(job)

        if pub_uuid and company:
            return {"company": company, "publication_uuid": pub_uuid}

        posting_id = job.get("provider_job_id") or self._adapter.extract_posting_id_from_url(posting_url)
        if company and posting_id:
            try:
                detail = await self._adapter.fetch_posting_detail(str(company), str(posting_id))
                pub_uuid = str(detail.get("uuid") or "").strip()
                if pub_uuid:
                    return {"company": company, "publication_uuid": pub_uuid}
            except Exception as exc:
                logger.debug("sr_posting_detail_failed company=%s posting=%s error=%s", company, posting_id, exc)

        if posting_url:
            try:
                async with httpx.AsyncClient(timeout=12) as client:
                    resp = await client.get(posting_url, headers={"User-Agent": "Mozilla/5.0"}, follow_redirects=True)
                    resp.raise_for_status()
                    parsed = _parse_oneclick_data(resp.text)
                    if parsed.get("company") and parsed.get("publication_uuid"):
                        return parsed
            except Exception as exc:
                logger.debug("sr_posting_html_parse_failed url=%s error=%s", posting_url, exc)

        raise ValueError("smartrecruiters_publication_unresolved")

    def oneclick_url(self, company: str, publication_uuid: str) -> str:
        return _ONECLICK_URL.format(company=company, uuid=publication_uuid)

    def application_url(self, job: Dict[str, Any]) -> str:
        pub_uuid = str(job.get("publication_uuid") or job.get("posting_uuid") or "").strip()
        company = _company_slug(job, self.posting_url(job))
        if company and pub_uuid:
            return self.oneclick_url(company, pub_uuid)
        return self.posting_url(job)

    def navigation_url(self, job: Dict[str, Any]) -> str:
        posting = self.posting_url(job)
        return posting or self.application_url(job)

    async def inspect_application(self, job: Dict[str, Any]) -> ApplicationBlueprint:
        publication = await self.resolve_publication(job)
        company = publication["company"]
        pub_uuid = publication["publication_uuid"]
        oneclick = self.oneclick_url(company, pub_uuid)

        extra_fields: List[NormalizedField] = []
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    _CONFIG_URL.format(company=company, uuid=pub_uuid),
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "Mozilla/5.0",
                        "Referer": oneclick,
                        "Origin": "https://jobs.smartrecruiters.com",
                    },
                    follow_redirects=True,
                )
                if resp.status_code == 200 and "json" in resp.headers.get("content-type", ""):
                    extra_fields = _fields_from_configuration(resp.json())
        except Exception as exc:
            logger.debug("sr_configuration_fetch_failed uuid=%s error=%s", pub_uuid, exc)

        fields = _merge_fields(_standard_fields(), extra_fields)
        return _blueprint(fields)

    async def submit(self, ctx: SubmissionContext) -> SubmissionEvidence:
        try:
            publication = await self.resolve_publication(ctx.job)
            ctx.job["publication_uuid"] = publication["publication_uuid"]
            ctx.job["board_token"] = publication["company"]
        except Exception as exc:
            return SubmissionEvidence(
                raw={"application_url": self.posting_url(ctx.job), "resolve_error": str(exc)[:200]},
                blocked_reason="publication_unresolved",
            )
        return await super().submit(ctx)

    async def after_navigation(self, page: Any, evidence) -> None:
        """Warm the SmartRecruiters origin a bit before interacting with Apply."""
        await human_pause(page, 1800, 3600)
        await human_scroll(page)
        await human_pause(page, 500, 1200)
        # Light mouse wander so the session is not "land and click Apply" only.
        try:
            await page.mouse.move(random.randint(120, 480), random.randint(160, 420), steps=random.randint(8, 18))
            await human_pause(page, 250, 700)
            await page.mouse.move(random.randint(520, 980), random.randint(220, 560), steps=random.randint(8, 18))
        except Exception:
            pass
        await human_pause(page, 400, 900)

    async def reveal_form(self, page: Any) -> None:
        url = page.url or ""
        if "oneclick-ui" in url:
            return
        for selector in ("#st-apply", 'a[data-sr-track="apply"]', 'a.js-oneclick[href*="oneclick-ui"]'):
            try:
                loc = page.locator(selector)
                if await loc.count():
                    await human_pause(page, 800, 1800)
                    await human_click(loc.first, page)
                    await human_pause(page, 1800, 3200)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=12000)
                    except Exception:
                        pass
                    return
            except Exception:
                continue

    async def _apply_step(self, page: Any, step, documents: Dict[str, Any], evidence) -> None:
        if step.action == "fill" and any("combobox" in loc for loc in step.locators):
            preview = str(step.value or "")[:100]
            loc = await self._first_locator(page, step.locators)
            if loc is None:
                evidence.raw.setdefault("unmatched_steps", []).append(step.locators[:1])
                await self._log_step(evidence, action="fill", locators=step.locators,
                                     status="not_found", value_preview=preview)
                return
            try:
                await human_click(loc, page)
                await human_pause(page, 180, 420)
                await loc.press_sequentially(str(step.value), delay=random.randint(48, 95))
                try:
                    await page.keyboard.press("Enter")
                except Exception:
                    pass
                await self._log_step(evidence, action="fill", locators=step.locators,
                                     status="ok", value_preview=preview)
                return
            except Exception as exc:
                evidence.raw.setdefault("step_errors", []).append(f"{exc.__class__.__name__}:{step.locators[:1]}")
                await self._log_step(evidence, action="fill", locators=step.locators,
                                     status="error", value_preview=preview, error=str(exc))
                return
        await super()._apply_step(page, step, documents, evidence)

    async def _click_submit(self, page: Any, evidence) -> None:
        loc = await self._first_locator(page, list(_SUBMIT_SELECTORS))
        if loc is None:
            evidence.raw["submit"] = "button_not_found"
            await self._log_step(evidence, action="submit", locators=list(_SUBMIT_SELECTORS),
                                 status="not_found")
            return
        try:
            await loc.scroll_into_view_if_needed(timeout=3000)
        except Exception:
            pass
        try:
            await human_click(loc, page)
            evidence.submit_performed = True
            await self._log_step(evidence, action="submit", locators=list(_SUBMIT_SELECTORS), status="ok")
        except Exception:
            try:
                await loc.click(timeout=5000, force=True)
                evidence.submit_performed = True
                await self._log_step(evidence, action="submit", locators=list(_SUBMIT_SELECTORS),
                                     status="ok", error="forced_click")
            except Exception as exc:
                evidence.raw["submit_error"] = str(exc)[:200]
                await self._log_step(evidence, action="submit", locators=list(_SUBMIT_SELECTORS),
                                     status="error", error=str(exc))


DRIVER_REGISTRY.register(SmartRecruitersApplyDriver())
