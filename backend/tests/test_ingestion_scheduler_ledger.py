import asyncio
from unittest.mock import AsyncMock

import pytest

import france_travail_harvest
import jsearch_harvest
import db.supabase_adapter as supabase_adapter
from ingestion_run_lease import await_with_ingestion_heartbeat


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

    assert len(db.completions) == 1
    completion = db.completions[0]
    assert completion["run_id"] == "run-1"
    assert completion["status"] == "succeeded"
    assert completion["completeness_state"] == "partial"
    assert completion["summary"]["jobs_fetched"] == 4
    assert completion["summary"]["raw_records"] == 4
    assert completion["summary"]["normalized_records"] == 4
    assert completion["summary"]["accounting_contract"]["jobs_inserted"] == "unknown"


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
        content = b'{"acquired":true,"run_id":"run-1","lease_token":"token-1","lease_generation":1,"lease_owner":"host:1"}'

        def json(self):
            return {
                "acquired": True,
                "run_id": "run-1",
                "lease_token": "token-1",
                "lease_generation": 1,
                "lease_owner": "host:1",
            }

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
        "p_lease_owner": db._python_ingestion_lease_owner,
        "p_lease_seconds": 300,
        "p_manifest": None,
    }


def test_long_run_heartbeats_until_completion():
    completed = None

    class _HeartbeatDB:
        def __init__(self):
            self.heartbeats = 0

        async def heartbeat_python_ingestion_run(self, _run_id):
            self.heartbeats += 1
            if self.heartbeats == 3:
                completed.set()
            return True

    async def operation():
        await completed.wait()
        return "done"

    async def scenario():
        nonlocal completed
        completed = asyncio.Event()
        db = _HeartbeatDB()
        result = await await_with_ingestion_heartbeat(
            db, "run-1", operation(), interval_seconds=0,
        )
        return db, result

    db, result = asyncio.run(scenario())
    assert result == "done"
    assert db.heartbeats == 3


@pytest.mark.parametrize("failure_mode", ["stale_lock", "database_outage", "timeout", "rate_limit"])
def test_heartbeat_failure_fences_and_cancels_long_run(failure_mode):
    cancelled = False

    class _HeartbeatDB:
        async def heartbeat_python_ingestion_run(self, _run_id):
            if failure_mode == "stale_lock":
                return False
            raise RuntimeError(failure_mode)

    async def operation():
        nonlocal cancelled
        try:
            await asyncio.sleep(10)
        except asyncio.CancelledError:
            cancelled = True
            raise

    with pytest.raises(RuntimeError):
        asyncio.run(await_with_ingestion_heartbeat(
            _HeartbeatDB(), "run-1", operation(), interval_seconds=0.001
        ))
    assert cancelled is True


def test_fenced_completion_uses_claim_token_generation_and_owner(monkeypatch):
    class _Response:
        status_code = 200
        text = ""
        content = b"true"

        def json(self):
            return True

    class _Client:
        def __init__(self):
            self.calls = []

        async def post(self, url, *, json, headers):
            self.calls.append((url, json, headers))
            return _Response()

    client = _Client()
    monkeypatch.setattr(supabase_adapter, "_get_shared_http_client", lambda: client)
    db = supabase_adapter.SupabaseDatabaseAdapter("https://example.supabase.co", "secret")
    db._python_ingestion_leases["run-1"] = {
        "lease_token": "token-1",
        "lease_generation": 3,
        "lease_owner": "host:1",
    }

    assert asyncio.run(db.complete_python_ingestion_run(
        run_id="run-1",
        status="failed",
        completeness_state="failed",
        summary={"terminal_error": "post-write crash"},
    ))
    payload = client.calls[0][1]
    assert payload["p_lease_token"] == "token-1"
    assert payload["p_lease_generation"] == 3
    assert payload["p_lease_owner"] == "host:1"
