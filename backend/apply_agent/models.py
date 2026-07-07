"""Shared data shapes for the apply agent."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class BrowserFile:
    field_name: str
    filename: str
    mime: str
    size_bytes: int


class ApplyAgentError(RuntimeError):
    """Raised for setup/navigation failures that abort a run before any
    field-level work happens (e.g. Playwright missing, page failed to load).
    Field-level failures are recorded as blockers instead, not raised.
    """

    def __init__(
        self,
        phase: str,
        message: str,
        *,
        exception_class: Optional[str] = None,
        target_url: Optional[str] = None,
    ):
        super().__init__(message)
        self.phase = phase
        self.exception_class = exception_class or self.__class__.__name__
        self.target_url = target_url

    def safe_detail(self) -> Dict[str, Any]:
        return {
            "phase": self.phase,
            "exception_class": self.exception_class,
            "message": str(self) or "Apply agent run failed",
            "target_url": self.target_url,
        }


def blocker(code: str, message: str, field: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    item: Dict[str, Any] = {"code": code, "message": message}
    if field:
        item["field"] = {
            key: field.get(key)
            for key in ("name", "label", "type", "required")
            if field.get(key) is not None
        }
    return item


@dataclass
class ApplyRunResult:
    """Result of one apply-agent run against a single job posting."""

    provider: str
    application_url: str
    domain: str
    screenshot_b64: str = ""
    fields_detected: List[Dict[str, Any]] = field(default_factory=list)
    agent_plan: List[Dict[str, Any]] = field(default_factory=list)
    fields_filled: List[Dict[str, Any]] = field(default_factory=list)
    rejected_fills: List[Dict[str, Any]] = field(default_factory=list)
    blockers: List[Dict[str, Any]] = field(default_factory=list)
    unfilled_required_fields: List[Dict[str, Any]] = field(default_factory=list)
    file_uploads: List[BrowserFile] = field(default_factory=list)
    recipe_used: Optional[str] = None
    recipe_recorded: bool = False
    success_likelihood: float = 0.0
    ready_for_final_click: bool = False
    submit_clicked: bool = False
    success_detected: bool = False
    failure_reason: Optional[str] = None
    final_url: Optional[str] = None
    captcha_required: bool = False
    login_wall_detected: bool = False
    action_required: bool = False
    confirmation_text_found: Optional[str] = None
    post_submit_errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "provider": self.provider,
            "application_url": self.application_url,
            "domain": self.domain,
            "screenshot_b64": self.screenshot_b64,
            "fields_detected": self.fields_detected,
            "agent_plan": self.agent_plan,
            "fields_filled": self.fields_filled,
            "rejected_fills": self.rejected_fills,
            "blockers": self.blockers,
            "unfilled_required_fields": self.unfilled_required_fields,
            "file_uploads": [item.__dict__ for item in self.file_uploads],
            "recipe_used": self.recipe_used,
            "recipe_recorded": self.recipe_recorded,
            "success_likelihood": self.success_likelihood,
            "ready_for_final_click": self.ready_for_final_click,
            "submit_clicked": self.submit_clicked,
            "success_detected": self.success_detected,
            "failure_reason": self.failure_reason,
            "final_url": self.final_url,
            "captcha_required": self.captcha_required,
            "login_wall_detected": self.login_wall_detected,
            "action_required": self.action_required,
            "confirmation_text_found": self.confirmation_text_found,
            "post_submit_errors": self.post_submit_errors,
        }


def calculate_success_likelihood(
    blockers: List[Dict[str, Any]],
    unfilled_required_fields: List[Dict[str, Any]],
    *,
    resume_uploaded: bool,
    rejected_fill_count: int = 0,
) -> float:
    score = 1.0
    if unfilled_required_fields:
        score -= min(0.45, 0.12 * len(unfilled_required_fields))
    if not resume_uploaded:
        score -= 0.25
    if rejected_fill_count:
        score -= min(0.2, 0.05 * rejected_fill_count)
    for item in blockers:
        code = item.get("code")
        if code in ("captcha_detected", "login_wall_detected", "page_not_loaded"):
            score -= 0.3
        elif code in ("required_sensitive_field_missing", "resume_upload_failed"):
            score -= 0.2
        else:
            score -= 0.08
    return max(0.0, min(0.95, round(score, 2)))
