"""DataFast revenue attribution helpers for Stripe metadata."""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional

DATAFAST_VISITOR_COOKIE = "datafast_visitor_id"
DATAFAST_SESSION_COOKIE = "datafast_session_id"


def datafast_stripe_metadata(
    *,
    cookies: Optional[Mapping[str, str]] = None,
    body: Optional[Mapping[str, Any]] = None,
) -> Dict[str, str]:
    """Build Stripe metadata fields for DataFast revenue attribution."""
    visitor = _first_non_empty(
        _cookie_value(cookies, DATAFAST_VISITOR_COOKIE),
        _body_value(body, "datafast_visitor_id"),
    )
    session = _first_non_empty(
        _cookie_value(cookies, DATAFAST_SESSION_COOKIE),
        _body_value(body, "datafast_session_id"),
    )
    metadata: Dict[str, str] = {}
    if visitor:
        metadata[DATAFAST_VISITOR_COOKIE] = visitor
    if session:
        metadata[DATAFAST_SESSION_COOKIE] = session
    return metadata


def merge_stripe_metadata(base: Optional[Mapping[str, Any]], extra: Mapping[str, str]) -> Dict[str, str]:
    merged: Dict[str, str] = {}
    for key, value in (base or {}).items():
        text = str(value or "").strip()
        if text:
            merged[str(key)] = text
    for key, value in extra.items():
        text = str(value or "").strip()
        if text:
            merged[key] = text
    return merged


def _cookie_value(cookies: Optional[Mapping[str, str]], name: str) -> str:
    if not cookies:
        return ""
    return str(cookies.get(name) or "").strip()


def _body_value(body: Optional[Mapping[str, Any]], name: str) -> str:
    if not body:
        return ""
    return str(body.get(name) or "").strip()


def _first_non_empty(*values: str) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""
