"""Shared browser submission types and utilities."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class BrowserFile:
    field_name: str
    filename: str
    mime: str
    size_bytes: int


@dataclass
class BrowserSubmissionResult:
    provider: str
    application_url: str
    screenshot_b64: str
    fields_detected: List[Dict[str, Any]] = field(default_factory=list)
    fields_filled: List[Dict[str, Any]] = field(default_factory=list)
    field_fill_debug: List[Dict[str, Any]] = field(default_factory=list)
    blocker_debug: Dict[str, Any] = field(default_factory=dict)
    blockers: List[Dict[str, Any]] = field(default_factory=list)
    unfilled_required_fields: List[Dict[str, Any]] = field(default_factory=list)
    file_uploads: List[BrowserFile] = field(default_factory=list)
    success_likelihood: float = 0.0
    ready_for_final_click: bool = False
    final_click_candidate_selector: Optional[str] = None
    submit_clicked: bool = False
    success_detected: bool = False
    failure_reason: Optional[str] = None
    final_url: Optional[str] = None
    submit_screenshot_b64: Optional[str] = None
    captcha_required: bool = False
    action_required: bool = False
    captcha_debug: Dict[str, Any] = field(default_factory=dict)
    post_submit_page_text_excerpt: Optional[str] = None
    post_submit_errors: List[str] = field(default_factory=list)
    submit_button_still_visible: Optional[bool] = None
    confirmation_text_found: Optional[str] = None
    lever_network_submit_statuses: List[Dict[str, Any]] = field(default_factory=list)
    form_scrape: List[Dict[str, Any]] = field(default_factory=list)
    answer_plan: List[Dict[str, Any]] = field(default_factory=list)
    verification_summary: Dict[str, Any] = field(default_factory=dict)
    failed_fields: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "provider": self.provider,
            "application_url": self.application_url,
            "screenshot_b64": self.screenshot_b64,
            "fields_detected": self.fields_detected,
            "fields_filled": self.fields_filled,
            "field_fill_debug": self.field_fill_debug,
            "blocker_debug": self.blocker_debug,
            "blockers": self.blockers,
            "unfilled_required_fields": self.unfilled_required_fields,
            "file_uploads": [item.__dict__ for item in self.file_uploads],
            "success_likelihood": self.success_likelihood,
            "ready_for_final_click": self.ready_for_final_click,
            "final_click_candidate_selector": self.final_click_candidate_selector,
            "submit_clicked": self.submit_clicked,
            "success_detected": self.success_detected,
            "failure_reason": self.failure_reason,
            "final_url": self.final_url,
            "submit_screenshot_b64": self.submit_screenshot_b64,
            "captcha_required": self.captcha_required,
            "action_required": self.action_required,
            "captcha_debug": self.captcha_debug,
            "post_submit_page_text_excerpt": self.post_submit_page_text_excerpt,
            "post_submit_errors": self.post_submit_errors,
            "submit_button_still_visible": self.submit_button_still_visible,
            "confirmation_text_found": self.confirmation_text_found,
            "lever_network_submit_statuses": self.lever_network_submit_statuses,
            "form_scrape": self.form_scrape,
            "answer_plan": self.answer_plan,
            "verification_summary": self.verification_summary,
            "failed_fields": self.failed_fields,
        }


def browser_submit_dry_run_enabled() -> bool:
    return os.environ.get("BROWSER_SUBMIT_DRY_RUN", "true").lower() not in ("0", "false", "no", "off")


def blocker(code: str, message: str, field: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    item: Dict[str, Any] = {"code": code, "message": message}
    if field:
        item["field"] = {
            key: field.get(key)
            for key in ("name", "label", "type", "required")
            if field.get(key) is not None
        }
    return item


class BrowserSubmissionError(RuntimeError):
    def __init__(
        self,
        phase: str,
        message: str,
        *,
        exception_class: Optional[str] = None,
        inner_exception_class: Optional[str] = None,
        inner_exception_message: Optional[str] = None,
        last_launch_marker: Optional[str] = None,
        target_url: Optional[str] = None,
        status: Optional[int] = None,
    ):
        super().__init__(message)
        self.phase = phase
        self.exception_class = exception_class or self.__class__.__name__
        self.inner_exception_class = inner_exception_class
        self.inner_exception_message = inner_exception_message
        self.last_launch_marker = last_launch_marker
        self.target_url = target_url
        self.status = status

    def safe_detail(self) -> Dict[str, Any]:
        detail: Dict[str, Any] = {
            "phase": self.phase,
            "exception_class": self.exception_class,
            "message": str(self) or "Browser submission failed",
        }
        if self.inner_exception_class:
            detail["inner_exception_class"] = self.inner_exception_class
        if self.inner_exception_message:
            detail["inner_exception_message"] = self.inner_exception_message
        if self.last_launch_marker:
            detail["last_launch_marker"] = self.last_launch_marker
        if self.target_url:
            detail["target_url"] = self.target_url
        if self.status is not None:
            detail["status"] = self.status
        return detail


def calculate_success_likelihood(
    blockers: List[Dict[str, Any]],
    unfilled_required_fields: List[Dict[str, Any]],
    resume_uploaded: bool,
    custom_widget_count: int = 0,
    submit_disabled: bool = False,
) -> float:
    score = 1.0
    if unfilled_required_fields:
        score -= min(0.45, 0.12 * len(unfilled_required_fields))
    if not resume_uploaded:
        score -= 0.25
    if custom_widget_count:
        score -= min(0.2, 0.05 * custom_widget_count)
    if submit_disabled:
        score -= 0.15
    for item in blockers:
        code = item.get("code")
        if code in ("captcha_detected", "login_required", "page_not_loaded"):
            score -= 0.3
        elif code in ("required_sensitive_field_missing", "resume_upload_failed"):
            score -= 0.2
        else:
            score -= 0.08
    return max(0.0, min(0.95, round(score, 2)))
