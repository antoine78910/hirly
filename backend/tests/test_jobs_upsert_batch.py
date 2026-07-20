import asyncio
from datetime import datetime, timezone

import jobs_service


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def limit(self, count):
        self.rows = self.rows[:count]
        return self

    async def to_list(self, length):
        return list(self.rows[:length])


class _JobsCollection:
    def __init__(self):
        self.rows = []
        self.update_one_calls = 0
        self.insert_many_calls = []

    def find(self, filter=None, projection=None):
        ids = set(((filter or {}).get("job_id") or {}).get("$in") or [])
        return _Cursor([dict(row) for row in self.rows if row.get("job_id") in ids])

    async def update_one(self, filter, update, upsert=False):
        self.update_one_calls += 1
        doc = dict(filter)
        doc.update((update or {}).get("$set") or {})
        self.rows.append(doc)
        return {"matched_count": 0, "modified_count": 1}

    async def insert_many(self, documents):
        docs = [dict(doc) for doc in documents]
        self.insert_many_calls.append(docs)
        self.rows.extend(docs)
        return {"inserted_count": len(docs)}


class _FakeDB:
    def __init__(self):
        self.jobs = _JobsCollection()


def _job(index: int) -> dict:
    return {
        "provider": "jsearch",
        "external_id": f"ext_{index}",
        "job_id": f"job_{index}",
        "title": f"Role {index}",
        "company": "Acme",
        "location": "Paris, France",
        "country_code": "fr",
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "last_seen_at": datetime.now(timezone.utc).isoformat(),
        "auto_apply_supported": True,
        "ats_provider": "greenhouse",
        "selected_apply_url": f"https://boards.greenhouse.io/acme/jobs/{index}",
        "external_url": f"https://boards.greenhouse.io/acme/jobs/{index}",
    }


def test_upsert_job_batch_uses_insert_many_chunks(monkeypatch):
    monkeypatch.setenv("JOB_UPSERT_BATCH_SIZE", "50")
    db = _FakeDB()
    jobs = [_job(i) for i in range(120)]
    stats = asyncio.run(jobs_service._upsert_job_batch(db, jobs))
    assert stats["total_imported"] == 120
    assert len(db.jobs.insert_many_calls) == 3  # 50 + 50 + 20
    assert db.jobs.update_one_calls == 0
    assert sum(len(chunk) for chunk in db.jobs.insert_many_calls) == 120


def test_upsert_job_batch_falls_back_to_update_one_without_insert_many():
    db = _FakeDB()
    db.jobs.insert_many = None  # adapter without batch writes
    jobs = [_job(1), _job(2)]
    stats = asyncio.run(jobs_service._upsert_job_batch(db, jobs))
    assert stats["total_imported"] == 2
    assert db.jobs.update_one_calls == 2
    assert db.jobs.insert_many_calls == []


def test_upsert_accounting_uses_actual_existing_identity_outcomes():
    db = _FakeDB()
    unchanged = jobs_service._prepare_job_for_upsert(_job(1))
    stale = jobs_service._prepare_job_for_upsert(_job(2))
    stale["validation_status"] = "invalid"
    stale["title"] = "Old title"
    stale["fingerprint"] = "old-fingerprint"
    db.jobs.rows = [unchanged, stale]

    stats = asyncio.run(jobs_service._upsert_job_batch(
        db,
        [_job(1), _job(2), _job(3), _job(3)],
    ))

    assert stats["inserted"] == 1
    assert stats["updated"] == 1
    assert stats["reactivated"] == 1
    assert stats["exact_duplicate"] == 2  # unchanged existing + duplicate occurrence in batch
    assert stats["write_failed"] == 0
    assert stats["inserted"] + stats["updated"] + stats["exact_duplicate"] == 4


def test_ensure_job_id_generates_stable_id():
    job = {"provider": "jsearch", "external_id": "abc123", "title": "Dev"}
    with_id = jobs_service._ensure_job_id(job)
    assert with_id["job_id"].startswith("job_")
    assert jobs_service._ensure_job_id(dict(with_id))["job_id"] == with_id["job_id"]
