import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import france_travail_harvest as harvest_module
from france_travail_harvest import harvest_france_travail, _harvest_cities
from job_providers.base import ProviderResult


class _FakeProvider:
    def __init__(self):
        self.queries = []

    async def search(self, query):
        self.queries.append(query)
        job = {
            "job_id": f"ft_{len(self.queries)}",
            "provider": "france_travail",
            "external_id": f"ext_{len(self.queries)}",
            "title": "Offer",
            "company": "Company Test",
            "location": query.location,
            "country_code": "fr",
            "external_url": "https://candidat.francetravail.fr/offres/recherche/detail/x",
        }
        return ProviderResult(jobs=[job])


class _FakeCollection:
    def __init__(self):
        self.upserts = []

    async def update_one(self, query, update, upsert=False):
        self.upserts.append((query, update, upsert))


class _FakeDb:
    def __init__(self):
        self.jobs = _FakeCollection()


def test_harvest_cities_default_top_ten(monkeypatch):
    monkeypatch.delenv("FT_HARVEST_CITIES", raising=False)
    monkeypatch.delenv("FT_HARVEST_LOCATIONS", raising=False)
    cities = _harvest_cities()
    assert cities[0] == "Paris"
    assert len(cities) == 10


def test_harvest_rotates_cities_city_only(monkeypatch):
    fake_provider = _FakeProvider()
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": fake_provider)
    monkeypatch.setenv("FT_HARVEST_CITIES", "Paris,Lyon,Marseille")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0.01")
    db = _FakeDb()

    summary = asyncio.run(harvest_france_travail(db, max_queries=3, start_offset=0))

    assert summary["mode"] == "city_only"
    assert summary["queries_planned"] == 3
    assert summary["jobs_fetched"] == 3
    assert fake_provider.queries[0].role == ""
    assert fake_provider.queries[0].location == "Paris, France"
    assert fake_provider.queries[1].location == "Lyon, France"
    assert fake_provider.queries[2].location == "Marseille, France"


def test_harvest_dry_run_does_not_write(monkeypatch):
    fake_provider = _FakeProvider()
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": fake_provider)
    monkeypatch.setenv("FT_HARVEST_CITIES", "Paris")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0.01")
    db = _FakeDb()

    summary = asyncio.run(harvest_france_travail(db, max_queries=1, dry_run=True, start_offset=0))

    assert summary["jobs_fetched"] == 1
    assert summary["jobs_upserted"] == 0
    assert db.jobs.upserts == []
