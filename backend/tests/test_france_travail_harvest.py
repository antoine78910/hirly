import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import france_travail_harvest as harvest_module
from france_travail_harvest import (
    harvest_france_travail,
    _harvest_cities,
    _harvest_targets,
    inventory_blitz_enabled,
)
from job_providers.base import ProviderResult
from ingestion_run_lease import accounting_summary


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
        self.claims = []

    async def claim_python_provider_work(self, provider):
        claim = {
            "claim_id": f"claim-{len(self.claims) + 1}",
            "provider": provider,
            "writer_runtime": "python",
            "ownership_epoch": 0,
            "expires_at": "2099-01-01T00:00:00Z",
            "lease_owner": f"test-{len(self.claims) + 1}",
        }
        self.claims.append(claim)
        return claim

    async def heartbeat_python_provider_work(self, claim):
        return claim in self.claims

    async def finish_python_provider_work(self, claim):
        return claim in self.claims


def test_harvest_cities_default_covers_secondary_markets(monkeypatch):
    monkeypatch.delenv("FT_HARVEST_CITIES", raising=False)
    monkeypatch.delenv("FT_HARVEST_LOCATIONS", raising=False)
    cities = _harvest_cities()
    assert cities[0] == "Paris"
    assert "Grenoble" in cities
    assert len(cities) >= 20


def test_blitz_targets_cover_all_departements(monkeypatch):
    monkeypatch.delenv("FT_HARVEST_CITIES", raising=False)
    monkeypatch.delenv("FT_HARVEST_LOCATIONS", raising=False)
    monkeypatch.setenv("JOBS_INVENTORY_BLITZ", "true")
    targets = _harvest_targets()
    assert inventory_blitz_enabled() is True
    assert len(targets) > 1000  # ~101 depts × ~24 roles
    assert any(t["location"].startswith("Département 75") for t in targets)
    assert any(t["role"] == "developpeur" for t in targets)
    assert any(t["role"] == "" for t in targets)


def test_harvest_rotates_cities_city_only(monkeypatch):
    fake_provider = _FakeProvider()
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": fake_provider)
    monkeypatch.setenv("FT_HARVEST_CITIES", "Paris,Lyon,Marseille")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0.01")
    monkeypatch.setenv("JOBS_INVENTORY_BLITZ", "false")
    db = _FakeDb()

    summary = asyncio.run(harvest_france_travail(db, max_queries=3, start_offset=0))

    assert summary["mode"] == "city_only"
    assert summary["queries_planned"] == 3
    assert summary["jobs_fetched"] == 3
    assert fake_provider.queries[0].role == ""
    assert fake_provider.queries[0].location == "Paris, France"
    assert fake_provider.queries[1].location == "Lyon, France"
    assert fake_provider.queries[2].location == "Marseille, France"


def test_harvest_blitz_uses_department_and_role(monkeypatch):
    fake_provider = _FakeProvider()
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": fake_provider)
    monkeypatch.delenv("FT_HARVEST_CITIES", raising=False)
    monkeypatch.delenv("FT_HARVEST_LOCATIONS", raising=False)
    monkeypatch.setenv("JOBS_INVENTORY_BLITZ", "true")
    monkeypatch.setenv("FT_HARVEST_DEPARTEMENTS", "75,69")
    monkeypatch.setenv("FT_HARVEST_ROLES", ",commercial")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0")
    monkeypatch.setenv("FT_HARVEST_CONCURRENCY", "2")
    db = _FakeDb()

    summary = asyncio.run(harvest_france_travail(db, max_queries=4, dry_run=True, start_offset=0))
    assert summary["mode"] == "blitz_dept_role"
    assert summary["jobs_fetched"] == 4
    assert any("Département 75" in q.location for q in fake_provider.queries)
    assert any(q.role == "commercial" for q in fake_provider.queries)


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


def test_harvest_runs_cities_concurrently(monkeypatch):
    fake_provider = _FakeProvider()
    in_flight = {"current": 0, "max": 0}

    async def slow_search(query):
        in_flight["current"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["current"])
        await asyncio.sleep(0.05)
        result = await _FakeProvider.search(fake_provider, query)
        in_flight["current"] -= 1
        return result

    fake_provider.search = slow_search  # type: ignore[method-assign]
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": fake_provider)
    monkeypatch.setenv("FT_HARVEST_CITIES", "Paris,Lyon,Marseille,Toulouse")
    monkeypatch.setenv("FT_HARVEST_CONCURRENCY", "3")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0")
    db = _FakeDb()

    summary = asyncio.run(harvest_france_travail(db, max_queries=4, dry_run=True, start_offset=0))
    assert summary["concurrency"] == 3
    assert summary["jobs_fetched"] == 4
    assert in_flight["max"] >= 2


def test_split_harvest_accumulates_parent_and_child_accounting(monkeypatch):
    class _SplitProvider:
        def __init__(self):
            self.calls = 0
        async def search(self, query):
            self.calls += 1
            if self.calls == 1:
                return ProviderResult(jobs=[
                    {"job_id": "ft_1", "provider": "france_travail", "external_id": "1"},
                    {"job_id": "ft_2", "provider": "france_travail", "external_id": "2"},
                ], raw_response={
                    "completeness": "capped_needs_split",
                    "rows_seen": 3,
                    "pagination_states": [{
                        "pages_requested": 2, "pages_completed": 2, "retries": 1, "next_page": 2,
                    }],
                })
            return ProviderResult(jobs=[
                {"job_id": "ft_2", "provider": "france_travail", "external_id": "2"},
                {"job_id": "ft_3", "provider": "france_travail", "external_id": "3"},
            ], raw_response={
                "completeness": "complete",
                "rows_seen": 2,
                "pagination_states": [{
                    "pages_requested": 1, "pages_completed": 1, "retries": 2,
                }],
            })

    provider = _SplitProvider()
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": provider)
    monkeypatch.setattr(harvest_module, "upsert_imported_jobs", AsyncMock(return_value={
        "total_imported": 3,
        "inserted": 3,
        "updated": 0,
        "reactivated": 0,
        "exact_duplicate": 0,
        "fuzzy_duplicate_candidates": 0,
        "write_failed": 0,
    }))
    monkeypatch.setenv("FT_HARVEST_CITIES", "Paris")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0")
    monkeypatch.setenv("FT_HARVEST_MAX_SPLIT_DEPTH", "3")

    summary = asyncio.run(harvest_france_travail(_FakeDb(), max_queries=1, start_offset=0))
    reconciled = accounting_summary(summary)

    assert summary["raw_records"] == 5
    assert summary["normalized_records"] == 3
    assert summary["source_exact_duplicates"] == 1
    assert summary["exact_duplicates"] == 1
    assert summary["rejected_by_reason"] == {"normalization_failed": 1}
    assert summary["pages_requested"] == 3
    assert summary["pages_completed"] == 3
    assert summary["retries"] == 3
    assert reconciled["accounting_contract"]["state"] == "known"


def test_late_failed_partition_is_retried_without_blocking_later_rotation(monkeypatch):
    class _LateFailureProvider(_FakeProvider):
        async def search(self, query):
            if len(self.queries) == 2:
                self.queries.append(query)
                raise RuntimeError("late failure")
            result = await super().search(query)
            result.raw_response = {
                "completeness": "complete",
                "rows_seen": len(result.jobs),
                "pagination_states": [{"pages_requested": 1, "pages_completed": 1}],
            }
            return result

    provider = _LateFailureProvider()
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": provider)
    monkeypatch.setenv("FT_HARVEST_CITIES", "Paris,Lyon,Marseille,Nantes")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0")
    monkeypatch.setenv("FT_HARVEST_CONCURRENCY", "1")
    harvest_module._harvest_retry_indices.clear()

    summary = asyncio.run(harvest_france_travail(
        _FakeDb(), max_queries=3, dry_run=True, start_offset=0,
    ))

    assert summary["cursor_next"] == 2
    assert summary["retry_partition_ids"] == ["Marseille, France|"]
    assert summary["runs"][2]["partition_status"] == "failed"
