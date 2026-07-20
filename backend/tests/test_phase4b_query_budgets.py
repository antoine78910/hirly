import asyncio

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
