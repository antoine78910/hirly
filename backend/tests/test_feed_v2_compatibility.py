import asyncio
import base64
import hashlib
import hmac
import json

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
    monkeypatch.setenv("FEED_V2_DELEGATION_ENABLED", "true")
    monkeypatch.setenv("FEED_V2_INTERNAL_URL", "http://feed-v2.internal/internal/feed/v2")
    monkeypatch.setenv("FEED_V2_ASSERTION_SECRET", "feed-v2-test-secret-that-is-at-least-32-bytes")
    monkeypatch.setenv("FEED_V2_TIMEOUT_MS", "125")


class _ProfilesOnlyDB:
    class Profiles:
        async def find_one(self, *_args, **_kwargs):
            return {
                "user_id": "user-1",
                "cv_text": "Experienced engineer",
                "target_role": "Engineer",
                "contact": {"phone": "+33 6 12 34 56 78"},
            }

    profiles = Profiles()


def _feed_args():
    return {
        "user": server.User(user_id="user-1", email="user@example.com", name="User"),
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


def test_feed_v2_delegation_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("FEED_V2_DELEGATION_ENABLED", raising=False)
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_kwargs: (_ for _ in ()).throw(AssertionError("HTTP called")))

    result = asyncio.run(server._try_feed_v2(user_id="user-1", limit=5, filters=_default_filters()))

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
    result = asyncio.run(server._try_feed_v2(user_id="user-1", limit=5, filters=_default_filters()))

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

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, *_args, **_kwargs):
            raise httpx.ReadTimeout("bounded timeout")

    monkeypatch.setattr(server.httpx, "AsyncClient", Client)

    assert asyncio.run(server._try_feed_v2(user_id="user-1", limit=5, filters=_default_filters())) is None


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


def test_explicit_filter_request_stays_on_legacy_path_without_v2_http(monkeypatch):
    _enable(monkeypatch)
    filters = _default_filters()
    filters["searchRole"] = "Data Engineer"
    monkeypatch.setattr(server.httpx, "AsyncClient", lambda **_kwargs: (_ for _ in ()).throw(AssertionError("HTTP called")))

    assert asyncio.run(server._try_feed_v2(user_id="user-1", limit=5, filters=filters)) is None
