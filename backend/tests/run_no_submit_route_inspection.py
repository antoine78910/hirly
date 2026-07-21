#!/usr/bin/env python3
"""Bounded aggregate-only inspection of existing auto-apply drivers.

This operator harness deliberately has no database dependency and never imports
the queue, executor, or attempt-metrics modules. It resolves an allowlisted
driver and calls only ``inspect_application``; application submission is not an
available operation in this module.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
from pathlib import Path
import re
import socket
import sys
from typing import Any, Awaitable, Callable, Mapping, Sequence
from urllib.parse import unquote_to_bytes, urlparse


BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import auto_apply.drivers  # noqa: E402,F401 - registers the inspected drivers
from auto_apply.classifier import classify  # noqa: E402
from auto_apply.driver import DRIVER_REGISTRY  # noqa: E402
from auto_apply.models import compute_blueprint_signature  # noqa: E402
from application_blueprint import (  # noqa: E402
    ApplicationBlueprint,
    FieldType,
    FieldValidation,
    NormalizedField,
    derive_complexity,
    estimate_compatibility_score,
)
from job_providers.ats_detection import APPLICATION_CAPABILITIES  # noqa: E402


SCHEMA_VERSION = "hirly.no-submit-route-inspection.v1"
MAX_JOBS = 100
MAX_CONCURRENCY = 4
INSPECTION_TIMEOUT_SECONDS = 20.0
CORPUS_MINIMUM_PER_PROVIDER = 50

ALLOWED_HOST_SUFFIXES: Mapping[str, tuple[str, ...]] = {
    "greenhouse": ("greenhouse.io", "greenhouse.com"),
    "jobaffinity": ("jobaffinity.fr",),
    "smartrecruiters": ("smartrecruiters.com",),
    "taleez": ("taleez.com",),
    "teamtailor": ("teamtailor.com",),
    "recruitee": ("recruitee.com",),
    "nicoka": ("nicoka.com",),
}

_IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9_-]*$", re.IGNORECASE)
_FIXTURE_BLOCKERS = {
    "captcha",
    "login_required",
    "otp_required",
    "assessment_required",
    "external_redirect",
    "malformed_form",
}
_CANDIDATE_REVIEW_TYPES = {
    FieldType.CONSENT,
    FieldType.CUSTOM_QUESTION,
    FieldType.DEMOGRAPHIC,
    FieldType.EEOC,
    FieldType.VISA_STATUS,
    FieldType.WORK_AUTHORIZATION,
    FieldType.SALARY_EXPECTATION,
    FieldType.TEXT,
    FieldType.TEXTAREA,
}
_CONTACT_TYPES = {
    FieldType.FIRST_NAME,
    FieldType.LAST_NAME,
    FieldType.FULL_NAME,
    FieldType.EMAIL,
    FieldType.PHONE,
    FieldType.LOCATION,
    FieldType.LINKEDIN,
    FieldType.WEBSITE,
    FieldType.RESUME,
    FieldType.COVER_LETTER,
}

FAILURE_BUCKETS = (
    "unsupported_provider",
    "unsafe_url",
    "dns_resolution_failed",
    "route_unresolved",
    "timeout",
    "provider_http_error",
    "inspection_error",
)

Resolver = Callable[[str], Awaitable[Sequence[str]]]


class UnsafeRouteError(ValueError):
    """The candidate URL is outside the bounded public ATS surface."""


class DnsResolutionError(ValueError):
    """The candidate hostname could not be proven public."""


def _canonical_digest(value: Mapping[str, Any]) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _provider(job: Mapping[str, Any]) -> str:
    return str(job.get("ats_provider") or job.get("provider") or "").strip().lower()


def _application_url(job: Mapping[str, Any]) -> str:
    keys = (
        "external_url",
        "selected_apply_url",
        "apply_url",
        "application_url",
        "absolute_url",
        "source_url",
        "url",
        "job_url",
    )
    nested = job.get("data")
    sources = (job, nested if isinstance(nested, Mapping) else {})
    for source in sources:
        for key in keys:
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _host_allowed(provider: str, hostname: str) -> bool:
    return any(
        hostname == suffix or hostname.endswith(f".{suffix}")
        for suffix in ALLOWED_HOST_SUFFIXES.get(provider, ())
    )


def _validate_url(provider: str, raw_url: str) -> str:
    if provider not in ALLOWED_HOST_SUFFIXES:
        raise UnsafeRouteError("provider is not allowlisted")
    parsed = urlparse(raw_url)
    hostname = (parsed.hostname or "").lower().rstrip(".")
    try:
        port = parsed.port
    except ValueError as exc:
        raise UnsafeRouteError("URL has a malformed port") from exc
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or not _host_allowed(provider, hostname)
    ):
        raise UnsafeRouteError("URL is outside the allowlisted HTTPS ATS host")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return hostname
    if not address.is_global:
        raise UnsafeRouteError("IP literals must be globally routable")
    return hostname


def _identity(job: Mapping[str, Any], *keys: str) -> str:
    nested = job.get("data")
    for source in (job, nested if isinstance(nested, Mapping) else {}):
        for key in keys:
            value = source.get(key)
            if value is not None and str(value).strip():
                return str(value).strip().lower()
    return ""


def _decoded_path(parsed: Any) -> list[str]:
    try:
        parts = []
        for part in parsed.path.split("/"):
            if not part:
                continue
            if re.search(r"%(?![0-9a-fA-F]{2})", part):
                raise ValueError("malformed percent escape")
            parts.append(unquote_to_bytes(part).decode("utf-8").lower())
        return parts
    except (UnicodeDecodeError, ValueError) as exc:
        raise UnsafeRouteError("URL contains an invalid encoded path") from exc


def _validate_provider_route(
    provider: str,
    raw_url: str,
    job: Mapping[str, Any],
) -> str:
    hostname = _validate_url(provider, raw_url)
    parsed = urlparse(raw_url)
    if parsed.fragment:
        raise UnsafeRouteError("route fragments are not allowed")
    parts = _decoded_path(parsed)

    if provider == "greenhouse":
        if "jobs" not in parts:
            raise UnsafeRouteError("Greenhouse route is not a job route")
        return hostname

    if provider in {"recruitee", "nicoka"}:
        tenant = _identity(
            job,
            "tenant_id",
            "tenantId",
            "tenant_key",
            "tenantKey",
            "approvedTenantId",
        )
        if not tenant or len(tenant) > 128 or not _IDENTIFIER.fullmatch(tenant):
            raise UnsafeRouteError("route tenant identity is missing or malformed")

    if provider == "recruitee":
        slug = _identity(job, "slug", "posting_slug", "postingSlug", "provider_job_id")
        if not slug:
            external_id = _identity(job, "external_id", "externalId")
            slug = external_id.rsplit(":", 1)[-1] if external_id else ""
        if (
            hostname != f"{tenant}.recruitee.com"
            or parsed.query
            or len(parts) != 2
            or parts[0] != "o"
            or not slug
            or parts[1] != slug
        ):
            raise UnsafeRouteError("Recruitee route is not tenant/posting bound")
        return hostname

    if provider == "nicoka":
        posting_uid = _identity(job, "posting_uid", "postingUid", "uid")
        if not posting_uid:
            raise UnsafeRouteError("Nicoka posting identity is missing")
        expected = (
            [tenant, "public", "jobs", posting_uid, "apply"]
            if hostname == "trial.nicoka.com"
            else ["public", "jobs", posting_uid, "apply"]
        )
        if (
            hostname not in {f"{tenant}.nicoka.com", "trial.nicoka.com"}
            or parsed.query
            or parts != expected
        ):
            raise UnsafeRouteError("Nicoka route is not tenant/posting bound")
        return hostname

    return hostname


def _fixture_blueprint(
    job: Mapping[str, Any],
    provider: str,
) -> ApplicationBlueprint:
    fixture = job.get("formFixture")
    if not isinstance(fixture, Mapping) or set(fixture) - {"fields", "blockers"}:
        raise ValueError("malformed form fixture")
    raw_fields = fixture.get("fields", [])
    raw_blockers = fixture.get("blockers", [])
    if not isinstance(raw_fields, list) or not isinstance(raw_blockers, list):
        raise ValueError("malformed form fixture")
    blockers = [str(value) for value in raw_blockers]
    if any(value not in _FIXTURE_BLOCKERS for value in blockers):
        raise ValueError("malformed form fixture blocker")

    fields: list[NormalizedField] = []
    for index, raw_field in enumerate(raw_fields):
        if not isinstance(raw_field, Mapping) or set(raw_field) != {
            "type", "required", "supported", "sensitive",
        }:
            raise ValueError("malformed form fixture field")
        if not all(isinstance(raw_field[key], bool) for key in ("required", "supported", "sensitive")):
            raise ValueError("malformed form fixture field flags")
        try:
            field_type = FieldType(str(raw_field["type"]))
        except ValueError:
            field_type = FieldType.UNKNOWN
        required = raw_field["required"]
        sensitive = raw_field["sensitive"] or (
            required and field_type in _CANDIDATE_REVIEW_TYPES
        )
        supported = raw_field["supported"] and field_type != FieldType.UNKNOWN
        fields.append(NormalizedField(
            key=f"fixture_field_{index}",
            type=field_type,
            required=required,
            supported=supported,
            validation=FieldValidation(sensitive=sensitive),
        ))
    return ApplicationBlueprint(
        provider=provider,
        fields=fields,
        complexity=derive_complexity(fields),
        estimated_compatibility_score=estimate_compatibility_score(fields, blockers),
        blockers=blockers,
        signature=compute_blueprint_signature(fields),
    )


def _form_class(blueprint: ApplicationBlueprint) -> str:
    if blueprint.blockers:
        return blueprint.blockers[0]
    required = [field for field in blueprint.fields if field.required]
    if any(not field.supported or field.type == FieldType.UNKNOWN for field in required):
        return "unsupported_widget"
    if any(field.type == FieldType.CONSENT for field in required):
        return "consent_review"
    if any(field.validation.sensitive or field.type not in _CONTACT_TYPES for field in required):
        return "candidate_review"
    return "contact_only"


def _route_state(provider: str, registry: Any) -> str:
    capability = APPLICATION_CAPABILITIES.get(provider) or {}
    driver = registry.for_job({"ats_provider": provider})
    if driver is not None and all(
        capability.get(flag)
        for flag in ("driverRegistered", "queuePermitted", "noSubmitVerified")
    ):
        return "application_gated"
    return "inventory_manual"


async def resolve_public_addresses(hostname: str) -> Sequence[str]:
    def lookup() -> Sequence[str]:
        records = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
        return sorted({str(record[4][0]) for record in records})

    try:
        addresses = await asyncio.to_thread(lookup)
    except OSError as exc:
        raise DnsResolutionError("hostname resolution failed") from exc
    if not addresses:
        raise DnsResolutionError("hostname returned no addresses")
    for raw_address in addresses:
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError as exc:
            raise DnsResolutionError("resolver returned an invalid address") from exc
        if not address.is_global:
            raise DnsResolutionError("hostname resolved to a non-public address")
    return addresses


def _failure_bucket(exc: BaseException) -> str:
    if isinstance(exc, UnsafeRouteError):
        return "unsafe_url"
    if isinstance(exc, DnsResolutionError):
        return "dns_resolution_failed"
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    message = str(exc).lower()
    if isinstance(exc, ValueError) and (
        "unresolved" in message or "missing" in message
    ):
        return "route_unresolved"
    module = exc.__class__.__module__.lower()
    if module.startswith("httpx") or module.startswith("httpcore"):
        return "provider_http_error"
    return "inspection_error"


async def inspect_route_batch(
    jobs: Sequence[Mapping[str, Any]],
    *,
    resolver: Resolver = resolve_public_addresses,
    registry: Any = DRIVER_REGISTRY,
    generated_at: str | None = None,
    evidence_mode: str = "bounded_live_no_submit",
    timeout_seconds: float = INSPECTION_TIMEOUT_SECONDS,
    concurrency: int = MAX_CONCURRENCY,
) -> dict[str, Any]:
    if not jobs:
        raise ValueError("at least one job is required")
    if len(jobs) > MAX_JOBS:
        raise ValueError(f"job count exceeds hard limit of {MAX_JOBS}")
    if not 1 <= concurrency <= MAX_CONCURRENCY:
        raise ValueError(f"concurrency must be between 1 and {MAX_CONCURRENCY}")
    if not 0 < timeout_seconds <= INSPECTION_TIMEOUT_SECONDS:
        raise ValueError(
            f"timeout_seconds must be between 0 and {INSPECTION_TIMEOUT_SECONDS:g}",
        )
    if evidence_mode not in {"bounded_live_no_submit", "fixture_contract"}:
        raise ValueError("unrecognized evidence mode")

    semaphore = asyncio.Semaphore(concurrency)

    async def inspect_one(job: Mapping[str, Any]) -> tuple[str, str, str, str, str]:
        provider = _provider(job)
        if provider not in ALLOWED_HOST_SUFFIXES:
            return "unsupported", "failed", "unsupported_provider", "blocked", "uncharacterized"
        try:
            hostname = _validate_provider_route(provider, _application_url(job), job)
            await resolver(hostname)
            driver = registry.for_job(dict(job))
            route_state = _route_state(provider, registry)
            if evidence_mode == "fixture_contract" and "formFixture" in job:
                blueprint = _fixture_blueprint(job, provider)
            elif driver is None or getattr(driver, "provider", "") != provider:
                return provider, "unsupported", "", route_state, "uncharacterized"
            else:
                async with semaphore:
                    blueprint = await asyncio.wait_for(
                        driver.inspect_application(dict(job)),
                        timeout=timeout_seconds,
                    )
            decision = classify(blueprint)
            return provider, decision.category, "", route_state, _form_class(blueprint)
        except Exception as exc:  # aggregate typed failures; never emit details
            return provider, "failed", _failure_bucket(exc), "blocked", "uncharacterized"

    results = await asyncio.gather(*(inspect_one(job) for job in jobs))
    provider_counts: dict[str, Counter[str]] = defaultdict(Counter)
    provider_form_counts: dict[str, Counter[str]] = defaultdict(Counter)
    provider_route_counts: dict[str, Counter[str]] = defaultdict(Counter)
    failure_counts = Counter({bucket: 0 for bucket in FAILURE_BUCKETS})
    category_counts = Counter({
        "eligible": 0,
        "needs_user_input": 0,
        "unsupported": 0,
        "failed": 0,
    })
    form_counts: Counter[str] = Counter()
    route_counts = Counter({
        "application_gated": 0,
        "inventory_manual": 0,
        "blocked": 0,
    })
    for provider, category, failure, route_state, form_class in results:
        category_counts[category] += 1
        provider_counts[provider][category] += 1
        route_counts[route_state] += 1
        provider_route_counts[provider][route_state] += 1
        form_counts[form_class] += 1
        provider_form_counts[provider][form_class] += 1
        if failure:
            failure_counts[failure] += 1

    unsigned: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "evidenceMode": evidence_mode,
        "jobsReceived": len(jobs),
        "jobsInspected": len(jobs) - category_counts["failed"],
        "outcomes": dict(category_counts),
        "providers": {
            provider: {
                category: counts[category]
                for category in (
                    "eligible",
                    "needs_user_input",
                    "unsupported",
                    "failed",
                )
            }
            for provider, counts in sorted(provider_counts.items())
        },
        "formClasses": dict(sorted(form_counts.items())),
        "routeStates": dict(route_counts),
        "corpusCoverage": {
            provider: {
                "formsCharacterized": sum(provider_form_counts[provider].values())
                - provider_form_counts[provider]["uncharacterized"],
                "minimumRequired": CORPUS_MINIMUM_PER_PROVIDER,
                "meetsMinimum": (
                    sum(provider_form_counts[provider].values())
                    - provider_form_counts[provider]["uncharacterized"]
                ) >= CORPUS_MINIMUM_PER_PROVIDER,
                "manualDeepLinksVerified": provider_route_counts[provider]["inventory_manual"],
                "formClasses": dict(sorted(provider_form_counts[provider].items())),
            }
            for provider in sorted(provider_counts)
        },
        "failureBuckets": dict(failure_counts),
        "safeguards": {
            "aggregateOnly": True,
            "applicationSubmissions": False,
            "applicationAttemptWrites": False,
            "canonicalWrites": False,
            "sourceActivationChanges": False,
            "writerTransfer": False,
            "capabilityFlagsChanged": False,
            "fixtureEvidenceCannotAuthorizeSubmission": True,
            "corpusMinimumPerProvider": CORPUS_MINIMUM_PER_PROVIDER,
            "maxJobs": MAX_JOBS,
            "maxConcurrency": MAX_CONCURRENCY,
            "timeoutSeconds": INSPECTION_TIMEOUT_SECONDS,
            "allowlistedProviders": sorted(ALLOWED_HOST_SUFFIXES),
        },
    }
    return {**unsigned, "digest": _canonical_digest(unsigned)}


def _load_jobs(path: Path) -> Sequence[Mapping[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    jobs = payload.get("jobs") if isinstance(payload, Mapping) else payload
    if not isinstance(jobs, list) or any(not isinstance(job, Mapping) for job in jobs):
        raise ValueError("input must be a JSON array of jobs or an object with a jobs array")
    return jobs


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect a bounded ATS route sample without submissions or DB writes",
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--allow-network",
        action="store_true",
        help="required acknowledgement for bounded public ATS inspection requests",
    )
    args = parser.parse_args()
    if not args.allow_network:
        parser.error("--allow-network is required; no network request was made")
    report = asyncio.run(inspect_route_batch(_load_jobs(args.input)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
