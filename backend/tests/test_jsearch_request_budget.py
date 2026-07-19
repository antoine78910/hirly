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


def test_background_harvest_is_opt_in(monkeypatch):
    monkeypatch.delenv("JSEARCH_HARVEST_ENABLED", raising=False)
    monkeypatch.setattr(jsearch_harvest, "is_job_provider_configured", lambda name=None: True)

    assert jsearch_harvest.harvest_enabled() is False

    monkeypatch.setenv("JSEARCH_HARVEST_ENABLED", "true")
    assert jsearch_harvest.harvest_enabled() is True