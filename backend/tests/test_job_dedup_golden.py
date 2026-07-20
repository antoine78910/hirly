import json
import asyncio
from pathlib import Path

from job_normalization import canonicalize_apply_url, classify_dedup_pair
from jobs_service import upsert_imported_jobs


FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "apps/job-ingestion-audit/fixtures/dedup-golden.json"
)


def test_dedup_golden_corpus_uses_production_identity_behavior():
    cases = json.loads(FIXTURE.read_text())
    assert len(cases) >= 9
    false_merges = 0
    missed_candidates = 0
    for case in cases:
        actual = classify_dedup_pair(case["left"], case["right"])
        assert actual["classification"] == case["expected"], case["id"]
        assert actual["auto_merge"] is case["autoMerge"], case["id"]
        assert actual["preserve_provenance"] is True
        if actual["auto_merge"] and case["expected"] == "distinct":
            false_merges += 1
        if actual["classification"] == "distinct" and case["expected"].endswith("candidate"):
            missed_candidates += 1
    assert false_merges == 0
    assert missed_candidates == 0


def test_canonical_url_strips_tracking_but_preserves_functional_parameters():
    assert canonicalize_apply_url(
        "HTTPS://Jobs.Acme.com/opening/1/?utm_source=x&token=keep#apply"
    ) == "https://jobs.acme.com/opening/1?token=keep"


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
    def limit(self, count):
        self.rows = self.rows[:count]
        return self
    async def to_list(self, length):
        return self.rows[:length]


class _Jobs:
    def __init__(self):
        self.rows = []
    def find(self, query, _projection=None):
        field, condition = next(iter(query.items()))
        values = set((condition or {}).get("$in") or [])
        return _Cursor([dict(row) for row in self.rows if row.get(field) in values])
    async def insert_many(self, documents):
        for document in documents:
            key = (document["provider"], document["external_id"])
            self.rows = [
                row for row in self.rows
                if (row.get("provider"), row.get("external_id")) != key
            ]
            self.rows.append(dict(document))


class _Candidates:
    def __init__(self):
        self.rows = []
    async def insert_many(self, documents):
        for document in documents:
            self.rows = [
                row for row in self.rows
                if row["candidate_id"] != document["candidate_id"]
            ]
            self.rows.append(dict(document))


class _DB:
    def __init__(self):
        self.jobs = _Jobs()
        self.job_dedup_candidates = _Candidates()


def test_golden_corpus_runs_through_real_upsert_without_false_merges():
    for case in json.loads(FIXTURE.read_text()):
        db = _DB()
        jobs = []
        for side in ("left", "right"):
            job = {
                **case[side],
                "description": case[side].get("description") or "Role description",
                "source_document": {"fixture": case["id"], "side": side},
            }
            jobs.append(job)
        stats = asyncio.run(upsert_imported_jobs(db, jobs))
        expected_rows = 1 if case["expected"] == "exact_occurrence" else 2
        assert len(db.jobs.rows) == expected_rows, case["id"]
        assert len({
            (row["provider"], row["external_id"]) for row in db.jobs.rows
        }) == expected_rows
        assert all(row.get("source_document", {}).get("fixture") == case["id"] for row in db.jobs.rows)
        if case["expected"].endswith("_candidate"):
            assert stats["fuzzy_duplicate_candidates"] == 1, case["id"]
        elif case["expected"] == "distinct":
            assert stats["fuzzy_duplicate_candidates"] == 0, case["id"]


def test_independent_provider_runs_persist_review_only_candidate_linkage():
    case = next(
        item for item in json.loads(FIXTURE.read_text())
        if item["expected"] == "canonical_url_candidate"
    )
    db = _DB()
    first = {
        **case["left"],
        "description": "First provider occurrence",
        "source_document": {"provider_run": 1},
    }
    second = {
        **case["right"],
        "description": "Second provider occurrence",
        "source_document": {"provider_run": 2},
    }

    first_stats = asyncio.run(upsert_imported_jobs(db, [first]))
    second_stats = asyncio.run(upsert_imported_jobs(db, [second]))

    assert first_stats["fuzzy_duplicate_candidates"] == 0
    assert second_stats["fuzzy_duplicate_candidates"] == 1
    assert second_stats["dedup_candidate_links"] == 1
    assert len(db.jobs.rows) == 2
    assert len(db.job_dedup_candidates.rows) == 1
    link = db.job_dedup_candidates.rows[0]
    assert link["candidate_type"] == "canonical_url_candidate"
    assert {link["left_job_id"], link["right_job_id"]} == {
        row["job_id"] for row in db.jobs.rows
    }
