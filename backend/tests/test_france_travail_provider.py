import asyncio
import json
from unittest.mock import AsyncMock, patch

from job_providers.base import JobSearchQuery
from job_providers.config import is_job_provider_configured, primary_job_provider_name
from job_providers.france_travail import FranceTravailProvider


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
    assert provider._publiee_depuis_days(query) == 30


def test_is_job_provider_configured_for_france_travail(monkeypatch):
    monkeypatch.setenv("JOB_PROVIDER_PRIMARY", "france_travail")
    monkeypatch.delenv("FRANCE_TRAVAIL_CLIENT_ID", raising=False)
    monkeypatch.delenv("FRANCE_TRAVAIL_CLIENT_SECRET", raising=False)
    assert is_job_provider_configured() is False

    monkeypatch.setenv("FRANCE_TRAVAIL_CLIENT_ID", "PAR_test")
    monkeypatch.setenv("FRANCE_TRAVAIL_CLIENT_SECRET", "secret")
    assert is_job_provider_configured() is True
    assert primary_job_provider_name() == "france_travail"


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
