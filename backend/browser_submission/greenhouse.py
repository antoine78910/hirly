"""Playwright-based Greenhouse hosted application form experiment."""

from __future__ import annotations

import logging
import re
import json
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from application_documents import cover_letter_to_text
from llm_client import LLMProviderNotConfigured, complete_json_text

from .base import BrowserFile
from .lever import LeverBrowserSubmissionEngine
from .matching import application_summary_text, canonical, generated_answer_map, is_sensitive_field, suggested_profile_key

logger = logging.getLogger(__name__)


class GreenhouseBrowserSubmissionEngine(LeverBrowserSubmissionEngine):
    provider = "greenhouse"
    engine_version = "greenhouse_form_intelligence_pipeline_v1_2026_06_11"

    FIELD_CLASSIFICATIONS = {
        "first_name",
        "last_name",
        "preferred_name",
        "email",
        "phone",
        "phone_country_code",
        "country",
        "city_location",
        "resume_upload",
        "cover_letter_upload",
        "linkedin_url",
        "website_url",
        "portfolio_url",
        "education_school",
        "education_degree",
        "education_discipline",
        "education_graduation_year",
        "referral_source",
        "privacy_consent",
        "work_authorization",
        "sponsorship",
        "current_location_eligibility",
        "former_company_history",
        "relocation",
        "start_date",
        "salary_expectation",
        "eeo_gender",
        "eeo_race",
        "eeo_veteran",
        "eeo_disability",
        "eeo_lgbtq",
        "custom_motivation_question",
        "unknown_required",
        "unknown_optional",
    }

    async def prepare_fill(
        self,
        *,
        job: dict[str, Any],
        app_doc: dict[str, Any],
        profile: dict[str, Any],
        user: dict[str, Any],
        click_submit: bool = False,
    ):
        self._greenhouse_form_scrape = []
        self._greenhouse_answer_plan = []
        self._greenhouse_plan_by_selector = {}
        self._greenhouse_conditional_ignored = []
        self._greenhouse_latest_field_fill_debug = []
        result = await super().prepare_fill(
            job=job,
            app_doc=app_doc,
            profile=profile,
            user=user,
            click_submit=click_submit,
        )
        result.form_scrape = list(getattr(self, "_greenhouse_form_scrape", []) or [])
        result.answer_plan = list(getattr(self, "_greenhouse_answer_plan", []) or [])
        result.failed_fields = self._pipeline_failed_fields(result)
        result.verification_summary = self._pipeline_verification_summary(result)
        logger.info(
            "greenhouse_form_intelligence_summary result=%s",
            self._safe_json(result.verification_summary)[:12000],
        )
        return result

    def _after_fields_detected(self, url: str, fields: list[dict[str, Any]]) -> None:
        models = [self._field_model(field) for field in fields if field.get("visible")]
        logger.info("greenhouse_field_model url=%s fields=%s", url, self._safe_json(models)[:20000])
        logger.info(
            "greenhouse_field_classification url=%s classifications=%s",
            url,
            self._safe_json([
                {
                    "selector": item.get("selector"),
                    "field_id": item.get("field_id"),
                    "label": item.get("label"),
                    "normalized_label": item.get("normalized_label"),
                    "field_group": item.get("field_group"),
                    "required": item.get("required"),
                    "safe_to_autofill": item.get("safe_to_autofill"),
                    "reason_if_not_fillable": item.get("reason_if_not_fillable"),
                }
                for item in models
            ])[:20000],
        )

    def _match_field(
        self,
        field: dict[str, Any],
        profile: dict[str, Any],
        app_doc: dict[str, Any],
        user: dict[str, Any],
    ) -> Optional[dict[str, Any]]:
        if field.get("disabled") or not field.get("visible"):
            if str(field.get("type") or "").lower() != "file":
                return None

        model = self._field_model(field)
        resolution = self._resolve_field_answer(model, field, profile, app_doc, user)
        self._record_answer_plan(field, model, resolution)
        if not resolution.get("safe_to_autofill"):
            return None
        value = resolution.get("value")
        if value in (None, ""):
            return None
        fill = {
            "value": str(value),
            "source": resolution.get("answer_source") or "greenhouse.unknown",
            "confidence": resolution.get("confidence") or 0.0,
            "field_group": model.get("field_group"),
            "reason_if_not_fillable": resolution.get("reason_if_not_fillable"),
        }
        valid, reason = self.validate_value_for_field(field, fill, str(value))
        if not valid:
            logger.warning(
                "greenhouse_fill_rejected field=%s",
                self._safe_json({
                    "label": model.get("label"),
                    "field_group": model.get("field_group"),
                    "answer_source": fill.get("source"),
                    "attempted_value_preview": self._safe_value_preview(value),
                    "reason": reason,
                }),
            )
            return None
        return fill

    def _record_answer_plan(self, field: dict[str, Any], model: dict[str, Any], resolution: dict[str, Any]) -> None:
        plan = {
            "selector": field.get("selector"),
            "stable_field_id": field.get("stable_field_id") or self._field_cache_key(field),
            "field_id": field.get("id") or field.get("name"),
            "label": field.get("label") or "",
            "classification": model.get("field_group"),
            "planned_answer": self._safe_planned_answer_preview(resolution.get("value")),
            "source": resolution.get("answer_source") or (
                "user_required" if field.get("required") else None
            ),
            "confidence": resolution.get("confidence") or 0.0,
            "safe_to_autofill": bool(resolution.get("safe_to_autofill")),
            "reason_if_not_fillable": resolution.get("reason_if_not_fillable"),
            "suggested_profile_key": suggested_profile_key(field),
            "widget_type": model.get("widget_type") or self._widget_type(field),
            "required": bool(field.get("required")),
            "options": field.get("options") or [],
            "current_value": field.get("value_before") or field.get("current_value") or "",
        }
        key = self._field_cache_key(field)
        plan_by_selector = getattr(self, "_greenhouse_plan_by_selector", {})
        plan_by_selector[key] = plan
        self._greenhouse_plan_by_selector = plan_by_selector
        existing = [
            item for item in getattr(self, "_greenhouse_answer_plan", [])
            if item.get("stable_field_id") != plan["stable_field_id"]
        ]
        existing.append(plan)
        self._greenhouse_answer_plan = existing

    def _safe_planned_answer_preview(self, value: Any) -> Any:
        if value in (None, ""):
            return None
        if value in ("__resume_file__", "__cover_letter_file__"):
            return value
        text = str(value)
        return text if len(text) <= 160 else text[:157] + "..."

    def _field_model(self, field: dict[str, Any]) -> dict[str, Any]:
        cache_key = self._field_cache_key(field)
        cached = getattr(self, "_greenhouse_field_model_cache", {}).get(cache_key)
        if cached:
            return {**cached}
        normalized_label = self._greenhouse_field_key(field)
        classification = self._classify_field_with_confidence(field)
        field_group = classification["classification"]
        safe, reason = self._autofill_policy(field_group, field, normalized_label)
        return {
            "selector": field.get("selector"),
            "stable_field_id": field.get("stable_field_id") or self._field_cache_key(field),
            "field_id": field.get("id") or field.get("name"),
            "label": field.get("label") or "",
            "normalized_label": normalized_label,
            "direct_identity": self._raw_field_key(field),
            "input_type": str(field.get("type") or "text").lower(),
            "widget_type": self._widget_type(field),
            "field_group": field_group,
            "required": bool(field.get("required")),
            "options": field.get("options") or [],
            "current_value": field.get("value_before") or "",
            "confidence": classification["confidence"],
            "classification_source": classification["source"],
            "classification_reason": classification["reason"],
            "needs_explicit_user_answer": classification.get("needs_explicit_user_answer", False),
            "answer_source": None,
            "safe_to_autofill": safe,
            "reason_if_not_fillable": reason,
        }

    def _classify_field(self, field: dict[str, Any], label: str) -> str:
        return self._classify_field_with_confidence(field)["classification"]

    def _classify_field_with_confidence(self, field: dict[str, Any]) -> dict[str, Any]:
        direct = self._raw_field_key(field)
        full = self._greenhouse_field_key(field)
        field_type = str(field.get("type") or "text").lower()
        authoritative = self._authoritative_field_group(field)
        if authoritative:
            return self._classification(authoritative, 0.99, "deterministic_direct", "authoritative field identity")
        if field_type == "file":
            if self._label_has_all(direct or full, ("cover", "letter")):
                return self._classification("cover_letter_upload", 0.98, "deterministic_direct", "file cover letter")
            if self._label_has_any(direct or full, ("resume", "cv", "curriculum vitae")):
                return self._classification("resume_upload", 0.99, "deterministic_direct", "file resume")
            return self._classification("unknown_optional", 0.4, "deterministic_direct", "unrecognized file input")
        if field_type == "email":
            return self._classification("email", 0.99, "deterministic_direct", "email input type")
        if field_type == "tel":
            return self._classification("phone", 0.99, "deterministic_direct", "tel input type")
        if field_type == "url":
            if self._label_has_any(direct, ("linkedin", "linked in")):
                return self._classification("linkedin_url", 0.99, "deterministic_direct", "url input linkedin identity")
            if self._label_has_any(direct, ("portfolio",)):
                return self._classification("portfolio_url", 0.95, "deterministic_direct", "url input portfolio identity")
            return self._classification("website_url", 0.9, "deterministic_direct", "url input type")

        direct_result = self._direct_identity_classification(field, direct)
        if direct_result:
            return direct_result

        fallback_result = self._context_fallback_classification(field, full)
        if fallback_result:
            return fallback_result
        return self._classification("unknown_required" if field.get("required") else "unknown_optional", 0.25, "deterministic_unknown", "no deterministic match")

    def _direct_identity_classification(self, field: dict[str, Any], label: str) -> Optional[dict[str, Any]]:
        if not label:
            return None
        if self._is_first_name_field(label):
            return self._classification("first_name", 0.98, "deterministic_direct", "first name identity")
        if self._is_last_name_field(label):
            return self._classification("last_name", 0.98, "deterministic_direct", "last name identity")
        if any(term in label for term in ("preferred name", "chosen name")):
            return self._classification("preferred_name", 0.95, "deterministic_direct", "preferred name identity")
        if self._is_email_field(label):
            return self._classification("email", 0.98, "deterministic_direct", "email identity")
        if self._is_phone_country_code_field(label):
            return self._classification("phone_country_code", 0.95, "deterministic_direct", "phone country code identity")
        if self._is_phone_field(label):
            return self._classification("phone", 0.95, "deterministic_direct", "phone identity")
        if any(term in label for term in ("country of residence", "residence country", "current country")):
            return self._classification("country", 0.92, "deterministic_direct", "country identity")
        if self._is_location_field(label):
            return self._classification("city_location", 0.9, "deterministic_direct", "location identity")
        if self._is_referral_source_field(label):
            return self._classification("referral_source", 0.95, "deterministic_direct", "referral/source identity")
        if self._label_has_any(label, ("linkedin", "linked in")):
            return self._classification("linkedin_url", 0.95, "deterministic_direct", "linkedin identity")
        if self._label_has_any(label, ("portfolio",)):
            return self._classification("portfolio_url", 0.9, "deterministic_direct", "portfolio identity")
        if self._label_has_any(label, ("website", "personal site", "github")):
            return self._classification("website_url", 0.88, "deterministic_direct", "website identity")
        if self._is_education_school_field(label):
            return self._classification("education_school", 0.9, "deterministic_direct", "education school identity", True)
        if self._is_education_degree_field(label):
            return self._classification("education_degree", 0.9, "deterministic_direct", "education degree identity", True)
        if self._is_education_discipline_field(label):
            return self._classification("education_discipline", 0.9, "deterministic_direct", "education discipline identity", True)
        if self._is_education_graduation_year_field(label):
            return self._classification("education_graduation_year", 0.9, "deterministic_direct", "education graduation year identity", True)
        if self._is_motivation_question(label):
            return self._classification("custom_motivation_question", 0.92, "deterministic_direct", "motivation question")
        if self._is_location_eligibility_question(label):
            return self._classification("current_location_eligibility", 0.92, "deterministic_direct", "current location eligibility question", True)
        if self._is_former_company_history_question(label):
            return self._classification("former_company_history", 0.94, "deterministic_direct", "former company history question", True)
        if any(term in label for term in ("authorized to work", "legally authorized", "eligible to work", "work authorization")):
            return self._classification("work_authorization", 0.94, "deterministic_direct", "work authorization question", True)
        if any(term in label for term in ("visa sponsorship", "require sponsorship", "sponsor", "immigration support")):
            return self._classification("sponsorship", 0.94, "deterministic_direct", "sponsorship question", True)
        if any(term in label for term in ("onsite", "on site", "hybrid", "office", "commute")):
            return self._classification("current_location_eligibility", 0.82, "deterministic_direct", "location/office eligibility question", True)
        if "relocation" in label or "relocate" in label:
            return self._classification("relocation", 0.9, "deterministic_direct", "relocation question", True)
        if "start date" in label or "available to start" in label:
            return self._classification("start_date", 0.9, "deterministic_direct", "start date question", True)
        if any(term in label for term in ("salary", "compensation", "pay expectation")):
            return self._classification("salary_expectation", 0.9, "deterministic_direct", "salary question", True)
        if "gender" in label:
            return self._classification("eeo_gender", 0.9, "deterministic_direct", "gender demographic")
        if any(term in label for term in ("race", "ethnicity", "hispanic")):
            return self._classification("eeo_race", 0.9, "deterministic_direct", "race/ethnicity demographic")
        if "veteran" in label:
            return self._classification("eeo_veteran", 0.9, "deterministic_direct", "veteran demographic")
        if "disability" in label:
            return self._classification("eeo_disability", 0.9, "deterministic_direct", "disability demographic")
        if any(term in label for term in ("lgbtq", "sexual orientation")):
            return self._classification("eeo_lgbtq", 0.9, "deterministic_direct", "lgbtq demographic")
        if self._is_safe_privacy_consent_field(label):
            return self._classification("privacy_consent", 0.92, "deterministic_direct", "privacy consent")
        return None

    def _context_fallback_classification(self, field: dict[str, Any], label: str) -> Optional[dict[str, Any]]:
        if not label:
            return None
        if self._is_motivation_question(label):
            return self._classification("custom_motivation_question", 0.72, "deterministic_context", "motivation context")
        if self._is_location_eligibility_question(label):
            return self._classification("current_location_eligibility", 0.72, "deterministic_context", "location eligibility context", True)
        if self._is_former_company_history_question(label):
            return self._classification("former_company_history", 0.78, "deterministic_context", "former company history context", True)
        if self._is_safe_privacy_consent_field(label):
            return self._classification("privacy_consent", 0.7, "deterministic_context", "privacy consent context")
        if any(term in label for term in ("authorized to work", "legally authorized", "eligible to work", "work authorization")):
            return self._classification("work_authorization", 0.75, "deterministic_context", "work authorization context", True)
        if any(term in label for term in ("visa sponsorship", "require sponsorship", "sponsor", "immigration support")):
            return self._classification("sponsorship", 0.75, "deterministic_context", "sponsorship context", True)
        if any(term in label for term in ("gender", "race", "ethnicity", "hispanic", "veteran", "disability", "sexual orientation")):
            return self._direct_identity_classification(field, label)
        if any(term in label for term in ("school", "degree", "discipline", "field of study", "graduation year")):
            return self._direct_identity_classification(field, label)
        return None

    def _classification(
        self,
        classification: str,
        confidence: float,
        source: str,
        reason: str,
        needs_explicit_user_answer: bool = False,
    ) -> dict[str, Any]:
        return {
            "classification": classification,
            "confidence": confidence,
            "source": source,
            "reason": reason,
            "needs_explicit_user_answer": needs_explicit_user_answer,
        }

    async def _prepare_field_models(
        self,
        url: str,
        fields: list[dict[str, Any]],
        job: dict[str, Any],
        app_doc: dict[str, Any],
        profile: dict[str, Any],
        user: dict[str, Any],
    ) -> None:
        cache: dict[str, dict[str, Any]] = {}
        form_scrape: list[dict[str, Any]] = []
        llm_fallback_count = 0
        for field in fields:
            if not field.get("visible"):
                continue
            model = self._field_model_uncached(field)
            if self._should_use_llm_classifier(model, field):
                llm_result = await self._llm_classify_field(field, job)
                if llm_result:
                    model = self._model_with_llm_classification(model, field, llm_result)
                    llm_fallback_count += 1
            label = model.get("normalized_label") or self._greenhouse_field_key(field)
            if model.get("field_group") == "unknown_required":
                if self._is_education_school_field(label):
                    model = self._model_with_overrides(model, field, field_group="education_school", classification_reason="education school fallback")
                elif self._is_education_degree_field(label):
                    model = self._model_with_overrides(model, field, field_group="education_degree", classification_reason="education degree fallback")
                elif self._is_education_discipline_field(label):
                    model = self._model_with_overrides(model, field, field_group="education_discipline", classification_reason="education discipline fallback")
                elif self._is_education_graduation_year_field(label):
                    model = self._model_with_overrides(model, field, field_group="education_graduation_year", classification_reason="education graduation year fallback")
            cache[self._field_cache_key(field)] = model
            form_scrape.append(self._form_scrape_item(field, model))
        self._greenhouse_field_model_cache = cache
        self._greenhouse_form_scrape = form_scrape
        logger.info(
            "greenhouse_llm_classification_summary url=%s llm_fallback_count=%s total_visible_fields=%s",
            url,
            llm_fallback_count,
            len(cache),
        )
        logger.info("greenhouse_form_scrape url=%s fields=%s", url, self._safe_json(form_scrape)[:24000])

    def _field_model_uncached(self, field: dict[str, Any]) -> dict[str, Any]:
        cache = getattr(self, "_greenhouse_field_model_cache", None)
        try:
            self._greenhouse_field_model_cache = {}
            return self._field_model(field)
        finally:
            if cache is not None:
                self._greenhouse_field_model_cache = cache
            elif hasattr(self, "_greenhouse_field_model_cache"):
                delattr(self, "_greenhouse_field_model_cache")

    def _model_with_overrides(self, model: dict[str, Any], field: dict[str, Any], **updates: Any) -> dict[str, Any]:
        merged = {**model, **updates}
        safe, reason = self._autofill_policy(str(merged.get("field_group") or ""), field, model.get("normalized_label") or "")
        merged["safe_to_autofill"] = safe
        merged["reason_if_not_fillable"] = reason
        return merged

    def _widget_type(self, field: dict[str, Any]) -> str:
        widget = str(field.get("widget_type") or "").strip().lower()
        if widget:
            return widget
        field_type = str(field.get("type") or "text").lower()
        role = str(field.get("role") or "").lower()
        label = self._greenhouse_field_key(field)
        if field_type == "file":
            return "file_upload"
        if field_type in ("textarea", "contenteditable"):
            return "textarea"
        if field_type == "select":
            return "select"
        if field_type == "combobox" or role == "combobox":
            return "combobox"
        if field_type in ("radio", "checkbox"):
            return field_type
        if field_type == "tel" and any(term in label for term in ("country code", "phone code", "dial code", "prefix")):
            return "phone_widget"
        return "input"

    def _form_scrape_item(self, field: dict[str, Any], model: dict[str, Any]) -> dict[str, Any]:
        return {
            "selector": field.get("selector"),
            "stable_field_id": field.get("stable_field_id") or self._field_cache_key(field),
            "field_id": field.get("id") or field.get("name"),
            "label": field.get("label") or "",
            "aria_label": field.get("aria_label") or "",
            "placeholder": field.get("placeholder") or "",
            "name": field.get("name") or "",
            "id": field.get("id") or "",
            "input_type": str(field.get("type") or "text").lower(),
            "required_marker": bool(field.get("required_marker") or field.get("required")),
            "required": bool(field.get("required")),
            "options": field.get("options") or [],
            "current_value": field.get("value_before") or field.get("current_value") or "",
            "surrounding_question_text": field.get("surrounding_question_text") or field.get("field_container_text") or field.get("nearby_text") or "",
            "widget_type": model.get("widget_type") or self._widget_type(field),
            "classification": model.get("field_group"),
            "conditional_hint": bool(field.get("conditional_hint")),
            "hidden_container": bool(field.get("hidden_container")),
        }

    def _should_use_llm_classifier(self, model: dict[str, Any], field: dict[str, Any]) -> bool:
        if not field.get("required"):
            return False
        if model.get("field_group") not in ("unknown_required", "unknown_optional"):
            return False
        return float(model.get("confidence") or 0) < 0.65

    async def _llm_classify_field(self, field: dict[str, Any], job: dict[str, Any]) -> Optional[dict[str, Any]]:
        prompt = {
            "allowed_classifications": sorted(self.FIELD_CLASSIFICATIONS),
            "field": {
                "label": field.get("label") or "",
                "aria_label": field.get("aria_label") or "",
                "placeholder": field.get("placeholder") or "",
                "id": field.get("id") or "",
                "name": field.get("name") or "",
                "type": field.get("type") or "",
                "options": field.get("options") or [],
                "required": bool(field.get("required")),
                "nearby_text_context_only": str(field.get("nearby_text") or "")[:800],
                "container_text_context_only": str(field.get("field_container_text") or "")[:1200],
            },
            "job": {
                "company": job.get("company") or "",
                "title": job.get("title") or "",
                "location": job.get("location") or "",
            },
            "rules": [
                "Use label/aria_label/id/name/placeholder/type as primary identity.",
                "Use nearby/container text only as context.",
                "Return unknown_required if unsure.",
                "Do not classify legal/factual/demographic fields as motivation.",
            ],
        }
        system = (
            "You classify Greenhouse application form fields. Return only JSON with keys: "
            "classification, confidence, can_autofill, needs_explicit_user_answer, "
            "suggested_profile_key, reason. Never invent user answers."
        )
        try:
            raw = await complete_json_text(system, json.dumps(prompt, ensure_ascii=True))
            parsed = json.loads(raw)
        except LLMProviderNotConfigured:
            logger.info("greenhouse_llm_classifier_skipped reason=llm_not_configured field=%s", self._safe_json(self._field_debug_identity(field)))
            return None
        except Exception as exc:
            logger.warning("greenhouse_llm_classifier_failed error=%s field=%s", f"{exc.__class__.__name__}: {exc}"[:300], self._safe_json(self._field_debug_identity(field)))
            return None
        classification = str(parsed.get("classification") or "").strip()
        if classification not in self.FIELD_CLASSIFICATIONS:
            return None
        try:
            confidence = float(parsed.get("confidence") or 0)
        except Exception:
            confidence = 0.0
        return {
            "classification": classification,
            "confidence": max(0.0, min(1.0, confidence)),
            "can_autofill": bool(parsed.get("can_autofill")),
            "needs_explicit_user_answer": bool(parsed.get("needs_explicit_user_answer")),
            "suggested_profile_key": parsed.get("suggested_profile_key"),
            "reason": str(parsed.get("reason") or "llm classification"),
        }

    def _model_with_llm_classification(self, model: dict[str, Any], field: dict[str, Any], llm_result: dict[str, Any]) -> dict[str, Any]:
        classification = str(llm_result.get("classification") or model.get("field_group"))
        safe, reason = self._autofill_policy(classification, field, model.get("normalized_label") or "")
        updated = {
            **model,
            "field_group": classification,
            "confidence": llm_result.get("confidence") or 0.0,
            "classification_source": "llm_fallback",
            "classification_reason": llm_result.get("reason") or "llm fallback",
            "needs_explicit_user_answer": bool(llm_result.get("needs_explicit_user_answer")),
            "suggested_profile_key": llm_result.get("suggested_profile_key"),
            "safe_to_autofill": safe,
            "reason_if_not_fillable": reason,
        }
        logger.info(
            "greenhouse_llm_field_classification field=%s",
            self._safe_json({
                **self._field_debug_identity(field),
                "classification": updated.get("field_group"),
                "confidence": updated.get("confidence"),
                "needs_explicit_user_answer": updated.get("needs_explicit_user_answer"),
                "reason": updated.get("classification_reason"),
            }),
        )
        return updated

    def _autofill_policy(self, field_group: str, field: dict[str, Any], label: str) -> tuple[bool, Optional[str]]:
        never_guess = {
            "work_authorization",
            "sponsorship",
            "current_location_eligibility",
            "former_company_history",
            "relocation",
            "start_date",
            "salary_expectation",
        }
        if field_group in never_guess:
            return True, "requires_explicit_profile_default"
        if field_group.startswith("eeo_"):
            return True, "safe_only_if_decline_option_available"
        if field_group in {"education_school", "education_degree", "education_discipline", "education_graduation_year"}:
            return True, "requires_profile_education_default"
        if field_group == "unknown_required":
            return False, "unknown_required_field"
        if field_group == "unknown_optional":
            return False, "unknown_optional_field"
        return True, None

    def _resolve_field_answer(
        self,
        model: dict[str, Any],
        field: dict[str, Any],
        profile: dict[str, Any],
        app_doc: dict[str, Any],
        user: dict[str, Any],
    ) -> dict[str, Any]:
        group = model["field_group"]
        canonical_applicant = self._canonical_applicant(profile, app_doc, user)
        defaults = profile.get("application_defaults") or {}
        answers_profile = profile.get("application_answers_profile") or {}
        prepared_answer = self._prepared_answer_for_field(field, app_doc)

        def resolved(value: Any, source: str, confidence: float = 0.95) -> dict[str, Any]:
            return {
                **model,
                "value": value,
                "answer_source": source,
                "confidence": confidence,
                "safe_to_autofill": value not in (None, ""),
                "reason_if_not_fillable": None if value not in (None, "") else "answer_missing",
            }

        if group in ("first_name", "last_name", "preferred_name", "email", "phone", "city_location", "country"):
            key = {
                "first_name": "first_name",
                "last_name": "last_name",
                "preferred_name": "first_name",
                "email": "email",
                "phone": "phone",
                "city_location": "location",
                "country": "country",
            }[group]
            if group == "country":
                value = prepared_answer or defaults.get("country") or defaults.get("current_location_country") or canonical_applicant.get("country")
                source = "prepared_application_payload" if prepared_answer else ("profile.application_defaults.country" if value == defaults.get("country") else "profile.contact.country")
                return resolved(value, source, 0.95)
            if group == "city_location":
                value = prepared_answer or defaults.get("city") or defaults.get("current_location_city") or canonical_applicant.get("city") or canonical_applicant.get("location")
                source = "prepared_application_payload" if prepared_answer else ("profile.application_defaults.city" if value == defaults.get("city") else "profile.contact.location")
                return resolved(value, source, 0.9)
            return resolved(canonical_applicant.get(key), f"profile.contact.{key}", 1.0 if group in ("first_name", "last_name", "email") else 0.9)

        if group == "phone_country_code":
            value = defaults.get("phone_country_code") or self._phone_country_code_value(field, canonical_applicant.get("phone") or "", profile)
            return resolved(value, "profile.application_defaults.phone_country_code" if defaults.get("phone_country_code") else "profile.phone_country_code", 0.9)

        if group == "resume_upload":
            return resolved("__resume_file__", "application.tailored_cv_file", 1.0)
        if group == "cover_letter_upload":
            return resolved("__cover_letter_file__", "application.cover_letter_file", 0.95)

        if group == "linkedin_url":
            value = defaults.get("linkedin_url") or canonical_applicant.get("linkedin_url")
            source = "profile.application_defaults.linkedin_url" if defaults.get("linkedin_url") else "profile.contact.linkedin"
            return resolved(value, source, 0.95)
        if group in ("website_url", "portfolio_url"):
            value, source = self._website_value_for_field(group, field, canonical_applicant, profile)
            return resolved(value, source, 0.9) if value else self._not_fillable(model, "required_website_missing")

        if group in {"education_school", "education_degree", "education_discipline", "education_graduation_year"}:
            value, source = self._education_value_for_group(group, field, profile, answers_profile, prepared_answer)
            return resolved(value, source, 0.92) if value not in (None, "") else self._not_fillable(model, f"{group}_missing")

        if group == "referral_source":
            if prepared_answer:
                return resolved(prepared_answer, "prepared_application_payload", 0.95)
            default = defaults.get("referral_source")
            value = self._option_value(field, tuple(str(item) for item in (default, "Swiipr", "Other", "Other website", "Job board", "Online") if item)) or default or "Swiipr"
            return resolved(value, "profile.application_defaults.referral_source" if default else "safe_default.referral_source", 0.95)
        if group == "privacy_consent":
            if prepared_answer:
                return resolved(prepared_answer, "prepared_application_payload", 0.95)
            default = defaults.get("privacy_consent")
            value = self._option_value(field, tuple(str(item) for item in (default, "I agree", "Agree", "Yes", "true") if item)) or default or "I agree"
            return resolved(value, "profile.application_defaults.privacy_consent" if default else "safe_default.privacy_consent", 0.95)

        if group.startswith("eeo_"):
            if prepared_answer:
                return resolved(prepared_answer, "prepared_application_payload", 0.95)
            default_key = group
            default = defaults.get(default_key)
            if default not in (None, ""):
                value = self._option_value(field, (str(default),)) or default
                return resolved(value, f"profile.application_defaults.{default_key}", 0.95)
            if not defaults.get("prefer_not_to_say_demographics"):
                return self._not_fillable(model, "explicit_demographic_default_required")
            decline = self._option_value(field, (
                "i do not wish to answer",
                "decline to self identify",
                "decline to self-identify",
                "prefer not to say",
                "i don't wish to answer",
                "choose not to disclose",
                "i choose not to disclose",
            )) or "Prefer not to say"
            return resolved(decline, "safe_default.eeo_decline", 0.9) if decline else self._not_fillable(model, "demographic_decline_option_missing")

        default_key = suggested_profile_key(field)
        if group == "work_authorization":
            value = prepared_answer or self._work_authorization_default(field, defaults, answers_profile)
            source = "prepared_application_payload" if prepared_answer else "profile.application_defaults.work_authorized_countries"
            return resolved(value, source, 0.95) if value not in (None, "") else self._not_fillable(model, "explicit_work_authorization_required")
        if group == "sponsorship":
            value = prepared_answer or defaults.get("requires_sponsorship") or defaults.get(default_key) or answers_profile.get("requires_sponsorship_now") or answers_profile.get("requires_sponsorship_future")
            source = "prepared_application_payload" if prepared_answer else "profile.application_defaults.requires_sponsorship"
            return resolved(value, source, 0.95) if value not in (None, "") else self._not_fillable(model, "explicit_sponsorship_answer_required")
        if group == "current_location_eligibility":
            value = prepared_answer or defaults.get(default_key) or defaults.get("current_location_city") or defaults.get("current_location_country") or answers_profile.get("willing_to_relocate")
            source = "prepared_application_payload" if prepared_answer else f"profile.application_defaults.{default_key or 'current_location'}"
            return resolved(value, source, 0.9) if value not in (None, "") else self._not_fillable(model, "explicit_location_eligibility_required")
        if group == "former_company_history":
            value = (
                prepared_answer
                or defaults.get(default_key)
                or defaults.get("former_company_history")
                or defaults.get("former_employer_restriction_or_noncompete")
            )
            source = "prepared_application_payload" if prepared_answer else f"profile.application_defaults.{default_key or 'former_company_history'}"
            return resolved(value, source, 0.9) if value not in (None, "") else self._not_fillable(model, "explicit_former_company_history_required")
        if group == "relocation":
            value = prepared_answer or defaults.get("willing_to_relocate") or defaults.get(default_key) or answers_profile.get("willing_to_relocate")
            source = "prepared_application_payload" if prepared_answer else "profile.application_defaults.willing_to_relocate"
            return resolved(value, source, 0.9) if value not in (None, "") else self._not_fillable(model, "explicit_relocation_answer_required")
        if group == "start_date":
            value = defaults.get(default_key) or answers_profile.get("earliest_start_date")
            return resolved(value, f"profile.application_defaults.{default_key or 'start_date'}", 0.9) if value not in (None, "") else self._not_fillable(model, "explicit_start_date_required")
        if group == "salary_expectation":
            value = defaults.get(default_key) or answers_profile.get("salary_expectation")
            return resolved(value, f"profile.application_defaults.{default_key or 'salary_expectation'}", 0.9) if value not in (None, "") else self._not_fillable(model, "explicit_salary_expectation_required")

        if group == "custom_motivation_question":
            generated = generated_answer_map(app_doc)
            label = model.get("normalized_label") or ""
            for answer_key, answer in generated.items():
                if answer_key and (answer_key in label or label in answer_key):
                    return resolved(self._concise_motivation_answer(str(answer), app_doc), "application.generated_answers", 0.82)
            text = self._concise_motivation_answer("", app_doc)
            return resolved(text, "application.motivation_summary", 0.78) if text.strip() else self._not_fillable(model, "application_text_missing")

        return self._not_fillable(model, model.get("reason_if_not_fillable") or "not_fillable")

    def _canonical_applicant(self, profile: dict[str, Any], app_doc: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
        normalized = self._normalized_profile(profile, user)
        location = normalized.get("location") or ""
        city = location.split(",")[0].strip() if location else ""
        cover_letter_text = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
        return {
            "first_name": normalized.get("first_name") or "",
            "last_name": normalized.get("last_name") or "",
            "full_name": " ".join(part for part in (normalized.get("first_name"), normalized.get("last_name")) if part).strip(),
            "email": normalized.get("email") or "",
            "phone": normalized.get("phone") or "",
            "phone_country_code": None,
            "country": normalized.get("country") or "",
            "country_code": normalized.get("country_code") or "",
            "city": city,
            "location": location,
            "linkedin_url": normalized.get("linkedin") or "",
            "website_url": normalized.get("website") or "",
            "portfolio_url": normalized.get("portfolio") or "",
            "resume_file": bool(app_doc.get("tailored_cv_file_b64") or app_doc.get("tailored_cv_text") or app_doc.get("tailored_resume_structured")),
            "cover_letter_file": bool(cover_letter_text),
            "cover_letter_text": cover_letter_text,
            "application_defaults": profile.get("application_defaults") or {},
            "application_answers_profile": profile.get("application_answers_profile") or {},
        }

    def _website_value_for_field(
        self,
        group: str,
        field: dict[str, Any],
        canonical_applicant: dict[str, Any],
        profile: dict[str, Any],
    ) -> tuple[Optional[str], str]:
        contact = profile.get("contact") or {}
        defaults = profile.get("application_defaults") or {}
        label = self._greenhouse_field_key(field)
        website_candidates = [
            defaults.get("website_url"),
            defaults.get("portfolio_url") if group == "portfolio_url" else None,
            contact.get("website"),
            contact.get("personal_website"),
            contact.get("portfolio"),
            contact.get("portfolio_url"),
            contact.get("github"),
            contact.get("github_url"),
            canonical_applicant.get("website_url"),
            canonical_applicant.get("portfolio_url"),
        ]
        for candidate in website_candidates:
            normalized = self._normalize_url(candidate)
            if normalized:
                source = "profile.application_defaults.website_url" if candidate in (defaults.get("website_url"), defaults.get("portfolio_url")) else "profile.contact.website"
                return normalized, source
        linkedin = canonical_applicant.get("linkedin_url")
        if linkedin and ("linkedin" in label or "linked in" in label or "portfolio" in label):
            return linkedin, "profile.contact.linkedin"
        return None, "profile.contact.website"

    def _education_value_for_group(
        self,
        group: str,
        field: dict[str, Any],
        profile: dict[str, Any],
        answers_profile: dict[str, Any],
        prepared_answer: Any,
    ) -> tuple[Optional[str], str]:
        if prepared_answer not in (None, ""):
            return str(prepared_answer), "prepared_application_payload"
        defaults = profile.get("application_defaults") or {}
        key_map = {
            "education_school": ("education_school", "school"),
            "education_degree": ("education_degree", "degree"),
            "education_discipline": ("education_discipline", "education_field_of_study", "field_of_study", "discipline"),
            "education_graduation_year": ("education_graduation_year", "graduation_year", "grad_year", "year"),
        }
        for key in key_map.get(group, ()):
            value = defaults.get(key)
            if value not in (None, ""):
                return str(value), f"profile.application_defaults.{key}"
            value = answers_profile.get(key)
            if value not in (None, ""):
                return str(value), f"profile.application_answers_profile.{key}"

        education_items = profile.get("education") or []
        if isinstance(education_items, dict):
            education_items = [education_items]
        for item in education_items:
            if not isinstance(item, dict):
                continue
            value = None
            if group == "education_school":
                value = item.get("school") or item.get("institution") or item.get("university") or item.get("college")
            elif group == "education_degree":
                value = item.get("degree") or item.get("qualification")
            elif group == "education_discipline":
                value = item.get("discipline") or item.get("field_of_study") or item.get("major") or item.get("subject")
            elif group == "education_graduation_year":
                value = item.get("graduation_year") or item.get("year") or item.get("end_year") or item.get("end_date")
            if value not in (None, ""):
                return str(value), "profile.education"
        return None, f"profile.application_defaults.{key_map.get(group, (group,))[0]}"

    def validate_value_for_field(self, field: dict[str, Any], fill: Optional[dict[str, Any]], value: Any) -> tuple[bool, str]:
        model = self._field_model(field)
        group = str((fill or {}).get("field_group") or model.get("field_group") or "")
        authoritative = self._authoritative_field_group(field)
        if authoritative and authoritative != group:
            return False, f"field_group_conflicts_with_authoritative_identity:{authoritative}"
        source = str((fill or {}).get("source") or "")
        text = str(value or "").strip()
        options = field.get("options") or []

        if not text:
            return False, "empty_value"
        if group == "resume_upload":
            return (text == "__resume_file__"), "resume_upload_requires_resume_file_sentinel"
        if group == "cover_letter_upload":
            return (text == "__cover_letter_file__"), "cover_letter_upload_requires_cover_letter_file_sentinel"

        if group == "email":
            if source != "profile.contact.email":
                return False, "email_field_requires_canonical_email_source"
            if not self._is_valid_email(text):
                return False, "email_field_value_is_not_email"
            if self._looks_like_name(text) or self._looks_like_phone(text) or self._looks_like_url(text):
                return False, "email_field_value_has_wrong_shape"
            return True, ""

        if group in ("first_name", "last_name", "preferred_name"):
            if not source.startswith("profile.contact."):
                return False, "name_field_requires_contact_name_source"
            if self._is_valid_email(text) or self._looks_like_url(text) or self._looks_like_phone(text):
                return False, "name_field_value_has_wrong_shape"
            if group in ("first_name", "last_name") and " " in text.strip() and len(text.strip().split()) > 3:
                return False, "name_field_value_too_broad"
            return True, ""

        if group == "phone":
            if source != "profile.contact.phone":
                return False, "phone_field_requires_canonical_phone_source"
            if not self._looks_like_phone(text) or self._looks_like_name(text) or self._is_valid_email(text):
                return False, "phone_field_value_has_wrong_shape"
            return True, ""

        if group == "phone_country_code":
            if not (text.startswith("+") or text.isdigit() or self._looks_like_country(text)):
                return False, "phone_country_code_value_has_wrong_shape"
            return self._value_matches_options_or_no_options(field, text)

        if group in ("linkedin_url", "website_url", "portfolio_url"):
            if group == "linkedin_url" and source not in ("profile.contact.linkedin", "profile.application_defaults.linkedin_url"):
                return False, "linkedin_field_requires_linkedin_source"
            if group in ("website_url", "portfolio_url") and not (
                source.startswith("profile.contact.")
                or source.startswith("profile.application_defaults.")
                or source == "prepared_application_payload"
            ):
                return False, "url_field_requires_profile_url_source"
            if not self._is_valid_url(text):
                return False, "url_field_value_is_invalid"
            if group == "linkedin_url" and "linkedin.com" not in urlparse(text).netloc.lower():
                return False, "linkedin_field_requires_linkedin_url"
            return True, ""

        if group in {"education_school", "education_degree", "education_discipline", "education_graduation_year"}:
            if not (
                source.startswith("profile.education")
                or source.startswith("profile.application_defaults.")
                or source.startswith("profile.application_answers_profile.")
                or source == "prepared_application_payload"
            ):
                return False, "education_field_requires_profile_education_source"
            if self._is_valid_email(text) or self._looks_like_phone(text) or self._looks_like_url(text):
                return False, "education_field_value_has_wrong_shape"
            if group == "education_graduation_year":
                return bool(re.search(r"\b(19|20)\d{2}\b", text) or len(text) <= 30), "education_graduation_year_invalid"
            return True, ""

        if group == "country":
            if source not in ("profile.contact.country", "profile.application_defaults.country", "prepared_application_payload"):
                return False, "country_field_requires_canonical_country_source"
            if self._is_valid_email(text) or self._looks_like_url(text) or self._looks_like_phone(text):
                return False, "country_field_value_has_wrong_shape"
            if options:
                return self._value_matches_options_or_no_options(field, text)
            return (bool(text) and len(text) <= 80), "country_value_invalid"

        if group == "city_location":
            if source not in ("profile.contact.location", "profile.application_defaults.city", "prepared_application_payload"):
                return False, "location_field_requires_canonical_location_source"
            if self._is_valid_email(text) or self._looks_like_url(text) or self._looks_like_phone(text):
                return False, "location_field_value_has_wrong_shape"
            return True, ""

        if group in ("referral_source", "privacy_consent"):
            if not (source.startswith("safe_default.") or source.startswith("profile.application_defaults.") or source == "prepared_application_payload"):
                return False, "safe_default_field_requires_safe_default_source"
            if group == "privacy_consent" and str(field.get("type") or "").lower() in ("checkbox", "radio"):
                return True, ""
            if options:
                return self._value_matches_options_or_no_options(field, text)
            return True, ""

        legal_groups = {
            "work_authorization",
            "sponsorship",
            "current_location_eligibility",
            "former_company_history",
            "relocation",
            "start_date",
            "salary_expectation",
        }
        if group in legal_groups:
            if not (source.startswith("profile.application_defaults.") or source.startswith("profile.application_answers_profile.") or source == "prepared_application_payload"):
                return False, "legal_factual_field_requires_explicit_saved_answer"
            if options:
                return self._value_matches_options_or_no_options(field, text)
            return True, ""

        if group.startswith("eeo_"):
            if not (source.startswith("safe_default.eeo_decline") or source.startswith("profile.application_defaults.") or source == "prepared_application_payload"):
                return False, "eeo_field_requires_saved_default_or_decline_option"
            if options:
                return self._value_matches_options_or_no_options(field, text)
            return (source.startswith("safe_default.eeo_decline") and canonical(text) in {
                "prefer not to say",
                "decline to self identify",
                "decline to self-identify",
                "i do not wish to answer",
                "choose not to disclose",
                "i choose not to disclose",
                "i dont wish to answer",
                "self describe later",
                "self-describe later",
                "prefer to self describe",
                "prefer to self-describe",
                "not listed",
                "none of the above",
            }) or source.startswith("profile.application_defaults.") or source == "prepared_application_payload", "eeo_field_requires_known_option"

        if group == "custom_motivation_question":
            if not (source.startswith("application.") or source == "application.generated_answers"):
                return False, "motivation_field_requires_application_text_source"
            if is_sensitive_field(field):
                return False, "motivation_text_not_allowed_for_sensitive_field"
            if self._is_valid_email(text) or self._looks_like_phone(text):
                return False, "motivation_field_value_has_wrong_shape"
            return True, ""

        return False, f"unsupported_field_group:{group}"

    def _validate_fill_before_attempt(self, field: dict[str, Any], fill: dict[str, Any]) -> tuple[bool, str]:
        return self.validate_value_for_field(field, fill, fill.get("value"))

    def _validate_fill_after_attempt(self, field: dict[str, Any], fill: dict[str, Any], value_after: str) -> tuple[bool, str]:
        group = str(fill.get("field_group") or self._field_model(field).get("field_group") or "")
        if group in ("resume_upload", "cover_letter_upload"):
            return bool(str(value_after or "").strip()), "file_upload_missing_after_fill"
        if group in ("checkbox", "radio"):
            return True, ""
        if group == "phone_country_code" and not str(value_after or "").strip():
            return self.validate_value_for_field(field, fill, fill.get("value"))
        actual = str(value_after or "").strip()
        if not actual:
            return False, "empty_after_fill"
        return self.validate_value_for_field(field, fill, actual)

    def _log_fill_rejected(self, field: dict[str, Any], fill: Optional[dict[str, Any]], reason: str) -> None:
        model = self._field_model(field)
        logger.warning(
            "greenhouse_fill_rejected field=%s",
            self._safe_json({
                "label": model.get("label"),
                "field_group": model.get("field_group"),
                "answer_source": fill.get("source") if fill else None,
                "attempted_value_preview": self._safe_value_preview(fill.get("value") if fill else ""),
                "reason": reason,
            }),
        )

    def _not_fillable(self, model: dict[str, Any], reason: str) -> dict[str, Any]:
        return {
            **model,
            "value": None,
            "answer_source": None,
            "confidence": 0.0,
            "safe_to_autofill": False,
            "reason_if_not_fillable": reason,
        }

    def _normalized_profile(self, profile: dict[str, Any], user: dict[str, Any]) -> dict[str, str]:
        contact = profile.get("contact") or {}
        first_name, last_name = self._candidate_name_parts(profile, user)
        location_data = profile.get("target_location_data") or {}
        email = self._normalize_email(contact.get("email") or user.get("email"))
        phone = self._normalize_phone(contact.get("phone"))
        linkedin = self._normalize_url(contact.get("linkedin"), require_linkedin=True)
        if not linkedin:
            linkedin = self._normalize_linkedin_profile_url(contact.get("linkedin"))
        website = self._normalize_url(contact.get("website") or contact.get("github") or contact.get("github_url"))
        portfolio = self._normalize_url(contact.get("portfolio") or contact.get("portfolio_url"))
        return {
            "first_name": first_name.strip(),
            "last_name": last_name.strip(),
            "email": email,
            "phone": phone,
            "location": str(contact.get("location") or location_data.get("location_label") or profile.get("target_location") or "").strip(),
            "country": str(location_data.get("country") or contact.get("country") or "").strip(),
            "country_code": str(location_data.get("country_code") or "").strip().lower(),
            "linkedin": linkedin,
            "website": website,
            "portfolio": portfolio,
        }

    def _is_valid_email(self, value: Any) -> bool:
        return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(value or "").strip()))

    def _is_valid_url(self, value: Any) -> bool:
        text = str(value or "").strip()
        if not text or re.search(r"\s", text):
            return False
        parsed = urlparse(text)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc) and "." in parsed.netloc

    def _looks_like_url(self, value: Any) -> bool:
        text = str(value or "").strip().lower()
        if "@" in text:
            return False
        return text.startswith(("http://", "https://")) or "www." in text or ".com" in text or ".io" in text

    def _looks_like_phone(self, value: Any) -> bool:
        text = str(value or "").strip()
        digits = re.sub(r"\D", "", text)
        return len(digits) >= 7 and bool(re.match(r"^\+?[0-9][0-9 .()/-]{5,}$", text))

    def _looks_like_name(self, value: Any) -> bool:
        text = str(value or "").strip()
        if not text or self._is_valid_email(text) or self._looks_like_url(text) or self._looks_like_phone(text):
            return False
        return bool(re.match(r"^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,80}$", text))

    def _looks_like_country(self, value: Any) -> bool:
        text = str(value or "").strip()
        if len(text) in (2, 3) and text.isalpha():
            return True
        return bool(re.match(r"^[A-Za-zÀ-ÖØ-öø-ÿ' -]{3,80}$", text))

    def _value_matches_options_or_no_options(self, field: dict[str, Any], value: Any) -> tuple[bool, str]:
        options = field.get("options") or []
        if not options:
            return True, ""
        wanted = canonical(value)
        if not wanted:
            return False, "option_value_empty"
        for option in options:
            if isinstance(option, dict):
                label = canonical(option.get("label") or option.get("value"))
                raw_value = canonical(option.get("value") or option.get("label"))
            else:
                label = canonical(option)
                raw_value = label
            if wanted and (wanted == label or wanted == raw_value or wanted in label or label in wanted):
                return True, ""
        return False, "value_not_in_available_options"

    def _normalize_email(self, value: Any) -> str:
        text = str(value or "").strip()
        if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", text):
            return text
        return ""

    def _normalize_phone(self, value: Any) -> str:
        text = re.sub(r"\s+", " ", str(value or "").strip())
        if not text:
            return ""
        if not re.match(r"^\+?[0-9][0-9 .()/-]{5,}$", text):
            return ""
        return text

    def _normalize_url(self, value: Any, require_linkedin: bool = False) -> str:
        text = str(value or "").strip()
        if not text or re.search(r"\s", text):
            return ""
        if "@" in text and not text.startswith(("http://", "https://")):
            return ""
        if not text.startswith(("http://", "https://")):
            if "." not in text:
                return ""
            text = "https://" + text
        parsed = urlparse(text)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or "." not in parsed.netloc:
            return ""
        if require_linkedin and "linkedin.com" not in parsed.netloc.lower():
            return ""
        return text

    def _normalize_linkedin_profile_url(self, value: Any) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        text = re.sub(r"\s+", "", text)
        if not text.startswith(("http://", "https://")):
            text = "https://" + text
        parsed = urlparse(text)
        if parsed.scheme not in ("http", "https") or "linkedin.com" not in parsed.netloc.lower():
            return ""
        return text

    def _log_answer_resolution(self, field: dict[str, Any], fill: Optional[dict[str, Any]]) -> None:
        model = self._field_model(field)
        logger.info(
            "greenhouse_answer_resolution field=%s",
            self._safe_json({
                "selector": model.get("selector"),
                "field_id": model.get("field_id"),
                "label": model.get("label"),
                "field_group": model.get("field_group"),
                "required": model.get("required"),
                "safe_to_autofill": bool(fill),
                "answer_source": fill.get("source") if fill else None,
                "confidence": fill.get("confidence") if fill else 0.0,
                "reason_if_not_fillable": fill.get("reason_if_not_fillable") if fill else model.get("reason_if_not_fillable"),
            }),
        )

    def _log_fill_attempt(
        self,
        field: dict[str, Any],
        fill: Optional[dict[str, Any]],
        success: bool,
        value_after: str,
        exc: Optional[Exception] = None,
    ) -> None:
        model = self._field_model(field)
        logger.info(
            "greenhouse_fill_attempts field=%s",
            self._safe_json({
                "selector": model.get("selector"),
                "field_id": model.get("field_id"),
                "label": model.get("label"),
                "field_group": model.get("field_group"),
                "answer_source": fill.get("source") if fill else None,
                "confidence": fill.get("confidence") if fill else 0.0,
                "attempted": bool(fill),
                "success": success,
                "value_after_present": bool(str(value_after or "").strip()),
                "error": f"{exc.__class__.__name__}: {exc}"[:300] if exc else None,
            }),
        )

    def _after_required_verification(
        self,
        fields_after: list[dict[str, Any]],
        unfilled_required_fields: list[dict[str, Any]],
        blockers: list[dict[str, Any]],
    ) -> None:
        ignored = self._filter_inactive_required_fields(fields_after, unfilled_required_fields, blockers)
        if ignored:
            current = list(getattr(self, "_greenhouse_conditional_ignored", []) or [])
            current.extend(ignored)
            self._greenhouse_conditional_ignored = current
            for item in ignored:
                logger.info("conditional_required_ignored field=%s", self._safe_json(item)[:4000])
        logger.info(
            "greenhouse_required_verification result=%s",
            self._safe_json({
                "required_count": sum(1 for field in fields_after if field.get("required") and field.get("visible") and not field.get("disabled")),
                "unfilled_required_count": len(unfilled_required_fields),
                "conditional_ignored_count": len(ignored),
                "unfilled_required": [
                    {
                        "label": field.get("label"),
                        "field_group": self._classify_field(field, self._greenhouse_field_key(field)),
                        "type": field.get("type"),
                        "options": field.get("options") or [],
                    }
                    for field in unfilled_required_fields
                ],
                "blocker_count": len(blockers),
            })[:12000],
        )

    def _filter_inactive_required_fields(
        self,
        fields_after: list[dict[str, Any]],
        unfilled_required_fields: list[dict[str, Any]],
        blockers: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        ignored: list[dict[str, Any]] = []
        phone_verified = self._phone_tel_field_verified(fields_after)
        successful_groups = self._successful_debug_groups()

        def should_ignore(field: dict[str, Any]) -> tuple[bool, str, Optional[str]]:
            if not field.get("visible") or field.get("disabled") or field.get("hidden_container"):
                return True, "hidden_or_disabled", None
            if phone_verified and self._is_duplicate_phone_widget(field):
                return True, "duplicate_phone_country_artifact", "phone_tel_verified"
            group = str(field.get("field_group") or field.get("classification") or "")
            if field.get("safe_to_autofill") and group and group in successful_groups:
                return True, "duplicate_verified_field_artifact", group
            if self._is_conditionally_inactive_field(field, fields_after):
                return True, "conditional_inactive", self._controlling_field_guess(field, fields_after)
            return False, "", None

        remove_keys: set[str] = set()
        remove_labels: set[str] = set()
        for field in list(unfilled_required_fields):
            ignore, reason, controller = should_ignore(field)
            if not ignore:
                continue
            key = self._field_match_key(field)
            remove_keys.add(key)
            if field.get("label"):
                remove_labels.add(canonical(field.get("label")))
            ignored.append({
                "label": field.get("label"),
                "selector": field.get("selector"),
                "stable_field_id": field.get("stable_field_id"),
                "reason": reason,
                "controlling_field_guess": controller,
            })

        if remove_keys:
            unfilled_required_fields[:] = [
                field for field in unfilled_required_fields
                if self._field_match_key(field) not in remove_keys
            ]
            blockers[:] = [
                item for item in blockers
                if (
                    self._field_match_key(item.get("field") or {}) not in remove_keys
                    and canonical((item.get("field") or {}).get("label")) not in remove_labels
                )
            ]
        return ignored

    def _successful_debug_groups(self) -> set[str]:
        groups: set[str] = set()
        for item in getattr(self, "_greenhouse_latest_field_fill_debug", []) or []:
            if item.get("attempted_fill") and item.get("fill_success"):
                group = str(item.get("classification") or "")
                if group:
                    groups.add(group)
        return groups

    def _field_match_key(self, field: dict[str, Any]) -> str:
        return str(field.get("stable_field_id") or field.get("selector") or field.get("name") or field.get("id") or field.get("label") or "")

    def _phone_tel_field_verified(self, fields_after: list[dict[str, Any]]) -> bool:
        for field in fields_after:
            if str(field.get("type") or "").lower() == "tel" and self._field_has_value(field):
                return True
        return False

    def _is_duplicate_phone_widget(self, field: dict[str, Any]) -> bool:
        label = self._greenhouse_field_key(field)
        field_type = str(field.get("type") or field.get("field_type") or "").lower()
        return (
            field_type == "combobox"
            and any(term in label for term in ("phone", "country code", "dial code", "select country"))
        )

    def _is_conditionally_inactive_field(self, field: dict[str, Any], fields_after: list[dict[str, Any]]) -> bool:
        label = self._greenhouse_field_key(field)
        if not (
            field.get("conditional_hint")
            or any(term in label for term in ("please specify", "if yes", "if other", "self describe", "self describe", "other"))
        ):
            return False
        if self._field_has_value(field):
            return False
        container = canonical(field.get("field_container_text") or field.get("surrounding_question_text") or "")
        if "please specify" in label and not self._nearby_self_describe_selected(field, fields_after):
            return True
        if any(term in label for term in ("if yes", "if other", "other", "self describe")) and not self._nearby_self_describe_selected(field, fields_after):
            return True
        if "please specify" in container and not self._nearby_self_describe_selected(field, fields_after):
            return True
        return False

    def _nearby_self_describe_selected(self, field: dict[str, Any], fields_after: list[dict[str, Any]]) -> bool:
        field_text = canonical(field.get("field_container_text") or field.get("surrounding_question_text") or field.get("nearby_text") or field.get("label") or "")
        if not field_text:
            return False
        for candidate in fields_after:
            if not candidate.get("visible") or candidate is field:
                continue
            value = canonical(candidate.get("value_before") or candidate.get("current_value") or "")
            text = canonical(candidate.get("field_container_text") or candidate.get("label") or "")
            if not value:
                continue
            if any(term in value for term in ("self describe", "self identify", "other", "not listed")):
                if text and (text in field_text or field_text in text or any(word in field_text for word in text.split()[:4])):
                    return True
        return False

    def _controlling_field_guess(self, field: dict[str, Any], fields_after: list[dict[str, Any]]) -> Optional[str]:
        field_text = canonical(field.get("field_container_text") or field.get("surrounding_question_text") or field.get("label") or "")
        for candidate in fields_after:
            if candidate is field or not candidate.get("visible"):
                continue
            candidate_text = canonical(candidate.get("label") or candidate.get("field_container_text") or "")
            if candidate_text and field_text and (candidate_text in field_text or field_text in candidate_text):
                return candidate.get("label") or candidate.get("name") or candidate.get("id")
        return None

    def _after_final_prepare_result(
        self,
        *,
        ready_for_final_click: bool,
        blockers: list[dict[str, Any]],
        unfilled_required_fields: list[dict[str, Any]],
        resume_uploaded: bool,
        final_click_candidate_selector: Optional[str],
        submit_disabled: bool,
    ) -> None:
        logger.info(
            "greenhouse_final_prepare_result result=%s",
            self._safe_json({
                "ready_for_final_click": ready_for_final_click,
                "blocker_count": len(blockers),
                "unfilled_required_count": len(unfilled_required_fields),
                "resume_uploaded": resume_uploaded,
                "final_click_candidate_selector": final_click_candidate_selector,
                "submit_disabled": submit_disabled,
            }),
        )

    async def _human_fill_text(self, page: Any, selector: str, value: str) -> None:
        if len(str(value or "")) < 180:
            await super()._human_fill_text(page, selector, value)
            return
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        try:
            await locator.fill(str(value), timeout=8000)
            return
        except Exception:
            pass
        await locator.evaluate(
            """(element, value) => {
                element.value = value;
                element.dispatchEvent(new Event("input", {bubbles: true}));
                element.dispatchEvent(new Event("change", {bubbles: true}));
            }""",
            str(value),
        )

    async def _read_field_value_after_fill(self, page: Any, field: dict[str, Any], fallback: str = "") -> str:
        if self._widget_type(field) in ("combobox", "phone_widget") or str(field.get("type") or "").lower() == "combobox":
            value = await self._combobox_value_snapshot(page, field)
            return value or fallback
        return await super()._read_field_value_after_fill(page, field, fallback)

    async def _select_option(self, page: Any, selector: str, value: str) -> bool:
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        selected_option = None
        try:
            await locator.select_option(label=value, timeout=3000)
            selected_option = value
            return await self._selected_value_matches(locator, value)
        except Exception:
            pass
        try:
            await locator.select_option(value=value, timeout=3000)
            selected_option = value
            return await self._selected_value_matches(locator, value)
        except Exception:
            pass
        try:
            selected_option = await locator.evaluate(
                """(element, value) => {
                    const canonical = (raw) => String(raw || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\\s+/g, ' ').trim();
                    const wanted = canonical(value);
                    const option = Array.from(element.options || []).find((item) => {
                        const label = canonical(item.label || item.textContent || '');
                        const val = canonical(item.value || '');
                        return label === wanted || val === wanted || label.includes(wanted) || wanted.includes(label);
                    });
                    if (!option) return null;
                    element.value = option.value;
                    element.dispatchEvent(new Event('input', {bubbles: true}));
                    element.dispatchEvent(new Event('change', {bubbles: true}));
                    return String(option.label || option.textContent || option.value || '');
                }""",
                value,
            )
            return await self._selected_value_matches(locator, value)
        except Exception:
            logger.info(
                "greenhouse_native_select_result field=%s",
                self._safe_json({
                    "selector": selector,
                    "planned_answer": self._safe_value_preview(value),
                    "selected_option": selected_option,
                    "success": False,
                }),
            )
            return False

    async def _selected_value_matches(self, locator: Any, value: str) -> bool:
        try:
            selected = await locator.evaluate(
                """(element) => {
                    const option = element.options && element.selectedIndex >= 0 ? element.options[element.selectedIndex] : null;
                    return String((option && (option.label || option.textContent || option.value)) || element.value || '');
                }"""
            )
            return self._canonical_values_match(selected, value)
        except Exception:
            return False

    async def _select_combobox_option(self, page: Any, field: dict[str, Any], value: str) -> bool:
        selector = field.get("selector")
        if not selector or not value:
            return False
        result = await self._select_combobox_option_with_details(page, field, value)
        details_by_key = getattr(self, "_greenhouse_combobox_debug_by_key", {})
        details_by_key[self._field_cache_key(field)] = result
        self._greenhouse_combobox_debug_by_key = details_by_key
        logger.info(
            "greenhouse_combobox_fill_result field=%s",
            self._safe_json(result)[:12000],
        )
        return bool(result.get("verified"))

    async def _select_combobox_option_with_details(self, page: Any, field: dict[str, Any], value: str) -> dict[str, Any]:
        selector = field.get("selector")
        model = self._field_model(field)
        result: dict[str, Any] = {
            **self._field_debug_identity(field),
            "field_group": model.get("field_group"),
            "planned_answer": self._safe_value_preview(value),
            "options_discovered": [],
            "best_match": None,
            "match_score": 0.0,
            "selected_option": None,
            "selected_or_not": False,
            "value_after_fill": "",
            "verified": False,
            "failure_reason": None,
        }
        if not selector or not value:
            result["failure_reason"] = "missing_selector_or_value"
            return result
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        if str(model.get("field_group") or "").startswith("eeo_"):
            preferred = None
        else:
            preferred = value

        try:
            await locator.click(timeout=5000)
            await page.wait_for_timeout(300)
        except Exception as exc:
            result["failure_reason"] = f"open_failed:{exc.__class__.__name__}"
            return result

        options = await self._extract_visible_combobox_options(page)
        match = self._best_combobox_option_match(options, preferred or value, model, field)
        selected = match.get("selected_option")
        if not selected:
            try:
                await locator.fill(str(value), timeout=4000)
            except Exception:
                try:
                    await locator.press_sequentially(str(value), timeout=5000)
                except Exception:
                    pass
            await page.wait_for_timeout(500)
            options = await self._extract_visible_combobox_options(page)
            searched_match = self._best_combobox_option_match(options, preferred or value, model, field)
            if float(searched_match.get("score") or 0) >= float(match.get("score") or 0):
                match = searched_match
                selected = match.get("selected_option")

        result["options_discovered"] = options[:40]
        result["best_match"] = match.get("best_match")
        result["match_score"] = match.get("score")
        result["selected_option"] = selected
        result["selected_or_not"] = bool(selected)
        if selected:
            clicked = await self._click_combobox_option_text(page, selected)
            if clicked:
                await page.wait_for_timeout(450)
            else:
                result["failure_reason"] = "option_click_failed"
        else:
            result["failure_reason"] = match.get("reason") or "matching_option_not_found"

        if not result["selected_option"]:
            try:
                await locator.press("Enter", timeout=2000)
                await page.wait_for_timeout(350)
            except Exception:
                pass

        value_after = await self._combobox_value_snapshot(page, field)
        result["value_after_fill"] = value_after
        expected = result["selected_option"] or value
        result["verified"] = await self._combobox_value_matches(page, selector, expected, field=field)
        if (
            not result["verified"]
            and result["selected_option"]
            and self._canonical_values_match(result["selected_option"], value)
            and not await self._combobox_required_error_visible(page, field)
        ):
            result["verified"] = True
        if not result["verified"] and result["failure_reason"] is None:
            result["failure_reason"] = "verification_failed"
        return result

    async def _select_eeo_decline_combobox_option(self, page: Any, field: dict[str, Any]) -> bool:
        selector = field.get("selector")
        if not selector:
            return False
        locator = page.locator(selector).first
        await self._human_scroll_to_locator(locator)
        try:
            await locator.click(timeout=5000)
            await page.wait_for_timeout(500)
        except Exception as exc:
            logger.info(
                "greenhouse_eeo_combobox_options field=%s",
                self._safe_json({
                    **self._field_debug_identity(field),
                    "options": [],
                    "selected_decline_option": None,
                    "success": False,
                    "error": f"{exc.__class__.__name__}: {exc}"[:300],
                }),
            )
            return False

        options = await self._extract_visible_combobox_options(page)
        decline = self._decline_option_from_options(options)
        logger.info(
            "greenhouse_eeo_combobox_options field=%s",
            self._safe_json({
                **self._field_debug_identity(field),
                "options": options,
                "selected_decline_option": decline,
                "success": bool(decline),
            })[:8000],
        )
        if not decline:
            return False

        clicked = await self._click_combobox_option_text(page, decline)
        if not clicked:
            return False
        await page.wait_for_timeout(350)
        return await self._combobox_value_matches(page, selector, decline)

    async def _extract_visible_combobox_options(self, page: Any) -> list[str]:
        try:
            values = await page.evaluate(
                """() => {
                    const visible = (el) => {
                        const style = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                    };
                    const selectors = [
                        '[role="option"]',
                        '[role="listbox"] [role="option"]',
                        '[role="menu"] [role="menuitem"]',
                        '[aria-selected]',
                        '[data-testid*="option"]',
                        '[id*="option"]',
                        '.select__option',
                        '[class*="option"]',
                        '[class*="menu"] [class*="item"]',
                        '.option',
                        'li'
                    ];
                    const seen = new Set();
                    const out = [];
                    for (const selector of selectors) {
                        for (const el of document.querySelectorAll(selector)) {
                            if (!visible(el)) continue;
                            const text = String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
                            if (!text || text.length > 180) continue;
                            const key = text.toLowerCase();
                            if (seen.has(key)) continue;
                            seen.add(key);
                            out.push(text);
                        }
                    }
                    return out.slice(0, 80);
                }"""
            )
            return [str(item).strip() for item in values if str(item).strip()]
        except Exception:
            return []

    def _combobox_equivalence_keys(self, value: Any) -> set[str]:
        raw = str(value or "")
        key = canonical(value)
        if not key:
            return set()
        groups = [
            {"united kingdom", "uk", "gb", "great britain", "england", "britain"},
            {"united states", "united states of america", "usa", "us", "america"},
            {"yes", "y", "true", "i agree", "agree", "authorized", "authorised"},
            {"no", "n", "false", "not authorized", "not authorised"},
            {
                "prefer not to say",
                "decline to self identify",
                "decline to self-identify",
                "i do not wish to answer",
                "i do not want to answer",
                "i dont wish to answer",
                "i don t wish to answer",
                "choose not to disclose",
                "i choose not to disclose",
            },
        ]
        out = {key}
        for group in groups:
            canonical_group = {canonical(item) for item in group}
            if key in canonical_group:
                out.update(canonical_group)
        if self._contains_dial_code(raw, "44"):
            out.update({"44", "uk", "united kingdom", "gb", "great britain"})
        if self._contains_dial_code(raw, "1"):
            out.update({"1", "us", "usa", "united states", "united states of america"})
        return {item for item in out if item}

    def _contains_dial_code(self, value: Any, code: str) -> bool:
        text = str(value or "")
        return bool(re.search(rf"(?<!\d)\+?{re.escape(code)}(?!\d)", text))

    def _safe_partial_option_match(self, option_key: str, wanted_key: str) -> bool:
        if not option_key or not wanted_key:
            return False
        if wanted_key.isdigit() or option_key.isdigit():
            return False
        if len(wanted_key) < 3 or len(option_key) < 3:
            return False
        return wanted_key in option_key or option_key in wanted_key

    def _canonical_values_match(self, actual: Any, expected: Any) -> bool:
        actual_key = canonical(actual)
        expected_key = canonical(expected)
        if not actual_key or not expected_key:
            return False
        actual_keys = self._combobox_equivalence_keys(actual_key)
        expected_keys = self._combobox_equivalence_keys(expected_key)
        if actual_keys & expected_keys:
            return True
        return self._safe_partial_option_match(actual_key, expected_key)

    def _best_combobox_option(self, options: list[str], value: str, model: dict[str, Any]) -> Optional[str]:
        return self._best_combobox_option_match(options, value, model, {}).get("selected_option")

    def _best_combobox_option_match(
        self,
        options: list[str],
        value: str,
        model: dict[str, Any],
        field: dict[str, Any],
    ) -> dict[str, Any]:
        cleaned = [str(option).strip() for option in options if str(option or "").strip()]
        if not cleaned:
            return {
                "selected_option": None,
                "best_match": None,
                "score": 0.0,
                "reason": "no_options",
            }
        planned = str(value or "").strip()
        if not planned:
            return {
                "selected_option": None,
                "best_match": None,
                "score": 0.0,
                "reason": "missing_planned_answer",
            }

        best_option = None
        best_score = 0.0
        best_reason = "no_match"
        for option in cleaned:
            score, reason = self._score_option_match(planned, option)
            if score > best_score:
                best_option = option
                best_score = score
                best_reason = reason

        threshold = 0.74
        if best_score >= threshold:
            return {
                "selected_option": best_option,
                "best_match": best_option,
                "score": round(best_score, 3),
                "reason": best_reason,
            }

        other = self._generic_other_option(cleaned)
        if other and self._should_select_other_option(field, planned, cleaned):
            return {
                "selected_option": other,
                "best_match": best_option,
                "score": round(best_score, 3),
                "reason": "selected_other_for_explicit_unmatched_answer",
            }

        return {
            "selected_option": None,
            "best_match": best_option,
            "score": round(best_score, 3),
            "reason": f"low_confidence_option_match:{best_reason}",
        }

    def _score_option_match(self, planned: str, option: str) -> tuple[float, str]:
        if self._is_decline_intent(planned) and not self._is_decline_intent(option):
            return 0.0, "decline_intent_option_not_decline"
        if self._canonical_values_match(option, planned):
            return 1.0, "universal_equivalence_or_exact"
        planned_norm = self._normalize_option_text(planned)
        option_norm = self._normalize_option_text(option)
        if not planned_norm or not option_norm:
            return 0.0, "empty_normalized_value"
        if planned_norm == option_norm:
            return 1.0, "exact_normalized"
        if planned_norm in option_norm or option_norm in planned_norm:
            shorter = min(len(planned_norm), len(option_norm))
            longer = max(len(planned_norm), len(option_norm))
            return max(0.82, shorter / max(longer, 1)), "substring_normalized"

        planned_tokens = self._option_tokens(planned_norm)
        option_tokens = self._option_tokens(option_norm)
        token_score = self._token_overlap_score(planned_tokens, option_tokens)
        acronym_score = 0.0
        if self._acronym(option_tokens) == "".join(token[0] for token in planned_tokens if token):
            acronym_score = 0.88
        if self._acronym(planned_tokens) == "".join(token[0] for token in option_tokens if token):
            acronym_score = max(acronym_score, 0.88)
        fuzzy_score = SequenceMatcher(None, planned_norm, option_norm).ratio()
        best = max(token_score, acronym_score, fuzzy_score)
        if best == token_score:
            return best, "token_overlap"
        if best == acronym_score:
            return best, "acronym"
        return best, "fuzzy_similarity"

    def _is_decline_intent(self, value: Any) -> bool:
        key = canonical(value)
        return any(pattern in key for pattern in {
            "prefer not to say",
            "decline to self identify",
            "i do not wish to answer",
            "i do not want to answer",
            "i dont wish to answer",
            "i don t wish to answer",
            "choose not to disclose",
            "i choose not to disclose",
        })

    def _normalize_option_text(self, value: Any) -> str:
        text = unicodedata.normalize("NFKD", str(value or ""))
        text = "".join(char for char in text if not unicodedata.combining(char))
        text = text.lower()
        text = re.sub(r"['’]", "", text)
        text = re.sub(r"[^a-z0-9+]+", " ", text)
        tokens = [
            token
            for token in re.sub(r"\s+", " ", text).strip().split()
            if token not in {
                "a",
                "an",
                "the",
                "select",
                "choose",
                "please",
                "option",
                "field",
                "program",
                "degree",
            }
        ]
        return " ".join(tokens)

    def _option_tokens(self, normalized: str) -> set[str]:
        return {token for token in str(normalized or "").split() if len(token) > 1}

    def _token_overlap_score(self, planned_tokens: set[str], option_tokens: set[str]) -> float:
        if not planned_tokens or not option_tokens:
            return 0.0
        overlap = planned_tokens & option_tokens
        if not overlap:
            return 0.0
        precision = len(overlap) / len(option_tokens)
        recall = len(overlap) / len(planned_tokens)
        return (2 * precision * recall) / max(precision + recall, 0.0001)

    def _acronym(self, tokens: set[str]) -> str:
        ordered = sorted(tokens)
        return "".join(token[0] for token in ordered if token)

    def _generic_other_option(self, options: list[str]) -> Optional[str]:
        for option in options:
            key = self._normalize_option_text(option)
            if key in {"other", "other website", "other option"}:
                return option
        return None

    def _should_select_other_option(self, field: dict[str, Any], planned: str, options: list[str]) -> bool:
        if not planned or len(str(planned).strip()) < 2:
            return False
        label = self._greenhouse_field_key(field)
        container = canonical(field.get("field_container_text") or field.get("surrounding_question_text") or "")
        if any(term in f"{label} {container}" for term in ("please specify", "if other", "other")):
            return True
        return len(options) <= 4 and any(self._normalize_option_text(option) == "other" for option in options)

    def _decline_option_from_options(self, options: list[str]) -> Optional[str]:
        decline_patterns = (
            "prefer not to say",
            "decline to self identify",
            "decline to self-identify",
            "i do not wish to answer",
            "i do not want to answer",
            "i don't wish to answer",
            "i dont wish to answer",
            "i don t wish to answer",
            "choose not to disclose",
            "i choose not to disclose",
        )
        for option in options:
            key = canonical(option)
            if any(canonical(pattern) in key for pattern in decline_patterns):
                return option
        return None

    async def _click_combobox_option_text(self, page: Any, text: str) -> bool:
        locators = (
            page.get_by_role("option", name=text).first,
            page.get_by_role("menuitem", name=text).first,
            page.locator("[role='option']").filter(has_text=text).first,
            page.locator("[role='menuitem'], li, [data-testid*='option'], [id*='option'], .select__option, [class*='option'], .option").filter(has_text=text).first,
        )
        for option_locator in locators:
            try:
                if await option_locator.count():
                    await option_locator.click(timeout=4000)
                    return True
            except Exception:
                continue
        return False

    async def _combobox_value_snapshot(self, page: Any, field: dict[str, Any]) -> str:
        selector = field.get("selector")
        if not selector:
            return ""
        try:
            return await page.locator(selector).first.evaluate(
                """(element) => {
                    const textOf = (node) => node ? String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim() : '';
                    const values = [];
                    if (element.value) values.push(String(element.value));
                    if (element.getAttribute('value')) values.push(element.getAttribute('value'));
                    if (element.getAttribute('aria-valuetext')) values.push(element.getAttribute('aria-valuetext'));
                    const text = textOf(element);
                    if (text) values.push(text);
                    const container = element.closest('.application-question, .question, .field, .form-field, .select-wrapper, .select, div');
                    if (container) {
                        for (const selected of container.querySelectorAll('[aria-selected="true"], [data-selected="true"], .select__single-value, [class*="singleValue"], [class*="selected"]')) {
                            const selectedText = textOf(selected);
                            if (selectedText) values.push(selectedText);
                        }
                        for (const input of container.querySelectorAll('input[type="hidden"], input:not([type]), input[type="text"], input[role="combobox"]')) {
                            if (input.value) values.push(String(input.value));
                        }
                    }
                    return values.filter(Boolean).join(' | ');
                }"""
            )
        except Exception:
            return ""

    async def _combobox_required_error_visible(self, page: Any, field: dict[str, Any]) -> bool:
        selector = field.get("selector")
        if not selector:
            return True
        try:
            return await page.locator(selector).first.evaluate(
                """(element) => {
                    const textOf = (node) => node ? String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase() : '';
                    const container = element.closest('.application-question, .question, .field, .form-field, .select-wrapper, .select, div');
                    const text = textOf(container || element);
                    return /required|can't be blank|must select|please select|is invalid/.test(text);
                }"""
            )
        except Exception:
            return True

    async def _combobox_value_matches(self, page: Any, selector: str, value: str, field: Optional[dict[str, Any]] = None) -> bool:
        field = field or {"selector": selector}
        actual = await self._combobox_value_snapshot(page, field)
        if self._canonical_values_match(actual, value):
            return True
        try:
            await page.locator(selector).first.evaluate(
                """(element) => {
                    element.dispatchEvent(new Event('change', {bubbles: true}));
                    element.dispatchEvent(new Event('blur', {bubbles: true}));
                }"""
            )
            await page.wait_for_timeout(200)
        except Exception:
            pass
        if self._canonical_values_match(await self._combobox_value_snapshot(page, field), value):
            return True
        if self._field_model(field).get("field_group") in {"privacy_consent"}:
            return not await self._combobox_required_error_visible(page, field)
        return False

    def _field_summary(self, field: dict[str, Any]) -> dict[str, Any]:
        summary = super()._field_summary(field)
        model = self._field_model(field)
        plan = getattr(self, "_greenhouse_plan_by_selector", {}).get(self._field_cache_key(field), {})
        summary.update({
            "selector": field.get("selector"),
            "stable_field_id": field.get("stable_field_id") or self._field_cache_key(field),
            "normalized_label": model.get("normalized_label"),
            "field_group": model.get("field_group"),
            "widget_type": model.get("widget_type") or self._widget_type(field),
            "safe_to_autofill": model.get("safe_to_autofill"),
            "reason_if_not_fillable": model.get("reason_if_not_fillable"),
            "field_category": model.get("field_group"),
            "suggested_profile_key": suggested_profile_key(field),
            "answer_source": plan.get("source"),
            "planned_answer": plan.get("planned_answer"),
            "surrounding_question_text": field.get("surrounding_question_text") or field.get("field_container_text") or field.get("nearby_text") or "",
            "conditional_hint": bool(field.get("conditional_hint")),
            "hidden_container": bool(field.get("hidden_container")),
        })
        combobox_debug = getattr(self, "_greenhouse_combobox_debug_by_key", {}).get(self._field_cache_key(field))
        if combobox_debug:
            summary["option_match_debug"] = {
                "planned_answer": combobox_debug.get("planned_answer"),
                "available_options": combobox_debug.get("options_discovered") or [],
                "best_match": combobox_debug.get("best_match"),
                "match_score": combobox_debug.get("match_score"),
                "selected_or_not": combobox_debug.get("selected_or_not"),
                "reason": combobox_debug.get("failure_reason"),
            }
        return summary

    def _fill_debug(
        self,
        field: dict[str, Any],
        fill: Optional[dict[str, Any]],
        attempted: bool,
        success: bool,
        value_after: str,
        exc: Optional[Exception] = None,
    ) -> dict[str, Any]:
        item = super()._fill_debug(field, fill, attempted, success, value_after, exc)
        model = self._field_model(field)
        plan = getattr(self, "_greenhouse_plan_by_selector", {}).get(self._field_cache_key(field), {})
        item.update({
            "selector": field.get("selector"),
            "stable_field_id": field.get("stable_field_id") or self._field_cache_key(field),
            "classification": model.get("field_group"),
            "widget_type": model.get("widget_type") or self._widget_type(field),
            "required": bool(field.get("required")),
            "safe_to_autofill": plan.get("safe_to_autofill", model.get("safe_to_autofill")),
            "reason_if_not_fillable": plan.get("reason_if_not_fillable") or model.get("reason_if_not_fillable"),
            "suggested_profile_key": suggested_profile_key(field),
        })
        combobox_debug = getattr(self, "_greenhouse_combobox_debug_by_key", {}).get(self._field_cache_key(field))
        if combobox_debug:
            item["combobox_debug"] = {
                "options_discovered": combobox_debug.get("options_discovered") or [],
                "best_match": combobox_debug.get("best_match"),
                "match_score": combobox_debug.get("match_score"),
                "selected_option": combobox_debug.get("selected_option"),
                "selected_or_not": combobox_debug.get("selected_or_not"),
                "value_after_fill": combobox_debug.get("value_after_fill"),
                "verification_result": combobox_debug.get("verified"),
                "failure_reason": combobox_debug.get("failure_reason"),
            }
        latest = list(getattr(self, "_greenhouse_latest_field_fill_debug", []) or [])
        latest.append(item)
        self._greenhouse_latest_field_fill_debug = latest
        return item

    def _pipeline_failed_fields(self, result: Any) -> list[dict[str, Any]]:
        failed: list[dict[str, Any]] = []
        phone_filled = self._phone_debug_success(result)
        for item in result.field_fill_debug or []:
            if item.get("fill_rejected") or item.get("invalid_after_fill") or (item.get("attempted_fill") and not item.get("fill_success")):
                if phone_filled and self._is_duplicate_phone_widget(item):
                    continue
                failed.append({
                    "stable_field_id": item.get("stable_field_id"),
                    "field_name": item.get("field_name"),
                    "label": item.get("label"),
                    "classification": item.get("classification") or item.get("field_group"),
                    "widget_type": item.get("widget_type") or item.get("field_type"),
                    "reason": item.get("rejection_reason") or item.get("invalid_after_fill_reason") or item.get("fill_error") or "fill_strategy_failed",
                    "attempted_fill": item.get("attempted_fill"),
                    "fill_success": item.get("fill_success"),
                    "value_after_fill": item.get("value_after_fill"),
                })
        return failed

    def _phone_debug_success(self, result: Any) -> bool:
        for item in result.field_fill_debug or []:
            if (
                item.get("attempted_fill")
                and item.get("fill_success")
                and str(item.get("field_type") or "").lower() == "tel"
                and str(item.get("matched_value") or item.get("value_after_fill") or "").strip()
            ):
                return True
        return False

    def _pipeline_verification_summary(self, result: Any) -> dict[str, Any]:
        required_scrape = [
            item for item in getattr(result, "form_scrape", []) or []
            if item.get("required")
        ]
        required_plan = [
            item for item in getattr(result, "answer_plan", []) or []
            if item.get("required")
        ]
        planned_autofill = [item for item in required_plan if item.get("safe_to_autofill")]
        user_required = [
            item for item in required_plan
            if not item.get("safe_to_autofill")
        ]
        attempted = [
            item for item in result.field_fill_debug or []
            if item.get("attempted_fill")
        ]
        successful = [
            item for item in result.field_fill_debug or []
            if item.get("attempted_fill") and item.get("fill_success") and not item.get("invalid_after_fill")
        ]
        successful_required = [
            item for item in successful
            if item.get("required")
        ]
        unfilled = result.unfilled_required_fields or []
        verified_complete = max(0, len(required_scrape) - len(unfilled))
        return {
            "pipeline": "generic_form_intelligence",
            "required_fields_detected": len(required_scrape),
            "required_fields_planned": len(required_plan),
            "required_fields_planned_autofill": len(planned_autofill),
            "required_fields_user_required": len(user_required),
            "fields_attempted": len(attempted),
            "fields_filled": len(successful),
            "required_fields_filled": len(successful_required),
            "required_fields_verified_complete": verified_complete,
            "remaining_action_required": len([
                item for item in unfilled
                if self._should_surface_action_required(item)
            ]),
            "failed_fields": len(self._pipeline_failed_fields(result)),
            "invalid_after_fill": len([item for item in result.field_fill_debug or [] if item.get("invalid_after_fill")]),
            "ready_for_final_click": bool(result.ready_for_final_click),
            "conditional_ignored_count": len(getattr(self, "_greenhouse_conditional_ignored", []) or []),
            "education_missing_count": len([
                item for item in unfilled
                if str(item.get("field_group") or item.get("classification") or "").startswith("education_")
            ]),
            "website_missing_count": len([
                item for item in unfilled
                if str(item.get("field_group") or item.get("classification") or "") in {"website_url", "portfolio_url"}
            ]),
        }

    def _should_surface_action_required(self, field: dict[str, Any]) -> bool:
        if not isinstance(field, dict):
            return False
        option_debug = field.get("option_match_debug") or {}
        if (
            field.get("required")
            and option_debug
            and field.get("answer_source")
            and option_debug.get("selected_or_not") is False
        ):
            return True
        if field.get("safe_to_autofill") or field.get("answer_source"):
            return False
        reason = str(field.get("reason_if_not_fillable") or "")
        if reason in {
            "unknown_optional_field",
            "not_fillable",
        }:
            return False
        return bool(field.get("required"))

    def _greenhouse_field_key(self, field: dict[str, Any]) -> str:
        return canonical(" ".join(str(field.get(key) or "") for key in (
            "name",
            "id",
            "label",
            "placeholder",
            "aria_label",
            "nearby_text",
            "field_container_text",
        )))

    def _raw_field_key(self, field: dict[str, Any]) -> str:
        return canonical(" ".join(str(field.get(key) or "") for key in (
            "name",
            "id",
            "label",
            "placeholder",
            "aria_label",
        )))

    def _field_cache_key(self, field: dict[str, Any]) -> str:
        return "|".join(str(field.get(key) or "") for key in ("selector", "name", "id", "label", "placeholder", "aria_label"))

    def _field_debug_identity(self, field: dict[str, Any]) -> dict[str, Any]:
        return {
            "selector": field.get("selector"),
            "name": field.get("name"),
            "id": field.get("id"),
            "label": field.get("label"),
            "placeholder": field.get("placeholder"),
            "aria_label": field.get("aria_label"),
            "type": field.get("type"),
            "required": field.get("required"),
        }

    def _authoritative_field_group(self, field: dict[str, Any]) -> Optional[str]:
        raw = self._raw_field_key(field)
        field_type = str(field.get("type") or "").lower()
        field_id = canonical(field.get("id") or "")
        field_name = canonical(field.get("name") or "")
        exact_keys = {field_id, field_name}
        if field_type == "email" or "email" in exact_keys or raw in ("email", "email address"):
            return "email"
        if field_type == "tel" or "phone" in exact_keys or "mobile" in exact_keys:
            return "phone"
        if field_type == "url":
            if "linkedin" in raw or "linked in" in raw:
                return "linkedin_url"
            if "portfolio" in raw:
                return "portfolio_url"
            return "website_url"
        if "preferred name" in raw or "preferred first name" in raw or "chosen name" in raw:
            return "preferred_name"
        if field_id in ("first_name", "firstname") or field_name in ("first_name", "firstname") or raw in ("first name", "given name"):
            return "first_name"
        if field_id in ("last_name", "lastname") or field_name in ("last_name", "lastname") or raw in ("last name", "family name", "surname"):
            return "last_name"
        if field_id == "country" or field_name == "country" or raw in ("country", "country country"):
            return "country"
        if field_id in ("candidate_location", "candidate location", "candidate-location") or "location city" in raw or raw in ("location", "current location", "city"):
            return "city_location"
        if self._is_education_school_field(raw):
            return "education_school"
        if self._is_education_degree_field(raw):
            return "education_degree"
        if self._is_education_discipline_field(raw):
            return "education_discipline"
        if self._is_education_graduation_year_field(raw):
            return "education_graduation_year"
        if "linkedin" in raw or "linked in" in raw:
            return "linkedin_url"
        if "how did you hear" in raw or "referral source" in raw:
            return "referral_source"
        return None

    def _is_education_school_field(self, label: str) -> bool:
        return any(term in label for term in ("school", "university", "college", "institution")) and not any(term in label for term in ("high school diploma", "degree"))

    def _is_education_degree_field(self, label: str) -> bool:
        return any(term in label for term in ("degree", "qualification")) and "discipline" not in label

    def _is_education_discipline_field(self, label: str) -> bool:
        return any(term in label for term in ("discipline", "field of study", "major", "subject"))

    def _is_education_graduation_year_field(self, label: str) -> bool:
        return any(term in label for term in ("graduation year", "grad year", "graduated", "year completed", "completion year"))

    def _is_motivation_question(self, label: str) -> bool:
        return any(pattern in label for pattern in (
            "why do you want to join",
            "why do you want to work",
            "why are you interested",
            "interested in this role",
            "interested in this opportunity",
            "what interests you about",
            "motivation for applying",
        ))

    def _is_location_eligibility_question(self, label: str) -> bool:
        return (
            any(pattern in label for pattern in (
                "currently located in",
                "currently based in",
                "are you based in",
                "are you currently based",
                "are you currently located",
            ))
            or bool(re.search(r"\bbased in\b", label))
        )

    def _is_former_company_history_question(self, label: str) -> bool:
        return any(pattern in label for pattern in (
            "have you ever worked for",
            "previously worked for",
            "previously been employed",
            "worked for us before",
            "employee or contractor",
            "contractor consultant",
            "contractor or consultant",
        ))

    def _concise_motivation_answer(self, preferred_text: str, app_doc: dict[str, Any]) -> str:
        text = str(preferred_text or "").strip()
        if not text:
            text = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {}).strip()
        if not text:
            text = application_summary_text(app_doc).strip()
        if not text:
            return ""
        text = re.sub(r"\s+", " ", text).strip()
        sentences = re.split(r"(?<=[.!?])\s+", text)
        selected: list[str] = []
        word_count = 0
        for sentence in sentences:
            words = sentence.split()
            if not words:
                continue
            if word_count + len(words) > 140 and selected:
                break
            selected.append(sentence)
            word_count += len(words)
            if word_count >= 80:
                break
        answer = " ".join(selected).strip() or text
        words = answer.split()
        if len(words) > 140:
            answer = " ".join(words[:140]).rstrip(" ,;:") + "."
        return answer

    def _candidate_name_parts(self, profile: dict[str, Any], user: dict[str, Any]) -> tuple[str, str]:
        contact = profile.get("contact") or {}
        first = str(contact.get("first_name") or "").strip()
        last = str(contact.get("last_name") or "").strip()
        if first or last:
            return first, last
        name = str(contact.get("name") or user.get("name") or "").strip()
        parts = [part for part in name.split() if part]
        if not parts:
            return "", ""
        if len(parts) == 1:
            return parts[0], ""
        return parts[0], " ".join(parts[1:])

    def _prepared_answer_for_field(self, field: dict[str, Any], app_doc: dict[str, Any]) -> Optional[str]:
        payload = app_doc.get("prepared_application_payload") or {}
        fields = payload.get("fields") or {}
        candidates = {
            canonical(field.get("id")),
            canonical(field.get("name")),
            canonical(field.get("label")),
            canonical(field.get("aria_label")),
            canonical(field.get("placeholder")),
        }
        for key, value in fields.items():
            if value in (None, ""):
                continue
            if canonical(key) in candidates:
                return str(value)
        for question in payload.get("questions") or []:
            if not isinstance(question, dict):
                continue
            value = question.get("value")
            if value in (None, ""):
                continue
            question_keys = {
                canonical(question.get("name")),
                canonical(question.get("field_name")),
                canonical(question.get("field_id")),
                canonical(question.get("label")),
                canonical(question.get("question")),
            }
            if candidates.intersection(question_keys):
                return str(value)
        return None

    def _label_has_any(self, label: str, terms: tuple[str, ...]) -> bool:
        return any(canonical(term) in label for term in terms)

    def _label_has_all(self, label: str, terms: tuple[str, ...]) -> bool:
        return all(canonical(term) in label for term in terms)

    def _is_first_name_field(self, label: str) -> bool:
        return any(term in label for term in ("first name", "given name", "preferred first name")) and "last name" not in label

    def _is_last_name_field(self, label: str) -> bool:
        return any(term in label for term in ("last name", "family name", "surname"))

    def _is_email_field(self, label: str) -> bool:
        return "email" in label or "e mail" in label

    def _is_phone_country_code_field(self, label: str) -> bool:
        return (
            ("phone" in label or "mobile" in label)
            and any(term in label for term in ("country code", "phone code", "dial code", "prefix"))
        ) or label in ("country code", "phone country")

    def _is_phone_field(self, label: str) -> bool:
        return ("phone" in label or "mobile" in label or "telephone" in label) and not self._is_phone_country_code_field(label)

    def _is_location_field(self, label: str) -> bool:
        tokens = set(label.split())
        return (
            "current location" in label
            or "location" in tokens
            or "city" in tokens
            or "address" in tokens
        ) and not any(
            term in label for term in ("office location", "job location", "preferred location")
        )

    def _is_referral_source_field(self, label: str) -> bool:
        return any(term in label for term in ("how did you hear", "referral source", "referred by", "source"))

    def _is_safe_privacy_consent_field(self, label: str) -> bool:
        return any(term in label for term in ("privacy policy", "data processing", "data protection", "consent", "i agree")) and not is_sensitive_field({"label": label})

    def _is_optional_demographic_decline_field(self, label: str) -> bool:
        return any(term in label for term in ("gender", "race", "ethnicity", "veteran", "disability", "sexual orientation", "hispanic"))

    def _is_work_authorization_or_legal(self, field: dict[str, Any]) -> bool:
        label = self._greenhouse_field_key(field)
        if self._is_safe_privacy_consent_field(label) or self._is_optional_demographic_decline_field(label):
            return False
        return is_sensitive_field(field) or suggested_profile_key(field) is not None

    def _saved_application_default(self, profile: dict[str, Any], field: dict[str, Any]) -> Any:
        key = suggested_profile_key(field)
        if not key:
            return None
        return (profile.get("application_defaults") or {}).get(key)

    def _phone_country_code_value(self, field: dict[str, Any], phone: str, profile: dict[str, Any]) -> Optional[str]:
        candidates = []
        if phone.strip().startswith("+"):
            digits = ""
            for char in phone.strip()[1:]:
                if char.isdigit():
                    digits += char
                else:
                    break
            for length in (3, 2, 1):
                if len(digits) >= length:
                    candidates.append("+" + digits[:length])
        country_code = str((profile.get("target_location_data") or {}).get("country_code") or "").lower()
        country_candidates = {
            "us": ("+1", "United States", "US"),
            "ca": ("+1", "Canada", "CA"),
            "gb": ("+44", "United Kingdom", "GB", "UK"),
            "fr": ("+33", "France", "FR"),
            "ma": ("+212", "Morocco", "MA"),
        }
        candidates.extend(country_candidates.get(country_code, ()))
        return self._option_value(field, tuple(str(item) for item in candidates if item))

    def _work_authorization_default(
        self,
        field: dict[str, Any],
        defaults: dict[str, Any],
        answers_profile: dict[str, Any],
    ) -> Any:
        direct = defaults.get("work_authorized_countries")
        if isinstance(direct, dict):
            country_keys = self._country_keys_from_field(field)
            for key in country_keys:
                if key in direct and direct[key] not in (None, ""):
                    return direct[key]
            for key in ("default", "any"):
                if direct.get(key) not in (None, ""):
                    return direct[key]
            return None
        if isinstance(direct, list):
            label = self._greenhouse_field_key(field)
            for item in direct:
                item_key = canonical(item)
                if item_key and item_key in label:
                    return "Yes"
            return None
        if direct not in (None, ""):
            return direct
        legacy = defaults.get("work_authorized_us") or answers_profile.get("work_authorization_countries")
        return legacy

    def _country_keys_from_field(self, field: dict[str, Any]) -> list[str]:
        label = self._greenhouse_field_key(field)
        keys = []
        country_terms = {
            "us": ("u s", "usa", "united states", "america"),
            "gb": ("uk", "u k", "united kingdom", "britain", "england"),
            "jp": ("japan",),
            "fr": ("france",),
            "ma": ("morocco", "maroc"),
        }
        for key, terms in country_terms.items():
            if any(term in label for term in terms):
                keys.append(key)
        return keys or ["default"]

    def _option_value(self, field: dict[str, Any], preferred_labels: tuple[str, ...]) -> Optional[str]:
        options = field.get("options") or []
        for preferred in preferred_labels:
            preferred_key = canonical(preferred)
            for option in options:
                if not isinstance(option, dict):
                    continue
                label = canonical(option.get("label") or option.get("value"))
                value = str(option.get("value") or option.get("label") or "").strip()
                if value and (label == preferred_key or preferred_key in label or label in preferred_key):
                    return value
        return None

    def _application_url(self, job: dict[str, Any]) -> str:
        for key in ("external_url", "application_url", "apply_url", "hosted_url"):
            value = job.get(key)
            if value:
                return str(value)
        raw = job.get("raw_provider_payload") or {}
        if isinstance(raw, dict):
            for key in ("absolute_url", "external_url", "application_url", "url"):
                value = raw.get(key)
                if value:
                    return str(value)
        raise ValueError("Greenhouse application URL is missing")

    def _validate_lever_url(self, url: str) -> None:
        host = urlparse(url).netloc.lower()
        allowed = (
            "greenhouse.io",
            "greenhouse.com",
            "boards.greenhouse",
            "job-boards.greenhouse",
        )
        if not any(token in host for token in allowed):
            raise ValueError("URL is not a Greenhouse hosted application page")

    async def _open_apply_form_if_needed(self, page: Any) -> None:
        if await page.locator("input[type='file'], input[name*='first_name'], input[name*='email']").count():
            return

        for target in ("#application", "#app", "[data-mapped='application-form']"):
            try:
                if await page.locator(target).count():
                    await page.locator(target).first.scroll_into_view_if_needed(timeout=3000)
                    return
            except Exception:
                continue

        candidates = [
            page.get_by_role("link", name="Apply for this job"),
            page.get_by_role("button", name="Apply for this job"),
            page.get_by_role("link", name="Apply"),
            page.get_by_role("button", name="Apply"),
            page.locator("a[href*='#application']").first,
        ]
        for locator in candidates:
            try:
                if await locator.count():
                    await locator.first.click(timeout=4000)
                    try:
                        await page.wait_for_load_state("domcontentloaded", timeout=8000)
                    except Exception:
                        pass
                    if await page.locator("input[type='file'], input[name*='first_name'], input[name*='email']").count():
                        return
            except Exception:
                continue

    async def _dismiss_obvious_cookie_banner(self, page: Any) -> None:
        for text in ("Accept All", "Accept all", "Accept", "I agree", "Got it", "OK"):
            try:
                button = page.get_by_role("button", name=text)
                if await button.count():
                    await button.first.click(timeout=1500)
                    return
            except Exception:
                continue

    async def _upload_file(
        self,
        page: Any,
        selector: str,
        value: str,
        resume_path: str | None,
        cover_letter_path: str | None,
    ) -> BrowserFile | None:
        if value == "__cover_letter_file__":
            path = cover_letter_path
            field_name = "cover_letter"
            mime = "text/plain"
        else:
            path = resume_path
            field_name = "resume"
            mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if not path:
            return None

        locator = page.locator(selector).first
        try:
            if await locator.is_visible(timeout=1000):
                await self._human_scroll_to_locator(locator)
                await self._human_delay()
        except Exception:
            pass
        await locator.set_input_files(path, timeout=10000)
        await self._human_delay()
        stat = Path(path).stat()
        return BrowserFile(field_name=field_name, filename=Path(path).name, mime=mime, size_bytes=stat.st_size)
