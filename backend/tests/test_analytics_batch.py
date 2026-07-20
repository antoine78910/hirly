import asyncio

import server


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

    assert first_result["accepted_event_ids"] == ["client-1"]
    assert second_result["accepted_event_ids"] == ["client-replay"]
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

    assert result["accepted_event_ids"] == ["first-replayed", "second"]
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

    assert [result["accepted_event_ids"] for result in results] == [["client-event"], ["client-event"]]
    assert len(db.analytics_events.rows) == 1
    assert db.analytics_events.operations == 2
    assert db.analytics_events.ignore_duplicates == [True, True]
