"""SmartRecruiters driver: oneclick-ui hosted apply forms.

Flow: job posting -> Apply CTA ("Je suis intéressé(e)" / #st-apply / text button)
-> oneclick-ui form. Falls back to direct oneclick navigation when the CTA
selectors miss. inspect_application builds a deterministic blueprint from the
standard oneclick field layout (French + English accessible names) plus optional
screening questions when the oneclick configuration API responds.
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
from application_failure import text_indicates_offer_expired
from apply_agent.blockers import detect_offer_expired
from apply_agent.guardrails import canonical
from apply_agent.browser import (
    is_proxy_connect_failure_status,
    is_proxy_connect_failure_text,
)
from apply_agent.human_browser import (
    human_click,
    human_mouse_wander,
    human_pause,
    human_scroll,
    try_pass_datadome_slider,
)
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


def _exact_role_locator(role: str, label: str) -> str:
    # Playwright name= is a substring match by default — "Nom" would hit "Prénom".
    return f'role={role}[name=/^{re.escape(label)}$/i]'


def _role_locators(role: str, labels: List[str]) -> List[str]:
    return [_exact_role_locator(role, label) for label in labels]


def _standard_fields() -> List[NormalizedField]:
    """Fields present on virtually every SmartRecruiters oneclick apply form."""
    # Prefer stable spl-input host ids (shadow-piercing >> input). Role names
    # use exact regex so "Nom" never matches "Prénom".
    specs: List[Tuple[str, FieldType, bool, List[str], str]] = [
        ("first_name", FieldType.FIRST_NAME, True, ["Prénom", "First name"], "#first-name-input >> input"),
        ("last_name", FieldType.LAST_NAME, True, ["Nom", "Last name"], "#last-name-input >> input"),
        ("email", FieldType.EMAIL, True, ["E-mail", "Email"], "#email-input >> input"),
        (
            "email_confirm",
            FieldType.EMAIL,
            True,
            ["Confirmez votre e-mail", "Confirm your email"],
            "#confirm-email-input >> input",
        ),
        ("city", FieldType.LOCATION, True, ["Ville", "City"], _exact_role_locator("combobox", "Ville")),
        ("phone", FieldType.PHONE, True, ["Numéro de téléphone", "Phone number"], 'input[type="tel"]'),
        ("linkedin", FieldType.LINKEDIN, False, ["LinkedIn"], "#linkedin-input >> input"),
        ("website", FieldType.WEBSITE, False, ["Site Web", "Website"], "#website-input >> input"),
        ("resume", FieldType.RESUME, True, [], 'input[type="file"] >> nth=-1'),
        ("consent", FieldType.CONSENT, True, [], 'spl-checkbox[data-test="consent-box"]'),
    ]
    fields: List[NormalizedField] = []
    for key, ftype, required, labels, binding in specs:
        fields.append(NormalizedField(
            key=key,
            type=ftype,
            required=required,
            supported=True,
            label=labels[0] if labels else key,
            binding=binding,
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
    version = "smartrecruiters-1.2.1"

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
        await human_pause(page, 2200, 4200)
        await human_mouse_wander(page)
        await human_scroll(page)
        await human_pause(page, 700, 1500)
        await human_scroll(page)
        await human_mouse_wander(page)
        await human_pause(page, 500, 1200)

    async def _wait_for_oneclick_form(self, page: Any, *, timeout_ms: int = 45000) -> bool:
        """Oneclick SPA can take a while after Apply; wait for real inputs."""
        deadline = timeout_ms
        elapsed = 0
        slider_attempts = 0
        while elapsed < deadline:
            try:
                body = await page.locator("body").inner_text(timeout=1500)
                if is_proxy_connect_failure_text(body):
                    return False
            except Exception:
                pass
            try:
                if await page.locator(
                    'input:visible, textarea:visible, [role="textbox"]:visible'
                ).count() >= 3:
                    return True
            except Exception:
                pass
            # DataDome device-check often appears only after /config 403.
            if slider_attempts < 2 and any(
                "captcha-delivery" in (f.url or "") for f in page.frames
            ):
                slider_attempts += 1
                logger.info("sr_datadome_slider_attempt n=%s", slider_attempts)
                await try_pass_datadome_slider(page, attempts=3)
            await human_pause(page, 900, 1300)
            elapsed += 1100
        return False

    async def reveal_form(self, page: Any, evidence: Any = None) -> None:
        url = page.url or ""
        if "oneclick-ui" in url:
            await self._wait_for_oneclick_form(page)
            return
        # Expired postings keep a CTA whose label is no longer "Je suis intéressé(e)".
        if await detect_offer_expired(page):
            return

        # Accor / FR boards often use a plain text button without #st-apply.
        apply_selectors = (
            "#st-apply",
            'a[data-sr-track="apply"]',
            'a.js-oneclick[href*="oneclick-ui"]',
            'button:has-text("Je suis intéressé")',
            'a:has-text("Je suis intéressé")',
            'button:has-text("I\'m interested")',
            'a:has-text("I\'m interested")',
            'button:has-text("Apply now")',
            'a:has-text("Apply now")',
            'role=button[name=/intéressé|interested|apply/i]',
        )
        clicked = False
        for selector in apply_selectors:
            try:
                loc = page.locator(selector)
                if await loc.count():
                    try:
                        label = await loc.first.inner_text(timeout=2000)
                    except Exception:
                        label = ""
                    if text_indicates_offer_expired(label):
                        return
                    await human_pause(page, 800, 1800)
                    await human_click(loc.first, page)
                    clicked = True
                    if evidence is not None:
                        evidence.raw.setdefault("step_log", []).append({
                            "action": "reveal_form",
                            "locator": selector,
                            "status": "ok",
                            "value_preview": "apply_cta_clicked",
                            "error": "",
                        })
                    await human_pause(page, 1800, 3200)
                    try:
                        await page.wait_for_load_state("networkidle", timeout=12000)
                    except Exception:
                        pass
                    if await self._wait_for_oneclick_form(page):
                        return
                    # CTA already landed on oneclick (or DataDome wall). Do NOT
                    # hard-navigate again — a second hop looks like a bot.
                    if "oneclick-ui" in (page.url or ""):
                        if evidence is not None:
                            evidence.raw.setdefault("step_log", []).append({
                                "action": "reveal_form",
                                "locator": page.url,
                                "status": "ok",
                                "value_preview": "oneclick_after_cta_no_direct_nav",
                                "error": "",
                            })
                        return
                    break
            except Exception:
                continue

        app_url = ""
        if evidence is not None:
            app_url = str((evidence.raw or {}).get("application_url") or "").strip()
        on_oneclick = "oneclick-ui" in (page.url or "")
        # Only use direct oneclick nav when the CTA never moved us off the posting.
        if clicked and on_oneclick:
            return
        if "oneclick-ui" in app_url and not on_oneclick:
            try:
                resp = await page.goto(app_url, wait_until="domcontentloaded", timeout=30000)
                status = None if resp is None else getattr(resp, "status", None)
                body = ""
                try:
                    body = await page.locator("body").inner_text(timeout=3000)
                except Exception:
                    body = ""
                proxy_fail = (
                    is_proxy_connect_failure_status(status)
                    or is_proxy_connect_failure_text(body)
                )
                if evidence is not None:
                    evidence.raw.setdefault("step_log", []).append({
                        "action": "reveal_form",
                        "locator": app_url,
                        "status": "error" if proxy_fail else "ok",
                        "value_preview": "oneclick_direct_nav",
                        "error": (
                            f"Proxy could not reach target host (HTTP {status or 'page'})."
                            if proxy_fail
                            else ""
                        ),
                    })
                if not proxy_fail:
                    await self._wait_for_oneclick_form(page)
                return
            except Exception as exc:
                if evidence is not None:
                    evidence.raw.setdefault("step_log", []).append({
                        "action": "reveal_form",
                        "locator": app_url,
                        "status": "error",
                        "value_preview": "oneclick_direct_nav",
                        "error": str(exc)[:240],
                    })
        elif evidence is not None and not clicked:
            evidence.raw.setdefault("step_log", []).append({
                "action": "reveal_form",
                "locator": "apply_cta",
                "status": "not_found",
                "value_preview": "still_on_posting",
                "error": "Apply CTA not found and no oneclick URL available",
            })

    async def _apply_step(self, page: Any, step, documents: Dict[str, Any], evidence) -> None:
        if step.action == "check":
            preview = str(step.value or "")[:100]
            loc = await self._first_locator(page, step.locators)
            if loc is None:
                evidence.raw.setdefault("unmatched_steps", []).append(step.locators[:1])
                await self._log_step(evidence, action="check", locators=step.locators,
                                     status="not_found", value_preview=preview)
                return
            try:
                await page.evaluate(
                    """() => {
                      const host = document.querySelector('spl-checkbox[data-test="consent-box"]')
                        || document.querySelector('spl-checkbox');
                      if (!host) return false;
                      host.scrollIntoView({block:'center'});
                      const inp = host.shadowRoot && host.shadowRoot.querySelector('input[type=checkbox]');
                      if (inp) {
                        inp.checked = true;
                        inp.dispatchEvent(new Event('input', {bubbles:true}));
                        inp.dispatchEvent(new Event('change', {bubbles:true}));
                        inp.click();
                      }
                      host.setAttribute('value', 'true');
                      try { host.click(); } catch (e) {}
                      return true;
                    }"""
                )
                box = await loc.bounding_box()
                if box and 0 <= box["y"] <= 4000:
                    await page.mouse.click(box["x"] + 10, box["y"] + box["height"] / 2)
                await self._log_step(evidence, action="check", locators=step.locators,
                                     status="ok", value_preview=preview)
                return
            except Exception as exc:
                await self._log_step(evidence, action="check", locators=step.locators,
                                     status="error", value_preview=preview, error=str(exc))
                return
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
        # Prefer visible text "Envoyer" — role name can match empty primary buttons.
        selectors = ['button:has-text("Envoyer")', *list(_SUBMIT_SELECTORS)]
        loc = await self._first_locator(page, selectors)
        if loc is None:
            # Deep shadow click (SAP spl-button).
            clicked = await page.evaluate(
                """() => {
                  function textOf(el) {
                    return ((el.innerText || el.textContent || '') + ' '
                      + (el.getAttribute('aria-label') || '')).trim();
                  }
                  function deep(root, out=[]) {
                    root.querySelectorAll('button, [role=button], spl-button, .c-spl-button')
                      .forEach(el => out.push(el));
                    root.querySelectorAll('*').forEach(el => {
                      if (el.shadowRoot) deep(el.shadowRoot, out);
                    });
                    return out;
                  }
                  const hit = deep(document).find(b => textOf(b) === 'Envoyer'
                    || textOf(b).includes('Envoyer'));
                  if (!hit) return false;
                  hit.scrollIntoView({block:'center'});
                  hit.click();
                  const inner = hit.shadowRoot && hit.shadowRoot.querySelector('button');
                  if (inner) inner.click();
                  return true;
                }"""
            )
            if clicked:
                evidence.submit_performed = True
                await self._log_step(evidence, action="submit", locators=selectors, status="ok",
                                     error="shadow_js_click")
                return
            evidence.raw["submit"] = "button_not_found"
            await self._log_step(evidence, action="submit", locators=selectors, status="not_found")
            return
        try:
            await loc.evaluate("el => el.scrollIntoView({block:'center'})")
        except Exception:
            pass
        try:
            box = await loc.bounding_box()
            if box:
                await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            else:
                await human_click(loc, page)
            evidence.submit_performed = True
            await self._log_step(evidence, action="submit", locators=selectors, status="ok")
        except Exception:
            try:
                await loc.click(timeout=5000, force=True)
                evidence.submit_performed = True
                await self._log_step(evidence, action="submit", locators=selectors,
                                     status="ok", error="forced_click")
            except Exception as exc:
                evidence.raw["submit_error"] = str(exc)[:200]
                await self._log_step(evidence, action="submit", locators=selectors,
                                     status="error", error=str(exc))


DRIVER_REGISTRY.register(SmartRecruitersApplyDriver())
