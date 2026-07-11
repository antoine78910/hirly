import asyncio

import server


class _Cursor:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]

    def sort(self, field, direction=-1):
        # Support both a plain field name (`sort("field", -1)`) and the
        # Mongo-style multi-field spec used elsewhere (`sort([("field", -1)])`).
        if isinstance(field, (list, tuple)) and field and isinstance(field[0], (list, tuple)):
            for key, dir_ in reversed(field):
                self.rows.sort(key=lambda row: row.get(key) or "", reverse=dir_ < 0)
            return self
        self.rows.sort(key=lambda row: row.get(field) or "", reverse=direction < 0)
        return self

    def limit(self, limit):
        self.rows = self.rows[:limit]
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class _Collection:
    def __init__(self, rows=None, name="collection"):
        self.rows = list(rows or [])
        self.name = name

    def find(self, filter=None, projection=None):
        filter = filter or {}
        rows = [
            row for row in self.rows
            if all(row.get(key) == value for key, value in filter.items())
        ]
        return _Cursor(rows)

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None


def _fake_db():
    paid_user = {
        "user_id": "paid-user",
        "email": "paid@example.com",
        "name": "Paid User",
        "created_at": "2026-07-01T10:00:00+00:00",
        "billing": {
            "plan": "monthly",
            "interval": "monthly",
            "source": "onboarding",
            "subscription_status": "active",
            "stripe_customer_id": "cus_paid",
            "credits_total": 80,
            "credits_remaining": 77,
        },
    }
    return type("DB", (), {
        "users": _Collection([paid_user], "users"),
        "profiles": _Collection([], "profiles"),
        "swipes": _Collection([
            {
                "user_id": "paid-user",
                "job_id": "job-left",
                "direction": "left",
                "created_at": "2026-07-10T10:00:00+00:00",
            },
            {
                "user_id": "paid-user",
                "job_id": "job-right",
                "direction": "right",
                "created_at": "2026-07-11T10:00:00+00:00",
            },
        ], "swipes"),
        "applications": _Collection([], "applications"),
        "jobs": _Collection([], "jobs"),
    })()


def test_admin_list_exposes_paid_plan_and_swipes_without_applications(monkeypatch):
    monkeypatch.setattr(server, "db", _fake_db())

    response = asyncio.run(server.admin_list_users(admin=object()))

    assert len(response["users"]) == 1
    user = response["users"][0]
    assert user["plan"] == "monthly"
    assert user["subscription_status"] == "active"
    assert user["is_premium"] is True
    assert user["credits_remaining"] == 77
    assert user["total_applications"] == 0
    assert user["total_swipes"] == 2
    assert user["left_swipes"] == 1
    assert user["right_swipes"] == 1
    assert user["last_active_at"] == "2026-07-11T10:00:00+00:00"


def test_admin_user_detail_exposes_billing_and_swipe_summary(monkeypatch):
    monkeypatch.setattr(server, "db", _fake_db())

    response = asyncio.run(server.admin_get_user("paid-user", admin=object()))

    assert response["user"]["plan"] == "monthly"
    assert response["billing"]["subscription_status"] == "active"
    assert response["billing"]["is_premium"] is True
    assert response["swipe_summary"]["total"] == 2
    assert response["swipe_summary"]["right"] == 1
    assert response["swipe_summary"]["left"] == 1
    assert response["swipe_summary"]["last_swipe_at"] == "2026-07-11T10:00:00+00:00"