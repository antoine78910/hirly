"""Taleez apply-form driver (app-apply-form Angular widgets)."""
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
from ._html_forms import classify_label, host_matches, job_http_url, nf, slug_key


def _standard_fields() -> List:
    return [
        nf("first_name", FieldType.FIRST_NAME, required=True, label="Prénom", binding='input[name="fname"], #fname input, tz-input#fname input'),
        nf("last_name", FieldType.LAST_NAME, required=True, label="Nom", binding='input[name="lname"], tz-input[name="lname"] input'),
        nf("email", FieldType.EMAIL, required=True, label="Email", binding='input[name="email"], #email input, tz-input#email input'),
        nf("phone", FieldType.PHONE, required=True, label="Téléphone", binding='tz-input-phone input.tz-input, tz-input-phone input[type="text"]'),
        nf("social_links", FieldType.LINKEDIN, required=False, label="Liens sociaux", binding='tz-social-links input', sensitive=False),
        nf("motivation", FieldType.TEXTAREA, required=False, label="Texte de motivation", binding='tz-textarea textarea, textarea.tz-textarea'),
        nf("resume", FieldType.RESUME, required=True, label="CV", binding='tz-drag-file input[type="file"], input[type="file"]'),
        nf(
            "consent",
            FieldType.CONSENT,
            required=False,
            label="Conditions générales d'utilisation",
            binding='a[href*="conditions-generales"]',
            sensitive=False,
        ),
    ]


def _parse_custom_questions(html: str) -> List:
    fields = []
    # tz-form-question blocks with label spans
    for match in re.finditer(
        r'<tz-form-question[^>]*>.*?<label([^>]*)>.*?<span>([^<]+)</span>.*?</tz-form-question>',
        html,
        flags=re.I | re.S,
    ):
        label_attrs, label = match.group(1), match.group(2).strip()
        if not label:
            continue
        cl = label.lower()
        if cl in {"cv", "texte de motivation", "liens sociaux"}:
            continue
        required = "required" in label_attrs.lower() or 'class="required"' in match.group(0).lower()[:200]
        block = match.group(0)
        if "tz-select" in block or "tz-select-list" in block:
            widget = "select"
        elif "tz-datepicker" in block or 'type="date"' in block:
            widget = "date"
        elif "tz-textarea" in block or "<textarea" in block:
            widget = "textarea"
        elif "tz-drag-file" in block:
            continue
        else:
            widget = "text"
        ftype = classify_label(label, widget=widget)
        key = slug_key(label, "custom")
        binding = f'tz-form-question:has(span:text-is("{label}")) tz-select, tz-form-question:has(label:has-text("{label}")) input, tz-form-question:has(label:has-text("{label}")) textarea'
        # Prefer role-based for planner fallbacks
        if widget == "select":
            binding = f'tz-form-question:has-text("{label}") tz-select, tz-form-question:has-text("{label}") .trigger'
        elif widget == "date":
            binding = f'tz-form-question:has-text("{label}") tz-datepicker input, tz-form-question:has-text("{label}") input.mat-datepicker-input'
        elif widget == "textarea":
            binding = f'tz-form-question:has-text("{label}") textarea'
        else:
            binding = f'tz-form-question:has-text("{label}") input'
        fields.append(nf(key, ftype, required=required, label=label, binding=binding))
    return fields


class TaleezApplyDriver(BrowserApplyDriver):
    provider = "taleez"
    version = "taleez-1.0.0"

    def can_handle(self, job: Dict[str, Any]) -> bool:
        provider = str(job.get("ats_provider") or job.get("provider") or "").lower()
        if provider == "taleez":
            return True
        url = self.application_url(job)
        return host_matches(url, "taleez.com")

    def application_url(self, job: Dict[str, Any]) -> str:
        return job_http_url(
            job,
            "external_url", "selected_apply_url", "apply_url", "application_url",
            "source_url", "url", "absolute_url", "job_url",
        )

    async def inspect_application(self, job: Dict[str, Any]) -> ApplicationBlueprint:
        fields = list(_standard_fields())
        url = self.application_url(job)
        try:
            from ._html_forms import fetch_html
            html = await fetch_html(url)
            # Prefer the apply form URL if listing page
            if html and "app-apply-form" not in html and "/apply/" not in url:
                m = re.search(r'href="([^"]*/apply/[^"]+)"', html)
                if m:
                    from urllib.parse import urljoin
                    html = await fetch_html(urljoin(url, m.group(1)))
            if html:
                custom = _parse_custom_questions(html)
                known = {f.key for f in fields}
                for field in custom:
                    if field.key not in known:
                        fields.append(field)
                        known.add(field.key)
        except Exception:
            # Fall back to common required custom questions from the template.
            fields.extend([
                nf("education_level", FieldType.SELECT, required=False, label="Votre niveau d'étude",
                   binding='tz-form-question:has-text("niveau d\'étude") tz-select'),
                nf("experience_level", FieldType.SELECT, required=False, label="Votre expérience",
                   binding='tz-form-question:has-text("Votre expérience") tz-select'),
                nf("availability_date", FieldType.TEXT, required=True, label="Votre disponibilité",
                   binding='tz-form-question:has-text("disponibilité") input'),
                nf("salary_expectation", FieldType.SALARY_EXPECTATION, required=True,
                   label="Salaire souhaité (brut par an)",
                   binding='tz-form-question:has-text("Salaire") tz-select'),
            ])
        return ApplicationBlueprint(
            provider="taleez",
            fields=fields,
            complexity=derive_complexity(fields),
            estimated_compatibility_score=estimate_compatibility_score(fields, []),
            blockers=[],
            signature=compute_blueprint_signature(fields),
        )

    async def reveal_form(self, page: Any, evidence: Any = None) -> None:
        for selector in (
            'a[href*="/apply/"]',
            'button:has-text("Postuler")',
            'a:has-text("Postuler")',
            'button:has-text("Je postule")',
        ):
            try:
                loc = page.locator(selector)
                if await loc.count():
                    await loc.first.click(timeout=3000)
                    await page.wait_for_timeout(500)
                    return
            except Exception:
                continue


DRIVER_REGISTRY.register(TaleezApplyDriver())
