"""France Travail ROME 4.0 profile enrichment for jobs.

Fetches and caches official occupation data from the four ROME 4.0 APIs:
- Métiers
- Fiches métiers
- Compétences
- Contextes de travail

Rate limit: at most one outbound call per second (per France Travail docs).
Results are cached in Supabase (`rome_profiles` table) for 30 days.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx

from job_providers.config import _france_travail_client_id, _france_travail_client_secret

logger = logging.getLogger(__name__)

API_BASE = (os.environ.get("FRANCE_TRAVAIL_API_BASE_URL") or "https://api.francetravail.io").rstrip("/")
TOKEN_URL = (
    os.environ.get("FRANCE_TRAVAIL_TOKEN_URL")
    or "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire"
)

ROME_SCOPES = {
    "metiers": "api_rome-metiersv1 nomenclatureRome",
    "fiches": "api_rome-fiches-metiersv1 nomenclatureRome",
    "competences": "api_rome-competencesv1 nomenclatureRome",
    "contextes": "api_rome-contextes-travailv1 nomenclatureRome",
}

ROME_PATHS = {
    "metiers": "/partenaire/rome-metiers/v1/metiers/metier/{code}",
    "fiches": "/partenaire/rome-fiches-metiers/v1/fiches-rome/fiche-metier/{code}",
    "competences": "/partenaire/rome-competences/v1/competences/metier/{code}",
    "contextes": "/partenaire/rome-contextes-travail/v1/contextes-travail/metier/{code}",
}

_ROME_CODE_RE = re.compile(r"^[A-Za-z]\d{4}$")
_token_cache: Dict[str, Tuple[str, float]] = {}
_rate_lock = asyncio.Lock()
_last_request_at = 0.0
CACHE_DAYS = max(1, int(os.environ.get("ROME_PROFILE_CACHE_DAYS", "30")))


def rome_profile_enabled() -> bool:
    if os.environ.get("ROME_PROFILE_ENABLED", "true").strip().lower() in ("0", "false", "no", "off"):
        return False
    return bool(_france_travail_client_id() and _france_travail_client_secret())


def normalize_rome_code(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    code = str(value).strip().upper()
    return code if _ROME_CODE_RE.match(code) else None


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


async def _throttle() -> None:
    global _last_request_at
    interval = max(1.0, _env_float("ROME_API_MIN_INTERVAL_SECONDS", 1.05))
    async with _rate_lock:
        now = time.monotonic()
        wait = interval - (now - _last_request_at)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_request_at = time.monotonic()


async def _get_token(scope: str, client: httpx.AsyncClient) -> str:
    now = time.time()
    cached = _token_cache.get(scope)
    if cached and now < cached[1] - 30:
        return cached[0]
    client_id = _france_travail_client_id()
    client_secret = _france_travail_client_secret()
    if not client_id or not client_secret:
        raise RuntimeError("France Travail credentials are not configured")
    response = await client.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": scope,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    response.raise_for_status()
    payload = response.json()
    token = str(payload["access_token"])
    expires_in = int(payload.get("expires_in") or 1500)
    _token_cache[scope] = (token, now + expires_in)
    return token


async def _api_get(
    client: httpx.AsyncClient,
    *,
    scope: str,
    path: str,
) -> Tuple[bool, Any]:
    await _throttle()
    try:
        token = await _get_token(scope, client)
    except Exception as exc:
        logger.warning("rome_profile_token_failed scope=%s error=%s", scope, exc)
        return False, {"error": str(exc)[:200]}
    url = f"{API_BASE}{path}"
    try:
        response = await client.get(
            url,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=max(5.0, _env_float("ROME_API_TIMEOUT_SECONDS", 12.0)),
        )
        if response.status_code == 204:
            return True, None
        if response.status_code == 404:
            return False, None
        response.raise_for_status()
        if not response.content:
            return True, None
        return True, response.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in (403, 404):
            return False, None
        logger.warning("rome_profile_http_error scope=%s path=%s status=%s", scope, path, exc.response.status_code)
        return False, {"error": f"HTTP {exc.response.status_code}"}
    except Exception as exc:
        logger.warning("rome_profile_request_failed scope=%s path=%s error=%s", scope, path, exc)
        return False, {"error": f"{exc.__class__.__name__}: {str(exc)[:160]}"}


def _labels(items: Any) -> List[str]:
    if not isinstance(items, list):
        return []
    labels: List[str] = []
    for item in items:
        if isinstance(item, str) and item.strip():
            labels.append(item.strip())
        elif isinstance(item, dict):
            label = (
                item.get("libelle")
                or item.get("libelleCompetence")
                or item.get("libelle_cont_travail")
                or item.get("libelleContexte")
                or item.get("name")
            )
            if label:
                labels.append(str(label).strip())
    return list(dict.fromkeys(labels))


def _grouped_from_fiche(fiche: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    skill_groups: List[Dict[str, Any]] = []
    for group in fiche.get("groupesCompetencesMobilisees") or []:
        if not isinstance(group, dict):
            continue
        bullets = _labels(group.get("competences") or [])
        if not bullets:
            continue
        skill_groups.append({
            "title": (group.get("enjeu") or {}).get("libelle") or "Skills",
            "items": bullets,
        })
    knowledge_groups: List[Dict[str, Any]] = []
    for group in fiche.get("groupesSavoirs") or []:
        if not isinstance(group, dict):
            continue
        bullets = _labels(group.get("savoirs") or [])
        if not bullets:
            continue
        knowledge_groups.append({
            "title": (group.get("categorieSavoirs") or {}).get("libelle") or "Knowledge",
            "items": bullets,
        })
    return skill_groups, knowledge_groups


def _context_groups_from_payload(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, dict):
        candidates = (
            payload.get("groupesContextesTravail")
            or payload.get("contextesMobilises")
            or payload.get("contextesTravail")
            or payload.get("contextes")
        )
        if isinstance(candidates, list):
            groups: List[Dict[str, Any]] = []
            for group in candidates:
                if not isinstance(group, dict):
                    continue
                category = (
                    (group.get("categorieContexte") or {}).get("libelle")
                    or (group.get("typeContexte") or {}).get("libelle")
                    or group.get("libelleTypeContTrav")
                    or group.get("libelle")
                    or "Work context"
                )
                items = _labels(group.get("contextes") or group.get("contextesTravail") or [group])
                if items:
                    groups.append({"title": str(category), "items": items})
            if groups:
                return groups
        flat = _labels(candidates)
        if flat:
            return [{"title": "Work context", "items": flat}]
    if isinstance(payload, list):
        flat = _labels(payload)
        if flat:
            return [{"title": "Work context", "items": flat}]
    return []


def _competence_tree_from_payload(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    groups: List[Dict[str, Any]] = []
    for key in ("domaines", "macroCompetences", "competences", "arborescence"):
        nodes = payload.get(key)
        if not isinstance(nodes, list):
            continue
        for node in nodes:
            if not isinstance(node, dict):
                continue
            title = node.get("libelle") or node.get("libelleDomaine") or node.get("libelleMacroCompetence")
            children = _labels(node.get("competences") or node.get("items") or node.get("enfants"))
            if title and children:
                groups.append({"title": str(title), "items": children})
    return groups


def build_public_rome_profile(
    rome_code: str,
    *,
    metier: Optional[Dict[str, Any]] = None,
    fiche: Optional[Dict[str, Any]] = None,
    competences: Optional[Any] = None,
    contextes: Optional[Any] = None,
    rome_label: Optional[str] = None,
) -> Dict[str, Any]:
    metier = metier if isinstance(metier, dict) else {}
    fiche = fiche if isinstance(fiche, dict) else {}
    skill_groups, knowledge_groups = _grouped_from_fiche(fiche)
    competence_tree = _competence_tree_from_payload(competences)
    context_groups = _context_groups_from_payload(contextes)
    if not context_groups:
        context_groups = _context_groups_from_payload(metier)

    core_skills = _labels(
        metier.get("competencesMobiliseesPrincipales")
        or metier.get("competencesPrincipales")
    )
    emerging_skills = _labels(
        metier.get("competencesMobiliseesEmergentes")
        or metier.get("competencesEmergentes")
    )
    if not core_skills and skill_groups:
        core_skills = skill_groups[0].get("items") or []

    return {
        "rome_code": rome_code,
        "label": (
            rome_label
            or metier.get("libelle")
            or (fiche.get("metier") or {}).get("libelle")
            or rome_code
        ),
        "definition": metier.get("definition") or fiche.get("definition"),
        "access": metier.get("accesEmploi") or metier.get("acces") or fiche.get("accesEmploi"),
        "appellations": _labels(metier.get("appellations"))[:12],
        "sectors": _labels(metier.get("secteursActivites"))[:8],
        "core_skills": core_skills[:20],
        "emerging_skills": emerging_skills[:12],
        "skill_groups": skill_groups[:8],
        "knowledge_groups": knowledge_groups[:8],
        "competence_tree": competence_tree[:8],
        "context_groups": context_groups[:8],
        "flags": {
            "cadre": metier.get("emploiCadre"),
            "digital_transition": metier.get("transitionNumerique"),
            "ecological_transition": metier.get("transitionEcologique"),
        },
        "sources": {
            "metiers": bool(metier),
            "fiches": bool(fiche),
            "competences": competences is not None,
            "contextes": contextes is not None or bool(context_groups),
        },
    }


async def fetch_rome_profile_raw(rome_code: str) -> Dict[str, Any]:
    code = normalize_rome_code(rome_code)
    if not code:
        return {"rome_code": rome_code, "error": "invalid_rome_code"}

    timeout = max(5.0, _env_float("ROME_API_TIMEOUT_SECONDS", 12.0))
    results: Dict[str, Any] = {"rome_code": code, "fetched_at": datetime.now(timezone.utc).isoformat()}
    async with httpx.AsyncClient(timeout=timeout) as client:
        for key in ("metiers", "fiches", "competences", "contextes"):
            path = ROME_PATHS[key].format(code=code)
            ok, data = await _api_get(client, scope=ROME_SCOPES[key], path=path)
            results[key] = data if ok else None
            if not ok and data:
                results.setdefault("errors", {})[key] = data
    return results


async def get_rome_profile(db, rome_code: str, *, rome_label: Optional[str] = None, force_refresh: bool = False) -> Dict[str, Any]:
    code = normalize_rome_code(rome_code)
    if not code:
        return {"available": False, "reason": "invalid_rome_code"}
    if not rome_profile_enabled():
        return {"available": False, "reason": "rome_profile_disabled"}

    cache_cutoff = datetime.now(timezone.utc) - timedelta(days=CACHE_DAYS)
    if db is not None and hasattr(db, "rome_profiles") and not force_refresh:
        cached = await db.rome_profiles.find_one({"rome_code": code}, {"_id": 0})
        if cached:
            fetched_at = cached.get("fetched_at")
            try:
                fetched_dt = datetime.fromisoformat(str(fetched_at).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                fetched_dt = None
            if fetched_dt and fetched_dt >= cache_cutoff:
                profile = cached.get("profile")
                if isinstance(profile, dict):
                    return {"available": True, "cached": True, **profile}

    raw = await fetch_rome_profile_raw(code)
    profile = build_public_rome_profile(
        code,
        metier=raw.get("metiers") if isinstance(raw.get("metiers"), dict) else None,
        fiche=raw.get("fiches") if isinstance(raw.get("fiches"), dict) else None,
        competences=raw.get("competences"),
        contextes=raw.get("contextes"),
        rome_label=rome_label,
    )
    has_content = any([
        profile.get("definition"),
        profile.get("core_skills"),
        profile.get("skill_groups"),
        profile.get("knowledge_groups"),
        profile.get("context_groups"),
    ])
    if not has_content:
        return {"available": False, "reason": "rome_profile_empty", "rome_code": code}

    doc = {
        "rome_code": code,
        "fetched_at": raw.get("fetched_at"),
        "profile": profile,
        "raw_sources": {
            key: raw.get(key) is not None
            for key in ("metiers", "fiches", "competences", "contextes")
        },
    }
    if db is not None and hasattr(db, "rome_profiles"):
        try:
            await db.rome_profiles.update_one({"rome_code": code}, {"$set": doc}, upsert=True)
        except Exception as exc:
            logger.warning("rome_profile_cache_write_failed code=%s error=%s", code, str(exc)[:200])
    return {"available": True, "cached": False, **profile}
