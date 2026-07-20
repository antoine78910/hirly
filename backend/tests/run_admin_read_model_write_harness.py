#!/usr/bin/env python3
"""Disposable PostgreSQL write-path and counter-lock release-gate harness."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import math
from pathlib import Path
import re
import subprocess
import time
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).parents[1]
SCHEMA = ROOT / "supabase_schema.sql"
UP = ROOT / "db/migrations/20260720001800_admin_read_models.sql"
TIMING_RE = re.compile(r"Time: ([0-9]+(?:\.[0-9]+)?) ms")


def run_psql(database_url: str, sql: str, *, timeout: int = 600) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["psql", database_url, "-X", "-v", "ON_ERROR_STOP=1", "-At"],
        input=sql,
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result


def run_file(database_url: str, path: Path) -> None:
    result = subprocess.run(
        ["psql", database_url, "-X", "-v", "ON_ERROR_STOP=1", "-f", str(path)],
        text=True,
        capture_output=True,
        timeout=600,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


def timed_statements(database_url: str, statements: list[str], *, timeout: int = 600) -> list[float]:
    script = "\\timing on\n" + "\n".join(f"{statement.rstrip(';')};" for statement in statements)
    result = run_psql(database_url, script, timeout=timeout)
    timings = [float(value) for value in TIMING_RE.findall(result.stdout)]
    if len(timings) != len(statements):
        raise RuntimeError(
            f"expected {len(statements)} timings, found {len(timings)}: {result.stdout[-1000:]}"
        )
    return timings


def p95(values: list[float]) -> float:
    if not values:
        return math.inf
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * 0.95) - 1)]


def assert_disposable(database_url: str) -> None:
    database = urlparse(database_url).path.lstrip("/").lower()
    if not database or not any(marker in database for marker in ("test", "fixture", "task")):
        raise SystemExit("database name must identify a disposable test/fixture/task database")


def seed_sql(user_count: int = 4_000, job_count: int = 128) -> str:
    return f"""
    INSERT INTO public.users(user_id,email,data)
    SELECT 'write-user-'||g,'write-'||g||'@example.com',
      jsonb_build_object('name','Write User '||g,'created_at','2026-01-01T00:00:00Z')
    FROM generate_series(1,{user_count}) g;
    INSERT INTO public.jobs(job_id,title,company,ats_provider,data)
    SELECT 'write-job-'||g,'Engineer '||g,'Write Co','greenhouse','{{}}'::jsonb
    FROM generate_series(1,{job_count}) g;
    """


def application_insert(prefix: str, index: int, user_offset: int) -> str:
    user_number = user_offset + index
    job_number = index % 128 + 1
    return (
        "INSERT INTO public.applications(application_id,user_id,job_id,data) VALUES "
        f"('{prefix}-{index}','write-user-{user_number}','write-job-{job_number}',"
        f"'{{\"submission_status\":\"ready\",\"created_at\":\"2026-01-01T00:00:00Z\","
        f"\"updated_at\":\"2026-01-01T00:00:00Z\"}}'::jsonb)"
    )


def batch_application_insert(prefix: str, batch: int, user_offset: int, size: int = 50) -> str:
    start = batch * size + 1
    end = start + size - 1
    return f"""
    INSERT INTO public.applications(application_id,user_id,job_id,data)
    SELECT '{prefix}-'||g,'write-user-'||({user_offset}+((g-1)%1000)+1),
      'write-job-'||((g%128)+1),
      '{{"submission_status":"ready","created_at":"2026-01-01T00:00:00Z",
         "updated_at":"2026-01-01T00:00:00Z"}}'::jsonb
    FROM generate_series({start},{end}) g
    """


def mixed_write_statement(worker: int, index: int) -> str:
    user_number = (index * 17 + worker * 31) % 256 + 1
    selector = index % 4
    if selector == 0:
        return (
            "UPDATE public.users SET data=jsonb_set(data,'{write_probe}',"
            f"to_jsonb({worker * 100_000 + index}),true) WHERE user_id='write-user-{user_number}'"
        )
    if selector == 1:
        return (
            "INSERT INTO public.profiles(user_id,data) VALUES "
            f"('write-user-{user_number}','{{\"target_role\":\"Engineer\","
            f"\"write_probe\":{worker * 100_000 + index}}}'::jsonb) "
            "ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data"
        )
    if selector == 2:
        return (
            "INSERT INTO public.analytics_events(event_id,user_id,event,created_at,data) VALUES "
            f"('write-event-{worker}-{index}','write-user-{user_number}','activity',"
            f"'2026-01-02T00:00:00Z'::timestamptz,'{{\"probe\":{index}}}'::jsonb)"
        )
    return application_insert(
        f"mixed-app-{worker}",
        index,
        user_number - index,
    )


def counter_ids(count: int) -> list[str]:
    return [f"counter-app-{index}" for index in range(1, count + 1)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--mixed-writes", type=int, default=10_000)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    assert_disposable(args.database_url)

    evidence: dict[str, Any] = {
        "database": urlparse(args.database_url).path.lstrip("/"),
        "gates": {
            "single_row_added_p95_ms": 25,
            "batch_added_p95_ms": 75,
            "mixed_writes": args.mixed_writes,
            "counter_lock_wait_upper_bound_p95_ms": 10,
        },
    }

    run_file(args.database_url, SCHEMA)
    run_psql(args.database_url, seed_sql())

    baseline_single = timed_statements(
        args.database_url,
        [application_insert("baseline-single", i, 300) for i in range(1, 221)],
    )[20:]
    baseline_batch = timed_statements(
        args.database_url,
        [batch_application_insert("baseline-batch", batch, 500) for batch in range(110)],
    )[10:]

    run_file(args.database_url, UP)
    run_psql(
        args.database_url,
        """
        SELECT public.admin_rebuild_users(array_agg(user_id ORDER BY user_id))
        FROM public.users;
        """,
    )
    projected_single = timed_statements(
        args.database_url,
        [application_insert("projected-single", i, 1_600) for i in range(1, 221)],
    )[20:]
    projected_batch = timed_statements(
        args.database_url,
        [batch_application_insert("projected-batch", batch, 1_800) for batch in range(110)],
    )[10:]

    baseline_single_p95 = p95(baseline_single)
    projected_single_p95 = p95(projected_single)
    single_added = max(projected_single_p95 - baseline_single_p95, 0)
    baseline_batch_p95 = p95(baseline_batch)
    projected_batch_p95 = p95(projected_batch)
    batch_added = max(projected_batch_p95 - baseline_batch_p95, 0)
    evidence["single_row"] = {
        "baseline_p95_ms": baseline_single_p95,
        "projected_p95_ms": projected_single_p95,
        "added_p95_ms": single_added,
        "pass": single_added <= 25,
    }
    evidence["batch"] = {
        "baseline_p95_ms": baseline_batch_p95,
        "projected_p95_ms": projected_batch_p95,
        "added_p95_ms": batch_added,
        "pass": batch_added <= 75,
    }

    per_worker = [args.mixed_writes // args.workers] * args.workers
    for index in range(args.mixed_writes % args.workers):
        per_worker[index] += 1

    def run_mixed(worker: int) -> dict[str, Any]:
        statements = [mixed_write_statement(worker, index) for index in range(per_worker[worker])]
        started = time.perf_counter()
        try:
            timed_statements(args.database_url, statements, timeout=1_200)
            return {
                "worker": worker,
                "writes": len(statements),
                "elapsed_seconds": time.perf_counter() - started,
                "pass": True,
            }
        except Exception as exc:  # retained evidence must preserve the exact failure
            return {
                "worker": worker,
                "writes": len(statements),
                "elapsed_seconds": time.perf_counter() - started,
                "pass": False,
                "error": str(exc),
            }

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        mixed_results = list(pool.map(run_mixed, range(args.workers)))
    evidence["mixed_writes"] = {
        "requested": args.mixed_writes,
        "completed": sum(item["writes"] for item in mixed_results if item["pass"]),
        "workers": mixed_results,
        "deadlocks": sum("deadlock detected" in item.get("error", "") for item in mixed_results),
        "pass": all(item["pass"] for item in mixed_results),
    }

    run_psql(
        args.database_url,
        """
        CREATE UNLOGGED TABLE public.admin_counter_lock_probe(
          elapsed_ms double precision NOT NULL
        );
        CREATE OR REPLACE FUNCTION public.aa_admin_counter_probe_before()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM set_config(
            'admin_probe.counter_started_at',
            extract(epoch FROM clock_timestamp())::text,
            true
          );
          RETURN NEW;
        END $$;
        CREATE OR REPLACE FUNCTION public.zz_admin_counter_probe_after()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE started_at double precision;
        BEGIN
          started_at:=current_setting('admin_probe.counter_started_at')::double precision;
          INSERT INTO public.admin_counter_lock_probe(elapsed_ms)
          VALUES((extract(epoch FROM clock_timestamp())-started_at)*1000);
          RETURN NEW;
        END $$;
        CREATE TRIGGER aa_admin_counter_probe_before
          BEFORE INSERT OR UPDATE ON public.admin_application_read_model
          FOR EACH ROW EXECUTE FUNCTION public.aa_admin_counter_probe_before();
        CREATE TRIGGER zz_admin_counter_probe_after
          AFTER INSERT OR UPDATE ON public.admin_application_read_model
          FOR EACH ROW EXECUTE FUNCTION public.zz_admin_counter_probe_after();
        """,
    )
    lock_ids = counter_ids(args.workers * 100)

    def run_counter_contention(worker: int) -> list[float]:
        statements = []
        for offset in range(100):
            application_id = lock_ids[worker * 100 + offset]
            statements.append(
                "INSERT INTO public.applications(application_id,user_id,job_id,data) VALUES "
                f"('{application_id}','write-user-{worker + 1}','write-job-1',"
                "'{\"submission_status\":\"ready\",\"created_at\":\"2026-01-03T00:00:00Z\","
                "\"updated_at\":\"2026-01-03T00:00:00Z\"}'::jsonb)"
            )
        return timed_statements(args.database_url, statements, timeout=600)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        contention_timings = [
            timing for worker_timings in pool.map(run_counter_contention, range(args.workers))
            for timing in worker_timings
        ]
    counter_probe = json.loads(
        run_psql(
            args.database_url,
            """
            SELECT json_build_object(
              'samples',count(*),
              'p95_ms',COALESCE(percentile_disc(0.95) WITHIN GROUP(ORDER BY elapsed_ms),0),
              'max_ms',COALESCE(max(elapsed_ms),0)
            ) FROM public.admin_counter_lock_probe;
            """,
        ).stdout
    )
    bucket_distribution = json.loads(
        run_psql(
            args.database_url,
            """
            SELECT json_object_agg(bucket,total) FROM (
              SELECT ((hashtextextended(application_id,0)&9223372036854775807)%64)::text bucket,
                count(*) total
              FROM public.applications WHERE application_id LIKE 'counter-app-%'
              GROUP BY 1 ORDER BY 1
            ) buckets;
            """,
        ).stdout
    )
    counter_p95 = float(counter_probe["p95_ms"])
    evidence["counter_lock"] = {
        "bucket_distribution": bucket_distribution,
        "samples": counter_probe["samples"],
        "counter_path_p95_ms": counter_p95,
        "counter_path_max_ms": counter_probe["max_ms"],
        "statement_p95_ms": p95(contention_timings),
        "measurement": (
            "fixture-only before/after triggers bound read-model row insertion plus "
            "the counter trigger; the measured interval is an upper bound on counter lock wait"
        ),
        "pass": counter_p95 <= 10,
    }

    evidence["pass"] = all(
        (
            evidence["single_row"]["pass"],
            evidence["batch"]["pass"],
            evidence["mixed_writes"]["pass"],
            evidence["mixed_writes"]["completed"] == args.mixed_writes,
            evidence["mixed_writes"]["deadlocks"] == 0,
            evidence["counter_lock"]["pass"],
        )
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"pass": evidence["pass"], "output": str(args.output)}, indent=2))
    return 0 if evidence["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
