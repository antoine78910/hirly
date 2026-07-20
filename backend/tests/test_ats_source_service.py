import asyncio
from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException

import ats_source_service as service
import job_cache_maintenance
import server
from job_providers.ats_adapters.base import AtsJobBatch


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, length):
        return list(self.rows[:length])


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.updated = []

    def find(self, filter=None, projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, filter or {})])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if _matches(row, filter):
                return dict(row)
        return None

    async def update_one(self, filter, update, upsert=False):
        self.updated.append((dict(filter), dict(update), upsert))
        for row in self.rows:
            if _matches(row, filter):
                row.update(update.get("$set") or {})
                return {"matched_count": 1, "modified_count": 1}
        if upsert:
            doc = {**filter, **(update.get("$set") or {})}
            self.rows.append(doc)
            return {"matched_count": 0, "upserted_id": doc.get("id") or doc.get("job_id")}
        return {"matched_count": 0, "modified_count": 0}


class _FakeDB:
    def __init__(self, jobs=None, sources=None, friendly_company_pages=None):
        self.jobs = _Collection(jobs or [])
        self.ats_company_sources = _Collection(sources or [])
        self.friendly_company_career_pages = _Collection(friendly_company_pages or [])


class _FakeAdapter:
    provider = "greenhouse"

    async def fetch_jobs(self, source_key, *, limit=None):
        return AtsJobBatch(
            [{"id": "1", "title": "Marketing Manager"}],
            completeness="complete_without_source_total",
            requested_limit=limit,
            observed_count=1,
        )

    def normalize_job(self, raw_job, *, source_key):
        return {
            "job_id": "job_greenhouse_1",
            "provider": "greenhouse",
            "external_id": f"{source_key}:1",
            "title": raw_job["title"],
            "company": source_key,
            "location": "Paris, France",
            "description": "Build campaigns",
            "external_url": f"https://boards.greenhouse.io/{source_key}/jobs/1",
            "selected_apply_url": f"https://boards.greenhouse.io/{source_key}/jobs/1",
            "ats_provider": "greenhouse",
            "auto_apply_supported": True,
            "manual_fulfillment_ready": True,
        }


class _FailingAdapter(_FakeAdapter):
    async def fetch_jobs(self, source_key, *, limit=None):
        raise RuntimeError("board failed")


class _CappedAdapter(_FakeAdapter):
    async def fetch_jobs(self, source_key, *, limit=None):
        return [
            {"id": str(index), "title": f"Marketing Manager {index}"}
            for index in range(limit or 0)
        ]


def _matches(row, filter):
    for key, expected in (filter or {}).items():
        value = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$nin" in expected and value in expected["$nin"]:
                return False
        elif value != expected:
            return False
    return True


def test_discover_ats_sources_from_cached_jobs():
    db = _FakeDB(jobs=[{
        "job_id": "job_1",
        "ats_provider": "greenhouse",
        "company": "Acme",
        "country_code": "fr",
        "selected_apply_url": "https://boards.greenhouse.io/acme/jobs/123",
    }])
    result = asyncio.run(service.discover_ats_sources_from_cached_jobs(db))
    assert result["scanned_count"] == 1
    assert result["discovered_count"] == 1
    assert db.ats_company_sources.rows[0]["id"] == "greenhouse:acme"


def test_refresh_source_calls_adapter_and_upserts_jobs(monkeypatch):
    db = _FakeDB()
    calls = {"jobs": 0}

    async def fake_upsert(db_arg, jobs, **kwargs):
        calls["jobs"] = len(jobs)
        return {"total_imported": len(jobs)}

    monkeypatch.setattr(service, "get_ats_adapter", lambda provider: _FakeAdapter())
    monkeypatch.setattr(service, "upsert_imported_jobs", fake_upsert)
    result = asyncio.run(service.refresh_ats_source(db, ats_provider="greenhouse", source_key="acme"))
    assert calls["jobs"] == 1
    assert result["imported_count"] == 1
    assert result["valid_count"] == 1


def test_refresh_source_surfaces_cap_as_needs_split(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(service, "get_ats_adapter", lambda _provider: _CappedAdapter())
    result = asyncio.run(service.refresh_ats_source(
        db,
        ats_provider="greenhouse",
        source_key="acme",
        limit=2,
        dry_run=True,
    ))
    assert result["fetched_count"] == 2
    assert result["status"] == "capped"
    assert result["completeness"] == "capped_needs_split"
    assert result["errors"] == ["source_cap_reached_needs_split"]


def test_failed_source_refresh_records_failure(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(service, "get_ats_adapter", lambda provider: _FailingAdapter())
    result = asyncio.run(service.refresh_ats_source(db, ats_provider="greenhouse", source_key="acme"))
    assert result["errors"]
    assert db.ats_company_sources.rows[0]["failure_count"] == 1
    assert "board failed" in db.ats_company_sources.rows[0]["last_error"]


def test_discover_ats_sources_prioritizing_europe_scans_france_first(monkeypatch):
    db = _FakeDB(jobs=[
        {
            "job_id": "job_us",
            "ats_provider": "greenhouse",
            "company": "USCo",
            "country_code": "us",
            "selected_apply_url": "https://boards.greenhouse.io/usco/jobs/1",
        },
        {
            "job_id": "job_fr",
            "ats_provider": "greenhouse",
            "company": "FrCo",
            "country_code": "fr",
            "selected_apply_url": "https://boards.greenhouse.io/frco/jobs/1",
        },
    ])
    result = asyncio.run(service.discover_ats_sources_prioritizing_europe(db, limit=10, priority_limit=1))
    assert result["priority"]["country_codes"] == service.priority_country_codes()
    assert result["discovered_count"] == 2
    assert {row["id"] for row in db.ats_company_sources.rows} == {"greenhouse:frco", "greenhouse:usco"}


def test_priority_country_codes_overridable_via_env(monkeypatch):
    monkeypatch.setenv("JOBS_ATS_PRIORITY_COUNTRY_CODES", "fr,be")
    assert service.priority_country_codes() == ["fr", "be"]
    monkeypatch.delenv("JOBS_ATS_PRIORITY_COUNTRY_CODES", raising=False)
    assert service.priority_country_codes() == service.DEFAULT_PRIORITY_COUNTRY_CODES


def test_refresh_known_sources_prioritizes_europe_over_older_non_europe(monkeypatch):
    old = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    db = _FakeDB(sources=[
        {"id": "greenhouse:us", "ats_provider": "greenhouse", "source_key": "us", "is_active": True, "last_checked_at": old, "country_code": "us"},
        {"id": "greenhouse:fr", "ats_provider": "greenhouse", "source_key": "fr", "is_active": True, "last_checked_at": old, "country_code": "fr"},
    ])
    refreshed = []

    async def fake_refresh(*args, **kwargs):
        refreshed.append(kwargs["source_key"])
        return {"errors": [], "source_key": kwargs["source_key"]}

    monkeypatch.setattr(service, "refresh_ats_source", fake_refresh)
    result = asyncio.run(service.refresh_known_ats_sources(db, limit=1, older_than_hours=12))
    assert result["refreshed_sources_count"] == 1
    assert refreshed == ["fr"]


def test_discover_friendly_company_career_pages_prioritizes_europe(monkeypatch):
    db = _FakeDB(jobs=[
        {
            "job_id": "job_us",
            "ats_provider": "unknown",
            "applyability_tier": "C",
            "company": "US Corp",
            "country_code": "us",
            "selected_apply_url": "https://careers.us-corp.example/apply/1",
        },
        {
            "job_id": "job_fr",
            "ats_provider": "unknown",
            "applyability_tier": "C",
            "company": "FR Corp",
            "country_code": "fr",
            "selected_apply_url": "https://careers.fr-corp.example/apply/1",
        },
    ])
    probed_order = []

    async def fake_probe(url, **kwargs):
        probed_order.append(url)
        return {"is_friendly": True, "requires_login": False, "captcha_detected": False, "has_file_upload": True, "fetch_error": None}

    monkeypatch.setattr(service, "probe_career_page_friendliness", fake_probe)
    result = asyncio.run(service.discover_friendly_company_career_pages(db))
    assert result["friendly_count"] == 2
    assert probed_order[0] == "https://careers.fr-corp.example/apply/1"


def test_refresh_known_sources_respects_limit_and_age(monkeypatch):
    old = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    db = _FakeDB(sources=[
        {"id": "greenhouse:a", "ats_provider": "greenhouse", "source_key": "a", "is_active": True, "last_checked_at": old},
        {"id": "greenhouse:b", "ats_provider": "greenhouse", "source_key": "b", "is_active": True, "last_checked_at": old},
    ])
    refreshed = []

    async def fake_refresh(*args, **kwargs):
        refreshed.append(kwargs["source_key"])
        return {"errors": [], "source_key": kwargs["source_key"]}

    monkeypatch.setattr(service, "refresh_ats_source", fake_refresh)
    result = asyncio.run(service.refresh_known_ats_sources(db, limit=1, older_than_hours=12))
    assert result["refreshed_sources_count"] == 1
    assert refreshed == ["a"]


def test_refresh_known_sources_filters_by_env_country(monkeypatch):
    old = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    db = _FakeDB(sources=[
        {"id": "greenhouse:us", "ats_provider": "greenhouse", "source_key": "us", "is_active": True, "last_checked_at": old, "country_code": "us"},
        {"id": "greenhouse:fr", "ats_provider": "greenhouse", "source_key": "fr", "is_active": True, "last_checked_at": old, "country_code": "fr"},
    ])
    refreshed = []

    async def fake_refresh(*args, **kwargs):
        refreshed.append(kwargs["source_key"])
        return {"errors": [], "source_key": kwargs["source_key"]}

    monkeypatch.setenv("JOBS_ATS_REFRESH_COUNTRY_CODE", "fr")
    monkeypatch.setattr(service, "refresh_ats_source", fake_refresh)
    result = asyncio.run(service.refresh_known_ats_sources(db, limit=10, older_than_hours=12))
    assert result["country_code"] == "fr"
    assert refreshed == ["fr"]


def test_refresh_known_sources_runs_concurrently(monkeypatch):
    old = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    db = _FakeDB(sources=[
        {"id": f"greenhouse:{i}", "ats_provider": "greenhouse", "source_key": str(i), "is_active": True, "last_checked_at": old, "country_code": "fr"}
        for i in range(4)
    ])
    in_flight = {"current": 0, "max": 0}

    async def fake_refresh(*args, **kwargs):
        in_flight["current"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["current"])
        await asyncio.sleep(0.05)
        in_flight["current"] -= 1
        return {"errors": [], "source_key": kwargs["source_key"]}

    monkeypatch.setattr(service, "refresh_ats_source", fake_refresh)
    result = asyncio.run(service.refresh_known_ats_sources(db, limit=4, older_than_hours=12, concurrency=3))
    assert result["concurrency"] == 3
    assert result["refreshed_sources_count"] == 4
    assert in_flight["max"] >= 2


def test_admin_ats_endpoint_is_protected():
    user = server.User(user_id="u", email="user@example.com", name="User")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.require_admin_user(user))
    assert exc.value.status_code == 403


def test_admin_ats_refresh_source_endpoint_uses_service(monkeypatch):
    calls = {"count": 0}

    async def fake_refresh(*args, **kwargs):
        calls["count"] += 1
        assert kwargs["ats_provider"] == "greenhouse"
        assert kwargs["source_key"] == "acme"
        return {"imported_count": 1}

    monkeypatch.setattr(server, "refresh_ats_source", fake_refresh)
    monkeypatch.setenv("JOBS_MAINTENANCE_ENABLED", "true")
    monkeypatch.setenv("JOBS_ATS_DIRECT_ENABLED", "true")
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    body = server.AdminAtsRefreshSourceRequest(ats_provider="greenhouse", source_key="acme")
    result = asyncio.run(server.admin_jobs_ats_refresh_source(body, admin=admin))
    assert calls["count"] == 1
    assert result["imported_count"] == 1


def test_discover_friendly_company_career_pages_upserts_friendly_domain(monkeypatch):
    db = _FakeDB(jobs=[{
        "job_id": "job_1",
        "ats_provider": "unknown",
        "applyability_tier": "C",
        "company": "Acme Corp",
        "country_code": "fr",
        "selected_apply_url": "https://careers.acme.example/apply/123",
    }])

    async def fake_probe(url, **kwargs):
        assert url == "https://careers.acme.example/apply/123"
        return {"url": url, "is_friendly": True, "requires_login": False, "captcha_detected": False, "has_file_upload": True, "fetch_error": None}

    monkeypatch.setattr(service, "probe_career_page_friendliness", fake_probe)
    result = asyncio.run(service.discover_friendly_company_career_pages(db))
    assert result["scanned_job_count"] == 1
    assert result["candidate_domain_count"] == 1
    assert result["friendly_count"] == 1
    assert result["not_friendly_count"] == 0
    assert len(db.friendly_company_career_pages.rows) == 1
    row = db.friendly_company_career_pages.rows[0]
    assert row["domain"] == "careers.acme.example"
    assert row["company_name"] == "Acme Corp"
    assert row["is_friendly"] is True


def test_discover_friendly_company_career_pages_skips_known_domains(monkeypatch):
    db = _FakeDB(
        jobs=[{
            "job_id": "job_1",
            "ats_provider": "unknown",
            "applyability_tier": "C",
            "company": "Acme Corp",
            "selected_apply_url": "https://careers.acme.example/apply/123",
        }],
        friendly_company_pages=[{"id": "careers.acme.example", "domain": "careers.acme.example", "is_friendly": True}],
    )
    calls = {"count": 0}

    async def fake_probe(url, **kwargs):
        calls["count"] += 1
        return {"is_friendly": True, "requires_login": False, "captcha_detected": False, "has_file_upload": True, "fetch_error": None}

    monkeypatch.setattr(service, "probe_career_page_friendliness", fake_probe)
    result = asyncio.run(service.discover_friendly_company_career_pages(db))
    assert calls["count"] == 0
    assert result["already_known_domain_count"] == 1


def test_discover_friendly_company_career_pages_not_friendly_is_not_upserted(monkeypatch):
    db = _FakeDB(jobs=[{
        "job_id": "job_1",
        "ats_provider": "unknown",
        "applyability_tier": "C",
        "company": "Acme Corp",
        "selected_apply_url": "https://careers.acme.example/apply/123",
    }])

    async def fake_probe(url, **kwargs):
        return {"is_friendly": False, "requires_login": True, "captcha_detected": False, "has_file_upload": False, "fetch_error": None}

    monkeypatch.setattr(service, "probe_career_page_friendliness", fake_probe)
    result = asyncio.run(service.discover_friendly_company_career_pages(db))
    assert result["not_friendly_count"] == 1
    assert result["friendly_count"] == 0
    assert len(db.friendly_company_career_pages.rows) == 0


def test_discover_friendly_company_career_pages_dry_run_skips_writes(monkeypatch):
    db = _FakeDB(jobs=[{
        "job_id": "job_1",
        "ats_provider": "unknown",
        "applyability_tier": "C",
        "company": "Acme Corp",
        "selected_apply_url": "https://careers.acme.example/apply/123",
    }])

    async def fake_probe(url, **kwargs):
        return {"is_friendly": True, "requires_login": False, "captcha_detected": False, "has_file_upload": True, "fetch_error": None}

    monkeypatch.setattr(service, "probe_career_page_friendliness", fake_probe)
    result = asyncio.run(service.discover_friendly_company_career_pages(db, dry_run=True))
    assert result["friendly_count"] == 1
    assert len(db.friendly_company_career_pages.rows) == 0


def test_ats_direct_maintenance_loop_disabled_flag(monkeypatch):
    monkeypatch.setenv("JOBS_ATS_DIRECT_MAINTENANCE_LOOP_ENABLED", "false")
    assert service.ats_direct_maintenance_loop_enabled() is False


def test_run_ats_direct_maintenance_loop_runs_and_records_summary(monkeypatch):
    # Regression: growing direct-ATS coverage used to require someone to
    # manually POST /admin/jobs/maintenance -- this loop is what makes it
    # self-sustaining. Verify it actually invokes run_ats_direct_maintenance
    # on its own once started, without needing an external trigger.
    calls = {"count": 0}

    async def fake_maintenance(db, *, dry_run=False):
        calls["count"] += 1
        return {"enabled": True, "run": calls["count"]}

    monkeypatch.setenv("JOBS_ATS_DIRECT_MAINTENANCE_INITIAL_DELAY_SECONDS", "0")
    monkeypatch.setenv("JOBS_ATS_DIRECT_MAINTENANCE_INTERVAL_MINUTES", "5")
    monkeypatch.setattr(service, "run_ats_direct_maintenance", fake_maintenance)

    async def run_briefly():
        task = asyncio.ensure_future(service.run_ats_direct_maintenance_loop(_FakeDB()))
        for _ in range(50):
            await asyncio.sleep(0)
            if calls["count"] >= 1:
                break
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run_briefly())
    assert calls["count"] >= 1
    assert service.last_maintenance_summary() == {"enabled": True, "run": calls["count"]}


def test_run_ats_direct_maintenance_loop_noop_when_disabled(monkeypatch):
    calls = {"count": 0}

    async def fake_maintenance(db, *, dry_run=False):
        calls["count"] += 1
        return {"enabled": True}

    monkeypatch.setenv("JOBS_ATS_DIRECT_MAINTENANCE_LOOP_ENABLED", "false")
    monkeypatch.setattr(service, "run_ats_direct_maintenance", fake_maintenance)
    asyncio.run(service.run_ats_direct_maintenance_loop(_FakeDB()))
    assert calls["count"] == 0


def test_maintenance_respects_ats_flag(monkeypatch):
    calls = []

    async def fake_expire(*args, **kwargs):
        return {"expired_count": 0}

    async def fake_revalidate(*args, **kwargs):
        return {"updated_count": 0}

    async def fake_ats(*args, **kwargs):
        calls.append("ats")
        return {"enabled": True}

    monkeypatch.setattr(job_cache_maintenance, "expire_stale_jobs", fake_expire)
    monkeypatch.setattr(job_cache_maintenance, "revalidate_cached_jobs", fake_revalidate)
    monkeypatch.setattr(job_cache_maintenance, "run_ats_direct_maintenance", fake_ats)
    monkeypatch.setenv("JOBS_ATS_DIRECT_ENABLED", "true")
    result = asyncio.run(job_cache_maintenance.run_job_cache_maintenance(_FakeDB(), refresh_popular=False))
    assert calls == ["ats"]
    assert result["ats_direct"]["enabled"] is True
