import asyncio
import base64
import hashlib
import hmac
import json
import time
from pathlib import Path

import httpx

import server


def _v2_response():
    return {
        "contractVersion": "hirly.feed.v2",
        "jobs": [{
            "canonicalGroupId": "group-1",
            "preferredJobId": "job-1",
            "jobVersion": "7",
            "relevanceScore": 0.91,
            "fulfillmentRoute": "auto",
        }],
        "nextCursor": None,
        "inventoryState": "ready",
        "emptyReason": None,
        "matchContext": {
            "snapshotVersion": "inventory-1",
            "profileVersion": "profile-1",
            "actionWatermark": "actions-1",
        },
        "summary": {
            "evaluated": 1,
            "eligible": 1,
            "hiddenActioned": 0,
            "hiddenPolicy": 0,
            "hiddenBlocked": 0,
            "visibleByRoute": {"auto": 1, "assisted": 0, "manual": 0, "blocked": 0},
        },
    }


def _seeded_first_navigation_response():
    fixture = Path(__file__).parent / "fixtures" / "feed_v2_paris_fullstack_first_navigation.json"
    return json.loads(fixture.read_text(encoding="utf-8"))


ANALYTICS_USER_ID = "123e4567-e89b-12d3-a456-426614174000"


def _rollout_context():
    return {
        server.FEED_V2_ROLLOUT_COUNTRY_PROPERTY: "FR",
        server.FEED_V2_ROLLOUT_COHORT_PROPERTY: (
            int(hashlib.sha256(ANALYTICS_USER_ID.encode("utf-8")).hexdigest()[:8], 16)
            % server.FEED_V2_ROLLOUT_COHORT_COUNT
        ),
    }


def _default_filters():
    return {
        "minSalary": 0,
        "postedWithin": None,
        "workLocation": None,
        "jobType": None,
        "experience": None,
        "location": None,
        "onlyCompany": None,
        "hideCompany": None,
        "onlyIndustry": None,
        "hideIndustry": None,
        "includeUnknownLocation": True,
        "includeUnknownSalary": True,
        "includeNonAutoApply": False,
        "searchRadius": "50km",
        "locationsJson": None,
        "onlyMyCountry": False,
        "locationLabel": None,
        "placeId": None,
        "country": None,
        "countryCode": None,
        "lat": None,
        "lng": None,
        "forceProviderRefresh": False,
        "prefetch": False,
        "score": False,
        "searchRole": None,
        "auditMode": False,
    }


def _enable(monkeypatch):
    monkeypatch.setenv("FEED_V2_INTERNAL_URL", "http://feed-v2.internal/internal/feed/v2")
    monkeypatch.setenv("FEED_V2_ASSERTION_SECRET", "feed-v2-test-secret-that-is-at-least-32-bytes")
    monkeypatch.setenv("FEED_V2_TIMEOUT_MS", "125")
    monkeypatch.setattr(server, "_feed_v2_rollout_enabled_for", _enabled_feed_v2_rollout)


async def _enabled_feed_v2_rollout(_distinct_id, *, rollout_context):
    assert rollout_context == _rollout_context()
    return True




class _ProfilesOnlyDB:
    class Profiles:
        async def find_one(self, *_args, **_kwargs):
            return {
                "user_id": "user-1",
                "cv_text": "Experienced engineer",
                "target_role": "Engineer",
                "target_location_data": {"country_code": "fr"},
                "contact": {"phone": "+33 6 12 34 56 78"},
            }

    profiles = Profiles()


def _feed_args():
    return {
        "user": server.User(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, email="user@example.com", name="User"),
        "limit": 5,
        "min_salary": 0,
        "posted_within": None,
        "work_location": None,
        "job_type": None,
        "experience": None,
        "location": None,
        "only_company": None,
        "hide_company": None,
        "only_industry": None,
        "hide_industry": None,
        "include_unknown_location": True,
        "include_unknown_salary": True,
        "include_non_auto_apply": False,
        "search_radius": "50km",
        "locations_json": None,
        "only_my_country": False,
        "location_label": None,
        "place_id": None,
        "country": None,
        "country_code": None,
        "lat": None,
        "lng": None,
        "force_provider_refresh": False,
        "prefetch": False,
        "score": False,
        "search_role": None,
        "audit_mode": False,
    }


def test_feed_v2_delegation_fails_closed_when_posthog_disables_the_flag(monkeypatch):
    async def disabled_rollout(_distinct_id, **_kwargs):
        return False

    monkeypatch.setattr(server, "_feed_v2_rollout_enabled_for", disabled_rollout)
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_kwargs: (_ for _ in ()).throw(AssertionError("HTTP called")))

    result = asyncio.run(server._try_feed_v2(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, rollout_context=_rollout_context(), limit=5, filters=_default_filters()))

    assert result is None


def test_feed_v2_rollout_fails_closed_when_posthog_is_unavailable(monkeypatch):
    monkeypatch.setattr(server, "_posthog_client", None)

    assert asyncio.run(server._feed_v2_rollout_enabled_for("user-1")) is False


def test_feed_v2_rollout_context_uses_saved_country_and_stable_cohort():
    profile = {"target_location_data": {"country_code": " fr "}}

    first = server._feed_v2_rollout_context(ANALYTICS_USER_ID, profile)
    second = server._feed_v2_rollout_context(ANALYTICS_USER_ID, profile)

    assert first == second
    assert first[server.FEED_V2_ROLLOUT_COUNTRY_PROPERTY] == "FR"
    assert 0 <= first[server.FEED_V2_ROLLOUT_COHORT_PROPERTY] < server.FEED_V2_ROLLOUT_COHORT_COUNT


def test_feed_v2_rollout_context_fails_closed_without_trusted_country_or_identity():
    assert server._feed_v2_rollout_context(ANALYTICS_USER_ID, {}) is None
    assert server._feed_v2_rollout_context("not-a-uuid", {"target_location_data": {"country_code": "fr"}}) is None
    assert asyncio.run(server._feed_v2_rollout_enabled_for(ANALYTICS_USER_ID)) is False


def test_feed_v2_rollout_evaluates_a_canonical_id_without_targeting_context(monkeypatch):
    observed = {}

    class Flags:
        def is_enabled(self, key):
            observed["key"] = key
            return True

    class PostHog:
        def evaluate_flags(self, distinct_id, **kwargs):
            observed["distinct_id"] = distinct_id
            observed["kwargs"] = kwargs
            return Flags()

    monkeypatch.setattr(server, "_posthog_client", PostHog())

    assert asyncio.run(server._feed_v2_rollout_enabled_for(ANALYTICS_USER_ID)) is True
    assert observed == {
        "distinct_id": ANALYTICS_USER_ID,
        "kwargs": {"flag_keys": [server.FEED_V2_ROLLOUT_FLAG]},
        "key": server.FEED_V2_ROLLOUT_FLAG,
    }


def test_feed_v2_rollout_uses_only_the_server_posthog_decision(monkeypatch):
    observed = {}

    class Flags:
        def is_enabled(self, key):
            observed["key"] = key
            return True

    class PostHog:
        def evaluate_flags(self, distinct_id, *, flag_keys, person_properties):
            observed["distinct_id"] = distinct_id
            observed["flag_keys"] = flag_keys
            observed["person_properties"] = person_properties
            return Flags()

    monkeypatch.setattr(server, "_posthog_client", PostHog())

    assert asyncio.run(
        server._feed_v2_rollout_enabled_for(
            "analytics-user", rollout_context=_rollout_context(),
        )
    ) is True
    assert observed == {
        "distinct_id": "analytics-user",
        "flag_keys": [server.FEED_V2_ROLLOUT_FLAG],
        "person_properties": _rollout_context(),
        "key": server.FEED_V2_ROLLOUT_FLAG,
    }


def test_feed_v2_rollout_fails_closed_when_posthog_evaluation_errors(monkeypatch):
    class PostHog:
        def evaluate_flags(self, *_args, **_kwargs):
            raise RuntimeError("PostHog unavailable")

    monkeypatch.setattr(server, "_posthog_client", PostHog())

    assert asyncio.run(
        server._feed_v2_rollout_enabled_for(
            "analytics-user", rollout_context=_rollout_context(),
        )
    ) is False


def test_feed_v2_delegation_requires_the_server_rollout_flag(monkeypatch):
    monkeypatch.setattr(server, "_posthog_client", None)
    monkeypatch.setattr(
        server.httpx,
        "AsyncClient",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("HTTP called")),
    )

    result = asyncio.run(server._try_feed_v2(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, rollout_context=_rollout_context(), limit=5, filters=_default_filters()))

    assert result is None


def test_feed_v2_delegation_signs_candidate_identity_with_runtime_convention(monkeypatch):
    _enable(monkeypatch)
    observed = {}

    class Client:
        def __init__(self, **kwargs):
            observed["client"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, **kwargs):
            observed.update({"url": url, **kwargs})
            return httpx.Response(200, json=_v2_response())

    monkeypatch.setattr(server.httpx, "AsyncClient", Client)
    result = asyncio.run(server._try_feed_v2(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, rollout_context=_rollout_context(), limit=5, filters=_default_filters()))

    encoded = observed["headers"]["X-Hirly-Feed-Assertion"]
    unsigned = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    assertion = json.loads(unsigned)
    expected_signature = hmac.new(
        b"feed-v2-test-secret-that-is-at-least-32-bytes", encoded.encode(), hashlib.sha256,
    ).hexdigest()
    assert observed["headers"]["X-Hirly-Feed-Signature"] == expected_signature
    assert observed["headers"]["X-Hirly-Request-Id"]
    assert assertion["candidateId"] == assertion["subject"] == "user-1"
    assert assertion["scopes"] == ["feed:read"]
    assert set(assertion) == {"subject", "candidateId", "scopes", "issuedAt", "expiresAt"}
    assert observed["params"] == {"limit": 5}
    assert observed["client"]["follow_redirects"] is False
    assert observed["client"]["timeout"].read == 0.125
    assert result == _v2_response()


def test_feed_v2_timeout_rolls_back_to_legacy_selection(monkeypatch):
    _enable(monkeypatch)
    calls = 0

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, *_args, **_kwargs):
            nonlocal calls
            calls += 1
            raise httpx.ReadTimeout("bounded timeout")

    monkeypatch.setattr(server.httpx, "AsyncClient", Client)

    assert asyncio.run(server._try_feed_v2(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, rollout_context=_rollout_context(), limit=5, filters=_default_filters())) is None
    assert calls == 1


def test_feed_v2_timeout_preserves_the_legacy_jsearch_emergency_path(monkeypatch):
    """The legacy path remains the rollback until G009 authorizes retirement."""
    _enable(monkeypatch)
    monkeypatch.setenv("JOBS_FEED_LEGACY_JSEARCH_ONLY", "true")
    monkeypatch.setenv("JSEARCH_API_KEY", "test-key")

    class EmptyCursor:
        def limit(self, _count):
            return self

        async def to_list(self, _count):
            return []

    class LegacyFallbackDB(_ProfilesOnlyDB):
        class Swipes:
            def find(self, *_args, **_kwargs):
                return EmptyCursor()

        swipes = Swipes()

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, *_args, **_kwargs):
            raise httpx.ReadTimeout("bounded timeout")

    class Provider:
        async def search(self, _query):
            return type("Result", (), {"jobs": [{
                "job_id": "legacy-job-1",
                "provider": "jsearch",
                "external_id": "legacy-1",
                "title": "Engineer",
                "company": "Hirly",
                "location": "Paris, France",
                "external_url": "https://example.test/jobs/legacy-1",
            }]})()

    async def upsert(_db, jobs, **_kwargs):
        return {"total_imported": len(jobs), "auto_apply_supported_imported": 0}

    monkeypatch.setattr(server, "db", LegacyFallbackDB())
    monkeypatch.setattr(server.httpx, "AsyncClient", Client)
    monkeypatch.setattr(server, "get_job_provider", lambda *_args: Provider())
    monkeypatch.setattr(server.jobs_service_module, "upsert_imported_jobs", upsert)

    result = asyncio.run(server.get_feed(**_feed_args()))

    assert result["feed_mode"] == "legacy_jsearch_only"
    assert result["fallback_reason"] == "legacy_jsearch_only"
    assert [job["job_id"] for job in result["jobs"]] == ["legacy-job-1"]


def test_successful_feed_v2_response_is_the_only_customer_visible_path(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(server, "db", _ProfilesOnlyDB())

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, *_args, **_kwargs):
            return httpx.Response(200, json=_v2_response())

    def forbidden(*_args, **_kwargs):
        raise AssertionError("v2 GET must not call providers or schedule feed work")

    async def forbidden_async(*_args, **_kwargs):
        forbidden()

    monkeypatch.setattr(server.httpx, "AsyncClient", Client)
    monkeypatch.setattr(server, "get_job_provider", forbidden)
    monkeypatch.setattr(server, "refresh_jobs_for_profile_if_needed", forbidden_async)
    monkeypatch.setattr(server, "schedule_feed_background_refresh", forbidden)

    result = asyncio.run(server.get_feed(**_feed_args()))

    assert result == _v2_response()


def test_explicit_paris_bounded_radius_get_never_calls_providers_or_schedules_background_work(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(server, "db", _ProfilesOnlyDB())
    for radius in ("52km", "103km"):
        observed = {"calls": 0}

        class Client:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def get(self, *_args, **_kwargs):
                observed["calls"] += 1
                return httpx.Response(200, json=_v2_response())

        def forbidden(*_args, **_kwargs):
            raise AssertionError("explicit v2 GET must not call providers or schedule feed work")

        async def forbidden_async(*_args, **_kwargs):
            forbidden()

        monkeypatch.setattr(server.httpx, "AsyncClient", Client)
        monkeypatch.setattr(server, "get_job_provider", forbidden)
        monkeypatch.setattr(server, "refresh_jobs_for_profile_if_needed", forbidden_async)
        monkeypatch.setattr(server, "schedule_feed_background_refresh", forbidden)
        args = _feed_args()
        args.update({
            "search_role": "Fullstack Engineer",
            "search_radius": radius,
            "locations_json": json.dumps([{
                "location_label": "Paris, France", "country": "France", "country_code": "fr",
                "lat": 48.8566, "lng": 2.3522,
            }]),
        })

        assert asyncio.run(server.get_feed(**args)) == _v2_response()
        assert observed["calls"] == 1


def test_exact_paris_fullstack_query_is_normalized_signed_and_forwarded_once(monkeypatch):
    _enable(monkeypatch)
    filters = _default_filters()
    filters.update({
        "searchRole": "Fullstack Engineer",
        "searchRadius": "52km",
        "workLocation": ["remote", "hybrid"],
        "jobType": ["full_time"],
        "locationsJson": json.dumps([{
            "location_label": "Paris, France",
            "country": "France",
            "country_code": "fr",
            "lat": 48.8566,
            "lng": 2.3522,
        }]),
    })
    observed = {"calls": 0}

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url, **kwargs):
            observed["calls"] += 1
            observed.update(kwargs)
            return httpx.Response(200, json=_v2_response())

    monkeypatch.setattr(server.httpx, "AsyncClient", Client)
    assert asyncio.run(server._try_feed_v2(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, rollout_context=_rollout_context(), limit=5, filters=filters)) == _v2_response()
    assert observed["calls"] == 1
    assert observed["params"] == {"limit": 5}

    encoded = observed["headers"]["X-Hirly-Feed-Assertion"]
    assertion = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    query = assertion["effectiveQuery"]
    assert query["role"] == "Fullstack Engineer"
    assert query["radiusKm"] == 52
    assert query["countryCode"] == "FR"
    assert query["workModes"] == ["hybrid", "remote"]
    assert query["locations"] == [{
        "label": "Paris, France", "country": "France", "countryCode": "FR", "placeId": None,
        "latitude": 48.8566, "longitude": 2.3522,
    }]
    payload = {key: value for key, value in query.items() if key != "fingerprint"}
    expected_fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
    ).hexdigest()
    assert query["fingerprint"] == expected_fingerprint
    assert query["fingerprint"] == "08225c46c605d1d6c18c22acc6a7fc67eed42dc91f4121fbebae67a50440b3cd"
    expected_signature = hmac.new(
        b"feed-v2-test-secret-that-is-at-least-32-bytes", encoded.encode(), hashlib.sha256,
    ).hexdigest()
    assert observed["headers"]["X-Hirly-Feed-Signature"] == expected_signature


def test_provider_and_background_controls_remain_non_delegable(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_kwargs: (_ for _ in ()).throw(AssertionError("HTTP called")))

    for control in ("forceProviderRefresh", "prefetch", "score", "auditMode"):
        filters = _default_filters()
        filters[control] = True
        assert asyncio.run(server._try_feed_v2(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, rollout_context=_rollout_context(), limit=5, filters=filters)) is None


def test_invalid_or_oversized_locations_json_falls_back_before_any_v2_http(monkeypatch):
    _enable(monkeypatch)
    attempts = 0

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, *_args, **_kwargs):
            nonlocal attempts
            attempts += 1
            raise AssertionError("invalid explicit query must not make a v2 HTTP attempt")

    monkeypatch.setattr(server.httpx, "AsyncClient", Client)
    too_many_locations = [{"location_label": f"Paris {index}", "country_code": "fr"} for index in range(9)]
    oversized_locations = json.dumps([{"location_label": "Paris " + "x" * 4096, "country_code": "fr"}])
    for locations_json in ("{not-json", json.dumps(too_many_locations), oversized_locations):
        filters = _default_filters()
        filters.update({"searchRole": "Fullstack Engineer", "searchRadius": "103km", "locationsJson": locations_json})
        assert asyncio.run(server._try_feed_v2(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, rollout_context=_rollout_context(), limit=5, filters=filters)) is None
    assert attempts == 0

    assert asyncio.run(server._try_feed_v2(user_id="user-1", analytics_user_id=ANALYTICS_USER_ID, rollout_context=_rollout_context(), limit=5, filters=filters)) is None


def test_first_navigation_returns_seeded_v2_once_with_zero_side_effects(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(server, "db", _ProfilesOnlyDB())
    calls = {"http": 0, "provider": 0, "refresh": 0, "schedule": 0}

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, *_args, **_kwargs):
            calls["http"] += 1
            return httpx.Response(200, json=_seeded_first_navigation_response())

    def provider_forbidden(*_args, **_kwargs):
        calls["provider"] += 1
        raise AssertionError("first-navigation GET must not discover providers")

    async def refresh_forbidden(*_args, **_kwargs):
        calls["refresh"] += 1
        raise AssertionError("first-navigation GET must not refresh inventory")

    def schedule_forbidden(*_args, **_kwargs):
        calls["schedule"] += 1
        raise AssertionError("first-navigation GET must not schedule background work")

    monkeypatch.setattr(server.httpx, "AsyncClient", Client)
    monkeypatch.setattr(server, "get_job_provider", provider_forbidden)
    monkeypatch.setattr(server, "refresh_jobs_for_profile_if_needed", refresh_forbidden)
    monkeypatch.setattr(server, "schedule_feed_background_refresh", schedule_forbidden)

    started = time.perf_counter()
    result = asyncio.run(server.get_feed(**_feed_args()))
    elapsed_ms = (time.perf_counter() - started) * 1_000

    assert result == _seeded_first_navigation_response()
    assert result["jobs"][0]["preferredJobId"] == "job-paris-fullstack-1"
    assert calls == {"http": 1, "provider": 0, "refresh": 0, "schedule": 0}
    assert elapsed_ms < 125


def _explicit_paris_fullstack_args():
    return {
        **_feed_args(),
        "search_radius": "52km",
        "locations_json": json.dumps([{
            "location_label": "Paris, France",
            "country": "France",
            "country_code": "fr",
            "lat": 48.8566,
            "lng": 2.3522,
        }]),
        "search_role": "Fullstack Engineer",
    }


def test_explicit_paris_52km_fullstack_falls_back_truthfully_when_v2_disabled(monkeypatch):
    async def disabled_rollout(_distinct_id, **_kwargs):
        return False

    monkeypatch.setattr(server, "_feed_v2_rollout_enabled_for", disabled_rollout)
    monkeypatch.setenv("JOBS_FEED_LEGACY_JSEARCH_ONLY", "true")
    monkeypatch.setattr(server, "db", _ProfilesOnlyDB())
    monkeypatch.setattr(server, "is_job_provider_configured", lambda _provider: False)
    monkeypatch.setattr(
        server.httpx,
        "AsyncClient",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("disabled v2 must not make HTTP calls")),
    )

    result = asyncio.run(server.get_feed(**_explicit_paris_fullstack_args()))

    assert result == {
        "jobs": [],
        "total": 0,
        "feed_mode": "legacy_jsearch_only",
        "fallback_reason": "missing_job_provider_credentials",
        "provider_rate_limited": False,
        "refresh_results": [{"attempted": False, "reason": "missing_api_key"}],
    }


def test_first_navigation_falls_back_after_one_unavailable_v2_attempt(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setenv("JOBS_FEED_LEGACY_JSEARCH_ONLY", "true")
    monkeypatch.setattr(server, "db", _ProfilesOnlyDB())
    monkeypatch.setattr(server, "is_job_provider_configured", lambda _provider: False)
    calls = {"http": 0}

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, *_args, **_kwargs):
            calls["http"] += 1
            raise httpx.ReadTimeout("bounded unavailable v2")

    monkeypatch.setattr(server.httpx, "AsyncClient", Client)

    result = asyncio.run(server.get_feed(**_feed_args()))

    assert calls["http"] == 1
    assert result["fallback_reason"] == "missing_job_provider_credentials"
    assert result["jobs"] == []
