"""Universal, ATS-agnostic application form contract.

Every ATS driver emits an ApplicationBlueprint. Downstream consumers
(classifier, submission engine, certification) depend ONLY on this module,
never on ATS-specific structures.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class FieldType(str, Enum):
    RESUME = "resume"
    COVER_LETTER = "cover_letter"
    PORTFOLIO = "portfolio"
    LINKEDIN = "linkedin"
    WEBSITE = "website"
    PHONE = "phone"
    EMAIL = "email"
    FULL_NAME = "full_name"
    FIRST_NAME = "first_name"
    LAST_NAME = "last_name"
    LOCATION = "location"
    VISA_STATUS = "visa_status"
    WORK_AUTHORIZATION = "work_authorization"
    SALARY_EXPECTATION = "salary_expectation"
    CUSTOM_QUESTION = "custom_question"
    FILE_UPLOAD = "file_upload"
    CHECKBOX = "checkbox"
    SELECT = "select"
    MULTISELECT = "multiselect"
    TEXT = "text"
    TEXTAREA = "textarea"
    DEMOGRAPHIC = "demographic"
    EEOC = "eeoc"
    CONSENT = "consent"
    UNKNOWN = "unknown"


class Complexity(str, Enum):
    TRIVIAL = "trivial"
    STANDARD = "standard"
    COMPLEX = "complex"


# Field types the engine can fill deterministically from a standard profile
# without any custom reasoning. Presence of only these (plus resume) = trivial.
_STANDARD_CONTACT = {
    FieldType.FIRST_NAME,
    FieldType.LAST_NAME,
    FieldType.FULL_NAME,
    FieldType.EMAIL,
    FieldType.PHONE,
    FieldType.LOCATION,
    FieldType.LINKEDIN,
    FieldType.WEBSITE,
    FieldType.RESUME,
    FieldType.COVER_LETTER,
}


@dataclass(frozen=True)
class FieldValidation:
    max_length: Optional[int] = None
    pattern: Optional[str] = None
    allowed_options: Optional[List[str]] = None
    accepted_file_types: Optional[List[str]] = None
    sensitive: bool = False


@dataclass
class NormalizedField:
    key: str
    type: FieldType
    required: bool
    supported: bool
    label: str = ""
    validation: FieldValidation = field(default_factory=FieldValidation)
    # Opaque ATS-specific locator used ONLY by the submission engine.
    # Deliberately excluded from the blueprint signature.
    binding: Optional[str] = None


@dataclass
class ApplicationBlueprint:
    provider: str
    fields: List[NormalizedField]
    complexity: Complexity
    estimated_compatibility_score: float
    blockers: List[str] = field(default_factory=list)
    signature: str = ""


def derive_complexity(fields: List[NormalizedField]) -> Complexity:
    if any(f.required and not f.supported for f in fields):
        return Complexity.COMPLEX
    if any(f.required and f.validation.sensitive for f in fields):
        return Complexity.COMPLEX
    extras = [f for f in fields if f.type not in _STANDARD_CONTACT]
    if not extras:
        return Complexity.TRIVIAL
    return Complexity.STANDARD


def estimate_compatibility_score(fields: List[NormalizedField], blockers: List[str]) -> float:
    if blockers:
        return 0.0
    required = [f for f in fields if f.required]
    if not required:
        return 0.95
    unsupported_required = [f for f in required if not f.supported or f.validation.sensitive]
    if unsupported_required:
        return round(0.4, 3)
    return 0.95
