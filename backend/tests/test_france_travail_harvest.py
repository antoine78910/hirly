import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import france_travail_harvest as harvest_module
from france_travail_harvest import harvest_france_travail, _harvest_combos
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
            "title": "Barista",
            "company": "Cafe Test",
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


def test_harvest_combos_cover_cities_and_roles(monkeypatch):
    monkeypatch.delenv("FT_HARVEST_LOCATIONS", raising=False)
    monkeypatch.delenv("FT_HARVEST_ROLES", raising=False)
    combos = _harvest_combos()
    assert len(combos) == len(harvest_module.DEFAULT_HARVEST_LOCATIONS) * len(harvest_module.DEFAULT_HARVEST_ROLES)
    # Broad (empty role) sweep must be part of every city's rotation.
    assert ("", "Paris") in combos


def test_harvest_rotates_cursor_and_upserts(monkeypatch):
    fake_provider = _FakeProvider()
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": fake_provider)
    monkeypatch.setenv("FT_HARVEST_LOCATIONS", "Paris,Lyon")
    monkeypatch.setenv("FT_HARVEST_ROLES", ",barista")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0.01")
    db = _FakeDb()

    summary = asyncio.run(harvest_france_travail(db, max_queries=3, start_offset=0))

    assert summary["queries_planned"] == 3
    assert summary["jobs_fetched"] == 3
    assert summary["jobs_upserted"] == 3
    assert summary["cursor_next"] == 3
    assert len(db.jobs.upserts) == 3
    # First combo is the broad sweep for the first city.
    assert fake_provider.queries[0].role == ""
    assert fake_provider.queries[0].location == "Paris, France"
    assert fake_provider.queries[0].country == "fr"


def test_harvest_dry_run_does_not_write(monkeypatch):
    fake_provider = _FakeProvider()
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": fake_provider)
    monkeypatch.setenv("FT_HARVEST_LOCATIONS", "Paris")
    monkeypatch.setenv("FT_HARVEST_ROLES", "barista")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0.01")
    db = _FakeDb()

    summary = asyncio.run(harvest_france_travail(db, max_queries=1, dry_run=True, start_offset=0))

    assert summary["jobs_fetched"] == 1
    assert summary["jobs_upserted"] == 0
    assert db.jobs.upserts == []
