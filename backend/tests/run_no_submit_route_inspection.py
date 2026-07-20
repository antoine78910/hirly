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
import socket
import sys
from typing import Any, Awaitable, Callable, Mapping, Sequence
from urllib.parse import urlparse


BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import auto_apply.drivers  # noqa: E402,F401 - registers the inspected drivers
from auto_apply.classifier import classify  # noqa: E402
from auto_apply.driver import DRIVER_REGISTRY  # noqa: E402


SCHEMA_VERSION = "hirly.no-submit-route-inspection.v1"
MAX_JOBS = 100
MAX_CONCURRENCY = 4
INSPECTION_TIMEOUT_SECONDS = 20.0

ALLOWED_HOST_SUFFIXES: Mapping[str, tuple[str, ...]] = {
    "greenhouse": ("greenhouse.io", "greenhouse.com"),
    "jobaffinity": ("jobaffinity.fr",),
    "smartrecruiters": ("smartrecruiters.com",),
    "taleez": ("taleez.com",),
    "teamtailor": ("teamtailor.com",),
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
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
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

    async def inspect_one(job: Mapping[str, Any]) -> tuple[str, str, str]:
        provider = _provider(job)
        if provider not in ALLOWED_HOST_SUFFIXES:
            return "unsupported", "failed", "unsupported_provider"
        try:
            hostname = _validate_url(provider, _application_url(job))
            await resolver(hostname)
            driver = registry.for_job(dict(job))
            if driver is None or getattr(driver, "provider", "") != provider:
                return provider, "failed", "unsupported_provider"
            async with semaphore:
                blueprint = await asyncio.wait_for(
                    driver.inspect_application(dict(job)),
                    timeout=timeout_seconds,
                )
            decision = classify(blueprint)
            return provider, decision.category, ""
        except Exception as exc:  # aggregate typed failures; never emit details
            return provider, "failed", _failure_bucket(exc)

    results = await asyncio.gather(*(inspect_one(job) for job in jobs))
    provider_counts: dict[str, Counter[str]] = defaultdict(Counter)
    failure_counts = Counter({bucket: 0 for bucket in FAILURE_BUCKETS})
    category_counts = Counter({
        "eligible": 0,
        "needs_user_input": 0,
        "unsupported": 0,
        "failed": 0,
    })
    for provider, category, failure in results:
        category_counts[category] += 1
        provider_counts[provider][category] += 1
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
        "failureBuckets": dict(failure_counts),
        "safeguards": {
            "aggregateOnly": True,
            "applicationSubmissions": False,
            "applicationAttemptWrites": False,
            "canonicalWrites": False,
            "sourceActivationChanges": False,
            "writerTransfer": False,
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
