import asyncio

from auto_apply import metrics


class _FakeAttempts:
    """Simulates the partial unique index on (user_id, job_id) WHERE status in
    ('in_flight','submitted_success')."""
    def __init__(self):
        self.rows = []

    def _active_conflict(self, doc):
        if doc.get("status") not in ("in_flight", "submitted_success"):
            return False
        return any(
            r["user_id"] == doc["user_id"] and r["job_id"] == doc["job_id"]
            and r["status"] in ("in_flight", "submitted_success")
            for r in self.rows
        )

    async def insert_one(self, doc):
        if self._active_conflict(doc):
            raise RuntimeError("duplicate key value violates unique constraint")
        self.rows.append(dict(doc))
        return {"inserted_id": doc["id"]}

    async def update_one(self, filter, update, upsert=False):
        for r in self.rows:
            if all(r.get(k) == v for k, v in filter.items()):
                r.update(update.get("$set") or {})
                return {"matched_count": 1}
        return {"matched_count": 0}

    def find(self, filter=None, projection=None):
        f = filter or {}
        rows = [dict(r) for r in self.rows if all(r.get(k) == v for k, v in f.items())]

        class _C:
            def __init__(self, rows):
                self._rows = rows

            def limit(self, n):
                self._rows = self._rows[:n]
                return self

            async def to_list(self, n):
                return list(self._rows[:n])

        return _C(rows)


class _FakeDB:
    def __init__(self):
        self.auto_apply_attempts = _FakeAttempts()


def test_claim_succeeds_then_blocks_second_concurrent_claim():
    db = _FakeDB()

    async def run():
        first = await metrics.claim_attempt(db, user_id="u1", job_id="j1", provider="greenhouse", driver="greenhouse")
        second = await metrics.claim_attempt(db, user_id="u1", job_id="j1", provider="greenhouse", driver="greenhouse")
        return first, second

    first, second = asyncio.run(run())
    assert first is not None and first["status"] == "in_flight"
    assert second is None  # partial unique index -> claim lost


def test_terminal_success_permanently_blocks_reclaim():
    db = _FakeDB()

    async def run():
        claim = await metrics.claim_attempt(db, user_id="u1", job_id="j1", provider="greenhouse", driver="greenhouse")
        await metrics.record_terminal(db, claim, status="submitted_success", verdict="verified_success")
        return await metrics.claim_attempt(db, user_id="u1", job_id="j1", provider="greenhouse", driver="greenhouse")

    assert asyncio.run(run()) is None


def test_terminal_needs_user_input_allows_retry_and_stores_missing_fields():
    db = _FakeDB()

    async def run():
        claim = await metrics.claim_attempt(db, user_id="u1", job_id="j1", provider="greenhouse", driver="greenhouse")
        await metrics.record_terminal(db, claim, status="needs_user_input", reason="needs_user_input:visa",
                                      missing_fields=["visa", "salary"])
        reclaim = await metrics.claim_attempt(db, user_id="u1", job_id="j1", provider="greenhouse", driver="greenhouse")
        return db.auto_apply_attempts.rows[0], reclaim

    row, reclaim = asyncio.run(run())
    assert reclaim is not None  # freed for retry
    assert row["missing_fields"] == ["visa", "salary"]
    assert row["reason"] == "needs_user_input:visa"


def test_every_record_carries_driver_version_and_reason():
    db = _FakeDB()

    async def run():
        claim = await metrics.claim_attempt(db, user_id="u1", job_id="j1", provider="greenhouse",
                                            driver="greenhouse", driver_version="gh-2026.07.15")
        await metrics.record_terminal(db, claim, status="unsupported", reason="blocker_present:captcha_detected")
        return db.auto_apply_attempts.rows[0]

    row = asyncio.run(run())
    assert row["driver_version"] == "gh-2026.07.15"
    assert row["reason"] == "blocker_present:captcha_detected"
    assert row["status"] == "unsupported"


def test_known_signatures_and_summary():
    db = _FakeDB()

    async def run():
        c1 = await metrics.claim_attempt(db, user_id="u1", job_id="j1", provider="greenhouse", driver="greenhouse")
        await metrics.record_terminal(db, c1, status="submitted_success", verdict="verified_success",
                                      blueprint_signature="sigA")
        c2 = await metrics.claim_attempt(db, user_id="u2", job_id="j2", provider="greenhouse", driver="greenhouse")
        await metrics.record_terminal(db, c2, status="submit_failed", verdict="verified_failure",
                                      blueprint_signature="sigB")
        sigs = await metrics.known_successful_signatures(db, "greenhouse")
        summ = await metrics.summary(db, "greenhouse")
        return sigs, summ

    sigs, summ = asyncio.run(run())
    assert sigs == frozenset({"sigA"})
    assert summ["verified_success"] == 1 and summ["submit_attempts"] == 2
