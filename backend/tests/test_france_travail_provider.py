import asyncio
import json
from unittest.mock import AsyncMock, patch

from job_providers.base import JobSearchQuery
from job_providers.config import is_job_provider_configured, primary_job_provider_name
from job_providers.france_travail import FranceTravailProvider


def test_france_travail_keywords_returns_single_term_no_and_semantics():
    # France Travail's motsCles treats comma-separated terms as a logical AND, so a
    # single motsCles value must never combine unrelated synonyms with commas.
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="Software Engineer",
        location="Dijon, France",
        country="fr",
        language="fr",
        radius_km=50,
    )
    keywords = provider._keywords(query)
    assert "," not in keywords
    assert "Software Engineer" not in keywords

    variants = provider._keyword_variants(query)
    assert "developpeur" in variants
    assert any("logiciel" in v or "informatique" in v for v in variants)
    assert all("," not in v for v in variants)


def test_france_travail_keywords_recruiter_use_french_tokens():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="Recruiter",
        location="Avignon, France",
        country="fr",
        language="fr",
        radius_km=50,
    )
    variants = provider._keyword_variants(query)
    assert "recruteur" in variants
    assert any("recrutement" in v for v in variants)
    assert "recruiter" not in variants
    assert all("," not in v for v in variants)


def test_france_travail_search_distance_uses_query_radius():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(role="developpeur", location="Dijon", country="fr", language="fr", radius_km=50)
    assert provider._search_distance_km(query) == 50


def test_france_travail_keywords_barista_use_hospitality_tokens():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="Barista",
        location="Beaune, France",
        country="fr",
        language="fr",
        radius_km=30,
    )
    variants = provider._keyword_variants(query)
    assert "barista" in variants
    assert any(v in ("serveur", "cafe") for v in variants)
    assert "vendeur" not in variants
    assert all("," not in v for v in variants)


def test_france_travail_empty_role_uses_location_only_without_mots_cles():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="",
        location="Auxerre",
        country="fr",
        language="fr",
        radius_km=50,
    )
    assert provider._keyword_variants(query) == []
    assert provider._keywords(query) == ""

    async def _run():
        with patch.object(provider, "_lookup_commune_code_and_departement", AsyncMock(return_value=("89024", "89"))):
            return await provider._search_param_variants(query)

    variants = asyncio.run(_run())
    assert len(variants) >= 1
    for variant in variants:
        assert "motsCles" not in variant
        assert variant.get("commune") == "89024" or variant.get("departement") == "89"


def test_france_travail_search_param_variants_dijon_tries_each_keyword_at_commune():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="Software Engineer",
        location="Dijon",
        country="fr",
        language="fr",
        radius_km=50,
    )

    async def _run():
        with patch.object(provider, "_lookup_commune_code_and_departement", AsyncMock(return_value=("21231", "21"))):
            return await provider._search_param_variants(query)

    variants = asyncio.run(_run())
    keyword_variants = provider._keyword_variants(query)
    # One variant per keyword candidate at the commune, plus a last-resort
    # department-wide fallback (using the primary keyword) if all of those miss.
    commune_variants = variants[: len(keyword_variants)]
    assert len(variants) == len(keyword_variants) + 1
    for variant, keyword in zip(commune_variants, keyword_variants):
        assert variant["commune"] == "21231"
        assert variant["distance"] == 50
        assert variant["motsCles"] == keyword
        assert "departement" not in variant
    # Distinct keyword per commune variant — no AND-joined comma list.
    assert len({v["motsCles"] for v in commune_variants}) == len(commune_variants)
    assert variants[-1]["departement"] == "21"
    assert variants[-1]["motsCles"] == keyword_variants[0]
    assert "commune" not in variants[-1]


def test_france_travail_search_param_variants_paris_uses_departement():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="Software Engineer",
        location="Paris, France",
        country="fr",
        language="fr",
        radius_km=50,
    )

    async def _run():
        with patch.object(provider, "_lookup_commune_code_and_departement", AsyncMock(return_value=("75056", "75"))):
            return await provider._search_param_variants(query)

    variants = asyncio.run(_run())
    keyword_variants = provider._keyword_variants(query)
    assert len(variants) == len(keyword_variants)
    for variant in variants:
        assert variant["departement"] == "75"
        assert "commune" not in variant


def test_france_travail_build_search_params_includes_commune_and_distance():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="Software Engineer",
        location="Dijon",
        country="fr",
        language="fr",
        radius_km=50,
    )

    async def _run():
        with patch.object(provider, "_lookup_commune_code_and_departement", AsyncMock(return_value=("21231", "21"))):
            return await provider._build_search_params(query)

    params = asyncio.run(_run())
    assert params["commune"] == "21231"
    assert params["distance"] == 50
    assert "developpeur" in params["motsCles"]
    assert "departement" not in params


def test_france_travail_build_search_params_falls_back_to_departement():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(role="developpeur", location="Unknownville", country="fr", language="fr", radius_km=50)

    async def _run():
        with patch.object(provider, "_lookup_commune_code_and_departement", AsyncMock(return_value=(None, "21"))):
            return await provider._build_search_params(query)

    params = asyncio.run(_run())
    assert params["departement"] == "21"
    assert "commune" not in params


def test_france_travail_normalization_maps_core_fields():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    job = provider.normalize_job(
        {
            "id": "048KLTP",
            "intitule": "Développeur web",
            "description": "Mission sur un produit SaaS.",
            "typeContrat": "CDI",
            "typeContratLibelle": "CDI",
            "dateCreation": "2026-06-01T10:00:00Z",
            "entreprise": {"nom": "Acme SAS"},
            "lieuTravail": {"libelle": "Lyon (69)", "commune": "Lyon", "codePostal": "69003"},
            "competences": [{"libelle": "JavaScript"}],
        },
        JobSearchQuery(role="développeur", location="Lyon, France", country="fr", language="fr"),
        "2026-07-03T10:00:00+00:00",
    )

    assert job is not None
    assert job["provider"] == "france_travail"
    assert job["external_id"] == "048KLTP"
    assert job["company"] == "Acme SAS"
    assert job["country_code"] == "fr"
    assert job["ats_provider"] == "francetravail"
    assert "francetravail.fr" in job["external_url"]
    assert job["employment_kind"] in ("full_time", "permanent", "fixed_term")
    assert job["manual_fulfillment_ready"] is True
    assert job["apply_fulfillment_status"] == "manual_ready"
    assert "francetravail.fr" in job["external_url"]


def test_france_travail_normalization_never_uses_entreprise_description_as_company():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    job = provider.normalize_job(
        {
            "id": "048ANON",
            "intitule": "Développeur web",
            "description": "Mission sur un produit SaaS.",
            "typeContrat": "CDI",
            "typeContratLibelle": "CDI",
            "dateCreation": "2026-06-01T10:00:00Z",
            "entreprise": {
                "description": "Notre entreprise est spécialisée dans le développement de solutions logicielles innovantes.",
            },
            "lieuTravail": {"libelle": "Lyon (69)", "commune": "Lyon", "codePostal": "69003"},
        },
        JobSearchQuery(role="développeur", location="Lyon, France", country="fr", language="fr"),
        "2026-07-03T10:00:00+00:00",
    )

    assert job is not None
    assert job["company"] == "Entreprise confidentielle"


def test_france_travail_normalization_extracts_offer_details_and_salary():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    job = provider.normalize_job(
        {
            "id": "048SAL1",
            "intitule": "Commercial B2B",
            "description": "Développement commercial.",
            "typeContrat": "CDI",
            "typeContratLibelle": "CDI",
            "natureContrat": "E1",
            "natureContratLibelle": "Contrat travail",
            "dureeTravailLibelle": "39H/semaine Travail en journée",
            "deplacementLibelle": "Déplacements : Fréquents",
            "entreprise": {"nom": "Acme SAS"},
            "lieuTravail": {"libelle": "Lyon (69)", "commune": "Lyon"},
            "salaire": {
                "libelle": "Salaire brut : Annuel de 26400.0 Euros à 45000.0 Euros sur 12 mois",
                "complement1": "26400€ à 45000€ / An ( fixe + variable )",
                "listeComplements": [
                    {"code": "TEL", "libelle": "Téléphone mobile"},
                    {"code": "PC", "libelle": "Ordinateur portable"},
                    {"code": "TR", "libelle": "Titres restaurant / Prime de panier"},
                    {"code": "MUT", "libelle": "Complémentaire santé"},
                ],
            },
        },
        JobSearchQuery(role="commercial", location="Lyon, France", country="fr", language="fr"),
        "2026-07-03T10:00:00+00:00",
    )

    assert job is not None
    assert job["salary_min"] == 26400
    assert job["salary_max"] == 45000
    assert "Annuel de 26400.0 Euros" in job["salary_label"]
    details = {item["key"]: item for item in job["offer_details"]}
    assert details["contract_type"]["value"] == "CDI"
    assert details["contract_nature"]["value"] == "Contrat travail"
    assert "39H" in details["work_schedule"]["value"]
    assert details["benefits"]["items"] == [
        "Téléphone mobile",
        "Ordinateur portable",
        "Titres restaurant / Prime de panier",
        "Complémentaire santé",
    ]
    assert details["travel"]["value"] == "Déplacements : Fréquents"


def test_france_travail_normalization_uses_direct_apply_url_when_available():
    """When the recruiter provided contact.urlPostulation to their own ATS,
    the job should be routed there (and auto-apply enabled) instead of being
    forced through the France-Travail-only manual flow."""
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    job = provider.normalize_job(
        {
            "id": "048XYZQ",
            "intitule": "Ingénieur logiciel",
            "description": "Rejoins notre équipe produit.",
            "entreprise": {"nom": "Acme SAS"},
            "lieuTravail": {"libelle": "Paris (75)", "commune": "Paris"},
            "contact": {"urlPostulation": "https://boards.greenhouse.io/acme/jobs/12345"},
        },
        JobSearchQuery(role="ingenieur logiciel", location="Paris, France", country="fr", language="fr"),
        "2026-07-03T10:00:00+00:00",
    )

    assert job is not None
    assert job["external_url"] == "https://boards.greenhouse.io/acme/jobs/12345"
    assert job["ats_provider"] == "greenhouse"
    assert job["auto_apply_supported"] is True
    assert job["ft_detail_url"].startswith("https://candidat.francetravail.fr/")


def test_france_travail_normalization_extracts_contact_email():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    job = provider.normalize_job(
        {
            "id": "048ABCD",
            "intitule": "Serveur",
            "description": "Restaurant cherche serveur.",
            "entreprise": {"nom": "Le Bistrot"},
            "lieuTravail": {"libelle": "Lyon (69)", "commune": "Lyon"},
            "contact": {"nom": "Mme Dupont", "courriel": "recrutement@bistrot.fr", "telephone": "0102030405"},
        },
        JobSearchQuery(role="serveur", location="Lyon, France", country="fr", language="fr"),
        "2026-07-03T10:00:00+00:00",
    )

    assert job is not None
    assert job["contact_name"] == "Mme Dupont"
    assert job["contact_email"] == "recrutement@bistrot.fr"
    assert job["contact_phone"] == "0102030405"
    assert job["ats_provider"] == "francetravail"
    assert job["auto_apply_supported"] is False


def test_france_travail_normalization_extracts_email_from_commentaire(monkeypatch):
    monkeypatch.setenv("FRANCE_TRAVAIL_EMPLOYER_ENRICH", "false")
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    job = provider.normalize_job(
        {
            "id": "048MAIL",
            "intitule": "Assistant",
            "description": "Poste en entreprise.",
            "entreprise": {"nom": "Acme"},
            "lieuTravail": {"libelle": "Lyon (69)", "commune": "Lyon"},
            "contact": {"commentaire": "Envoyez votre CV à rh@acme.fr"},
        },
        JobSearchQuery(role="assistant", location="Lyon, France", country="fr", language="fr"),
        "2026-07-03T10:00:00+00:00",
    )

    assert job is not None
    assert job["contact_email"] == "rh@acme.fr"


def test_france_travail_direct_apply_url_ignored_when_pointing_back_to_ft():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    job = provider.normalize_job(
        {
            "id": "048LOOP",
            "intitule": "Comptable",
            "description": "Cabinet comptable recrute.",
            "entreprise": {"nom": "Cabinet Martin"},
            "lieuTravail": {"libelle": "Nice (06)", "commune": "Nice"},
            "contact": {"urlPostulation": "https://candidat.francetravail.fr/offres/recherche/detail/048LOOP"},
        },
        JobSearchQuery(role="comptable", location="Nice, France", country="fr", language="fr"),
        "2026-07-03T10:00:00+00:00",
    )

    assert job is not None
    assert job["ats_provider"] == "francetravail"
    assert job["auto_apply_supported"] is False
    assert job["manual_fulfillment_ready"] is True


def test_france_travail_publiee_depuis_uses_summer_ttl():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="vendeur",
        location="Nice, France",
        country="fr",
        language="fr",
        contract_hint="job été",
    )
    assert provider._publiee_depuis_days(query) == 7


def test_france_travail_publiee_depuis_uses_permanent_ttl():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(
        role="comptable",
        location="Paris, France",
        country="fr",
        language="fr",
        contract_hint="CDI",
    )
    assert provider._publiee_depuis_days(query) == 31


def test_is_job_provider_configured_for_france_travail(monkeypatch):
    monkeypatch.setenv("JOB_PROVIDER_PRIMARY", "france_travail")
    monkeypatch.delenv("FRANCE_TRAVAIL_CLIENT_ID", raising=False)
    monkeypatch.delenv("FRANCE_TRAVAIL_CLIENT_SECRET", raising=False)
    assert is_job_provider_configured() is False

    monkeypatch.setenv("FRANCE_TRAVAIL_CLIENT_ID", "PAR_test")
    monkeypatch.setenv("FRANCE_TRAVAIL_CLIENT_SECRET", "secret")
    assert is_job_provider_configured() is True
    assert primary_job_provider_name() == "france_travail"


def test_france_travail_search_falls_through_keyword_variants_until_results_found():
    """Reproduces the reported bug: the first (most specific) keyword yields 204 No
    Content, but a later synonym in the same city/commune does have offers. The
    provider must try each keyword one request at a time and keep the first hit.
    """
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    token_response = AsyncMock()
    token_response.raise_for_status = lambda: None
    token_response.json = lambda: {"access_token": "token-123", "expires_in": 1500}

    empty_response = AsyncMock()
    empty_response.status_code = 204
    empty_response.content = b""
    empty_response.raise_for_status = lambda: None

    hit_response = AsyncMock()
    hit_response.status_code = 200
    hit_response.content = json.dumps(
        {
            "resultats": [
                {
                    "id": "XYZ789",
                    "intitule": "Serveur en restauration",
                    "description": "Service en salle.",
                    "entreprise": {"nom": "Cafe du Coin"},
                    "lieuTravail": {"libelle": "Auxerre (89)"},
                    "typeContrat": "CDD",
                }
            ]
        }
    ).encode("utf-8")
    hit_response.json = lambda: json.loads(hit_response.content)
    hit_response.raise_for_status = lambda: None

    client = AsyncMock()
    client.post = AsyncMock(return_value=token_response)
    client.get = AsyncMock(side_effect=[empty_response, hit_response, hit_response])

    async def _run():
        with patch.object(provider, "_lookup_commune_code_and_departement", AsyncMock(return_value=("89024", "89"))):
            with patch("job_providers.france_travail.httpx.AsyncClient") as client_cls:
                client_cls.return_value.__aenter__.return_value = client
                return await provider.search(
                    JobSearchQuery(role="Barista", location="Auxerre, France", country="fr", language="fr", limit=5)
                )

    result = asyncio.run(_run())

    assert len(result.jobs) == 1
    assert result.jobs[0]["title"] == "Serveur en restauration"
    # First keyword attempt got 204; second attempt found the job and we stopped there.
    assert client.get.await_count == 2
    first_call_params = client.get.await_args_list[0].kwargs["params"]
    second_call_params = client.get.await_args_list[1].kwargs["params"]
    assert first_call_params["motsCles"] != second_call_params["motsCles"]
    assert "," not in first_call_params["motsCles"]
    assert "," not in second_call_params["motsCles"]


def test_france_travail_search_parses_results():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    token_response = AsyncMock()
    token_response.raise_for_status = lambda: None
    token_response.json = lambda: {"access_token": "token-123", "expires_in": 1500}

    search_response = AsyncMock()
    search_response.status_code = 200
    search_response.content = json.dumps(
        {
            "resultats": [
                {
                    "id": "ABC123",
                    "intitule": "Assistant commercial",
                    "description": "Accueil client.",
                    "entreprise": {"nom": "Retail Co"},
                    "lieuTravail": {"libelle": "Bordeaux (33)"},
                    "typeContrat": "CDD",
                }
            ]
        }
    ).encode("utf-8")
    search_response.json = lambda: json.loads(search_response.content)
    search_response.raise_for_status = lambda: None

    client = AsyncMock()
    client.post = AsyncMock(return_value=token_response)
    client.get = AsyncMock(return_value=search_response)

    async def _run():
        with patch.object(provider, "_lookup_commune_code", AsyncMock(return_value="33063")):
            with patch("job_providers.france_travail.httpx.AsyncClient") as client_cls:
                client_cls.return_value.__aenter__.return_value = client
                return await provider.search(
                    JobSearchQuery(role="commercial", location="Bordeaux, France", country="fr", language="fr", limit=5)
                )

    result = asyncio.run(_run())

    assert len(result.jobs) == 1
    assert result.jobs[0]["title"] == "Assistant commercial"
    assert result.jobs[0]["provider"] == "france_travail"


def test_france_travail_repeated_full_page_fails_closed():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")

    async def _run():
        response = AsyncMock()
        response.status_code = 206
        response.content = b'{"resultats":[{"id":"A"}]}'
        response.json = lambda: {"resultats": [{"id": "A"}]}
        response.raise_for_status = lambda: None
        response.headers = {}
        client = AsyncMock()
        client.get = AsyncMock(return_value=response)
        with patch.object(provider, "_pace_request", AsyncMock()):
            return await provider._fetch_search_pages(
                client, {}, {}, page_size=1, max_pages=2, target_count=2, seen_ids=set()
            )

    try:
        asyncio.run(_run())
        assert False, "expected incomplete pagination to fail"
    except RuntimeError as exc:
        assert "all-duplicate page" in str(exc)


def test_france_travail_content_range_total_mismatch_fails_closed():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")

    async def _run():
        response = AsyncMock()
        response.status_code = 200
        response.content = b'{"resultats":[{"id":"A"}]}'
        response.json = lambda: {"resultats": [{"id": "A"}]}
        response.raise_for_status = lambda: None
        response.headers = {"Content-Range": "items 0-0/2"}
        client = AsyncMock()
        client.get = AsyncMock(return_value=response)
        with patch.object(provider, "_pace_request", AsyncMock()):
            return await provider._fetch_search_pages(
                client, {}, {}, page_size=1, max_pages=1, target_count=2, seen_ids=set()
            )

    try:
        asyncio.run(_run())
        assert False, "expected source-total mismatch to fail"
    except RuntimeError as exc:
        assert "source total 2" in str(exc)


def test_france_travail_max_pages_before_exhaustion_fails_closed():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")

    async def _run():
        response = AsyncMock()
        response.status_code = 206
        response.content = b'{"resultats":[{"id":"A"}]}'
        response.json = lambda: {"resultats": [{"id": "A"}]}
        response.raise_for_status = lambda: None
        response.headers = {}
        client = AsyncMock()
        client.get = AsyncMock(return_value=response)
        with patch.object(provider, "_pace_request", AsyncMock()):
            return await provider._fetch_search_pages(
                client, {}, {}, page_size=1, max_pages=1, target_count=2, seen_ids=set()
            )

    try:
        asyncio.run(_run())
        assert False, "expected local cap to fail"
    except RuntimeError as exc:
        assert "max_pages=1" in str(exc)
