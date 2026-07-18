"""TeamTailor careersite application form driver."""
from __future__ import annotations

import re
from typing import Any, Dict, List

from application_blueprint import (
    ApplicationBlueprint,
    FieldType,
    derive_complexity,
    estimate_compatibility_score,
)

from ..driver import DRIVER_REGISTRY, BrowserApplyDriver
from ..models import compute_blueprint_signature
from ._html_forms import classify_label, fetch_html, host_matches, job_http_url, nf, slug_key


def _standard_fields() -> List:
    return [
        nf("first_name", FieldType.FIRST_NAME, required=True, label="Prénom",
           binding='#candidate_first_name, input[name="candidate[first_name]"]'),
        nf("last_name", FieldType.LAST_NAME, required=True, label="Nom",
           binding='#candidate_last_name, input[name="candidate[last_name]"]'),
        nf("email", FieldType.EMAIL, required=True, label="E-mail",
           binding='#candidate_email, input[name="candidate[email]"]'),
        nf("phone", FieldType.PHONE, required=True, label="Téléphone",
           binding='#candidate_phone, input[name="candidate[phone]"]'),
        nf("resume", FieldType.RESUME, required=True, label="Importer un CV",
           binding='#candidate_resume_remote_url, #upload_resume_field input[type="file"]'),
        nf("cover_letter", FieldType.TEXTAREA, required=False, label="Lettre de motivation",
           binding='#candidate_job_applications_attributes_0_cover_letter, textarea[name*="cover_letter"]'),
        nf("consent", FieldType.CONSENT, required=True, label="Politique de confidentialité",
           binding='#candidate_consent_given, input[name="candidate[consent_given]"]'),
    ]


def _parse_screening_questions(html: str) -> List:
    fields = []
    for match in re.finditer(
        r'<div class="question[^"]*"[^>]*data-question-uuid="([^"]+)"[^>]*data-question-mandatory="([^"]+)"[^>]*>(.*?)</div>\s*</div>',
        html,
        flags=re.I | re.S,
    ):
        uuid, mandatory, body = match.group(1), match.group(2).lower() == "true", match.group(3)
        label_m = re.search(r'<legend[^>]*>.*?<span class="block">([^<]+)', body, flags=re.I | re.S)
        if not label_m:
            label_m = re.search(r'<label[^>]*>([^<]+)', body, flags=re.I)
        if not label_m:
            continue
        label = re.sub(r"\s+", " ", label_m.group(1)).strip()
        label = re.sub(r"\*$", "", label).strip()
        if not label:
            continue
        if "answers_attributes" not in body:
            continue
        if 'type="radio"' in body or "forms--inputs--boolean" in body:
            name_m = re.search(r'name="(candidate\[answers_attributes\]\[\d+\]\[boolean\])"', body)
            binding = (
                f'input[name="{name_m.group(1)}"][value="true"]'
                if name_m
                else f'[data-question-uuid="{uuid}"] input[type="radio"][value="true"]'
            )
            ftype = FieldType.CHECKBOX
        elif 'type="date"' in body:
            name_m = re.search(r'name="(candidate\[answers_attributes\]\[\d+\]\[date\])"', body)
            binding = (
                f'input[name="{name_m.group(1)}"]'
                if name_m
                else f'[data-question-uuid="{uuid}"] input[type="date"]'
            )
            ftype = FieldType.TEXT
        else:
            name_m = re.search(r'name="(candidate\[answers_attributes\]\[\d+\]\[text\])"', body)
            binding = (
                f'input[name="{name_m.group(1)}"]'
                if name_m
                else f'[data-question-uuid="{uuid}"] input[type="text"]'
            )
            ftype = classify_label(label, widget="text")
        key = f"q_{slug_key(label, uuid[:8])}"
        fields.append(nf(key, ftype, required=mandatory, label=label, binding=binding, sensitive=True))
    return fields


class TeamtailorApplyDriver(BrowserApplyDriver):
    provider = "teamtailor"
    version = "teamtailor-1.0.0"

    def can_handle(self, job: Dict[str, Any]) -> bool:
        provider = str(job.get("ats_provider") or job.get("provider") or "").lower()
        if provider == "teamtailor":
            return True
        url = self.application_url(job)
        return host_matches(url, "teamtailor.com")

    def application_url(self, job: Dict[str, Any]) -> str:
        return job_http_url(
            job,
            "external_url", "selected_apply_url", "apply_url", "application_url",
            "source_url", "url", "absolute_url", "job_url",
        )

    def _form_url(self, job: Dict[str, Any]) -> str:
        url = self.application_url(job)
        if not url:
            return ""
        if "/applications/new" in url:
            return url
        if re.search(r"/jobs/\d+", url):
            base = url.split("?")[0].rstrip("/")
            return f"{base}/applications/new"
        return url

    async def inspect_application(self, job: Dict[str, Any]) -> ApplicationBlueprint:
        fields = list(_standard_fields())
        form_url = self._form_url(job)
        try:
            html = await fetch_html(form_url)
            if html:
                fields.extend(_parse_screening_questions(html))
        except Exception:
            pass
        return ApplicationBlueprint(
            provider="teamtailor",
            fields=fields,
            complexity=derive_complexity(fields),
            estimated_compatibility_score=estimate_compatibility_score(fields, []),
            blockers=[],
            signature=compute_blueprint_signature(fields),
        )

    async def reveal_form(self, page: Any, evidence: Any = None) -> None:
        for selector in (
            'a[href*="/applications/new"]',
            'button:has-text("Postuler")',
            'a:has-text("Postuler")',
            'button:has-text("Apply")',
            '#job-application-form',
        ):
            try:
                loc = page.locator(selector)
                if await loc.count():
                    tag = await loc.first.evaluate("el => el.tagName")
                    if tag and tag.lower() in {"a", "button"}:
                        await loc.first.click(timeout=3000)
                        await page.wait_for_timeout(600)
                    return
            except Exception:
                continue
        try:
            form_url = self._form_url({"external_url": page.url})
            if form_url and form_url != page.url:
                await page.goto(form_url, wait_until="domcontentloaded", timeout=20000)
        except Exception:
            pass


DRIVER_REGISTRY.register(TeamtailorApplyDriver())
