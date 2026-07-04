"""France Travail Offres d'emploi v2 provider integration."""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx

from employment_kind import enrich_job_employment_kind
from job_normalization import normalize_company_logo_url
from .apply_eligibility import classify_apply_link
from .ats_detection import detect_job_platform
from .base import JobSearchQuery, ProviderResult

_TOKEN_CACHE: Dict[str, Any] = {"access_token": None, "expires_at": 0.0}

_CONTRACT_HINT_TO_TYPE_CONTRAT = {
    "cdi": "CDI",
    "cdd": "CDD",
    "alternance": "E1,E2",
    "stage": "STG",
    "job été": "SAISON",
    "job ete": "SAISON",
    "saisonnier": "SAISON",
    "freelance": "MIS",
}

_DEPARTEMENT_RE = re.compile(r"\b(\d{2}|2[AB])\b", re.IGNORECASE)

# France Travail expects arrondissement INSEE codes for Paris/Lyon/Marseille, not global city codes.
_MUNICIPALITY_AGGREGATION_CODES = {"75056", "69123", "13055"}
_MEGA_CITY_DEPARTEMENT = {
    "paris": "75",
    "lyon": "69",
    "marseille": "13",
}

_ROLE_KEYWORD_HINTS = {
    "software": ("developpeur", "logiciel", "informatique", "programmeur"),
    "engineer": ("ingenieur", "ingenieur logiciel"),
    "developer": ("developpeur", "logiciel", "informatique"),
    "frontend": ("frontend", "front-end", "web"),
    "backend": ("backend", "back-end", "serveur"),
    "fullstack": ("fullstack", "full-stack"),
    "data": ("data", "donnees", "analyste"),
    "analyst": ("analyste", "etudes"),
    "marketing": ("marketing", "communication", "digital"),
    "commercial": ("commercial", "vente", "vendeur"),
    "product": ("produit", "chef de produit"),
    "manager": ("manager", "responsable", "chef"),
}


def _ascii_fold(value: str) -> str:
    return unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii").lower()


def _france_travail_keyword_tokens(role: str, country: Optional[str]) -> List[str]:
    normalized = " ".join((role or "").split()) or "emploi"
    lower = _ascii_fold(normalized)
    tokens: List[str] = []
    if (country or "").lower() in ("fr", "france", ""):
        if any(term in lower for term in ("software", "engineer", "developer", "full stack", "full-stack", "frontend", "backend", "devops")):
            tokens.extend(["developpeur", "logiciel", "informatique", "ingenieur"])
        elif "data" in lower and "analyst" in lower:
            tokens.extend(["analyste", "data", "donnees"])
        elif "analyst" in lower:
            tokens.extend(["analyste", "etudes"])
        elif "marketing" in lower:
            tokens.extend(["marketing", "communication", "digital"])
        elif any(term in lower for term in ("sales", "commercial")):
            tokens.extend(["commercial", "vente", "vendeur"])
        elif "product" in lower and "manager" in lower:
            tokens.extend(["chef de produit", "product manager"])
        for token in re.findall(r"[a-z0-9]+", lower):
            if len(token) >= 3:
                tokens.extend(list(_ROLE_KEYWORD_HINTS.get(token, ())))
    for token in re.findall(r"[a-z0-9]+", lower):
        if len(token) >= 3:
            tokens.append(token)
    deduped: List[str] = []
    seen = set()
    for token in tokens:
        cleaned = token.strip().lower()
        if len(cleaned) < 2 or cleaned in seen:
            continue
        seen.add(cleaned)
        deduped.append(cleaned)
    return deduped[:8] or ["emploi"]


class FranceTravailProvider:
    name = "france_travail"

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        token_url: Optional[str] = None,
        api_base_url: Optional[str] = None,
        scope: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.token_url = (
            token_url
            or os.environ.get("FRANCE_TRAVAIL_TOKEN_URL")
            or "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire"
        )
        self.api_base_url = (
            api_base_url
            or os.environ.get("FRANCE_TRAVAIL_API_BASE_URL")
            or "https://api.francetravail.io"
        ).rstrip("/")
        self.search_url = (
            os.environ.get("FRANCE_TRAVAIL_SEARCH_URL")
            or f"{self.api_base_url}/partenaire/offresdemploi/v2/offres/search"
        )
        self.scope = scope or os.environ.get("FRANCE_TRAVAIL_SCOPE") or "api_offresdemploiv2 o2dsoffre"
        if timeout is None:
            try:
                timeout = float(os.environ.get("FRANCE_TRAVAIL_HTTP_TIMEOUT_SECONDS", "12"))
            except (TypeError, ValueError):
                timeout = 12.0
        self.timeout = max(1.0, min(float(timeout), 30.0))

    async def search(self, query: JobSearchQuery) -> ProviderResult:
        country = (query.country or "fr").lower()
        if country not in ("fr", "france"):
            return ProviderResult(jobs=[], raw_response={"skipped": "non_france_country"})

        params = await self._build_search_params(query)
        page_size = max(1, min(int(query.page_size or self._env_int("FRANCE_TRAVAIL_PAGE_SIZE", 50)), 150))
        max_pages = max(1, min(int(query.max_pages or self._env_int("FRANCE_TRAVAIL_MAX_PAGES", 2)), 10))
        target_count = max(query.limit, min(page_size * max_pages, 300))
        min_results_before_fallback = max(1, self._env_int("FRANCE_TRAVAIL_MIN_RESULTS_BEFORE_FALLBACK", 8))

        param_variants = await self._search_param_variants(query)
        payloads: List[Any] = []
        rows: List[Dict[str, Any]] = []
        seen_ids = set()
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            token = await self._get_access_token(client)
            headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
            for variant_index, variant_params in enumerate(param_variants):
                if variant_index > 0:
                    if len(rows) >= min_results_before_fallback:
                        break
                    await asyncio.sleep(self._request_interval())
                variant_rows, variant_payloads = await self._fetch_search_pages(
                    client,
                    headers,
                    variant_params,
                    page_size=page_size,
                    max_pages=max_pages,
                    target_count=target_count - len(rows),
                    seen_ids=seen_ids,
                )
                payloads.extend(variant_payloads)
                rows.extend(variant_rows)
                if len(rows) >= target_count:
                    break

        imported_at = datetime.now(timezone.utc).isoformat()
        jobs = [self.normalize_job(row, query, imported_at) for row in rows[:target_count]]
        jobs = [job for job in jobs if job is not None]
        return ProviderResult(
            raw_response={"pages": payloads, "rows_seen": len(rows), "params_variants": param_variants},
            jobs=jobs[:target_count],
        )

    async def _fetch_search_pages(
        self,
        client: httpx.AsyncClient,
        headers: Dict[str, str],
        params: Dict[str, Any],
        *,
        page_size: int,
        max_pages: int,
        target_count: int,
        seen_ids: set,
    ) -> Tuple[List[Dict[str, Any]], List[Any]]:
        payloads: List[Any] = []
        rows: List[Dict[str, Any]] = []
        for page_index in range(max_pages):
            if len(rows) >= target_count:
                break
            if page_index > 0:
                await asyncio.sleep(self._request_interval())
            start = page_index * page_size
            end = start + page_size - 1
            page_params = dict(params)
            page_params["range"] = f"{start}-{end}"
            response = await client.get(self.search_url, params=page_params, headers=headers)
            if response.status_code == 204:
                break
            if response.status_code == 429:
                retry_after = self._retry_after_seconds(response)
                await asyncio.sleep(retry_after)
                response = await client.get(self.search_url, params=page_params, headers=headers)
            response.raise_for_status()
            payload = response.json() if response.content else {}
            payloads.append({"status_code": response.status_code, "payload": payload, "params": page_params})
            page_rows = self._extract_offers(payload)
            new_rows = 0
            for row in page_rows:
                external_id = row.get("id")
                dedupe_key = str(external_id or hashlib.sha1(repr(sorted(row.items())).encode("utf-8")).hexdigest())
                if dedupe_key in seen_ids:
                    continue
                seen_ids.add(dedupe_key)
                rows.append(row)
                new_rows += 1
            has_more = response.status_code == 206 or bool(payload.get("has_more"))
            if not page_rows or new_rows == 0 or len(rows) >= target_count or not has_more:
                break
        return rows, payloads

    async def _search_param_variants(self, query: JobSearchQuery) -> List[Dict[str, Any]]:
        base = await self._build_search_params(query)
        city = (query.location or "").split(",")[0].strip().lower()
        distance = self._search_distance_km(query)
        _, _, departement = await self._commune_distance_departement(query)
        variants: List[Dict[str, Any]] = []

        if city in _MEGA_CITY_DEPARTEMENT:
            variants.append({**base, "departement": _MEGA_CITY_DEPARTEMENT[city]})
            for key in ("commune", "distance"):
                variants[0].pop(key, None)
            return variants

        commune = base.get("commune")
        if commune and str(commune) not in _MUNICIPALITY_AGGREGATION_CODES:
            variants.append(dict(base))

        dept_code = departement or base.get("departement") or _MEGA_CITY_DEPARTEMENT.get(city)
        if dept_code:
            dept_params = dict(base)
            dept_params.pop("commune", None)
            dept_params.pop("distance", None)
            dept_params["departement"] = str(dept_code)
            if not variants or dept_params != variants[0]:
                variants.append(dept_params)

        return variants or [base]

    async def _build_search_params(self, query: JobSearchQuery) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "motsCles": self._keywords(query),
            "sort": "1",
            "publieeDepuis": self._publiee_depuis_days(query),
        }
        type_contrat = self._type_contrat(query.contract_hint)
        if type_contrat:
            params["typeContrat"] = type_contrat
        commune, distance, departement = await self._commune_distance_departement(query)
        if commune and str(commune) not in _MUNICIPALITY_AGGREGATION_CODES:
            params["commune"] = commune
            params["distance"] = distance
        elif departement:
            params["departement"] = departement
        else:
            departement = self._departement_from_location(query.location)
            if departement:
                params["departement"] = departement
        return params

    def normalize_job(
        self,
        row: Dict[str, Any],
        query: JobSearchQuery,
        imported_at: str,
    ) -> Optional[Dict[str, Any]]:
        external_id = row.get("id")
        title = row.get("intitule")
        entreprise = row.get("entreprise") if isinstance(row.get("entreprise"), dict) else {}
        company = entreprise.get("nom") or entreprise.get("enseigne") or entreprise.get("description")
        if not external_id or not title or not company:
            return None

        external_url = (
            f"https://candidat.francetravail.fr/offres/recherche/detail/{quote(str(external_id), safe='')}"
        )
        source = "France Travail"
        apply_classification = classify_apply_link(external_url, source=source)
        selected_apply_url = apply_classification.get("selected_apply_url") or external_url
        platform = detect_job_platform(selected_apply_url)
        ats_provider = platform.get("ats_provider") or "francetravail"
        contract_type = row.get("typeContrat")
        contract_label = row.get("typeContratLibelle")
        description = self._description(row)
        lieu = row.get("lieuTravail") if isinstance(row.get("lieuTravail"), dict) else {}
        salaire = row.get("salaire") if isinstance(row.get("salaire"), dict) else {}
        requirements = self._requirements(row)
        city = str(lieu.get("commune") or "").strip()
        region = str(lieu.get("libelle") or "").strip()

        job_doc = {
            "job_id": self._internal_job_id(str(external_id)),
            "title": title,
            "company": company,
            "company_logo": normalize_company_logo_url(entreprise.get("logo")),
            "location": self._location(lieu),
            "city": city or None,
            "region": region or None,
            "country_code": "fr",
            "remote": self._remote(row, description),
            "salary_min": self._salary(salaire.get("salaireMin") or salaire.get("complement1")),
            "salary_max": self._salary(salaire.get("salaireMax") or salaire.get("complement2")),
            "currency": "EUR",
            "description": description,
            "requirements": requirements,
            "tech_stack": [],
            "seniority": self._seniority(title, row.get("experienceExige")),
            "posted_at": row.get("dateActualisation") or row.get("dateCreation") or imported_at,
            "provider": self.name,
            "external_id": str(external_id),
            "external_url": selected_apply_url,
            "source": source,
            "ats_provider": ats_provider,
            "auto_apply_supported": False,
            "auto_apply_reason": "France Travail offers require candidate account fulfillment",
            **apply_classification,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "provider_query": self._keywords(query),
            "provider_search_key": self.search_key(query),
            "raw_provider_payload": row if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }
        if contract_type:
            job_doc["contract_type"] = contract_type
            job_doc["employment_type"] = contract_label or contract_type
        if row.get("romeCode"):
            job_doc["rome_code"] = row.get("romeCode")
        if row.get("romeLibelle"):
            job_doc["rome_label"] = row.get("romeLibelle")
        return enrich_job_employment_kind(job_doc)

    def search_key(self, query: JobSearchQuery) -> str:
        remote_preference = "remote" if (query.remote_preference or "").strip().lower() == "remote" else "any"
        bits = [
            self.name,
            (query.role or "").strip().lower(),
            (query.location or "").strip().lower(),
            remote_preference,
            "fr",
            query.language.lower(),
            (query.contract_hint or "").strip().lower(),
        ]
        return ":".join(bits)

    async def _get_access_token(self, client: httpx.AsyncClient) -> str:
        now = time.time()
        cached = _TOKEN_CACHE.get("access_token")
        expires_at = float(_TOKEN_CACHE.get("expires_at") or 0.0)
        if cached and now < expires_at - 30:
            return str(cached)

        response = await client.post(
            self.token_url,
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": self.scope,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()
        payload = response.json()
        token = payload.get("access_token")
        if not token:
            raise ValueError("France Travail token response missing access_token")
        expires_in = int(payload.get("expires_in") or 1500)
        _TOKEN_CACHE["access_token"] = token
        _TOKEN_CACHE["expires_at"] = now + max(60, expires_in)
        return str(token)

    def _extract_offers(self, payload: Any) -> List[Dict[str, Any]]:
        if not isinstance(payload, dict):
            return []
        resultats = payload.get("resultats")
        if isinstance(resultats, list):
            return [row for row in resultats if isinstance(row, dict)]
        return []

    def _keywords(self, query: JobSearchQuery) -> str:
        tokens = _france_travail_keyword_tokens(query.role, query.country)
        hint = (query.contract_hint or "").strip()
        if hint:
            hint_token = _ascii_fold(hint).replace(" ", "")
            if hint_token and hint_token not in tokens:
                tokens.append(hint_token)
        return ",".join(tokens)

    def _publiee_depuis_days(self, query: JobSearchQuery) -> int:
        hint = (query.contract_hint or "").lower()
        if any(token in hint for token in ("été", "ete", "saison", "summer")):
            return max(1, self._env_int("FRANCE_TRAVAIL_PUBLIEE_DEPUIS_SUMMER_DAYS", 7))
        if "cdi" in hint:
            return max(1, self._env_int("FRANCE_TRAVAIL_PUBLIEE_DEPUIS_PERMANENT_DAYS", 30))
        return max(1, self._env_int("FRANCE_TRAVAIL_PUBLIEE_DEPUIS_DAYS", 30))

    def _type_contrat(self, contract_hint: Optional[str]) -> Optional[str]:
        if not contract_hint:
            return None
        normalized = contract_hint.strip().lower()
        if normalized in _CONTRACT_HINT_TO_TYPE_CONTRAT:
            return _CONTRACT_HINT_TO_TYPE_CONTRAT[normalized]
        if normalized == "cdi":
            return "CDI"
        if normalized == "cdd":
            return "CDD"
        return None

    def _departement_from_location(self, location: Optional[str]) -> Optional[str]:
        if not location:
            return None
        match = _DEPARTEMENT_RE.search(location)
        if not match:
            return None
        return match.group(1).upper().replace("ab", "2A").replace("AB", "2A")

    async def _commune_distance_departement(self, query: JobSearchQuery) -> Tuple[Optional[str], int, Optional[str]]:
        distance = self._search_distance_km(query)
        location = (query.location or "").strip()
        if not location:
            return None, distance, None
        city = location.split(",")[0].strip()
        if not city or len(city) < 2:
            return None, distance, None
        commune_code, departement = await self._lookup_commune_code_and_departement(city)
        return commune_code, distance, departement

    def _search_distance_km(self, query: JobSearchQuery) -> int:
        if query.radius_km is not None:
            return max(0, min(int(query.radius_km), 200))
        return max(0, min(self._env_int("FRANCE_TRAVAIL_SEARCH_DISTANCE_KM", 30), 200))

    async def _lookup_commune_code(self, city_name: str) -> Optional[str]:
        commune_code, _departement = await self._lookup_commune_code_and_departement(city_name)
        return commune_code

    async def _lookup_commune_code_and_departement(self, city_name: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    "https://geo.api.gouv.fr/communes",
                    params={
                        "nom": city_name,
                        "fields": "nom,code,codesPostaux,departement,population",
                        "boost": "population",
                        "limit": 5,
                    },
                )
                response.raise_for_status()
                rows = response.json()
                if not isinstance(rows, list) or not rows:
                    return None, None
                best = max(rows, key=lambda row: int(row.get("population") or 0))
                code = best.get("code")
                departement = best.get("departement")
                if isinstance(departement, dict):
                    departement_code = departement.get("code")
                else:
                    departement_code = None
                if not departement_code and code:
                    departement_code = str(code)[:2]
                return (str(code) if code else None, str(departement_code) if departement_code else None)
        except Exception:
            return None, None

    def _internal_job_id(self, external_id: str) -> str:
        digest = hashlib.sha1(f"{self.name}:{external_id}".encode("utf-8")).hexdigest()[:16]
        return f"job_{digest}"

    def _location(self, lieu: Dict[str, Any]) -> str:
        if lieu.get("libelle"):
            return str(lieu["libelle"])
        parts = [lieu.get("commune"), lieu.get("codePostal")]
        return ", ".join([str(part) for part in parts if part]) or "France"

    def _description(self, row: Dict[str, Any]) -> str:
        description = row.get("description")
        if isinstance(description, str) and description.strip():
            return description.strip()
        parts = []
        for key in ("romeLibelle", "typeContratLibelle"):
            value = row.get(key)
            if value:
                parts.append(str(value))
        return "\n".join(parts)

    def _requirements(self, row: Dict[str, Any]) -> List[str]:
        out: List[str] = []
        competences = row.get("competences") or []
        if isinstance(competences, list):
            for item in competences[:8]:
                if isinstance(item, dict):
                    label = item.get("libelle") or item.get("code")
                    if label:
                        out.append(str(label))
        formations = row.get("formations") or []
        if isinstance(formations, list):
            for item in formations[:4]:
                if isinstance(item, dict):
                    label = item.get("niveauLibelle") or item.get("exigenceLibelle")
                    if label:
                        out.append(str(label))
        return out

    def _remote(self, row: Dict[str, Any], description: str) -> str:
        text = " ".join(
            [
                str(row.get("intitule") or ""),
                description,
                str((row.get("lieuTravail") or {}).get("libelle") if isinstance(row.get("lieuTravail"), dict) else ""),
            ]
        ).lower()
        if "télétravail" in text or "teletravail" in text or "remote" in text:
            return "remote"
        if "hybride" in text or "hybrid" in text:
            return "hybrid"
        return "onsite"

    def _salary(self, value: Any) -> Optional[int]:
        try:
            if value is None:
                return None
            return int(float(value))
        except (TypeError, ValueError):
            return None

    def _seniority(self, title: str, experience_exige: Any) -> Optional[str]:
        code = str(experience_exige or "").upper()
        if code == "D":
            return "junior"
        text = (title or "").lower()
        if any(token in text for token in ("senior", "confirmé", "confirme", "expert")):
            return "senior"
        if any(token in text for token in ("junior", "débutant", "debutant", "stage", "alternance")):
            return "junior"
        return "mid"

    def _request_interval(self) -> float:
        return max(0.5, self._env_float("FRANCE_TRAVAIL_REQUEST_INTERVAL_SECONDS", 1.0))

    def _retry_after_seconds(self, response: httpx.Response) -> float:
        raw = response.headers.get("Retry-After")
        try:
            if raw:
                return max(0.5, min(float(raw), 30.0))
        except (TypeError, ValueError):
            pass
        return 1.0

    def _env_int(self, name: str, default: int) -> int:
        try:
            return int(os.environ.get(name, default))
        except (TypeError, ValueError):
            return default

    def _env_float(self, name: str, default: float) -> float:
        try:
            return float(os.environ.get(name, default))
        except (TypeError, ValueError):
            return default
