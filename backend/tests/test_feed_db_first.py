import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import server


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)
        self.count = None

    def limit(self, count):
        self.count = count
        return self

    async def to_list(self, length):
        count = length or self.count
        return list(self.rows[:count]) if count is not None else list(self.rows)


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if _matches(row, filter):
                return dict(row)
        return None

    def find(self, filter=None, projection=None):
        return _Cursor([dict(row) for row in self.rows if _matches(row, filter or {})])

    async def count_documents(self, filter):
        return len([row for row in self.rows if _matches(row, filter or {})])


class _FakeDB:
    def __init__(self, jobs, profile, swipes=None, geo_places=None):
        self.jobs = _Collection(jobs)
        self.geo_places = _Collection(geo_places or [])
        self.profiles = _Collection([profile])
        self.swipes = _Collection(swipes or [])


def _matches(row, filter):
    for key, expected in (filter or {}).items():
        value = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and value not in expected["$in"]:
                return False
            if "$gte" in expected and (value is None or value < expected["$gte"]):
                return False
            if "$nin" in expected and value in expected["$nin"]:
                return False
        elif value != expected:
            return False
    return True


def _profile():
    return {
        "user_id": "user_1",
        "cv_text": "Marketing manager with campaign experience.",
        "target_role": "Marketing Manager",
        "target_location": "Paris, France",
        "target_location_data": {"location_label": "Paris, France", "country_code": "fr", "country": "France"},
    }


def _job(index, *, tier="A", status="valid", title="Marketing Manager", swiped=False):
    now = datetime.now(timezone.utc).isoformat()
    return {
        "job_id": f"job_{index}",
        "title": title,
        "company": f"Company {index}",
        "location": "Paris, France",
        "country_code": "fr",
        "remote": False,
        "description": "Marketing campaigns, digital acquisition, communication.",
        "provider": "jsearch",
        "external_id": f"ext_{index}",
        "external_url": f"https://boards.greenhouse.io/company/jobs/{index}",
        "selected_apply_url": f"https://boards.greenhouse.io/company/jobs/{index}",
        "validation_status": status,
        "applyability_tier": tier,
        "applyability_score": 0.92 if tier == "A" else 0.55,
        "ats_provider": "greenhouse",
        "auto_apply_supported": tier == "A",
        "manual_fulfillment_ready": tier in {"A", "B", "C"},
        "apply_fulfillment_status": "manual_ready" if tier in {"A", "B", "C"} else "blocked_user_account_required",
        "posted_at": now,
        "imported_at": now,
        "_swiped": swiped,
    }


def _geo_places():
    path = Path(__file__).parent / "fixtures" / "geo_places_sample.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _location_payload(name="Ciboure", *, country_code="fr", lat=43.3849, lng=-1.6682):
    return json.dumps([{
        "location_label": f"{name}, France" if country_code == "fr" else name,
        "country": "France" if country_code == "fr" else "",
        "country_code": country_code,
        "lat": lat,
        "lng": lng,
    }])


def _run_feed(
    monkeypatch,
    jobs,
    *,
    env=None,
    refresh=None,
    swiped_ids=None,
    search_radius="50km",
    only_my_country=False,
    locations_json=None,
    include_unknown_location=True,
    work_location=None,
    geo_places=None,
):
    env = env or {}
    for key, value in {
        "JOBS_DB_FIRST_ENABLED": "true",
        "JOBS_DB_MIN_GOOD_RESULTS_BEFORE_JSEARCH": "30",
        "JOBS_DB_WEAK_RESULTS_THRESHOLD": "10",
        "JOBS_ALLOW_UNKNOWN_TIER_IN_FEED": "false",
        **env,
    }.items():
        monkeypatch.setenv(key, value)
    swipes = [{"user_id": "user_1", "job_id": job_id} for job_id in (swiped_ids or [])]
    fake_db = _FakeDB(jobs, _profile(), swipes, geo_places=geo_places)
    monkeypatch.setattr(server, "db", fake_db)
    server._feed_job_pool_cache.update({"query_key": "", "rows": [], "fetched_at": 0.0})
    calls = {"refresh": 0}

    async def _refresh(*args, **kwargs):
        calls["refresh"] += 1
        calls["refresh_kwargs"] = kwargs
        if refresh:
            result = refresh()
            if asyncio.iscoroutine(result):
                result = await result
            fake_db.jobs.rows.extend(result)
        return {"attempted": True, "jobs_imported": len(fake_db.jobs.rows), "search_keys": ["jsearch:test"]}

    monkeypatch.setattr(server, "refresh_jobs_for_profile_if_needed", _refresh)
    user = server.User(user_id="user_1", email="user@example.com", name="User")

    response = asyncio.run(server.get_feed(
        user=user,
        limit=5,
        min_salary=0,
        posted_within=None,
        work_location=work_location,
        job_type=None,
        experience=None,
        location=None,
        only_company=None,
        hide_company=None,
        only_industry=None,
        hide_industry=None,
        include_unknown_location=include_unknown_location,
        include_unknown_salary=True,
        include_non_auto_apply=False,
        search_radius=search_radius,
        locations_json=locations_json,
        only_my_country=only_my_country,
        location_label=None,
        place_id=None,
        country=None,
        country_code=None,
        lat=None,
        lng=None,
        score=False,
        search_role=None,
    ))
    return response, calls


def _run_legacy_feed(monkeypatch, provider_jobs, *, env=None, work_location=None):
    env = {
        "JOBS_FEED_LEGACY_JSEARCH_ONLY": "true",
        "JSEARCH_API_KEY": "test-key",
        **(env or {}),
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    fake_db = _FakeDB([], _profile(), [])
    monkeypatch.setattr(server, "db", fake_db)
    calls = {"search": 0, "upsert": 0}

    class _Provider:
        async def search(self, query):
            calls["search"] += 1
            calls["query"] = query
            return type("Result", (), {"jobs": provider_jobs})()

    monkeypatch.setattr(server, "get_job_provider", lambda _name, _api_key: _Provider())

    async def _upsert(_db, jobs, **_kwargs):
        calls["upsert"] += 1
        calls["upserted_jobs"] = list(jobs)
        return {"total_imported": len(jobs), "auto_apply_supported_imported": 0, "unknown_ats_imported": 0}

    monkeypatch.setattr(server.jobs_service_module, "upsert_imported_jobs", _upsert)
    user = server.User(user_id="user_1", email="user@example.com", name="User")
    response = asyncio.run(server.get_feed(
        user=user,
        limit=5,
        min_salary=0,
        posted_within=None,
        work_location=work_location,
        job_type=None,
        experience=None,
        location=None,
        only_company=None,
        hide_company=None,
        only_industry=None,
        hide_industry=None,
        include_unknown_location=True,
        include_unknown_salary=True,
        include_non_auto_apply=False,
        search_radius="worldwide",
        locations_json=None,
        only_my_country=False,
        location_label=None,
        place_id=None,
        country=None,
        country_code=None,
        lat=None,
        lng=None,
        score=False,
        search_role=None,
    ))
    return response, calls


def _legacy_direct_job(index, *, country_code="gb", location="London, United Kingdom", title="Marketing Manager"):
    job = _job(index, title=title)
    job.update({
        "provider": "lever",
        "ats_provider": "lever",
        "country_code": country_code,
        "location": location,
        "external_url": f"https://jobs.lever.co/company/{index}",
        "selected_apply_url": None,
        "validation_status": None,
        "applyability_tier": None,
        "manual_fulfillment_ready": None,
        "apply_fulfillment_status": None,
        "auto_apply_supported": True,
    })
    return job


def test_db_first_enough_jobs_does_not_call_jsearch(monkeypatch):
    response, calls = _run_feed(monkeypatch, [_job(i) for i in range(35)])
    assert calls["refresh"] == 0
    assert response["jobs"]
    assert response["total"] <= 5
    assert response["filters_applied"]["manual_fulfillment_ready"] is True


def test_legacy_jsearch_only_calls_provider_without_validation_fields(monkeypatch):
    job = _job(1)
    job["validation_status"] = None
    job["applyability_tier"] = None
    response, calls = _run_legacy_feed(monkeypatch, [job])
    assert calls["search"] == 1
    assert calls["upsert"] == 1
    assert calls["upserted_jobs"][0]["job_id"] == "job_1"
    assert response["feed_mode"] == "legacy_jsearch_only"
    assert [item["job_id"] for item in response["jobs"]] == ["job_1"]


def test_legacy_jsearch_only_ignores_feed_cooldown(monkeypatch):
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldown_until", 999999999999.0)
    response, calls = _run_legacy_feed(monkeypatch, [_job(1)])
    assert calls["search"] == 1
    assert response["jobs"]
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldown_until", 0.0)


def test_version_endpoint_exposes_safe_flags(monkeypatch):
    monkeypatch.setenv("APP_GIT_SHA", "abc123")
    monkeypatch.setenv("JOBS_FEED_LEGACY_JSEARCH_ONLY", "true")
    response = asyncio.run(server.version())
    assert response["git_sha"] == "abc123"
    assert response["flags"]["JOBS_FEED_LEGACY_JSEARCH_ONLY"] is True
    assert "JSEARCH_API_KEY" not in str(response)


def test_admin_clear_feed_provider_cooldown(monkeypatch):
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldown_until", 999999999999.0)
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldowns", {"explicit_local:test": 999999999999.0})
    server.jobs_service_module._PROVIDER_COOLDOWN_UNTIL["jsearch"] = datetime.now(timezone.utc)
    admin = server.User(user_id="admin", email="admin@tryhirly.com", name="Admin")
    monkeypatch.setattr(server, "_is_admin_email", lambda _email: True)
    response = asyncio.run(server.admin_clear_feed_provider_cooldown(admin=admin))
    assert response["cleared"] is True
    assert response["previous_feed_cooldown_active"] is True
    assert server._feed_sync_refresh_cooldown_until == 0.0
    assert server._feed_sync_refresh_cooldowns == {}
    assert server.jobs_service_module._PROVIDER_COOLDOWN_UNTIL == {}


def test_weak_but_nonzero_db_returns_without_sync_jsearch(monkeypatch):
    response, calls = _run_feed(
        monkeypatch,
        [_job(1), _job(2)],
        refresh=lambda: [_job(i) for i in range(3, 20)],
    )
    assert calls["refresh"] == 0
    assert response["jobs"]
    assert response["fallback_used"] in {"none", "none_due_to_explicit_filters", None}


def test_zero_db_uses_limited_sync_jsearch_fallback(monkeypatch):
    response, calls = _run_feed(
        monkeypatch,
        [],
        env={
            "JOBS_FEED_SYNC_REFRESH_MAX_RESULTS": "10",
            "JSEARCH_FEED_FALLBACK_MAX_PAGES": "1",
            "JSEARCH_FEED_FALLBACK_PAGE_SIZE": "10",
        },
        refresh=lambda: [_job(i) for i in range(1, 4)],
    )
    assert calls["refresh"] == 1
    assert calls["refresh_kwargs"]["query_limit_override"] == 10
    assert calls["refresh_kwargs"]["provider_max_pages"] == 1
    assert calls["refresh_kwargs"]["provider_page_size"] == 10
    assert calls["refresh_kwargs"]["max_provider_requests_override"] == 1
    assert response["jobs"]


def test_worldwide_uses_legacy_direct_ats_when_validated_cache_empty(monkeypatch):
    response, calls = _run_feed(
        monkeypatch,
        [
            _legacy_direct_job(1, country_code="gb", location="London, United Kingdom"),
            _legacy_direct_job(2, country_code="us", location="New York, United States"),
        ],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        search_radius="worldwide",
    )
    assert calls["refresh"] == 0
    assert {job["job_id"] for job in response["jobs"]} == {"job_1", "job_2"}


def test_worldwide_legacy_direct_ats_can_include_unknown_location(monkeypatch):
    job = _legacy_direct_job(1, country_code="", location="")
    response, _calls = _run_feed(
        monkeypatch,
        [job],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        search_radius="worldwide",
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]


def test_worldwide_final_fallback_relaxes_role_when_legacy_candidates_exist(monkeypatch):
    response, calls = _run_feed(
        monkeypatch,
        [_legacy_direct_job(1, title="ADAS Data Collection Driver")],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        search_radius="worldwide",
    )
    assert calls["refresh"] == 0
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["fallback_used"] == "worldwide_radius_auto_apply"


def test_explicit_paris_radius_does_not_return_new_jersey_legacy_direct_job(monkeypatch):
    paris = _legacy_direct_job(1, country_code="fr", location="Paris, France", title="Marketing Manager")
    new_jersey = _legacy_direct_job(
        2,
        country_code="",
        location="Florham Park - New Jersey - United States",
        title="Marketing Manager",
    )
    locations = json.dumps([{
        "location_label": "Paris, France",
        "country": "France",
        "country_code": "fr",
        "lat": 48.8566,
        "lng": 2.3522,
    }])
    response, _calls = _run_feed(
        monkeypatch,
        [new_jersey, paris],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=locations,
        geo_places=_geo_places(),
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["filters_applied"]["explicit_local_intent"] is True


def test_explicit_paris_radius_returns_local_c_tier_manual_job(monkeypatch):
    local_c = _job(1, tier="C", status="unknown", title="Marketing Manager")
    local_c.update({"location": "Paris, France", "city": "Paris", "country_code": "fr"})
    response, _calls = _run_feed(
        monkeypatch,
        [local_c],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        geo_places=_geo_places(),
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["jobs"][0]["application_mode"] == "manual"
    assert response["jobs"][0]["can_auto_apply"] is False
    assert response["jobs"][0]["requires_manual_review"] is True
    assert response["feed_summary"]["manual_count"] == 1


def test_explicit_paris_radius_returns_local_null_tier_jsearch_job(monkeypatch):
    local_null = _job(1, tier=None, status=None, title="Marketing Manager")
    local_null.update({
        "provider": "jsearch",
        "location": "Paris, France",
        "city": "Paris",
        "country_code": "fr",
        "validation_status": None,
        "applyability_tier": None,
        "auto_apply_supported": False,
    })
    response, _calls = _run_feed(
        monkeypatch,
        [local_null],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        geo_places=_geo_places(),
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["jobs"][0]["application_mode"] == "manual"
    assert response["jobs"][0]["can_auto_apply"] is False


def test_ab_jobs_rank_before_manual_local_jobs(monkeypatch):
    manual = _job(1, tier="C", status="unknown", title="Marketing Manager")
    manual.update({"location": "Paris, France", "city": "Paris", "country_code": "fr"})
    auto = _job(2, tier="A", status="valid", title="Marketing Manager")
    auto.update({"location": "Paris, France", "city": "Paris", "country_code": "fr"})
    response, _calls = _run_feed(
        monkeypatch,
        [manual, auto],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        geo_places=_geo_places(),
    )
    assert [job["job_id"] for job in response["jobs"][:2]] == ["job_2", "job_1"]
    assert response["jobs"][0]["application_mode"] == "auto_apply"


def test_explicit_local_jsearch_fallback_returns_imported_manual_local_job(monkeypatch):
    imported = _job(1, tier="C", status="unknown", title="Marketing Manager")
    imported.update({"location": "Paris, France", "city": "Paris", "country_code": "fr"})
    response, calls = _run_feed(
        monkeypatch,
        [],
        env={
            "JOBS_FEED_LOCAL_DISCOVERY_MAX_CITIES": "2",
            "JOBS_FEED_SYNC_REFRESH_MAX_SECONDS": "5",
        },
        refresh=lambda: [imported],
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        geo_places=_geo_places(),
    )
    assert calls["refresh"] >= 1
    assert calls["refresh"] <= 2
    assert calls["refresh_kwargs"]["max_provider_requests_override"] == 1
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["jobs"][0]["application_mode"] == "manual"


def test_real_app_text_only_toulouse_request_triggers_local_discovery(monkeypatch):
    imported = _job(1, tier="C", status="unknown", title="Marketing Manager")
    imported.update({"location": "Toulouse, France", "city": "Toulouse", "country_code": "fr"})
    locations_json = json.dumps([{
        "location_label": "Toulouse, France",
        "place_id": "",
        "country": "France",
        "country_code": "",
        "lat": None,
        "lng": None,
        "source": "local",
        "kind": "city",
    }])
    response, calls = _run_feed(
        monkeypatch,
        [],
        env={
            "JOBS_FEED_LOCAL_DISCOVERY_MAX_CITIES": "2",
            "JOBS_FEED_SYNC_REFRESH_MAX_SECONDS": "5",
            "JOBS_FEED_DEBUG_DIAGNOSTICS": "true",
        },
        refresh=lambda: [imported],
        locations_json=locations_json,
        search_radius="52km",
        geo_places=_geo_places(),
    )
    assert calls["refresh"] >= 1
    assert response["request_trace"]["explicit_local_intent"] is True
    assert response["request_trace"]["location_intelligence_used"] is True
    assert response["request_trace"]["expanded_country_codes"] == ["fr"]
    assert response["request_trace"]["local_jsearch_discovery_attempted"] is True
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["jobs"][0]["application_mode"] == "manual"


def test_ciboure_radius_can_return_local_manual_biarritz_job(monkeypatch):
    biarritz = _job(1, tier="C", status="unknown", title="Marketing Manager")
    biarritz.update({"location": "Biarritz, France", "city": "Biarritz", "country_code": "fr"})
    response, _calls = _run_feed(
        monkeypatch,
        [biarritz],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["jobs"][0]["application_mode"] == "manual"


def test_explicit_local_search_blocks_global_unknown_country_direct_ats(monkeypatch):
    global_job = _legacy_direct_job(
        1,
        country_code="",
        location="Florham Park - New Jersey - United States",
        title="Marketing Manager",
    )
    response, _calls = _run_feed(
        monkeypatch,
        [global_job],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        geo_places=_geo_places(),
    )
    assert response["jobs"] == []
    assert response["empty_reason"]["code"] == "NO_LOCAL_AUTO_APPLY_JOBS"


def test_explicit_local_search_can_return_remote_when_allowed(monkeypatch):
    remote = _legacy_direct_job(
        1,
        country_code="us",
        location="Remote - United States",
        title="Marketing Manager",
    )
    remote["remote"] = True
    response, _calls = _run_feed(
        monkeypatch,
        [remote],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        work_location=["remote"],
        geo_places=_geo_places(),
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]


def test_explicit_local_search_does_not_return_remote_by_default(monkeypatch):
    remote = _legacy_direct_job(
        1,
        country_code="us",
        location="Remote - United States",
        title="Marketing Manager",
    )
    remote["remote"] = True
    response, _calls = _run_feed(
        monkeypatch,
        [remote],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        geo_places=_geo_places(),
    )
    assert response["jobs"] == []
    assert response["empty_reason"]["code"] == "NO_LOCAL_AUTO_APPLY_JOBS"


def test_global_remote_jobs_do_not_prevent_explicit_local_jsearch_discovery(monkeypatch):
    remote = _legacy_direct_job(
        1,
        country_code="us",
        location="Remote - United States",
        title="Marketing Manager",
    )
    remote["remote"] = True
    imported = _job(2, tier="C", status="unknown", title="Marketing Manager")
    imported.update({"location": "Paris, France", "city": "Paris", "country_code": "fr"})
    response, calls = _run_feed(
        monkeypatch,
        [remote],
        env={
            "JOBS_FEED_LOCAL_DISCOVERY_MAX_CITIES": "1",
            "JOBS_FEED_SYNC_REFRESH_MAX_SECONDS": "5",
        },
        refresh=lambda: [imported],
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        geo_places=_geo_places(),
    )
    assert calls["refresh"] == 1
    assert [job["job_id"] for job in response["jobs"]] == ["job_2"]
    assert response["jobs"][0]["application_mode"] == "manual"


def test_explicit_local_search_excludes_remote_when_onsite_only(monkeypatch):
    remote = _legacy_direct_job(
        1,
        country_code="us",
        location="Remote - United States",
        title="Marketing Manager",
    )
    remote["remote"] = True
    response, _calls = _run_feed(
        monkeypatch,
        [remote],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        work_location=["onsite"],
        geo_places=_geo_places(),
    )
    assert response["jobs"] == []


def test_explicit_local_search_excludes_unknown_location_unless_allowed(monkeypatch):
    unknown = _legacy_direct_job(1, country_code="", location="", title="Marketing Manager")
    response, _calls = _run_feed(
        monkeypatch,
        [unknown],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        include_unknown_location=False,
        geo_places=_geo_places(),
    )
    assert response["jobs"] == []

    response, _calls = _run_feed(
        monkeypatch,
        [unknown],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload("Paris", lat=48.8566, lng=2.3522),
        include_unknown_location=True,
        geo_places=_geo_places(),
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]


def test_ciboure_radius_returns_empty_reason_instead_of_unrelated_global_jobs(monkeypatch):
    global_job = _legacy_direct_job(
        1,
        country_code="",
        location="Florham Park - New Jersey - United States",
        title="Marketing Manager",
    )
    response, _calls = _run_feed(
        monkeypatch,
        [global_job],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert response["jobs"] == []
    assert response["empty_reason"]["code"] == "NO_LOCAL_AUTO_APPLY_JOBS"


def test_only_my_country_still_filters_legacy_direct_ats(monkeypatch):
    response, _calls = _run_feed(
        monkeypatch,
        [
            _legacy_direct_job(1, country_code="fr", location="Paris, France"),
            _legacy_direct_job(2, country_code="gb", location="London, United Kingdom"),
        ],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        only_my_country=True,
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]


def test_ciboure_radius_returns_cached_biarritz_job(monkeypatch):
    biarritz = _job(1)
    biarritz.update({"location": "Biarritz, France", "city": "Biarritz", "country_code": "fr"})
    response, calls = _run_feed(
        monkeypatch,
        [biarritz],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert calls["refresh"] == 0
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["filters_applied"]["location_intelligence"]["used"] is True


def test_ciboure_radius_returns_cached_bayonne_and_anglet_jobs(monkeypatch):
    bayonne = _job(1)
    bayonne.update({"location": "Bayonne, France", "city": "Bayonne", "country_code": "fr"})
    anglet = _job(2)
    anglet.update({"location": "Anglet, France", "city": "Anglet", "country_code": "fr"})
    response, _calls = _run_feed(
        monkeypatch,
        [bayonne, anglet],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert {job["job_id"] for job in response["jobs"]} == {"job_1", "job_2"}


def test_ciboure_radius_returns_cross_border_jobs_when_enabled(monkeypatch):
    irun = _job(1)
    irun.update({"location": "Irun, Spain", "city": "Irun", "country_code": "es"})
    san_sebastian = _job(2)
    san_sebastian.update({"location": "San Sebastián, Spain", "city": "San Sebastián", "country_code": "es"})
    response, _calls = _run_feed(
        monkeypatch,
        [irun, san_sebastian],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false", "JOBS_LOCATION_INCLUDE_CROSS_BORDER": "true"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert {job["job_id"] for job in response["jobs"]} == {"job_1", "job_2"}
    assert set(response["filters_applied"]["location_intelligence"]["expanded_country_codes"]) >= {"fr", "es"}


def test_ciboure_radius_excludes_cross_border_when_only_my_country(monkeypatch):
    fr_job = _job(1)
    fr_job.update({"location": "Biarritz, France", "city": "Biarritz", "country_code": "fr"})
    es_job = _job(2)
    es_job.update({"location": "Irun, Spain", "city": "Irun", "country_code": "es"})
    response, _calls = _run_feed(
        monkeypatch,
        [fr_job, es_job],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
        only_my_country=True,
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]
    assert response["filters_applied"]["location_intelligence"]["include_cross_border"] is False


def test_ciboure_radius_excludes_cross_border_when_env_disabled(monkeypatch):
    es_job = _job(1)
    es_job.update({"location": "Irun, Spain", "city": "Irun", "country_code": "es"})
    response, _calls = _run_feed(
        monkeypatch,
        [es_job],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false", "JOBS_LOCATION_INCLUDE_CROSS_BORDER": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert response["jobs"] == []


def test_worldwide_skips_location_intelligence_expansion(monkeypatch):
    london = _job(1)
    london.update({"location": "London, United Kingdom", "city": "London", "country_code": "gb"})
    response, _calls = _run_feed(
        monkeypatch,
        [london],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        search_radius="worldwide",
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert response["jobs"]
    assert response["filters_applied"]["location_intelligence"]["used"] is False
    assert response["filters_applied"]["location_intelligence"]["reason"] == "non_numeric_or_global_radius"


def test_radius_below_minimum_does_not_over_expand(monkeypatch):
    biarritz = _job(1)
    biarritz.update({"location": "Biarritz, France", "city": "Biarritz", "country_code": "fr"})
    response, _calls = _run_feed(
        monkeypatch,
        [biarritz],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false", "JOBS_LOCATION_MIN_RADIUS_KM": "100"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert response["jobs"] == []
    assert response["filters_applied"]["location_intelligence"]["reason"] == "radius_below_minimum"


def test_multiple_selected_locations_merge_expanded_places(monkeypatch):
    biarritz = _job(1)
    biarritz.update({"location": "Biarritz, France", "city": "Biarritz", "country_code": "fr"})
    london = _job(2)
    london.update({"location": "London, United Kingdom", "city": "London", "country_code": "gb"})
    locations = json.dumps([
        {"location_label": "Ciboure, France", "country_code": "fr", "lat": 43.3849, "lng": -1.6682},
        {"location_label": "London, United Kingdom", "country_code": "gb", "lat": 51.5074, "lng": -0.1278},
    ])
    response, _calls = _run_feed(
        monkeypatch,
        [biarritz, london],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false", "JOBS_LOCATION_MAX_EXPANDED_CITIES": "20"},
        locations_json=locations,
        geo_places=_geo_places(),
    )
    assert {job["job_id"] for job in response["jobs"]} == {"job_1", "job_2"}


def test_include_unknown_location_still_includes_unknown_with_radius_expansion(monkeypatch):
    unknown = _job(1)
    unknown.update({"location": "", "city": "", "region": "", "country_code": ""})
    response, _calls = _run_feed(
        monkeypatch,
        [unknown],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
        include_unknown_location=True,
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]


def test_invalid_de_jobs_remain_excluded_with_location_intelligence(monkeypatch):
    invalid = _job(1, tier="D", status="invalid")
    invalid.update({"location": "Biarritz, France", "city": "Biarritz", "country_code": "fr"})
    response, _calls = _run_feed(
        monkeypatch,
        [invalid],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert response["jobs"] == []


def test_already_swiped_jobs_remain_excluded_with_location_intelligence(monkeypatch):
    biarritz = _job(1)
    biarritz.update({"location": "Biarritz, France", "city": "Biarritz", "country_code": "fr"})
    response, _calls = _run_feed(
        monkeypatch,
        [biarritz],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
        swiped_ids=["job_1"],
    )
    assert response["jobs"] == []


def test_existing_validated_a_b_jobs_remain_preferred(monkeypatch):
    a_job = _job(1, tier="A")
    a_job.update({"location": "Biarritz, France", "city": "Biarritz", "country_code": "fr"})
    b_job = _job(2, tier="B")
    b_job.update({"location": "Bayonne, France", "city": "Bayonne", "country_code": "fr"})
    response, _calls = _run_feed(
        monkeypatch,
        [b_job, a_job],
        env={"JOBS_FEED_SYNC_REFRESH_ENABLED": "false"},
        locations_json=_location_payload(),
        geo_places=_geo_places(),
    )
    assert response["jobs"][0]["job_id"] == "job_1"


def test_slow_sync_jsearch_fallback_times_out_and_sets_cooldown(monkeypatch):
    async def slow_refresh():
        await asyncio.sleep(1.2)
        return [_job(1)]

    monkeypatch.setattr(server, "_feed_sync_refresh_cooldown_until", 0.0)
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldowns", {})
    response, calls = _run_feed(
        monkeypatch,
        [],
        env={
            "JOBS_FEED_SYNC_REFRESH_MAX_SECONDS": "1",
            "JOBS_FEED_SYNC_REFRESH_COOLDOWN_SECONDS": "30",
        },
        refresh=slow_refresh,
    )
    assert calls["refresh"] == 1
    assert response["jobs"] == []
    assert server._feed_sync_refresh_cooldown_until > 0

    response, calls = _run_feed(
        monkeypatch,
        [],
        env={
            "JOBS_FEED_SYNC_REFRESH_MAX_SECONDS": "1",
            "JOBS_FEED_SYNC_REFRESH_COOLDOWN_SECONDS": "30",
        },
        refresh=lambda: [_job(2)],
    )
    assert calls["refresh"] == 0
    assert response["jobs"] == []
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldown_until", 0.0)
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldowns", {})


def test_explicit_local_timeout_does_not_block_different_city_discovery(monkeypatch):
    async def slow_refresh():
        await asyncio.sleep(1.2)
        return [_job(1)]

    monkeypatch.setattr(server, "_feed_sync_refresh_cooldown_until", 0.0)
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldowns", {})
    paris_payload = json.dumps([{
        "location_label": "Paris, France",
        "country": "France",
        "country_code": "",
        "lat": None,
        "lng": None,
    }])
    response, calls = _run_feed(
        monkeypatch,
        [],
        env={
            "JOBS_FEED_SYNC_REFRESH_MAX_SECONDS": "1",
            "JOBS_FEED_SYNC_REFRESH_COOLDOWN_SECONDS": "30",
        },
        refresh=slow_refresh,
        locations_json=paris_payload,
        geo_places=_geo_places(),
    )
    assert calls["refresh"] == 1
    assert response["jobs"] == []
    assert server._feed_sync_refresh_cooldowns

    imported = _job(2, tier="C", status="unknown", title="Marketing Manager")
    imported.update({"location": "Toulouse, France", "city": "Toulouse", "country_code": "fr"})
    toulouse_payload = json.dumps([{
        "location_label": "Toulouse, France",
        "country": "France",
        "country_code": "",
        "lat": None,
        "lng": None,
    }])
    response, calls = _run_feed(
        monkeypatch,
        [],
        env={
            "JOBS_FEED_SYNC_REFRESH_MAX_SECONDS": "1",
            "JOBS_FEED_SYNC_REFRESH_COOLDOWN_SECONDS": "30",
            "JOBS_FEED_DEBUG_DIAGNOSTICS": "true",
        },
        refresh=lambda: [imported],
        locations_json=toulouse_payload,
        search_radius="52km",
        geo_places=_geo_places(),
    )
    assert calls["refresh"] >= 1
    assert response["request_trace"]["local_jsearch_skip_reason"] is None
    assert response["request_trace"]["feed_provider_cooldown_active"] is False
    assert [job["job_id"] for job in response["jobs"]] == ["job_2"]
    monkeypatch.setattr(server, "_feed_sync_refresh_cooldowns", {})


def test_d_and_e_jobs_are_excluded(monkeypatch):
    jobs = [
        _job(1, tier="D", status="invalid"),
        _job(2, tier="E", status="invalid"),
        _job(3, tier="A", status="valid"),
    ]
    response, _calls = _run_feed(monkeypatch, jobs, env={"JOBS_DB_WEAK_RESULTS_THRESHOLD": "0"})
    assert [job["job_id"] for job in response["jobs"]] == ["job_3"]


def test_c_tier_excluded_by_default(monkeypatch):
    response, _calls = _run_feed(monkeypatch, [_job(1, tier="C", status="unknown")], env={"JOBS_DB_WEAK_RESULTS_THRESHOLD": "0"})
    assert response["jobs"] == []


def test_c_tier_can_be_included_by_config(monkeypatch):
    response, _calls = _run_feed(
        monkeypatch,
        [_job(1, tier="C", status="unknown")],
        env={"JOBS_ALLOW_UNKNOWN_TIER_IN_FEED": "true", "JOBS_DB_WEAK_RESULTS_THRESHOLD": "0"},
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_1"]


def test_already_swiped_jobs_are_excluded(monkeypatch):
    response, _calls = _run_feed(
        monkeypatch,
        [_job(1), _job(2)],
        env={"JOBS_DB_WEAK_RESULTS_THRESHOLD": "0"},
        swiped_ids={"job_1"},
    )
    assert [job["job_id"] for job in response["jobs"]] == ["job_2"]


def test_role_and_location_filters_still_shape_response(monkeypatch):
    jobs = [
        _job(1, title="Marketing Manager"),
        _job(2, title="Backend Developer"),
    ]
    response, _calls = _run_feed(monkeypatch, jobs, env={"JOBS_DB_WEAK_RESULTS_THRESHOLD": "0"})
    assert response["jobs"]
    assert all("match_score" in job and "match_reasons" in job for job in response["jobs"])
    assert response["searched_location"] == "Paris, France"
