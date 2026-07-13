"""Resolve job-search role/location from profile fields and onboarding extras."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _first_non_empty_string(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def onboarding_from_profile(profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return dict((profile or {}).get("extras") or {}).get("onboarding") or {}


def _first_role(profile: Dict[str, Any], onboarding: Dict[str, Any]) -> str:
    for roles in (profile.get("target_roles"), onboarding.get("selected_roles")):
        if isinstance(roles, list):
            for role in roles:
                text = _first_non_empty_string(role)
                if text:
                    return text
    return ""


def resolve_profile_target_role(profile: Optional[Dict[str, Any]]) -> str:
    profile = profile or {}
    onboarding = onboarding_from_profile(profile)
    return _first_non_empty_string(profile.get("target_role"), _first_role(profile, onboarding))


def resolve_profile_target_location_data(profile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    profile = profile or {}
    onboarding = onboarding_from_profile(profile)
    contact = profile.get("contact") or {}
    for candidate in (
        profile.get("target_location_data"),
        contact.get("location_data"),
        onboarding.get("onboarding_location_data"),
    ):
        if isinstance(candidate, dict) and candidate:
            return dict(candidate)
    return {}


def resolve_profile_target_location_label(profile: Optional[Dict[str, Any]]) -> str:
    profile = profile or {}
    onboarding = onboarding_from_profile(profile)
    contact = profile.get("contact") or {}
    location_data = resolve_profile_target_location_data(profile)
    return _first_non_empty_string(
        profile.get("target_location"),
        contact.get("location"),
        onboarding.get("onboarding_location"),
        location_data.get("location_label"),
    )
