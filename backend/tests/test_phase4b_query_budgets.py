import asyncio
import inspect

import gmail_sync
from auto_apply import queue
from db.base import is_missing_database_contract_error
from notifications_service import mark_all_notifications_read
from training_service import (
    list_creator_students,
    list_published_courses,
    list_user_enrollments,
)


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args):
        return self

    async def to_list(self, limit=None):
        return self.rows[:limit] if limit else self.rows


class _Collection:
    def __init__(self, rows, counter, name):
        self.rows = rows
        self.counter = counter
        self.name = name

    def find(self, query=None, projection=None):
        self.counter.append(self.name)
        query = query or {}
        rows = self.rows
        for key, expected in query.items():
            if isinstance(expected, dict) and "$in" in expected:
                rows = [row for row in rows if row.get(key) in expected["$in"]]
            else:
                rows = [row for row in rows if row.get(key) == expected]
        return _Cursor(rows)


class _TrainingDb:
    def __init__(self):
        self.calls = []
        self.training_courses = _Collection(
            [
                {"course_id": "c1", "published": True, "creator_id": "creator", "title": "One"},
                {"course_id": "c2", "published": True, "creator_id": "creator", "title": "Two"},
            ],
            self.calls,
            "courses",
        )
        self.training_modules = _Collection(
            [{"course_id": "c1", "module_id": "m1"}, {"course_id": "c2", "module_id": "m2"}],
            self.calls,
            "modules",
        )
        self.training_enrollments = _Collection(
            [
                {"enrollment_id": "e1", "course_id": "c1", "user_id": "u1"},
                {"enrollment_id": "e2", "course_id": "c2", "user_id": "u2"},
            ],
            self.calls,
            "enrollments",
        )
        self.users = _Collection(
            [{"user_id": "u1", "email": "1@example.com"}, {"user_id": "u2", "email": "2@example.com"}],
            self.calls,
            "users",
        )


def test_training_lists_have_fixed_query_budgets():
    db = _TrainingDb()
    assert len(asyncio.run(list_published_courses(db))) == 2
    assert db.calls == ["courses", "modules"]

    db.calls.clear()
    assert len(asyncio.run(list_user_enrollments(db, "u1"))) == 1
    assert db.calls == ["enrollments", "courses", "modules"]

    db.calls.clear()
    assert len(asyncio.run(list_creator_students(db, "creator"))) == 2
    assert db.calls == ["courses", "enrollments", "users"]


def test_notification_mark_all_uses_one_bounded_mutation():
    class _Db:
        def __init__(self):
            self.calls = []

        async def mark_all_notifications_read(self, user_id, *, limit):
            self.calls.append((user_id, limit))
            return 3

    db = _Db()
    assert asyncio.run(mark_all_notifications_read(db, user_id="u1")) == 3
    assert db.calls == [("u1", 500)]


def test_notification_mark_all_falls_back_only_for_missing_rpc():
    class _Cursor:
        async def to_list(self, _limit):
            return [{"notification_id": "n1"}]

    class _Notifications:
        def __init__(self):
            self.updated = []

        def find(self, _filter, _projection):
            return _Cursor()

        async def update_one(self, filter, update):
            self.updated.append((filter, update))

    class _Db:
        def __init__(self):
            self.notifications = _Notifications()

        async def mark_all_notifications_read(self, _user_id, *, limit):
            raise RuntimeError("PGRST202 Could not find the function")

    db = _Db()
    assert asyncio.run(mark_all_notifications_read(db, user_id="u1")) == 1
    assert len(db.notifications.updated) == 1


def test_gmail_sync_preloads_existing_messages_and_batches_writes():
    source = inspect.getsource(gmail_sync.sync_gmail_application_emails)

    assert "existing_by_id" in source
    assert "application_emails.find_one" not in source
    assert "application_emails.insert_many" in source
    assert "range(0, len(pending_email_writes), 100)" in source
    assert "apply_gmail_application_outcomes" in source


def test_missing_database_contract_classifier_is_narrow():
    assert is_missing_database_contract_error(
        RuntimeError("HTTP 404 PGRST202 Could not find the function")
    )
    assert not is_missing_database_contract_error(
        RuntimeError("HTTP 500 statement timeout")
    )
    assert not is_missing_database_contract_error(
        RuntimeError("HTTP 503 connection refused")
    )


def test_auto_apply_backfill_uses_one_bounded_contract(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_QUEUE_ENABLED", "true")
    monkeypatch.setenv("AUTO_APPLY_QUEUE_PROVIDERS", "smartrecruiters,greenhouse")

    class _Db:
        def __init__(self):
            self.calls = []

        async def backfill_auto_apply_queue(self, providers, *, limit):
            self.calls.append((providers, limit))
            return 2

    db = _Db()
    assert asyncio.run(queue.backfill_pending_applications(db, limit=200)) == 2
    assert db.calls == [(["greenhouse", "smartrecruiters"], 200)]
