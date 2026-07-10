"""Disambiguation table for role search terms that are ambiguous across
languages or homonymous with unrelated occupations.

Concrete case this exists for: the frontend's internal taxonomy uses "Chef"
as the canonical (English) identifier for the cook/kitchen role, displayed
as "Cuisinier" in French. But bare "chef" in French commonly means
"lead/head" ("chef de projet", "chef de mission", "chef d'equipe"), not
specifically a kitchen chef -- so using the raw word "chef" as a search or
scoring token matches those completely unrelated roles too. This table is
keyed by every known alias (any language/casing) so a lookup works
regardless of which form a profile's target_role happens to be stored in
(old data may hold "Chef", new data may hold "Cuisinier").

Deliberately a small, explicit table rather than a general translation
layer: only roles with a *proven* cross-language collision need an entry.
Most of the taxonomy (e.g. "Software Engineer" / "Ingenieur logiciel")
isn't ambiguous and doesn't need one.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional


def _normalize(value: Optional[str]) -> str:
    text = unicodedata.normalize("NFKD", str(value or "").strip().lower())
    text = text.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", text).strip()


_ROLE_QUERY_OVERRIDES: Dict[str, Dict[str, Any]] = {
    "cook_chef": {
        "aliases": [
            "chef", "cuisinier", "cuisiniere", "cook", "kitchen chef",
            "chef cuisinier", "chef de cuisine",
        ],
        # Tokens used INSTEAD OF naively tokenizing the raw role text for
        # internal DB scoring -- deliberately excludes the bare word "chef",
        # which matches any "chef de X" leadership title.
        "match_tokens": ["cuisinier", "cuisine", "cook", "kitchen"],
        # Search text sent to external job providers (JSearch/France
        # Travail), picked by the resolved TARGET-MARKET language, not the
        # UI display language -- a French UI user searching in London
        # still needs an English query term, and vice versa.
        "query_by_language": {"fr": "cuisinier", "en": "chef cuisinier"},
    },
}

_ALIAS_TO_ENTRY: Dict[str, Dict[str, Any]] = {}
for _entry in _ROLE_QUERY_OVERRIDES.values():
    for _alias in _entry["aliases"]:
        _ALIAS_TO_ENTRY[_normalize(_alias)] = _entry


def resolve_role_match_tokens(role_text: Optional[str]) -> Optional[List[str]]:
    """Safe token list to score against instead of naively tokenizing
    role_text. Returns None when role_text isn't a known ambiguous case."""
    entry = _ALIAS_TO_ENTRY.get(_normalize(role_text))
    return list(entry["match_tokens"]) if entry else None


def resolve_role_query_term(role_text: Optional[str], language: Optional[str]) -> str:
    """Search text for external providers, chosen by the target market's
    language. Falls back to the original text for unknown roles."""
    entry = _ALIAS_TO_ENTRY.get(_normalize(role_text))
    if not entry:
        return role_text or ""
    lang_key = "fr" if str(language or "").lower().startswith("fr") else "en"
    return entry["query_by_language"].get(lang_key, role_text)
