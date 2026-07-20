import ast
import asyncio
import json
from pathlib import Path
import sys

import pytest

from application_blueprint import (
    ApplicationBlueprint,
    Complexity,
    FieldType,
    FieldValidation,
    NormalizedField,
)
from run_no_submit_route_inspection import (
    DnsResolutionError,
    MAX_JOBS,
    UnsafeRouteError,
    _canonical_digest,
    _validate_url,
    inspect_route_batch,
    main,
)


async def public_resolver(_hostname: str):
    return ["93.184.216.34"]


def blueprint(category: str, provider: str) -> ApplicationBlueprint:
    validation = FieldValidation(sensitive=category == "needs_user_input")
    field = NormalizedField(
        key="contact",
        type=FieldType.EMAIL,
        required=True,
        supported=category != "unsupported",
        validation=validation,
    )
    return ApplicationBlueprint(
        provider=provider,
        fields=[field],
        complexity=Complexity.STANDARD,
        estimated_compatibility_score=0.95,
        signature=f"fixture-{category}",
    )


class FakeDriver:
    def __init__(self, provider: str, category: str = "eligible"):
        self.provider = provider
        self.category = category
        self.inspections = 0
        self.submissions = 0

    async def inspect_application(self, _job):
        self.inspections += 1
        return blueprint(self.category, self.provider)

    async def submit(self, _context):
        self.submissions += 1
        raise AssertionError("no-submit inspector called submit")


class FakeRegistry:
    def __init__(self, drivers):
        self.drivers = drivers

    def for_job(self, job):
        return self.drivers.get(job.get("ats_provider"))


def job(provider: str, url: str):
    return {
        "job_id": "must-not-leak",
        "ats_provider": provider,
        "selected_apply_url": url,
    }


def test_inspects_only_and_emits_aggregate_non_identifying_outcomes():
    drivers = {
        "greenhouse": FakeDriver("greenhouse", "eligible"),
        "taleez": FakeDriver("taleez", "needs_user_input"),
        "teamtailor": FakeDriver("teamtailor", "unsupported"),
    }
    report = asyncio.run(inspect_route_batch(
        [
            job("greenhouse", "https://boards.greenhouse.io/acme/jobs/123"),
            job("taleez", "https://jobs.taleez.com/acme/42"),
            job("teamtailor", "https://acme.teamtailor.com/jobs/7"),
        ],
        resolver=public_resolver,
        registry=FakeRegistry(drivers),
        generated_at="2026-07-20T21:30:00Z",
        evidence_mode="fixture_contract",
    ))

    assert report["jobsReceived"] == 3
    assert report["jobsInspected"] == 3
    assert report["outcomes"] == {
        "eligible": 1,
        "needs_user_input": 1,
        "unsupported": 1,
        "failed": 0,
    }
    assert report["safeguards"]["applicationSubmissions"] is False
    assert report["safeguards"]["applicationAttemptWrites"] is False
    assert report["safeguards"]["canonicalWrites"] is False
    assert all(driver.inspections == 1 for driver in drivers.values())
    assert all(driver.submissions == 0 for driver in drivers.values())
    serialized = json.dumps(report)
    assert "must-not-leak" not in serialized
    assert "greenhouse.io/acme" not in serialized
    assert "taleez.com/acme" not in serialized
    assert "teamtailor.com/jobs" not in serialized
    assert len(report["digest"]) == 64


def test_rejects_unbounded_batches_and_unsafe_urls_before_inspection():
    driver = FakeDriver("greenhouse")
    registry = FakeRegistry({"greenhouse": driver})
    with pytest.raises(ValueError, match="hard limit"):
        asyncio.run(inspect_route_batch(
            [job("greenhouse", "https://boards.greenhouse.io/acme/jobs/1")]
            * (MAX_JOBS + 1),
            resolver=public_resolver,
            registry=registry,
        ))

    report = asyncio.run(inspect_route_batch(
        [
            job("greenhouse", "http://boards.greenhouse.io/acme/jobs/1"),
            job("greenhouse", "https://greenhouse.io.evil.example/jobs/1"),
            job("unknown", "https://example.com/jobs/1"),
        ],
        resolver=public_resolver,
        registry=registry,
        generated_at="2026-07-20T21:30:00Z",
        evidence_mode="fixture_contract",
    ))
    assert report["jobsInspected"] == 0
    assert report["failureBuckets"]["unsafe_url"] == 2
    assert report["failureBuckets"]["unsupported_provider"] == 1
    assert driver.inspections == 0
    assert driver.submissions == 0


def test_fails_closed_when_dns_is_not_proven_public():
    async def rejected_resolver(_hostname: str):
        raise DnsResolutionError("private address")

    driver = FakeDriver("taleez")
    report = asyncio.run(inspect_route_batch(
        [job("taleez", "https://jobs.taleez.com/acme/42")],
        resolver=rejected_resolver,
        registry=FakeRegistry({"taleez": driver}),
        generated_at="2026-07-20T21:30:00Z",
        evidence_mode="fixture_contract",
    ))
    assert report["failureBuckets"]["dns_resolution_failed"] == 1
    assert driver.inspections == 0


def test_times_out_inspection_without_falling_through_to_submit():
    class SlowDriver(FakeDriver):
        async def inspect_application(self, _job):
            self.inspections += 1
            await asyncio.sleep(0.05)
            return blueprint("eligible", self.provider)

    driver = SlowDriver("greenhouse")
    report = asyncio.run(inspect_route_batch(
        [job("greenhouse", "https://boards.greenhouse.io/acme/jobs/1")],
        resolver=public_resolver,
        registry=FakeRegistry({"greenhouse": driver}),
        generated_at="2026-07-20T21:30:00Z",
        evidence_mode="fixture_contract",
        timeout_seconds=0.001,
    ))
    assert report["failureBuckets"]["timeout"] == 1
    assert driver.inspections == 1
    assert driver.submissions == 0


def test_actual_registered_jobaffinity_inspection_uses_no_network_or_submit():
    report = asyncio.run(inspect_route_batch(
        [job("jobaffinity", "https://jobs.jobaffinity.fr/apply/42")],
        resolver=public_resolver,
        generated_at="2026-07-20T21:30:00Z",
        evidence_mode="fixture_contract",
    ))
    assert report["jobsInspected"] == 1
    assert (
        report["outcomes"]["eligible"]
        + report["outcomes"]["needs_user_input"]
        + report["outcomes"]["unsupported"]
    ) == 1
    assert sum(report["failureBuckets"].values()) == 0


def test_url_guard_requires_allowlisted_https_host():
    assert _validate_url(
        "smartrecruiters",
        "https://jobs.smartrecruiters.com/Acme/123-role",
    ) == "jobs.smartrecruiters.com"
    with pytest.raises(UnsafeRouteError):
        _validate_url("smartrecruiters", "https://smartrecruiters.com@127.0.0.1/job")
    with pytest.raises(UnsafeRouteError):
        _validate_url("greenhouse", "https://boards.greenhouse.io:8443/acme/jobs/1")


def test_module_has_no_attempt_writer_executor_queue_or_submit_call():
    source = Path(__file__).with_name("run_no_submit_route_inspection.py").read_text()
    tree = ast.parse(source)
    imported_modules = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        node.module or ""
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
    }
    assert not any(
        module.endswith(("auto_apply.executor", "auto_apply.metrics", "auto_apply.queue"))
        for module in imported_modules
    )
    assert not any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "submit"
        for node in ast.walk(tree)
    )
    assert "auto_apply_attempts" not in source


def test_committed_contract_artifact_is_aggregate_only_and_digest_bound():
    artifact_path = (
        Path(__file__).parents[2]
        / "artifacts/job-ingestion/g018-no-submit-inspection-contract-2026-07-20.json"
    )
    report = json.loads(artifact_path.read_text(encoding="utf-8"))
    digest = report.pop("digest")
    assert digest == _canonical_digest(report)
    assert report["evidenceMode"] == "fixture_contract"
    assert report["jobsReceived"] == report["jobsInspected"] == 1
    assert report["safeguards"] == {
        "aggregateOnly": True,
        "applicationSubmissions": False,
        "applicationAttemptWrites": False,
        "canonicalWrites": False,
        "sourceActivationChanges": False,
        "writerTransfer": False,
        "maxJobs": 100,
        "maxConcurrency": 4,
        "timeoutSeconds": 20.0,
        "allowlistedProviders": [
            "greenhouse",
            "jobaffinity",
            "smartrecruiters",
            "taleez",
            "teamtailor",
        ],
    }
    serialized = json.dumps(report)
    assert "fixture-must-not-leak" not in serialized
    assert "https://" not in serialized


def test_cli_requires_explicit_network_acknowledgement(monkeypatch, tmp_path):
    input_path = tmp_path / "jobs.json"
    output_path = tmp_path / "report.json"
    input_path.write_text("[]", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", [
        "run_no_submit_route_inspection.py",
        "--input",
        str(input_path),
        "--output",
        str(output_path),
    ])
    with pytest.raises(SystemExit) as error:
        main()
    assert error.value.code == 2
    assert not output_path.exists()
