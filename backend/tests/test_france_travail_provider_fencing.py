import asyncio

import pytest

import france_travail_harvest as harvest_module
import jobs_service
from db import attach_jobs_inventory
from db.supabase_adapter import SupabaseDatabaseAdapter
from job_providers.base import JobSearchQuery, ProviderResult


class _Provider:
    name = "france_travail"

    def __init__(self, result=None, error=None, events=None):
        self.result = result or ProviderResult(jobs=[])
        self.error = error
        self.events = events if events is not None else []

    async def search(self, query):
        self.events.append("fetch")
        if self.error:
            raise self.error
        return self.result


class _ClaimDb:
    def __init__(self, *, finish=True, claim_error=None, events=None):
        self.finish = finish
        self.claim_error = claim_error
        self.events = events if events is not None else []
        self.jobs = object()

    async def claim_python_provider_work(self, provider):
        self.events.append("claim")
        if self.claim_error:
            raise self.claim_error
        return {
            "claim_id": "claim-1",
            "provider": provider,
            "writer_runtime": "python",
            "ownership_epoch": 1,
            "expires_at": "2099-01-01T00:00:00Z",
            "lease_owner": "operation-1",
        }

    async def heartbeat_python_provider_work(self, claim):
        self.events.append("heartbeat")
        return True

    async def finish_python_provider_work(self, claim):
        self.events.append("finish")
        return self.finish


def test_zero_result_feed_import_fails_when_epoch_changes_at_finish():
    events = []
    db = _ClaimDb(finish=False, events=events)
    provider = _Provider(events=events)

    with pytest.raises(RuntimeError, match="became stale"):
        asyncio.run(
            jobs_service._import_provider_jobs(
                db,
                provider,
                JobSearchQuery(role="engineer", country="fr"),
            )
        )

    assert events == ["claim", "fetch", "finish"]


def test_original_fetch_error_is_not_masked_by_stale_finish():
    events = []
    db = _ClaimDb(finish=False, events=events)
    provider = _Provider(error=ValueError("source failed"), events=events)

    with pytest.raises(ValueError, match="source failed"):
        asyncio.run(
            jobs_service._import_provider_jobs(
                db,
                provider,
                JobSearchQuery(role="engineer", country="fr"),
            )
        )

    assert events == ["claim", "fetch", "finish"]


def test_non_python_owner_rejects_before_fetch():
    events = []
    db = _ClaimDb(
        claim_error=RuntimeError("provider is not owned by Python"),
        events=events,
    )
    provider = _Provider(events=events)

    with pytest.raises(RuntimeError, match="not owned by Python"):
        asyncio.run(
            jobs_service._import_provider_jobs(
                db,
                provider,
                JobSearchQuery(role="engineer", country="fr"),
            )
        )

    assert events == ["claim"]


def test_zero_result_harvest_marks_partition_failed_on_stale_finish(monkeypatch):
    provider = _Provider(
        result=ProviderResult(
            jobs=[],
            raw_response={"completeness": "complete", "pagination_states": []},
        )
    )
    db = _ClaimDb(finish=False)
    monkeypatch.setattr(harvest_module, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(harvest_module, "get_job_provider", lambda name, key="": provider)
    monkeypatch.setenv("FT_HARVEST_CITIES", "Paris")
    monkeypatch.setenv("FT_HARVEST_QUERY_PAUSE_SECONDS", "0")

    summary = asyncio.run(
        harvest_module.harvest_france_travail(db, max_queries=1, start_offset=0)
    )

    assert summary["runs"][0]["partition_status"] == "failed"
    assert "became stale" in summary["runs"][0]["error"]
    assert summary["completeness"] == "partial_snapshot"


def test_split_inventory_routes_provider_rpcs_and_preserves_full_document(monkeypatch):
    primary = SupabaseDatabaseAdapter("https://primary.test", "primary-key")
    inventory = SupabaseDatabaseAdapter("https://inventory.test", "inventory-key")
    attach_jobs_inventory(primary, inventory)
    calls = []

    async def rpc(function_name, payload):
        calls.append((function_name, payload))
        if function_name == "python_provider_work_claim":
            return {
                "claim_id": f"claim-{len(calls)}",
                "provider": "france_travail",
                "writer_runtime": "python",
                "ownership_epoch": 4,
                "expires_at": "2099-01-01T00:00:00Z",
            }
        if function_name == "python_provider_jobs_upsert":
            return len(payload["p_jobs"])
        return True

    monkeypatch.setattr(inventory, "_python_ingestion_rpc", rpc)
    claim_one = asyncio.run(primary.claim_python_provider_work("france_travail"))
    claim_two = asyncio.run(primary.claim_python_provider_work("france_travail"))
    assert claim_one["lease_owner"] != claim_two["lease_owner"]
    assert calls[0][1]["p_lease_owner"] == claim_one["lease_owner"]
    assert calls[1][1]["p_lease_owner"] == claim_two["lease_owner"]

    job = {
        "job_id": "job_0123456789abcdef",
        "provider": "france_travail",
        "external_id": "123",
        "title": "Engineer",
        "description": "Complete source document",
        "country_code": "fr",
    }
    assert asyncio.run(primary.upsert_python_provider_jobs(claim_one, [job])) == 1
    function_name, payload = calls[-1]
    assert function_name == "python_provider_jobs_upsert"
    assert payload["p_jobs"][0]["title"] == "Engineer"
    assert payload["p_jobs"][0]["data"]["description"] == "Complete source document"
