import asyncio

import server


class _Collection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def find_one(self, filter, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                return dict(row)
        return None

    async def update_one(self, filter, update, upsert=False):
        for row in self.rows:
            if all(row.get(key) == value for key, value in filter.items()):
                if "$set" in update:
                    for key, value in update["$set"].items():
                        if "." in key:
                            top, nested = key.split(".", 1)
                            row.setdefault(top, {})[nested] = value
                        else:
                            row[key] = value
                return {"matched_count": 1, "modified_count": 1}
        return {"matched_count": 0, "modified_count": 0}


class _DB:
    def __init__(self, *, applications=None, users=None):
        self.applications = _Collection(applications or [])
        self.users = _Collection(users or [])


def _admin():
    return server.User(user_id="admin_1", email="admin@tryhirly.com", name="Admin")


def _base_application(**overrides):
    app = {
        "application_id": "app_1",
        "user_id": "user_1",
        "job_id": "job_1",
        "submission_status": "not_submitted",
    }
    app.update(overrides)
    return app


def _base_user(**overrides):
    user = {"user_id": "user_1", "billing": {"credits_total": 200, "credits_remaining": 150}}
    user.update(overrides)
    return user


def test_offer_expired_sets_expired_status_and_refunds_credit(monkeypatch):
    db = _DB(applications=[_base_application()], users=[_base_user()])
    monkeypatch.setattr(server, "db", db)

    result = asyncio.run(server.admin_update_application_manual_status(
        "app_1", server.AdminManualStatusUpdate(manual_status="offer_expired"), admin=_admin(),
    ))

    assert result["application"]["submission_status"] == "expired"
    assert db.users.rows[0]["billing"]["credits_remaining"] == 151
    assert db.applications.rows[0].get("credit_refunded_at") is not None


def test_offer_expired_refund_clamped_to_plan_total(monkeypatch):
    db = _DB(
        applications=[_base_application()],
        users=[_base_user(billing={"credits_total": 200, "credits_remaining": 200})],
    )
    monkeypatch.setattr(server, "db", db)

    asyncio.run(server.admin_update_application_manual_status(
        "app_1", server.AdminManualStatusUpdate(manual_status="offer_expired"), admin=_admin(),
    ))

    assert db.users.rows[0]["billing"]["credits_remaining"] == 200


def test_offer_expired_does_not_double_refund(monkeypatch):
    db = _DB(applications=[_base_application()], users=[_base_user()])
    monkeypatch.setattr(server, "db", db)

    asyncio.run(server.admin_update_application_manual_status(
        "app_1", server.AdminManualStatusUpdate(manual_status="offer_expired"), admin=_admin(),
    ))
    assert db.users.rows[0]["billing"]["credits_remaining"] == 151

    # Re-applying the same status must not refund a second time.
    asyncio.run(server.admin_update_application_manual_status(
        "app_1", server.AdminManualStatusUpdate(manual_status="offer_expired"), admin=_admin(),
    ))
    assert db.users.rows[0]["billing"]["credits_remaining"] == 151


def test_other_manual_statuses_still_work_unchanged(monkeypatch):
    db = _DB(applications=[_base_application()], users=[_base_user()])
    monkeypatch.setattr(server, "db", db)

    result = asyncio.run(server.admin_update_application_manual_status(
        "app_1", server.AdminManualStatusUpdate(manual_status="manually_submitted"), admin=_admin(),
    ))

    assert result["application"]["submission_status"] == "submitted"
    # No refund for non-expired statuses.
    assert db.users.rows[0]["billing"]["credits_remaining"] == 150


def test_refund_application_credit_direct(monkeypatch):
    db = _DB(users=[_base_user(billing={"credits_total": 200, "credits_remaining": 0})])
    monkeypatch.setattr(server, "db", db)

    asyncio.run(server._refund_application_credit("user_1"))

    assert db.users.rows[0]["billing"]["credits_remaining"] == 1
