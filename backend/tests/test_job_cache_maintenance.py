import asyncio
from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException

import job_cache_maintenance as maintenance
import server


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, key_or_list, direction=None):
        if direction is None and isinstance(key_or_list, list):
            specs = [(key, int(dir_value)) for key, dir_value in key_or_list]
        else:
            specs = [(str(key_or_list), int(direction or 1))]
        for key, dir_value in reversed(specs):
            self.rows.sort(
                key=lambda item: (item.get(key) is None, str(item.get(key) or "")),
                reverse=dir_value < 0,
            )
        return self

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, length):
        return list(self.rows[:length])


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.updated = []
        self.insert_many_calls = []

    def find(self, filter=None, projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, filter or {})])

    async def update_one(self, filter, update, upsert=False):
        self.updated.append((dict(filter), dict(update), upsert))
        for row in self.rows:
            if _matches(row, filter):
                row.update(update.get("$set") or {})
                return {"matched_count": 1, "modified_count": 1}
        if upsert:
            doc = dict(filter)
            doc.update(update.get("$set") or {})
            self.rows.append(doc)
            return {"matched_count": 0, "modified_count": 1}
        return {"matched_count": 0, "modified_count": 0}

    async def insert_many(self, documents):
        docs = [dict(doc) for doc in documents]
        self.insert_many_calls.append(docs)
        for doc in docs:
            job_id = doc.get("job_id")
            replaced = False
            for index, row in enumerate(self.rows):
                if job_id and row.get("job_id") == job_id:
                    self.rows[index] = {**row, **doc}
                    replaced = True
                    break
            if not replaced:
                self.rows.append(doc)
        return {"inserted_count": len(docs)}

    async def count_documents(self, filter):
        return len([row for row in self.rows if _matches(row, filter or {})])

    async def delete_one(self, filter):
        before = len(self.rows)
        self.rows = [row for row in self.rows if not _matches(row, filter or {})]
        return {"deleted_count": 1 if len(self.rows) < before else 0}


class _FakeDB:
    def __init__(self, jobs=None):
        self.jobs = _Collection(jobs or [])


def _matches(row, filter):
    for key, expected in (filter or {}).items():
        value = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$gte" in expected and str(value or "") < str(expected["$gte"] or ""):
                return False
            if "$lte" in expected and str(value or "") > str(expected["$lte"] or ""):
                return False
            if "$lt" in expected and not (str(value or "") < str(expected["$lt"] or "")):
                return False
        elif value != expected:
            return False
    return True


def _job(index=1, **extra):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "job_id": f"job_{index}",
        "title": "Marketing Manager",
        "company": "Acme",
        "external_url": "https://boards.greenhouse.io/acme/jobs/123",
        "selected_apply_url": "https://boards.greenhouse.io/acme/jobs/123",
        "country_code": "fr",
        "validation_status": "unknown",
        "applyability_tier": "C",
        "validation_checked_at": None,
        "last_seen_at": now,
        "imported_at": now,
        **extra,
    }


def test_refresh_endpoint_calls_refresh_path(monkeypatch):
    calls = {"count": 0}

    async def fake_refresh(*args, **kwargs):
        calls["count"] += 1
        return {
            "attempted": True,
            "imported": 1,
            "jobs": [_job(validation_status="valid", applyability_tier="A")],
        }

    monkeypatch.setattr(maintenance, "refresh_jobs_for_profile_if_needed", fake_refresh)
    result = asyncio.run(maintenance.refresh_jobs_for_query_or_filters(
        _FakeDB(),
        search_role="marketing",
        location="Paris, France",
        country_code="FR",
        limit=10,
    ))
    assert calls["count"] == 1
    assert result["jsearch_called"] is True
    assert result["imported_count"] == 1
    assert result["valid_count"] == 1


def test_revalidate_updates_unknown_jobs():
    db = _FakeDB([_job()])
    result = asyncio.run(maintenance.revalidate_cached_jobs(db, limit=10))
    assert result["scanned_count"] == 1
    assert result["updated_count"] == 1
    assert db.jobs.rows[0]["validation_status"] == "valid"
    assert db.jobs.rows[0]["applyability_tier"] == "A"


def test_expire_stale_marks_invalid_without_deleting():
    stale = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    db = _FakeDB([_job(last_seen_at=stale, imported_at=stale)])
    result = asyncio.run(maintenance.expire_stale_jobs(db, older_than_days=30, limit=10))
    assert result["expired_count"] == 1
    assert len(db.jobs.rows) == 1
    assert db.jobs.rows[0]["validation_status"] == "invalid"
    assert db.jobs.rows[0]["applyability_tier"] == "E"


def test_expire_stale_targets_oldest_not_newest():
    stale = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    recent = datetime.now(timezone.utc).isoformat()
    db = _FakeDB([
        _job(1, last_seen_at=recent, imported_at=recent, validation_status="valid", applyability_tier="A"),
        _job(2, last_seen_at=stale, imported_at=stale, validation_status="valid", applyability_tier="A"),
    ])
    result = asyncio.run(maintenance.expire_stale_jobs(db, older_than_days=30, limit=1))
    assert result["expired_count"] == 1
    by_id = {row["job_id"]: row for row in db.jobs.rows}
    assert by_id["job_2"]["applyability_tier"] == "E"
    assert by_id["job_1"]["applyability_tier"] == "A"


def test_purge_invalid_deletes_tier_e_jobs():
    stale = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    recent = datetime.now(timezone.utc).isoformat()
    db = _FakeDB([
        _job(1, applyability_tier="E", last_seen_at=stale, imported_at=stale),
        _job(2, applyability_tier="A", last_seen_at=recent, imported_at=recent),
        _job(3, applyability_tier="D", last_seen_at=stale, imported_at=stale),
    ])
    result = asyncio.run(
        maintenance.purge_invalid_jobs(db, older_than_days=30, expire_first=False, limit=10)
    )
    assert result["matched_count"] == 2
    assert result["deleted_count"] == 2
    assert [row["job_id"] for row in db.jobs.rows] == ["job_2"]


def test_purge_invalid_dry_run_does_not_delete():
    stale = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    db = _FakeDB([_job(1, applyability_tier="E", last_seen_at=stale, imported_at=stale)])
    result = asyncio.run(
        maintenance.purge_invalid_jobs(db, older_than_days=30, expire_first=False, dry_run=True)
    )
    assert result["matched_count"] == 1
    assert result["deleted_count"] == 0
    assert len(db.jobs.rows) == 1


def test_admin_purge_invalid_endpoint(monkeypatch):
    calls = {}

    async def fake_purge(*args, **kwargs):
        calls.update(kwargs)
        return {"deleted_count": 3, "matched_count": 3}

    monkeypatch.setattr(server, "purge_invalid_jobs", fake_purge)
    monkeypatch.setenv("JOBS_MAINTENANCE_ENABLED", "true")
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    body = server.AdminJobsPurgeInvalidRequest(
        older_than_days=30,
        applyability_tiers=["E"],
        expire_first=False,
        dry_run=True,
        limit=100,
    )
    result = asyncio.run(server.admin_jobs_purge_invalid(body, admin=admin))
    assert result["deleted_count"] == 3
    assert calls["older_than_days"] == 30
    assert calls["applyability_tiers"] == ["E"]
    assert calls["dry_run"] is True


def test_job_cache_status_counts_and_groups():
    old = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
    recent = datetime.now(timezone.utc).isoformat()
    db = _FakeDB([
        _job(1, validation_status="valid", applyability_tier="A", ats_provider="greenhouse", imported_at=recent, last_seen_at=recent),
        _job(2, validation_status="valid", applyability_tier="B", ats_provider="lever", imported_at=recent, last_seen_at=recent),
        _job(3, validation_status="unknown", applyability_tier="C", ats_provider="ashby", imported_at=recent, last_seen_at=recent),
        _job(4, validation_status="invalid", applyability_tier="E", ats_provider="linkedin", imported_at=old, last_seen_at=old),
    ])
    db.ats_company_sources = _Collection([{"id": "greenhouse:acme"}])
    result = asyncio.run(maintenance.job_cache_status(db, stale_after_days=30))
    assert result["total_jobs"] == 4
    assert result["valid_ab_jobs"] == 2
    assert result["unknown_c_jobs"] == 1
    assert result["invalid_de_jobs"] == 1
    assert result["stale_jobs_sampled"] == 1
    assert result["jobs_by_ats_provider"]["greenhouse"] == 1
    assert result["ats_company_sources_count"] == 1


def test_maintenance_runs_steps_in_order(monkeypatch):
    calls = []

    async def fake_expire(*args, **kwargs):
        calls.append("expire")
        return {"expired_count": 1}

    async def fake_revalidate(*args, **kwargs):
        calls.append("revalidate")
        return {"updated_count": 1}

    async def fake_popular(*args, **kwargs):
        calls.append("popular")
        return {"enabled": True}

    async def fake_ats(*args, **kwargs):
        calls.append("ats")
        return {"enabled": True}

    monkeypatch.setattr(maintenance, "expire_stale_jobs", fake_expire)
    monkeypatch.setattr(maintenance, "revalidate_cached_jobs", fake_revalidate)
    monkeypatch.setattr(maintenance, "refresh_popular_job_cache", fake_popular)
    monkeypatch.setattr(maintenance, "run_ats_direct_maintenance", fake_ats)
    result = asyncio.run(maintenance.run_job_cache_maintenance(_FakeDB(), refresh_popular=True))
    assert calls == ["expire", "revalidate", "popular", "ats"]
    assert result["expire_stale"]["expired_count"] == 1


def test_dry_run_does_not_update_db():
    db = _FakeDB([_job()])
    result = asyncio.run(maintenance.revalidate_cached_jobs(db, dry_run=True, limit=10))
    assert result["scanned_count"] == 1
    assert result["updated_count"] == 0
    assert db.jobs.updated == []


def test_refresh_limits_are_respected(monkeypatch):
    captured = {}

    async def fake_refresh(*args, **kwargs):
        captured.update(kwargs)
        return {"attempted": True, "imported": 0, "jobs": []}

    monkeypatch.setattr(maintenance, "refresh_jobs_for_profile_if_needed", fake_refresh)
    asyncio.run(maintenance.refresh_jobs_for_query_or_filters(_FakeDB(), limit=9999))
    assert captured["target_auto_apply_count"] == 300


def _expanded_basque_places():
    return [
        {"name": "Ciboure", "ascii_name": "Ciboure", "country_code": "fr", "distance_km": 0.0, "population": 6814, "is_origin": True},
        {"name": "Biarritz", "ascii_name": "Biarritz", "country_code": "fr", "distance_km": 14.0, "population": 33188},
        {"name": "Irun", "ascii_name": "Irun", "country_code": "es", "distance_km": 11.0, "population": 61983},
        {"name": "Donostia / San Sebastián", "ascii_name": "san sebastian", "country_code": "es", "distance_km": 26.0, "population": 185357},
    ]


class _FakeProvider:
    name = "jsearch"

    def __init__(self):
        self.queries = []

    async def search(self, query):
        self.queries.append(query)
        return type("Result", (), {"jobs": [
            _job(
                len(self.queries),
                job_id=f"{query.country}:{query.location}",
                title=f"{query.role} {query.location}",
                provider="jsearch",
                external_id=f"{query.country}:{query.location}",
                location=query.location,
                country_code=query.country,
                validation_status="valid",
                applyability_tier="A",
            )
        ]})()


def test_admin_refresh_uses_expanded_locations_and_country_language(monkeypatch):
    provider = _FakeProvider()

    async def fake_expand(*args, **kwargs):
        assert kwargs["include_cross_border"] is True
        return _expanded_basque_places()

    async def fake_upsert(db, jobs):
        return {"total_imported": len(jobs)}

    monkeypatch.setenv("JOBS_ADMIN_LOCATION_PROVIDER_QUERY_BUDGET", "4")
    monkeypatch.setattr(maintenance, "expand_location_radius", fake_expand)
    monkeypatch.setattr(maintenance, "get_job_provider", lambda *args, **kwargs: provider)
    monkeypatch.setattr(maintenance, "upsert_imported_jobs", fake_upsert)
    monkeypatch.setenv("JSEARCH_API_KEY", "test")

    result = asyncio.run(maintenance.refresh_jobs_for_query_or_filters(
        _FakeDB(),
        search_role="business developer",
        location="Ciboure, France",
        country_code="fr",
        lat=43.384,
        lng=-1.668,
        search_radius="50km",
        limit=30,
        include_cross_border=True,
    ))

    assert result["location_expansion_used"] is True
    assert [item["name"] for item in result["expanded_locations"]] == [
        "Ciboure",
        "Biarritz",
        "Irun",
        "Donostia / San Sebastián",
    ]
    assert result["provider_queries_attempted"] == 4
    assert [(query.location, query.country, query.language) for query in provider.queries] == [
        ("Ciboure", "fr", "fr"),
        ("Biarritz", "fr", "fr"),
        ("Irun", "es", "es"),
        ("san sebastian", "es", "es"),
    ]
    assert result["imported_count"] == 4
    assert result["valid_count"] == 4


def test_admin_refresh_respects_provider_query_budget(monkeypatch):
    provider = _FakeProvider()

    async def fake_expand(*args, **kwargs):
        return _expanded_basque_places()

    async def fake_upsert(db, jobs):
        return {"total_imported": len(jobs)}

    monkeypatch.setenv("JOBS_ADMIN_LOCATION_PROVIDER_QUERY_BUDGET", "2")
    monkeypatch.setattr(maintenance, "expand_location_radius", fake_expand)
    monkeypatch.setattr(maintenance, "get_job_provider", lambda *args, **kwargs: provider)
    monkeypatch.setattr(maintenance, "upsert_imported_jobs", fake_upsert)
    monkeypatch.setenv("JSEARCH_API_KEY", "test")

    result = asyncio.run(maintenance.refresh_jobs_for_query_or_filters(
        _FakeDB(),
        search_role="business developer",
        location="Ciboure, France",
        country_code="fr",
        search_radius="50km",
    ))
    assert result["provider_queries_attempted"] == 2
    assert [query.location for query in provider.queries] == ["Ciboure", "Biarritz"]


def test_admin_refresh_cross_border_disabled_passed_to_expansion(monkeypatch):
    captured = {}

    async def fake_expand(*args, **kwargs):
        captured.update(kwargs)
        return [place for place in _expanded_basque_places() if place["country_code"] == "fr"]

    monkeypatch.setattr(maintenance, "expand_location_radius", fake_expand)
    result = asyncio.run(maintenance.refresh_jobs_for_query_or_filters(
        _FakeDB(),
        search_role="business developer",
        location="Ciboure, France",
        country_code="fr",
        search_radius="50km",
        include_cross_border=False,
        dry_run=True,
    ))
    assert captured["include_cross_border"] is False
    assert {item["country_code"] for item in result["expanded_locations"]} == {"fr"}


def test_admin_refresh_expansion_failure_falls_back_to_old_path(monkeypatch):
    calls = {"old": 0}

    async def fake_expand(*args, **kwargs):
        return []

    async def fake_refresh(*args, **kwargs):
        calls["old"] += 1
        return {"attempted": True, "jobs": []}

    monkeypatch.setattr(maintenance, "expand_location_radius", fake_expand)
    monkeypatch.setattr(maintenance, "refresh_jobs_for_profile_if_needed", fake_refresh)
    result = asyncio.run(maintenance.refresh_jobs_for_query_or_filters(
        _FakeDB(),
        search_role="business developer",
        location="Unknownville",
        country_code="fr",
        search_radius="50km",
    ))
    assert calls["old"] == 1
    assert result["location_expansion_used"] is False


def test_admin_refresh_can_run_ats_discovery_after_expanded_import(monkeypatch):
    provider = _FakeProvider()
    calls = {"discover": 0, "refresh": 0}

    async def fake_expand(*args, **kwargs):
        return _expanded_basque_places()[:1]

    async def fake_upsert(db, jobs):
        return {"total_imported": len(jobs)}

    async def fake_discover(*args, **kwargs):
        calls["discover"] += 1
        return {"discovered_count": 3}

    async def fake_refresh_known(*args, **kwargs):
        calls["refresh"] += 1
        return {"refreshed_sources_count": 2}

    monkeypatch.setattr(maintenance, "expand_location_radius", fake_expand)
    monkeypatch.setattr(maintenance, "get_job_provider", lambda *args, **kwargs: provider)
    monkeypatch.setattr(maintenance, "upsert_imported_jobs", fake_upsert)
    monkeypatch.setattr(maintenance, "discover_ats_sources_from_cached_jobs", fake_discover)
    monkeypatch.setattr(maintenance, "refresh_known_ats_sources", fake_refresh_known)
    monkeypatch.setenv("JSEARCH_API_KEY", "test")

    result = asyncio.run(maintenance.refresh_jobs_for_query_or_filters(
        _FakeDB(),
        search_role="business developer",
        location="Ciboure, France",
        country_code="fr",
        search_radius="50km",
        discover_ats_sources=True,
        refresh_discovered_ats_sources=True,
        ats_refresh_limit=10,
    ))
    assert calls == {"discover": 1, "refresh": 1}
    assert result["direct_ats_sources_discovered"] == 3
    assert result["direct_ats_sources_refreshed"] == 2


def test_one_job_error_does_not_crash_batch(monkeypatch):
    db = _FakeDB([_job(1), _job(2)])
    original = maintenance.cheap_validate_job_applyability

    def flaky(job):
        if job["job_id"] == "job_1":
            raise RuntimeError("boom")
        return original(job)

    monkeypatch.setattr(maintenance, "cheap_validate_job_applyability", flaky)
    result = asyncio.run(maintenance.revalidate_cached_jobs(db, limit=10))
    assert len(result["errors"]) == 1
    assert result["updated_count"] == 1


def test_non_admin_access_is_blocked():
    user = server.User(user_id="u", email="user@example.com", name="User")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.require_admin_user(user))
    assert exc.value.status_code == 403


def test_admin_refresh_endpoint_uses_maintenance_service(monkeypatch):
    calls = {"count": 0}

    async def fake_refresh(*args, **kwargs):
        calls["count"] += 1
        assert kwargs["search_role"] == "marketing"
        assert kwargs["lat"] == 43.384
        assert kwargs["lng"] == -1.668
        assert kwargs["search_radius"] == "50km"
        assert kwargs["include_cross_border"] is True
        return {"jsearch_called": True, "imported_count": 1, "valid_count": 1, "errors": []}

    monkeypatch.setattr(server, "refresh_jobs_for_query_or_filters", fake_refresh)
    monkeypatch.setenv("JOBS_MAINTENANCE_ENABLED", "true")
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    body = server.AdminJobsRefreshRequest(
        search_role="marketing",
        location="Paris",
        country_code="FR",
        lat=43.384,
        lng=-1.668,
        search_radius="50km",
        include_cross_border=True,
    )
    result = asyncio.run(server.admin_jobs_refresh(body, admin=admin))
    assert calls["count"] == 1
    assert result["jsearch_called"] is True


def test_job_inventory_analytics_builds_source_breakdown_and_daily_series():
    now = datetime.now(timezone.utc)
    yesterday = (now - timedelta(days=1)).isoformat()
    week_ago = (now - timedelta(days=8)).isoformat()
    jobs = [
        _job(1, provider="jsearch", imported_at=yesterday, validation_status="valid", applyability_tier="A"),
        _job(2, provider="jsearch", imported_at=yesterday, validation_status="valid", applyability_tier="B"),
        _job(3, provider="france_travail", imported_at=yesterday, validation_status="valid", applyability_tier="A"),
        _job(4, provider="greenhouse", imported_at=week_ago, validation_status="valid", applyability_tier="A"),
    ]
    db = _FakeDB(jobs)
    db.ats_company_sources = _Collection([{"id": "greenhouse:acme"}, {"id": "greenhouse:beta"}])
    result = asyncio.run(maintenance.job_inventory_analytics(db, days=14))

    assert result["total_jobs"] == 4
    assert result["imports_last_24h"] == 3
    assert result["imports_last_7d"] == 3
    assert any(row["source"] == "jsearch" and row["count"] == 2 for row in result["by_source"])
    assert result["daily"]
    assert "jsearch" in result["chart_sources"]
    assert result["funnel_goals"]["overall_status"] in {"ok", "warn", "bad"}
    assert len(result["funnel_goals"]["goals"]) == 8
    assert len(result["funnel_goals"]["funnel"]) == 5
    assert result["funnel_goals"]["signals"]["stale_jobs"] >= 0
    assert any(goal["id"] == "inventory_stock" for goal in result["funnel_goals"]["goals"])
    assert any(goal["id"] == "weekly_imports" for goal in result["funnel_goals"]["goals"])


def test_build_inventory_funnel_goals_marks_stale_and_volume():
    result = maintenance.build_inventory_funnel_goals(
        total_jobs=1000,
        valid_ab_jobs=300,
        imports_last_24h=80_000,
        imports_last_7d=520_000,
        imports_by_source_24h={"france_travail": 40_000, "greenhouse": 10_000},
        ats_sources_count=600,
        stale_jobs=100,
    )
    by_id = {goal["id"]: goal for goal in result["goals"]}
    assert by_id["weekly_imports"]["status"] == "ok"
    assert by_id["daily_imports"]["status"] == "ok"
    assert by_id["france_travail_daily"]["status"] == "ok"
    assert by_id["auto_apply_ready_share"]["status"] == "ok"
    assert by_id["stale_inventory"]["status"] == "ok"
    assert result["overall_status"] == "ok"

    weak = maintenance.build_inventory_funnel_goals(
        total_jobs=1000,
        valid_ab_jobs=10,
        imports_last_24h=50,
        imports_last_7d=200,
        imports_by_source_24h={"jsearch": 50},
        ats_sources_count=2,
        stale_jobs=600,
    )
    assert weak["overall_status"] == "bad"


def test_admin_maintenance_disabled_blocks_endpoint(monkeypatch):
    monkeypatch.setenv("JOBS_MAINTENANCE_ENABLED", "false")
    admin = server.User(user_id="admin", email="anto.delbos@gmail.com", name="Admin")
    body = server.AdminJobsRefreshRequest(search_role="marketing")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.admin_jobs_refresh(body, admin=admin))
    assert exc.value.status_code == 403
