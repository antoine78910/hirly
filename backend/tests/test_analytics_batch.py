import asyncio

import server


class _Request:
    headers = {"user-agent": "test-agent"}
    client = type("Client", (), {"host": "127.0.0.1"})()


class _Events:
    def __init__(self):
        self.batches = []

    async def insert_many(self, documents):
        self.batches.append(list(documents))

    def find(self, query):
        ids = set(query["event_id"]["$in"])
        rows = [row for batch in self.batches for row in batch if row["event_id"] in ids]

        class _Cursor:
            async def to_list(self, _length):
                return rows

        return _Cursor()


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
    assert db.analytics_events.batches[0][0]["event_id"] == db.analytics_events.batches[1][0]["event_id"]
    assert db.analytics_events.batches[0][0]["batch_id"] == "batch-fixed"
    assert db.analytics_events.batches[0][0]["user_id"] is None


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
