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
        if upsert:
            new_row = dict(filter)
            new_row.update(update.get("$set", {}))
            self.rows.append(new_row)
            return {"matched_count": 0, "modified_count": 0, "upserted_id": True}
        return {"matched_count": 0, "modified_count": 0}


class _DB:
    def __init__(self, *, applications=None, users=None, jobs=None):
        self.applications = _Collection(applications or [])
        self.users = _Collection(users or [])
        self.jobs = _Collection(jobs or [{"job_id": "job_1", "title": "Software Engineer", "company": "Acme"}])
        self.notifications = _Collection([])


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
    assert len(db.notifications.rows) == 1
    notification = db.notifications.rows[0]
    assert notification["type"] == "offer_expired"
    assert notification["user_id"] == "user_1"
    assert "Software Engineer" in notification["body"]
    assert "Acme" in notification["body"]


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
    # ...nor create a second notification.
    assert len(db.notifications.rows) == 1


def test_other_manual_statuses_still_work_unchanged(monkeypatch):
    db = _DB(applications=[_base_application()], users=[_base_user()])
    monkeypatch.setattr(server, "db", db)

    result = asyncio.run(server.admin_update_application_manual_status(
        "app_1", server.AdminManualStatusUpdate(manual_status="manually_submitted"), admin=_admin(),
    ))

    assert result["application"]["submission_status"] == "submitted"
    # No refund for non-expired statuses.
    assert db.users.rows[0]["billing"]["credits_remaining"] == 150


def test_legacy_needs_user_input_action_persists_manual_status(monkeypatch):
    db = _DB(applications=[_base_application(manual_status="manual_review_needed")])
    monkeypatch.setattr(server, "db", db)

    result = asyncio.run(server.admin_update_application_status(
        "app_1", server.AdminStatusUpdate(status="needs_user_input"), admin=_admin(),
    ))

    application = result["application"]
    assert application["admin_status"] == "needs_user_input"
    assert application["manual_status"] == "needs_user_input"
    assert application["submission_status"] == "action_required"
    assert application["admin_timeline"][-1]["admin_status"] == "needs_user_input"


def test_newer_admin_needs_user_input_wins_over_stale_manual_status():
    application = _base_application(
        admin_status="needs_user_input",
        admin_status_updated_at="2026-07-16T12:00:00+00:00",
        manual_status="manual_review_needed",
        manual_status_updated_at="2026-07-15T12:00:00+00:00",
    )

    assert server._effective_manual_status(application) == "needs_user_input"
    assert server._user_facing_submission_status(application) == "action_required"


def test_newer_manual_status_is_not_overridden_by_stale_admin_status():
    application = _base_application(
        admin_status="needs_user_input",
        admin_status_updated_at="2026-07-15T12:00:00+00:00",
        manual_status="manually_submitted",
        manual_status_updated_at="2026-07-16T12:00:00+00:00",
        submission_status="submitted",
    )

    assert server._effective_manual_status(application) == "manually_submitted"


def test_offer_expired_is_always_user_facing_even_with_stale_pending_status():
    application = _base_application(
        status="pending",
        submission_status="expired",
        manual_status="offer_expired",
    )

    assert server._user_facing_submission_status(application) == "expired"


def test_refund_application_credit_direct(monkeypatch):
    db = _DB(users=[_base_user(billing={"credits_total": 200, "credits_remaining": 0})])
    monkeypatch.setattr(server, "db", db)

    asyncio.run(server._refund_application_credit("user_1"))

    assert db.users.rows[0]["billing"]["credits_remaining"] == 1
