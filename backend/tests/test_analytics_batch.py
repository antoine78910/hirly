import asyncio
from contextlib import nullcontext
from pathlib import Path

import server


def test_backend_deployable_analytics_registry_matches_canonical_contract():
    canonical_path = (
        Path(__file__).resolve().parents[2]
        / "packages"
        / "contracts"
        / "src"
        / "analytics-registry.v1.json"
    )
    deployable_path = Path(server.__file__).resolve().with_name(
        "analytics-registry.v1.json"
    )

    assert deployable_path.read_bytes() == canonical_path.read_bytes()


def test_analytics_registry_loader_falls_back_to_backend_deployable_copy(
    monkeypatch, tmp_path
):
    missing_path = tmp_path / "packages" / "analytics-registry.v1.json"
    deployable_path = Path(server.__file__).resolve().with_name(
        "analytics-registry.v1.json"
    )
    monkeypatch.setattr(
        server,
        "_ANALYTICS_REGISTRY_PATHS",
        (missing_path, deployable_path),
    )

    registry = server._load_analytics_registry()

    assert registry["schemaVersion"] == "hirly.analytics-registry.v1"
    assert {event["name"] for event in registry["events"]} >= {
        "user_signed_up",
        "cv_uploaded",
        "job_dismissed",
        "subscription_activated",
        "subscription_churned",
    }


class _Request:
    headers = {"user-agent": "test-agent"}
    client = type("Client", (), {"host": "127.0.0.1"})()


class _Events:
    def __init__(self):
        self.batches = []
        self.rows = {}
        self.operations = 0
        self.ignore_duplicates = []

    async def insert_many(self, documents, *, ignore_duplicates=False):
        self.operations += 1
        self.ignore_duplicates.append(ignore_duplicates)
        inserted = []
        for document in documents:
            event_id = document["event_id"]
            if ignore_duplicates and event_id in self.rows:
                continue
            self.rows[event_id] = dict(document)
            inserted.append(dict(document))
        if inserted:
            self.batches.append(inserted)


class _Db:
    def __init__(self):
        self.analytics_events = _Events()


def _user(user_id="123e4567-e89b-12d3-a456-426614174000"):
    return server.User(
        user_id=user_id,
        email="analytics@example.com",
        name="Analytics Fixture",
    )


def test_user_exposes_canonical_analytics_identity_without_storage_alias():
    user = server.User(
        user_id="user_internal_123",
        supabase_user_id="123e4567-e89b-12d3-a456-426614174000",
        email="analytics@example.com",
        name="Analytics Fixture",
    )

    assert user.analytics_user_id == "123e4567-e89b-12d3-a456-426614174000"
    assert user.model_dump()["analytics_user_id"] == user.analytics_user_id
    assert "supabase_user_id" not in user.model_dump()


def test_billing_identity_resolution_returns_canonical_auth_uuid(monkeypatch):
    canonical_user_id = "123e4567-e89b-12d3-a456-426614174000"

    class _Users:
        async def find_one(self, query, projection):
            assert query == {"user_id": "user_internal_123"}
            assert projection == {"_id": 0, "supabase_user_id": 1}
            return {"supabase_user_id": canonical_user_id}

    monkeypatch.setattr(server, "db", type("Db", (), {"users": _Users()})())
    resolved = asyncio.run(
        server._resolve_posthog_user_id(
            metadata={"user_id": "user_internal_123"},
        )
    )

    assert resolved == canonical_user_id


def test_billing_identity_resolution_rejects_malformed_metadata_without_raising():
    assert asyncio.run(server._resolve_posthog_user_id(metadata="not-a-mapping")) is None
    assert server._posthog_invoice_product_properties(
        {"metadata": "not-a-mapping", "lines": {"data": []}}
    ) == {}


def test_analytics_batch_is_bounded_and_server_idempotent(monkeypatch):
    db = _Db()
    monkeypatch.setattr(server, "db", db)
    first = server.AnalyticsBatchRequest(
        batch_id="batch-fixed",
        events=[server.AnalyticsEventRequest(event="cta_signup_clicked", event_id="client-1")],
    )
    second = server.AnalyticsBatchRequest(
        batch_id="batch-fixed",
        events=[server.AnalyticsEventRequest(event="cta_signup_clicked", event_id="client-replay")],
    )

    first_result = asyncio.run(server.track_analytics_events(first, _Request(), None))
    second_result = asyncio.run(server.track_analytics_events(second, _Request(), None))

    assert first_result["accepted_event_ids"] == second_result["accepted_event_ids"]
    assert first_result["accepted_event_ids"][0].startswith("evt_batch_")
    assert len(db.analytics_events.batches) == 1
    assert db.analytics_events.batches[0][0]["batch_id"] == "batch-fixed"
    assert db.analytics_events.batches[0][0]["user_id"] is None
    assert db.analytics_events.operations == 2
    assert db.analytics_events.ignore_duplicates == [True, True]


def test_analytics_batch_rejects_more_than_twenty_events():
    body = server.AnalyticsBatchRequest(
        batch_id="batch-too-many",
        events=[server.AnalyticsEventRequest(event="landing_view") for _ in range(21)],
    )
    try:
        asyncio.run(server.track_analytics_events(body, _Request(), None))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400
    else:
        raise AssertionError("expected bounded analytics batch rejection")


def test_replayed_batch_cannot_mutate_first_persisted_document(monkeypatch):
    db = _Db()
    monkeypatch.setattr(server, "db", db)
    first = server.AnalyticsBatchRequest(
        batch_id="immutable-batch",
        events=[server.AnalyticsEventRequest(event="cta_signup_clicked", event_id="first", properties={"step": 1})],
    )
    hostile_replay = server.AnalyticsBatchRequest(
        batch_id="immutable-batch",
        events=[server.AnalyticsEventRequest(event="landing_view", event_id="second", properties={"step": 999})],
    )

    asyncio.run(server.track_analytics_events(first, _Request(), None))
    original = dict(db.analytics_events.batches[0][0])
    asyncio.run(server.track_analytics_events(hostile_replay, _Request(), None))

    assert len(db.analytics_events.batches) == 1
    assert db.analytics_events.batches[0][0] == original


def test_partial_replay_acknowledges_every_validated_client_event(monkeypatch):
    db = _Db()
    monkeypatch.setattr(server, "db", db)
    first = server.AnalyticsBatchRequest(
        batch_id="partial-batch",
        events=[server.AnalyticsEventRequest(event="landing_view", event_id="first")],
    )
    replay = server.AnalyticsBatchRequest(
        batch_id="partial-batch",
        events=[
            server.AnalyticsEventRequest(event="landing_view", event_id="first-replayed"),
            server.AnalyticsEventRequest(event="cta_signup_clicked", event_id="second"),
        ],
    )

    asyncio.run(server.track_analytics_events(first, _Request(), None))
    result = asyncio.run(server.track_analytics_events(replay, _Request(), None))

    assert result["accepted_event_ids"][0] in db.analytics_events.rows
    assert result["accepted_event_ids"][1] in db.analytics_events.rows
    assert len(db.analytics_events.rows) == 2
    assert db.analytics_events.operations == 2


def test_concurrent_replay_shape_uses_atomic_insert_ignore_without_reads(monkeypatch):
    db = _Db()
    monkeypatch.setattr(server, "db", db)
    body = server.AnalyticsBatchRequest(
        batch_id="race-batch",
        events=[server.AnalyticsEventRequest(event="cta_signup_clicked", event_id="client-event")],
    )

    async def run_concurrent_replays():
        return await asyncio.gather(
            server.track_analytics_events(body, _Request(), None),
            server.track_analytics_events(body, _Request(), None),
        )

    results = asyncio.run(run_concurrent_replays())

    assert results[0]["accepted_event_ids"] == results[1]["accepted_event_ids"]
    assert len(db.analytics_events.rows) == 1
    assert db.analytics_events.operations == 2
    assert db.analytics_events.ignore_duplicates == [True, True]


def test_live_event_preserves_valid_occurrence_and_registry_metadata():
    body = server.AnalyticsEventRequest(
        event="checkout_started",
        occurred_at="2026-07-20T17:59:00Z",
        properties={"plan": "pro", "email": "private@example.com"},
    )

    document = server._analytics_event_document(
        body,
        _Request(),
        _user(),
        now="2026-07-20T18:00:00+00:00",
    )

    assert document["event"] == "checkout_started"
    assert document["canonical_event"] == "checkout_intent_started"
    assert document["registry_authoritative_source"] == "frontend"
    assert document["registry_valid"] is True
    assert document["canonical_properties"] == {"plan": "pro"}
    assert document["registry_rejected_properties"] == ["email"]
    assert document["properties"] == {"plan": "pro"}
    assert document["occurred_at"] == "2026-07-20T17:59:00Z"
    assert document["received_at"] == "2026-07-20T18:00:00+00:00"
    assert document["timestamp_quality"] == "validated_client_occurrence"
    assert document["clock_skew_ms"] == -60_000
    assert document["identity_quality"] == "canonical_user_id"


def test_live_event_falls_back_to_receipt_time_outside_clock_window():
    future = server._analytics_event_document(
        server.AnalyticsEventRequest(
            event="landing_view",
            occurred_at="2026-07-20T18:05:00.001Z",
        ),
        _Request(),
        None,
        now="2026-07-20T18:00:00+00:00",
    )
    stale = server._analytics_event_document(
        server.AnalyticsEventRequest(
            event="landing_view",
            occurred_at="2026-07-19T17:59:59.999Z",
        ),
        _Request(),
        None,
        now="2026-07-20T18:00:00+00:00",
    )
    invalid = server._analytics_event_document(
        server.AnalyticsEventRequest(
            event="landing_view",
            occurred_at="2026-07-20T18:00:00",
        ),
        _Request(),
        None,
        now="2026-07-20T18:00:00+00:00",
    )

    assert future["timestamp_quality"] == "server_received_at"
    assert stale["timestamp_quality"] == "server_received_at"
    assert invalid["timestamp_quality"] == "server_received_at"
    assert future["occurred_at"] is None
    assert stale["occurred_at"] is None
    assert invalid["occurred_at"] is None


def test_identified_frontend_event_is_not_registry_valid_for_anonymous_actor():
    document = server._analytics_event_document(
        server.AnalyticsEventRequest(
            event="checkout_started",
            occurred_at="2026-07-20T17:59:00Z",
            properties={"plan": "pro"},
        ),
        _Request(),
        None,
        now="2026-07-20T18:00:00+00:00",
    )

    assert document["identity_quality"] == "anonymous"
    assert document["registry_valid"] is False


def test_batch_idempotency_is_scoped_to_actor(monkeypatch):
    db = _Db()
    monkeypatch.setattr(server, "db", db)
    body = server.AnalyticsBatchRequest(
        batch_id="shared-batch",
        events=[server.AnalyticsEventRequest(event="landing_view")],
    )

    first = asyncio.run(server.track_analytics_events(body, _Request(), _user()))
    second = asyncio.run(
        server.track_analytics_events(
            body,
            _Request(),
            _user("123e4567-e89b-12d3-a456-426614174001"),
        )
    )

    assert first["accepted_event_ids"] != second["accepted_event_ids"]
    assert len(db.analytics_events.rows) == 2


def test_backend_capture_validates_identity_owner_properties_and_fails_open(monkeypatch):
    captures = []
    identified = []
    monkeypatch.setattr(server, "_posthog_client", object())
    monkeypatch.setattr(server, "new_context", nullcontext)
    monkeypatch.setattr(server, "identify_context", identified.append)
    monkeypatch.setattr(
        server,
        "posthog_capture",
        lambda event, **kwargs: captures.append((event, kwargs)),
    )

    assert server._capture_posthog_registry_event(
        "user_logged_in",
        "123e4567-e89b-12d3-a456-426614174000",
        {
            "auth_source": "supabase",
            "has_gmail_provider": True,
            "email": "private@example.com",
        },
    )
    assert identified == ["123e4567-e89b-12d3-a456-426614174000"]
    assert captures[0][0] == "user_logged_in"
    assert captures[0][1]["properties"]["event_source"] == "backend"
    assert captures[0][1]["properties"]["timestamp_quality"] == "server_received_at"
    assert captures[0][1]["properties"]["rejected_property_count"] == 1
    assert "email" not in captures[0][1]["properties"]
    assert captures[0][1]["timestamp"]

    assert not server._capture_posthog_registry_event(
        "user_logged_in",
        "123E4567-E89B-12D3-A456-426614174000",
    )
    assert not server._capture_posthog_registry_event(
        "checkout_intent_started",
        "123e4567-e89b-12d3-a456-426614174000",
    )

    monkeypatch.setattr(
        server,
        "posthog_capture",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("offline")),
    )
    assert not server._capture_posthog_registry_event(
        "account_deleted",
        "123e4567-e89b-12d3-a456-426614174000",
    )
