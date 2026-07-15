"""Turns (blueprint, ResolvedAnswer[]) into a normalized, ordered ApplicationPlan.

The plan is ATS-agnostic in STRUCTURE; the locator strings it carries are
opaque to the pipeline and executed verbatim by the driver. Ordering: non-file
fills first, then file uploads, then a single terminal submit step.
"""
from __future__ import annotations

from typing import Dict, List

from application_blueprint import FieldType, NormalizedField
from .models import ApplicationPlan, PlanStep, ResolvedAnswer

_SELECT_TYPES = {FieldType.SELECT, FieldType.MULTISELECT}
_CHECK_TYPES = {FieldType.CHECKBOX, FieldType.CONSENT}


def _action_for(field: NormalizedField, answer: ResolvedAnswer) -> str:
    if answer.is_file:
        return "upload"
    if field.type in _SELECT_TYPES:
        return "select"
    if field.type in _CHECK_TYPES:
        return "check"
    return "fill"


def _file_role(field: NormalizedField) -> str:
    return "cover_letter" if field.type == FieldType.COVER_LETTER else "resume"


def _locators(field: NormalizedField) -> List[str]:
    locators: List[str] = []
    if field.binding:
        locators.append(field.binding)
    # Generic, ATS-agnostic fallbacks (harmless if they don't match; the driver
    # tries them in order only if the primary fails).
    if field.key:
        locators.append(f'#{field.key}')
    if field.label:
        locators.append(f'[aria-label="{field.label}"]')
    return locators


def plan(blueprint, answers: List[ResolvedAnswer]) -> ApplicationPlan:
    fields_by_key: Dict[str, NormalizedField] = {f.key: f for f in blueprint.fields}
    fills: List[PlanStep] = []
    uploads: List[PlanStep] = []
    for ans in answers:
        field = fields_by_key.get(ans.field_key)
        if field is None:
            continue
        action = _action_for(field, ans)
        step = PlanStep(
            action=action, locators=_locators(field), value=ans.value, source=ans.source,
            file_role=_file_role(field) if action == "upload" else None,
        )
        (uploads if action == "upload" else fills).append(step)
    steps = fills + uploads + [PlanStep(action="submit", locators=[])]
    return ApplicationPlan(steps=steps, blueprint_signature=blueprint.signature or "")
