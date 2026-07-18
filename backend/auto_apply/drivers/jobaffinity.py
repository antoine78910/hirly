"""JobAffinity apply form driver."""
from __future__ import annotations

from typing import Any, Dict, List

from application_blueprint import (
    ApplicationBlueprint,
    FieldType,
    derive_complexity,
    estimate_compatibility_score,
)

from ..driver import DRIVER_REGISTRY, BrowserApplyDriver
from ..models import compute_blueprint_signature
from ._html_forms import host_matches, job_http_url, nf


def _standard_fields() -> List:
    return [
        nf(
            "title",
            FieldType.SELECT,
            required=True,
            label="Civilité",
            binding='#form_title, select[name="title"]',
            options=["M.", "Mme", "Mlle"],
            sensitive=True,
        ),
        nf("last_name", FieldType.LAST_NAME, required=True, label="Nom de famille",
           binding='#form_lastname, input[name="lastName"]'),
        nf("first_name", FieldType.FIRST_NAME, required=True, label="Prénom",
           binding='#form_firstname, input[name="firstName"]'),
        nf("email", FieldType.EMAIL, required=True, label="Email",
           binding='#form_eMail, input[name="eMail"]'),
        nf("address", FieldType.LOCATION, required=False, label="Adresse",
           binding='#form_address, input[name="address"]'),
        nf("postal_code", FieldType.TEXT, required=False, label="Code postal",
           binding='#form_postalCode, input[name="postalCode"]', sensitive=False),
        nf("town", FieldType.TEXT, required=False, label="Ville",
           binding='#form_town, input[name="town"]', sensitive=False),
        nf("country", FieldType.SELECT, required=False, label="Pays",
           binding='#form_country, select[name="country"]', sensitive=False),
        nf("mobile_phone", FieldType.PHONE, required=False, label="Téléphone mobile",
           binding='#form_mobilePhone, input[name="mobilePhone"]'),
        nf("home_phone", FieldType.PHONE, required=False, label="Téléphone domicile",
           binding='#form_homePhone, input[name="homePhone"]'),
        nf("resume", FieldType.RESUME, required=True, label="CV",
           binding='#form_cv, #cv-section input[type="file"], input#form_cv'),
        nf("availability", FieldType.SELECT, required=False, label="Disponibilité",
           binding='#availability, select[name="availability"]',
           options=["Immédiate", "Préavis de 15 jours", "Préavis de 1 mois", "Préavis de 2 mois",
                    "Préavis de 3 mois", "Préavis > 3 mois", "Disponible à partir du...", "A l'écoute", "Pas Disponible"],
           sensitive=True),
        nf("salary", FieldType.SALARY_EXPECTATION, required=False, label="Salaire annuel",
           binding='#form_salary_1337, input[name="salary_1337"]'),
        nf("experience", FieldType.TEXT, required=False, label="Années d'expérience",
           binding='#form_experience, input[name="experience"]', sensitive=True),
        nf("comment", FieldType.TEXTAREA, required=False, label="Informations complémentaires",
           binding='#form_comment, textarea[name="comment"]'),
        nf("consent", FieldType.CONSENT, required=False, label="Conditions d'utilisation des données personnelles",
           binding='#js-legal-notice-control-form'),
    ]


class JobAffinityApplyDriver(BrowserApplyDriver):
    provider = "jobaffinity"
    version = "jobaffinity-1.0.0"

    def can_handle(self, job: Dict[str, Any]) -> bool:
        provider = str(job.get("ats_provider") or job.get("provider") or "").lower()
        if provider == "jobaffinity":
            return True
        url = self.application_url(job)
        return host_matches(url, "jobaffinity.fr")

    def application_url(self, job: Dict[str, Any]) -> str:
        return job_http_url(
            job,
            "external_url", "selected_apply_url", "apply_url", "application_url",
            "source_url", "url", "absolute_url", "job_url",
        )

    async def inspect_application(self, job: Dict[str, Any]) -> ApplicationBlueprint:
        fields = list(_standard_fields())
        return ApplicationBlueprint(
            provider="jobaffinity",
            fields=fields,
            complexity=derive_complexity(fields),
            estimated_compatibility_score=estimate_compatibility_score(fields, []),
            blockers=[],
            signature=compute_blueprint_signature(fields),
        )

    async def reveal_form(self, page: Any, evidence: Any = None) -> None:
        for selector in (
            'a[href*="/apply/"]',
            'a[href*="jobaffinity"]',
            'button:has-text("Postuler")',
            'input[type="submit"][value="Valider"]',
            '#identity',
        ):
            try:
                loc = page.locator(selector)
                if await loc.count():
                    tag = await loc.first.evaluate("el => el.tagName")
                    if tag and tag.lower() in {"a", "button"}:
                        await loc.first.click(timeout=3000)
                        await page.wait_for_timeout(400)
                    return
            except Exception:
                continue


DRIVER_REGISTRY.register(JobAffinityApplyDriver())
