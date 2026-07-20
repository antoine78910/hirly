import json
from pathlib import Path

from job_normalization import canonicalize_apply_url, classify_dedup_pair


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
