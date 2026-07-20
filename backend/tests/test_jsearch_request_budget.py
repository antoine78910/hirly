import asyncio

from job_providers.base import JobSearchQuery
from job_providers.jsearch import JSearchProvider
import jsearch_harvest


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _Client:
    def __init__(self, calls, payload):
        self.calls = calls
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None

    async def get(self, url, *, params, headers):
        self.calls.append({"url": url, "params": dict(params), "headers": dict(headers)})
        return _Response(self.payload)


def test_multi_page_search_uses_one_bundled_http_request(monkeypatch):
    calls = []
    payload = {
        "data": [
            {
                "job_id": "job-1",
                "job_title": "Software Engineer",
                "employer_name": "Acme",
                "job_apply_link": "https://jobs.lever.co/acme/job-1",
                "job_city": "Paris",
                "job_country": "France",
            },
            {
                "job_id": "job-2",
                "job_title": "Backend Engineer",
                "employer_name": "Acme",
                "job_apply_link": "https://boards.greenhouse.io/acme/jobs/job-2",
                "job_city": "Paris",
                "job_country": "France",
            },
        ]
    }
    monkeypatch.setattr(
        "job_providers.jsearch.httpx.AsyncClient",
        lambda **kwargs: _Client(calls, payload),
    )

    result = asyncio.run(
        JSearchProvider(api_key="test").search(
            JobSearchQuery(
                role="software engineer",
                location="Paris, France",
                country="fr",
                language="fr",
                limit=100,
                max_pages=5,
                page_size=20,
            )
        )
    )

    assert len(calls) == 1
    assert calls[0]["params"]["num_pages"] == 5
    assert calls[0]["params"]["page_size"] == 20
    assert "page" not in calls[0]["params"]
    assert len(result.jobs) == 2


def test_jsearch_cap_hit_is_explicitly_non_complete(monkeypatch):
    calls = []
    payload = {
        "data": [
            {"job_id": "job-1", "job_title": "Engineer", "employer_name": "Acme"},
            {"job_id": "job-2", "job_title": "Engineer", "employer_name": "Acme"},
        ]
    }
    monkeypatch.setattr(
        "job_providers.jsearch.httpx.AsyncClient",
        lambda **kwargs: _Client(calls, payload),
    )

    result = asyncio.run(JSearchProvider(api_key="test").search(JobSearchQuery(
        role="engineer",
        location="Paris",
        country="fr",
        limit=1,
        max_pages=1,
        page_size=1,
    )))

    assert result.raw_response["completeness"] == "capped_unknown"
    assert result.raw_response["requested_cap"] == 1


def test_background_harvest_is_opt_in(monkeypatch):
    monkeypatch.delenv("JSEARCH_HARVEST_ENABLED", raising=False)
    monkeypatch.setattr(jsearch_harvest, "is_job_provider_configured", lambda name=None: True)

    assert jsearch_harvest.harvest_enabled() is False

    monkeypatch.setenv("JSEARCH_HARVEST_ENABLED", "true")
    assert jsearch_harvest.harvest_enabled() is True


def test_failed_partition_does_not_advance_over_unattempted_queries(monkeypatch):
    class _FailingProvider:
        def __init__(self, **_kwargs):
            pass

        async def search(self, _query):
            raise RuntimeError("rate limited")

    monkeypatch.setattr(jsearch_harvest, "is_job_provider_configured", lambda _name=None: True)
    monkeypatch.setattr(jsearch_harvest, "JSearchProvider", _FailingProvider)
    monkeypatch.setattr(jsearch_harvest, "_cooldown_until", lambda _name: None)
    monkeypatch.setattr(jsearch_harvest, "_is_rate_limit_error", lambda _exc: True)
    monkeypatch.setattr(jsearch_harvest, "_set_rate_limit_cooldown", lambda _name: None)
    jsearch_harvest._harvest_cursor = 0

    result = asyncio.run(jsearch_harvest.harvest_jsearch(
        object(),
        max_queries=2,
        cities=["Paris"],
        roles=["engineer", "designer"],
        dry_run=True,
    ))

    assert result["aborted_reason"] == "rate_limited"
    assert len(result["runs"]) == 1
    assert result["cursor_next"] == 0
    assert jsearch_harvest._harvest_cursor == 0


def test_late_jsearch_failure_rotates_completed_partitions_and_retains_retry(monkeypatch):
    class _Provider:
        calls = 0
        def __init__(self, **_kwargs):
            pass
        async def search(self, query):
            _Provider.calls += 1
            if _Provider.calls == 3:
                raise RuntimeError("late failure")
            return type("Result", (), {
                "jobs": [{
                    "job_id": f"job-{_Provider.calls}",
                    "provider": "jsearch",
                    "external_id": f"ext-{_Provider.calls}",
                }],
                "raw_response": {
                    "completeness": "complete_without_source_total",
                    "rows_seen": 1,
                },
            })()

    monkeypatch.setattr(jsearch_harvest, "is_job_provider_configured", lambda _name=None: True)
    monkeypatch.setattr(jsearch_harvest, "JSearchProvider", _Provider)
    monkeypatch.setattr(jsearch_harvest, "_cooldown_until", lambda _name: None)
    jsearch_harvest._harvest_cursor = 0
    jsearch_harvest._harvest_retry_indices.clear()

    result = asyncio.run(jsearch_harvest.harvest_jsearch(
        object(),
        max_queries=3,
        cities=["Paris", "Lyon", "Nantes", "Lille"],
        roles=["engineer"],
        dry_run=True,
        start_offset=0,
    ))

    assert result["cursor_next"] == 2
    assert result["retry_partition_ids"] == ["Nantes, France|engineer"]
    assert result["runs"][2]["partition_status"] == "failed"
