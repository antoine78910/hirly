import asyncio
from datetime import datetime, timezone

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
    def __init__(self, jobs, profile, swipes=None):
        self.jobs = _Collection(jobs)
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


def _run_feed(monkeypatch, jobs, *, env=None, refresh=None, swiped_ids=None):
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
    fake_db = _FakeDB(jobs, _profile(), swipes)
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
        work_location=None,
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
        search_radius="50km",
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


def test_db_first_enough_jobs_does_not_call_jsearch(monkeypatch):
    response, calls = _run_feed(monkeypatch, [_job(i) for i in range(35)])
    assert calls["refresh"] == 0
    assert response["jobs"]
    assert response["total"] <= 5
    assert response["filters_applied"]["manual_fulfillment_ready"] is True


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


def test_slow_sync_jsearch_fallback_times_out_and_sets_cooldown(monkeypatch):
    async def slow_refresh():
        await asyncio.sleep(1.2)
        return [_job(1)]

    monkeypatch.setattr(server, "_feed_sync_refresh_cooldown_until", 0.0)
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
