"""ATS-agnostic data shapes for the auto-apply pipeline."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from application_blueprint import FieldType, NormalizedField


@dataclass
class ResolvedAnswer:
    field_key: str
    field_type: FieldType
    value: str
    source: str
    is_file: bool = False


@dataclass
class PlanStep:
    action: str  # "fill" | "select" | "check" | "upload" | "submit"
    locators: List[str] = field(default_factory=list)
    value: Optional[str] = None
    source: Optional[str] = None
    file_role: Optional[str] = None  # "resume" | "cover_letter"


@dataclass
class ApplicationPlan:
    steps: List[PlanStep] = field(default_factory=list)
    blueprint_signature: str = ""


@dataclass
class SubmissionContext:
    job: Dict[str, Any]
    blueprint: Any
    plan: ApplicationPlan
    documents: Dict[str, Any] = field(default_factory=dict)
    dry_run: bool = False
    headless: bool = True


@dataclass
class SubmissionEvidence:
    submit_performed: bool = False
    confirmation_text: Optional[str] = None
    submit_control_gone: Optional[bool] = None
    url_changed: Optional[bool] = None
    validation_errors: List[str] = field(default_factory=list)
    network_ok: Optional[bool] = None
    blocked_reason: Optional[str] = None
    final_url: Optional[str] = None
    screenshot_b64: Optional[str] = None
    raw: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Verdict:
    status: str  # "verified_success" | "verified_failure" | "unverified"
    reason: str = ""
    signals: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EligibilityDecision:
    eligible: bool
    reason: str = ""
    score: float = 0.0
    signals: Dict[str, Any] = field(default_factory=dict)


def compute_blueprint_signature(fields: List[NormalizedField]) -> str:
    parts = sorted(
        f"{f.type.value}:{int(bool(f.required))}:{int(bool(f.validation.sensitive))}"
        for f in fields
    )
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]
