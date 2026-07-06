"""Public France Travail employer-page enrichment (logos, contact email)."""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

_logger = logging.getLogger(__name__)

GTW_BASE = "https://recrute.francetravail.fr/page-employeur/gw"
EMPLOYER_PAGE_ORIGIN = "https://recrute.francetravail.fr/page-employeur"

_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\d+$", re.IGNORECASE)
_IGNORE_EMAIL_DOMAINS = (
    "francetravail.fr",
    "pole-emploi.fr",
    "example.com",
    "email.com",
)

_EMPLOYER_CACHE: Dict[str, Dict[str, Any]] = {}


def employer_logo_url(id_rce: str) -> str:
    return f"{GTW_BASE}/logo-employeur/localisation/{quote(str(id_rce), safe='')}"


def employer_page_url(url_path: str) -> str:
    slug = str(url_path or "").strip().strip("/")
    return f"{EMPLOYER_PAGE_ORIGIN}/{slug}" if slug else ""


def slug_from_employer_url(value: Any) -> Optional[str]:
    text = str(value or "").strip().rstrip("/")
    if not text:
        return None
    if "page-employeur/" in text.lower():
        slug = text.split("page-employeur/")[-1].split("?")[0].split("#")[0].strip("/")
        return slug or None
    if "/" not in text and _SLUG_RE.match(text):
        return text
    return None


def siren_from_siret(value: Any) -> Optional[str]:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) >= 9:
        return digits[:9]
    return None


def extract_emails_from_text(*chunks: Any) -> List[str]:
    found: List[str] = []
    seen = set()
    for chunk in chunks:
        text = str(chunk or "")
        if not text:
            continue
        for match in _EMAIL_RE.findall(text):
            email = match.strip().lower()
            if any(domain in email for domain in _IGNORE_EMAIL_DOMAINS):
                continue
            if email in seen:
                continue
            seen.add(email)
            found.append(match.strip())
    return found


def _http_timeout() -> float:
    try:
        return max(1.0, min(float(os.environ.get("FRANCE_TRAVAIL_EMPLOYER_TIMEOUT_SECONDS", "4")), 10.0))
    except (TypeError, ValueError):
        return 4.0


def _enrichment_enabled() -> bool:
    return os.environ.get("FRANCE_TRAVAIL_EMPLOYER_ENRICH", "true").lower() not in ("0", "false", "no")


def _get_json(client: httpx.Client, url: str) -> Optional[Dict[str, Any]]:
    try:
        response = client.get(url, headers={"Accept": "application/json", "User-Agent": "Hirly/1.0"})
        if response.status_code != 200:
            return None
        payload = response.json()
        return payload if isinstance(payload, dict) else None
    except Exception as exc:
        _logger.debug("France Travail employer fetch failed for %s: %s", url, exc)
        return None


def resolve_siren_from_slug(client: httpx.Client, slug: str) -> Optional[str]:
    payload = _get_json(client, f"{GTW_BASE}/url/{quote(slug, safe='')}")
    if not payload:
        return None
    return str(payload.get("sirenOrSiret") or "").strip() or None


def fetch_employer_profile(client: httpx.Client, siren_or_siret: str) -> Optional[Dict[str, Any]]:
    key = str(siren_or_siret or "").strip()
    if not key:
        return None
    if key in _EMPLOYER_CACHE:
        return _EMPLOYER_CACHE[key]
    payload = _get_json(client, f"{GTW_BASE}/page-employeur/{quote(key, safe='')}")
    if payload:
        _EMPLOYER_CACHE[key] = payload
    return payload


def _collect_page_text(page: Dict[str, Any]) -> str:
    chunks: List[str] = []
    contenu = page.get("contenu") if isinstance(page.get("contenu"), dict) else {}
    tabs = contenu.get("tabs") if isinstance(contenu.get("tabs"), list) else []
    for tab in tabs:
        if not isinstance(tab, dict):
            continue
        areas = tab.get("areas") if isinstance(tab.get("areas"), list) else []
        for area in areas:
            if not isinstance(area, dict):
                continue
            widgets = area.get("widgets") if isinstance(area.get("widgets"), list) else []
            for widget in widgets:
                if not isinstance(widget, dict):
                    continue
                data = widget.get("data") if isinstance(widget.get("data"), dict) else {}
                for key in ("text", "title", "desc"):
                    value = data.get(key)
                    if value:
                        chunks.append(str(value))
                steps = data.get("steps")
                if isinstance(steps, list):
                    chunks.extend(str(step) for step in steps if step)
                list_raisons = data.get("listRaisons")
                if isinstance(list_raisons, list):
                    for item in list_raisons:
                        if isinstance(item, dict) and item.get("desc"):
                            chunks.append(str(item.get("desc")))
    return "\n".join(chunks)


def _logo_id_from_profile(payload: Dict[str, Any]) -> Optional[str]:
    page = payload.get("page") if isinstance(payload.get("page"), dict) else {}
    entete = page.get("entete") if isinstance(page.get("entete"), dict) else {}
    employeur = payload.get("employeur") if isinstance(payload.get("employeur"), dict) else {}

    if entete.get("logoUpdated") and employeur.get("idRCE"):
        return str(employeur["idRCE"])

    etablissements = employeur.get("etablissements") if isinstance(employeur.get("etablissements"), list) else []
    for item in etablissements:
        if not isinstance(item, dict):
            continue
        content = item.get("content") if isinstance(item.get("content"), dict) else {}
        if content.get("logoUpdated") and item.get("idRCE"):
            return str(item["idRCE"])
    return None


def _active_url_path(payload: Dict[str, Any]) -> Optional[str]:
    urls = payload.get("urls") if isinstance(payload.get("urls"), list) else []
    for item in urls:
        if isinstance(item, dict) and item.get("actif") and item.get("urlPath"):
            return str(item["urlPath"]).strip()
    for item in urls:
        if isinstance(item, dict) and item.get("urlPath"):
            return str(item["urlPath"]).strip()
    return None


def enrich_france_travail_job(
    job_doc: Dict[str, Any],
    row: Dict[str, Any],
    *,
    client: Optional[httpx.Client] = None,
) -> Dict[str, Any]:
    """Attach employer-page logo, public page URL, and fallback recruiter email."""
    if not _enrichment_enabled():
        return job_doc

    entreprise = row.get("entreprise") if isinstance(row.get("entreprise"), dict) else {}
    contact = row.get("contact") if isinstance(row.get("contact"), dict) else {}
    description = str(row.get("description") or "")

    if not job_doc.get("contact_email"):
        fallback_emails = extract_emails_from_text(
            contact.get("commentaire"),
            contact.get("nom"),
            description,
        )
        if fallback_emails:
            job_doc["contact_email"] = fallback_emails[0]

    slug = slug_from_employer_url(entreprise.get("url"))
    siren = (
        siren_from_siret(entreprise.get("siret"))
        or siren_from_siret(entreprise.get("siren"))
        or siren_from_siret(entreprise.get("sirenOrSiret"))
    )

    owns_client = client is None
    http_client = client or httpx.Client(timeout=_http_timeout(), follow_redirects=True)
    try:
        if not siren and slug:
            siren = resolve_siren_from_slug(http_client, slug)
        if not siren:
            return job_doc

        profile = fetch_employer_profile(http_client, siren)
        if not profile:
            return job_doc

        url_path = _active_url_path(profile) or slug
        if url_path:
            page_url = employer_page_url(url_path)
            job_doc["ft_employer_page_url"] = page_url
            job_doc["employer_page_url"] = page_url

        if not job_doc.get("company_logo"):
            logo_id = _logo_id_from_profile(profile)
            if logo_id:
                job_doc["company_logo"] = employer_logo_url(logo_id)

        if not job_doc.get("contact_email"):
            page = profile.get("page") if isinstance(profile.get("page"), dict) else {}
            emails = extract_emails_from_text(_collect_page_text(page))
            if emails:
                job_doc["contact_email"] = emails[0]
    finally:
        if owns_client:
            http_client.close()

    return job_doc
