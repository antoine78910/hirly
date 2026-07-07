import asyncio

import jobs_service


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self._limit = None

    def limit(self, count):
        self._limit = count
        return self

    async def to_list(self, length):
        count = length or self._limit
        return list(self.rows[:count]) if count is not None else list(self.rows)


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def find(self, filter=None, projection=None):
        return _Cursor(list(self.rows))

    async def count_documents(self, filter=None):
        return len(self.rows)


class _FakeDB:
    def __init__(self):
        self.jobs = _Collection([])
        self.swipes = _Collection([])


PROFILE = {"user_id": "u1", "target_role": "", "target_location": "Paris", "target_location_data": {"country_code": "fr"}}


def _patch_common(monkeypatch):
    async def _noop_smartrecruiters(*args, **kwargs):
        return None

    monkeypatch.setattr("smartrecruiters_search.refresh_smartrecruiters_jobs_for_query", _noop_smartrecruiters)
    monkeypatch.setattr("workday_search.should_run_workday_search", lambda *args, **kwargs: False)
    monkeypatch.setattr("job_search_routing.resolve_primary_provider", lambda query: "jsearch")


class _FakeProvider:
    def __init__(self, name):
        self.name = name

    def search_key(self, query):
        return f"{self.name}:test"

    def _query_string(self, query):
        return f"{self.name} query"


def test_france_travail_fallback_runs_when_jsearch_finds_nothing(monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(jobs_service, "get_job_provider", lambda name, api_key="": _FakeProvider(name))
    monkeypatch.setattr(jobs_service, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(jobs_service, "is_job_provider_enabled", lambda name=None: True)

    async def fake_import(db, provider, query):
        if provider.name == "france_travail":
            job = {
                "job_id": "ft_1",
                "title": "Software Engineer",
                "manual_fulfillment_ready": True,
            }
            return {"total_imported": 1, "auto_apply_supported_imported": 0, "unknown_ats_imported": 0, "jobs": [job]}
        return {"total_imported": 0, "auto_apply_supported_imported": 0, "unknown_ats_imported": 0, "jobs": []}

    monkeypatch.setattr(jobs_service, "_import_provider_jobs", fake_import)

    result = asyncio.run(jobs_service.refresh_jobs_for_profile_if_needed(
        _FakeDB(), PROFILE, search_radius="worldwide", force_provider_refresh=True,
    ))

    assert result["france_travail_fallback_used"] is True
    assert result["relevant_imported"] >= 1
    assert any(job.get("job_id") == "ft_1" for job in result["jobs"])


def test_france_travail_fallback_skipped_when_jsearch_finds_jobs(monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(jobs_service, "get_job_provider", lambda name, api_key="": _FakeProvider(name))
    monkeypatch.setattr(jobs_service, "is_job_provider_configured", lambda name=None: True)
    monkeypatch.setattr(jobs_service, "is_job_provider_enabled", lambda name=None: True)

    calls = []

    async def fake_import(db, provider, query):
        calls.append(provider.name)
        if provider.name == "jsearch":
            job = {
                "job_id": "js_1",
                "title": "Software Developer",
                "manual_fulfillment_ready": True,
            }
            return {"total_imported": 1, "auto_apply_supported_imported": 0, "unknown_ats_imported": 0, "jobs": [job]}
        return {"total_imported": 0, "auto_apply_supported_imported": 0, "unknown_ats_imported": 0, "jobs": []}

    monkeypatch.setattr(jobs_service, "_import_provider_jobs", fake_import)

    result = asyncio.run(jobs_service.refresh_jobs_for_profile_if_needed(
        _FakeDB(), PROFILE, search_radius="worldwide", force_provider_refresh=True,
    ))

    assert result["france_travail_fallback_used"] is False
    assert "france_travail" not in calls


def test_france_travail_fallback_skipped_when_not_configured(monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(jobs_service, "get_job_provider", lambda name, api_key="": _FakeProvider(name))
    monkeypatch.setattr(jobs_service, "is_job_provider_configured", lambda name=None: name != "france_travail")
    monkeypatch.setattr(jobs_service, "is_job_provider_enabled", lambda name=None: True)

    calls = []

    async def fake_import(db, provider, query):
        calls.append(provider.name)
        return {"total_imported": 0, "auto_apply_supported_imported": 0, "unknown_ats_imported": 0, "jobs": []}

    monkeypatch.setattr(jobs_service, "_import_provider_jobs", fake_import)

    result = asyncio.run(jobs_service.refresh_jobs_for_profile_if_needed(
        _FakeDB(), PROFILE, search_radius="worldwide", force_provider_refresh=True,
    ))

    assert result["france_travail_fallback_used"] is False
    assert "france_travail" not in calls
