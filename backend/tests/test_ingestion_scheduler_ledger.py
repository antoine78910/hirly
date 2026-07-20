import asyncio
from unittest.mock import AsyncMock

import pytest

import france_travail_harvest
import jsearch_harvest
import db.supabase_adapter as supabase_adapter


class _LedgerDB:
    def __init__(self, *, acquired=True):
        self.acquired = acquired
        self.begins = []
        self.completions = []

    async def begin_python_ingestion_run(self, **kwargs):
        self.begins.append(kwargs)
        return {
            "acquired": self.acquired,
            "run_id": "run-1",
            "scheduled_for": "2026-07-20T00:00:00Z",
        }

    async def complete_python_ingestion_run(self, **kwargs):
        self.completions.append(kwargs)
        return True


def _one_iteration_sleep():
    calls = 0

    async def sleep(_seconds):
        nonlocal calls
        calls += 1
        if calls >= 2:
            raise asyncio.CancelledError()

    return sleep


def test_france_travail_cross_process_overlap_claim_skips_duplicate(monkeypatch):
    db = _LedgerDB(acquired=False)
    harvest = AsyncMock()
    monkeypatch.setattr(france_travail_harvest, "harvest_enabled", lambda: True)
    monkeypatch.setattr(france_travail_harvest, "harvest_france_travail", harvest)
    monkeypatch.setattr(france_travail_harvest.asyncio, "sleep", _one_iteration_sleep())
    monkeypatch.setenv("FT_HARVEST_INITIAL_DELAY_SECONDS", "0")

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(france_travail_harvest.run_france_travail_harvest_loop(db))

    harvest.assert_not_awaited()
    assert db.begins[0]["schedule_id"] == "python-france-travail-harvest"
    assert db.completions == []


def test_jsearch_completed_occurrence_writes_terminal_counters(monkeypatch):
    db = _LedgerDB(acquired=True)
    harvest = AsyncMock(return_value={
        "jobs_fetched": 4,
        "jobs_upserted": 3,
        "errors": [],
        "completeness": "complete_snapshot",
    })
    monkeypatch.setattr(jsearch_harvest, "harvest_enabled", lambda: True)
    monkeypatch.setattr(jsearch_harvest, "harvest_jsearch", harvest)
    monkeypatch.setattr(jsearch_harvest.asyncio, "sleep", _one_iteration_sleep())
    monkeypatch.setenv("JSEARCH_HARVEST_INITIAL_DELAY_SECONDS", "0")

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(jsearch_harvest.run_jsearch_harvest_loop(db))

    assert db.completions == [{
        "run_id": "run-1",
        "status": "succeeded",
        "completeness_state": "complete_snapshot",
        "summary": {
            "jobs_fetched": 4,
            "jobs_upserted": 3,
            "errors": [],
            "completeness": "complete_snapshot",
        },
    }]


def test_jsearch_terminal_failure_is_persisted(monkeypatch):
    db = _LedgerDB(acquired=True)
    monkeypatch.setattr(jsearch_harvest, "harvest_enabled", lambda: True)
    monkeypatch.setattr(
        jsearch_harvest,
        "harvest_jsearch",
        AsyncMock(side_effect=RuntimeError("provider down")),
    )
    monkeypatch.setattr(jsearch_harvest.asyncio, "sleep", _one_iteration_sleep())
    monkeypatch.setenv("JSEARCH_HARVEST_INITIAL_DELAY_SECONDS", "0")

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(jsearch_harvest.run_jsearch_harvest_loop(db))

    assert db.completions[0]["status"] == "failed"
    assert db.completions[0]["completeness_state"] == "failed"
    assert "provider down" in db.completions[0]["summary"]["terminal_error"]


def test_supabase_ledger_claim_uses_narrow_rpc(monkeypatch):
    class _Response:
        status_code = 200
        text = ""
        content = b'{"acquired":true,"run_id":"run-1"}'

        def json(self):
            return {"acquired": True, "run_id": "run-1"}

    class _Client:
        def __init__(self):
            self.calls = []

        async def post(self, url, *, json, headers):
            self.calls.append((url, json, headers))
            return _Response()

    client = _Client()
    monkeypatch.setattr(supabase_adapter, "_get_shared_http_client", lambda: client)
    db = supabase_adapter.SupabaseDatabaseAdapter("https://example.supabase.co", "secret")

    result = asyncio.run(db.begin_python_ingestion_run(
        schedule_id="python-jsearch-harvest",
        source="jsearch",
        cadence_seconds=900,
    ))

    assert result["acquired"] is True
    assert client.calls[0][0].endswith("/rest/v1/rpc/python_ingestion_run_begin")
    assert client.calls[0][1] == {
        "p_schedule_id": "python-jsearch-harvest",
        "p_source": "jsearch",
        "p_cadence_seconds": 900,
    }
