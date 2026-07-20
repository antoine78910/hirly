import asyncio
import json
import logging

import httpx
import pytest

import db.supabase_adapter as adapter
from db.supabase_adapter import SupabaseCollectionAdapter


class _Response:
    def __init__(self, rows, *, status_code=200, text=""):
        self._rows = rows
        self.status_code = status_code
        self.text = text
        self.content = json.dumps(rows).encode("utf-8") if rows is not None else text.encode("utf-8")

    def json(self):
        return self._rows


def _metrics(caplog):
    prefix = "db_adapter_metric "
    return [
        json.loads(record.getMessage().split(prefix, 1)[1])
        for record in caplog.records
        if prefix in record.getMessage()
    ]


def test_filter_translation_characterizes_supported_and_rejected_shapes():
    assert adapter._postgrest_filter_params(
        "jobs",
        {
            "provider": "greenhouse",
            "remote": True,
            "country_code": {"$in": ["fr", "United States"]},
            "posted_at": {"$gte": "2026-07-01T00:00:00Z"},
        },
    ) == {
        "provider": "eq.greenhouse",
        "remote": "eq.true",
        "country_code": 'in.(fr,"United States")',
        "posted_at": "gte.2026-07-01T00:00:00Z",
    }
    assert adapter._postgrest_filter_params("jobs", {"data.email": "person@example.com"}) is None
    assert adapter._postgrest_filter_params("jobs", {"$or": [{"provider": "greenhouse"}]}) is None
    assert adapter._postgrest_filter_params("jobs", {"unindexed": "secret"}) is None


def test_read_metric_is_canonical_and_reports_rows_fetched(monkeypatch, caplog):
    responses = [_Response([{"data": {"job_id": "job-1", "provider": "greenhouse"}}])]

    class _Client:
        async def get(self, *_args, **_kwargs):
            return responses.pop(0)

    monkeypatch.setattr(adapter, "_get_shared_http_client", lambda: _Client())
    collection = SupabaseCollectionAdapter(
        "jobs",
        supabase_url="https://example.supabase.co",
        secret_key="service-secret",
    )

    with caplog.at_level(logging.INFO, logger=adapter.__name__):
        result = asyncio.run(collection._read_documents({"provider": "greenhouse"}, 1))

    assert result == [{"job_id": "job-1", "provider": "greenhouse"}]
    metrics = _metrics(caplog)
    read_metric = next(metric for metric in metrics if metric["operation"] == "read_documents")
    assert read_metric["remote_request_count"] == 1
    assert read_metric["rows_fetched"] == 1
    assert read_metric["rows_returned"] == 1
    assert read_metric["filter_status"] == "pushed"
    assert sum(metric["remote_request_count"] for metric in metrics) == 1


def test_local_fallback_metric_exposes_scan_amplification(monkeypatch, caplog):
    rows = [
        {"data": {"job_id": "job-1", "private": {"score": 1}}},
        {"data": {"job_id": "job-2", "private": {"score": 2}}},
        {"data": {"job_id": "job-3", "private": {"score": 3}}},
    ]

    class _Client:
        async def get(self, *_args, **_kwargs):
            return _Response(rows)

    monkeypatch.setattr(adapter, "_get_shared_http_client", lambda: _Client())
    collection = SupabaseCollectionAdapter(
        "jobs",
        supabase_url="https://example.supabase.co",
        secret_key="service-secret",
    )

    with caplog.at_level(logging.INFO, logger=adapter.__name__):
        result = asyncio.run(collection._read_documents({"private.score": 2}, 1))

    assert result == [{"job_id": "job-2", "private": {"score": 2}}]
    read_metric = next(metric for metric in _metrics(caplog) if metric["operation"] == "read_documents")
    assert read_metric["filter_status"] == "local"
    assert read_metric["rows_fetched"] == 3
    assert read_metric["rows_returned"] == 1


def test_retry_metrics_count_attempts_once(monkeypatch, caplog):
    attempts = 0

    class _Client:
        async def get(self, *_args, **_kwargs):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise httpx.ReadTimeout("retry")
            return _Response([{"data": {"job_id": "job-1"}}])

    async def _no_sleep(_delay):
        return None

    monkeypatch.setattr(adapter, "_get_shared_http_client", lambda: _Client())
    monkeypatch.setattr(adapter.asyncio, "sleep", _no_sleep)
    collection = SupabaseCollectionAdapter(
        "jobs",
        supabase_url="https://example.supabase.co",
        secret_key="service-secret",
    )

    with caplog.at_level(logging.INFO, logger=adapter.__name__):
        asyncio.run(collection._read_documents({"job_id": "job-1"}, 1))

    metrics = _metrics(caplog)
    read_metric = next(metric for metric in metrics if metric["operation"] == "read_documents")
    assert attempts == 2
    assert read_metric["remote_request_count"] == 2
    assert read_metric["retry_count"] == 1
    assert sum(metric["remote_request_count"] for metric in metrics) == 2


def test_http_error_metrics_never_report_success(monkeypatch, caplog):
    class _Client:
        async def get(self, *_args, **_kwargs):
            return _Response({"message": "denied"}, status_code=403, text="denied")

    monkeypatch.setattr(adapter, "_get_shared_http_client", lambda: _Client())
    collection = SupabaseCollectionAdapter(
        "jobs",
        supabase_url="https://example.supabase.co",
        secret_key="service-secret",
    )

    with caplog.at_level(logging.INFO, logger=adapter.__name__):
        with pytest.raises(RuntimeError, match="HTTP 403"):
            asyncio.run(collection._read_documents({"job_id": "job-1"}, 1))

    metrics = _metrics(caplog)
    assert metrics
    assert all(metric["status"] == "error" for metric in metrics)


def test_journey_metrics_do_not_accept_pii_or_secrets(monkeypatch, caplog):
    class _Client:
        async def get(self, *_args, **_kwargs):
            return _Response([{"data": {"job_id": "job-1"}}])

    monkeypatch.setattr(adapter, "_get_shared_http_client", lambda: _Client())
    collection = SupabaseCollectionAdapter(
        "jobs",
        supabase_url="https://example.supabase.co",
        secret_key="service-secret",
    )

    with caplog.at_level(logging.INFO, logger=adapter.__name__):
        with adapter.database_journey("landing:person@example.com?token=secret"):
            asyncio.run(collection._read_documents({"job_id": "job-1"}, 1))

    serialized = "\n".join(record.getMessage() for record in caplog.records)
    assert "person@example.com" not in serialized
    assert "token=secret" not in serialized
    read_metric = next(metric for metric in _metrics(caplog) if metric["operation"] == "read_documents")
    assert read_metric["journey"] in {"landing", "unattributed"}
