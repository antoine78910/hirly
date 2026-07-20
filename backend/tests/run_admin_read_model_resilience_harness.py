#!/usr/bin/env python3
"""Retain admin read-model bootstrap, traversal, shadow, and rollback evidence."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time
from typing import Any
from urllib.parse import urlparse

from run_admin_read_model_operational_harness import query_json, run_file, run_psql


ROOT = Path(__file__).parents[1]
SCHEMA = ROOT / "supabase_schema.sql"
UP = ROOT / "db/migrations/20260720001800_admin_read_models.sql"
DOWN = ROOT / "db/migrations/20260720001800_admin_read_models.down.sql"


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def wait_until_holding(database_url: str, worker: subprocess.Popen[str]) -> None:
    for _ in range(120):
        if worker.poll() is not None:
            stdout, stderr = worker.communicate()
            raise RuntimeError(f"bootstrap worker exited early: {stdout} {stderr}")
        holding = run_psql(
            database_url,
            """
            SELECT EXISTS(
              SELECT 1 FROM pg_stat_activity
              WHERE datname=current_database()
                AND query LIKE 'SELECT pg_sleep(300)%'
            );
            """,
        ).stdout.strip()
        if holding == "t":
            return
        time.sleep(0.25)
    raise RuntimeError("bootstrap worker did not enter the held transaction")


def held_worker(database_url: str, sql: str) -> subprocess.Popen[str]:
    worker = subprocess.Popen(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", database_url],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert worker.stdin is not None
    worker.stdin.write(
        f"BEGIN;\nSELECT {sql};\nSELECT pg_sleep(300);\nCOMMIT;\n"
    )
    worker.stdin.close()
    wait_until_holding(database_url, worker)
    return worker


def kill_worker(database_url: str, worker: subprocess.Popen[str]) -> dict[str, Any]:
    terminated = run_psql(
        database_url,
        """
        SELECT count(*) FROM (
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname=current_database()
            AND pid<>pg_backend_pid()
            AND query LIKE 'SELECT pg_sleep(300)%'
        ) killed;
        """,
    ).stdout.strip()
    try:
        returncode = worker.wait(timeout=10)
    except subprocess.TimeoutExpired:
        worker.terminate()
        try:
            returncode = worker.wait(timeout=5)
        except subprocess.TimeoutExpired:
            worker.kill()
            returncode = worker.wait(timeout=10)
    return {
        "returncode": returncode,
        "terminated_backends": int(terminated),
        "killed": returncode != 0 and int(terminated) == 1,
    }


def traverse(database_url: str, direction: str, limit: int = 37) -> dict[str, Any]:
    cursor_time: str | None = None
    cursor_id: str | None = None
    visited: list[str] = []
    pages = 0
    while True:
        time_arg = "NULL" if cursor_time is None else f"{sql_literal(cursor_time)}::timestamptz"
        id_arg = "NULL" if cursor_id is None else sql_literal(cursor_id)
        payload = query_json(
            database_url,
            "SELECT public.admin_applications_cursor_v3("
            f"{limit},{time_arg},{id_arg},{sql_literal(direction)},NULL);",
        )
        rows = payload["applications"]
        pages += 1
        visited.extend(row["application_id"] for row in rows)
        continuation = payload["has_next"] if direction == "next" else payload["has_previous"]
        if not continuation:
            break
        boundary = rows[-1] if direction == "next" else rows[0]
        cursor_time = boundary["sort_at"]
        cursor_id = boundary["application_id"]
        if pages > 100:
            raise RuntimeError("cursor traversal did not terminate")
    return {
        "direction": direction,
        "pages": pages,
        "visited": len(visited),
        "unique": len(set(visited)),
        "first_id": visited[0] if visited else None,
        "last_id": visited[-1] if visited else None,
        "ids": visited,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    parsed = urlparse(args.database_url)
    database_name = parsed.path.removeprefix("/")
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise SystemExit("resilience harness requires localhost PostgreSQL")
    if not any(marker in database_name for marker in ("task7", "disposable", "test")):
        raise SystemExit("database name must identify a disposable task7/test database")

    evidence: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "database": database_name,
        "checks": {},
    }

    def check(name: str, condition: bool, detail: Any) -> None:
        evidence["checks"][name] = {"pass": bool(condition), "detail": detail}

    run_file(args.database_url, SCHEMA)
    run_psql(
        args.database_url,
        """
        DO $$ BEGIN
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
            CREATE ROLE authenticated;
          END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
            CREATE ROLE service_role;
          END IF;
        END $$;
        CREATE OR REPLACE FUNCTION public.admin_overview_snapshot()
        RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
        DROP TABLE public.jobs;
        """,
    )
    run_file(args.database_url, UP)
    run_psql(
        args.database_url,
        """
        CREATE TABLE public.jobs (
          job_id text PRIMARY KEY, title text, company text, ats_provider text,
          data jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        INSERT INTO jobs(job_id,title,company,ats_provider)
          VALUES ('j1','stale-title','stale-company','stale-provider');

        ALTER TABLE users DISABLE TRIGGER USER;
        INSERT INTO users(user_id,email,data)
        SELECT 'u-' || lpad(n::text,3,'0'),
          'u' || n || '@example.com',
          jsonb_build_object('name','User ' || n,'created_at','2026-01-01T00:00:00Z')
        FROM generate_series(1,20) n;
        ALTER TABLE users ENABLE TRIGGER USER;

        ALTER TABLE applications DISABLE TRIGGER USER;
        INSERT INTO applications(application_id,user_id,job_id,data)
        SELECT 'a-' || lpad(n::text,4,'0'),'u-001','j1',
          jsonb_build_object(
            'company','Acme','title','Engineer','ats_provider','greenhouse',
            'submission_status','ready',
            'created_at','2026-01-01T00:00:00Z',
            'updated_at',to_char(
              timestamptz '2026-01-01T00:00:00Z' + n * interval '1 second',
              'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        FROM generate_series(1,600) n;
        ALTER TABLE applications ENABLE TRIGGER USER;
        """,
    )

    user_a = held_worker(
        args.database_url,
        "public.admin_backfill_users(NULL,10)",
    )
    user_b = query_json(
        args.database_url,
        "SELECT public.admin_backfill_users('u-010',10);",
    )
    user_kill = kill_worker(args.database_url, user_a)
    user_recovery = query_json(
        args.database_url,
        "SELECT public.admin_backfill_users('u-020',10);",
    )
    users_state = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'canonical',(SELECT count(*) FROM users),
          'model',(SELECT count(*) FROM admin_user_read_model));
        """,
    )
    check(
        "user_backfill_kill_restart",
        user_b["processed"] == 10
        and user_b["cursor_ignored"] is True
        and user_kill["killed"]
        and user_recovery["processed"] == 10
        and user_recovery["remaining"] is False
        and users_state == {"canonical": 20, "model": 20},
        {
            "concurrent_worker": user_b,
            "killed_worker": user_kill,
            "recovery": user_recovery,
            "state": users_state,
        },
    )

    app_a = held_worker(
        args.database_url,
        "public.admin_backfill_applications(NULL,500)",
    )
    app_b = query_json(
        args.database_url,
        "SELECT public.admin_backfill_applications('a-0500',500);",
    )
    app_kill = kill_worker(args.database_url, app_a)
    app_recovery = query_json(
        args.database_url,
        "SELECT public.admin_backfill_applications('a-0600',500);",
    )
    app_user_recovery = query_json(
        args.database_url,
        "SELECT public.admin_backfill_users(NULL,500);",
    )
    apps_state = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'canonical',(SELECT count(*) FROM applications),
          'model',(SELECT count(*) FROM admin_application_read_model),
          'counter',(SELECT COALESCE(sum(total),0)
            FROM admin_application_scope_count WHERE scope_key='all'));
        """,
    )
    check(
        "application_backfill_kill_restart",
        app_b["processed"] == 100
        and app_b["cursor_ignored"] is True
        and app_kill["killed"]
        and app_recovery["processed"] == 500
        and app_recovery["remaining"] is False
        and app_user_recovery["processed"] == 20
        and app_user_recovery["remaining"] is False
        and apps_state == {"canonical": 600, "model": 600, "counter": 600},
        {
            "concurrent_worker": app_b,
            "killed_worker": app_kill,
            "recovery": app_recovery,
            "user_fact_recovery": app_user_recovery,
            "state": apps_state,
        },
    )

    first_clean = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(false);",
    )
    run_psql(
        args.database_url,
        """
        UPDATE users SET data=data || '{"resilience_probe":1}'::jsonb
          WHERE user_id='u-001';
        """,
    )
    second_clean = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(true);",
    )
    check(
        "two_pass_ready_after_bootstrap",
        first_clean["ok"] is True
        and first_clean["clean_reconciliation_count"] == 1
        and second_clean["ok"] is True
        and second_clean["clean_reconciliation_count"] == 2
        and second_clean["ready"] is True,
        {"first": first_clean, "second": second_clean},
    )

    forward = traverse(args.database_url, "next")
    backward = traverse(args.database_url, "previous")
    canonical_ids = {
        f"a-{number:04d}"
        for number in range(1, 601)
    }
    check(
        "full_cursor_traversal",
        forward["visited"] == 600
        and forward["unique"] == 600
        and set(forward.pop("ids")) == canonical_ids
        and backward["visited"] == 600
        and backward["unique"] == 600
        and set(backward.pop("ids")) == canonical_ids,
        {"forward": forward, "backward": backward},
    )

    shadow = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'missing',(SELECT count(*) FROM applications a
            LEFT JOIN admin_application_read_model r USING(application_id)
            WHERE r.application_id IS NULL),
          'display_mismatches',(SELECT count(*) FROM applications a
            JOIN admin_application_read_model r USING(application_id)
            WHERE r.company IS DISTINCT FROM a.data->>'company'
              OR r.title IS DISTINCT FROM a.data->>'title'
              OR r.ats_provider IS DISTINCT FROM a.data->>'ats_provider'),
          'stale_job_leaks',(SELECT count(*) FROM admin_application_read_model
            WHERE company='stale-company' OR title='stale-title'
              OR ats_provider='stale-provider'));
        """,
    )
    check(
        "shadow_parity",
        shadow == {"missing": 0, "display_mismatches": 0, "stale_job_leaks": 0},
        shadow,
    )

    mismatch = query_json(
        args.database_url,
        """
        UPDATE admin_application_scope_count SET total=total-1
        WHERE scope_key='all' AND total>0
          AND ctid=(SELECT ctid FROM admin_application_scope_count
            WHERE scope_key='all' AND total>0 LIMIT 1);
        SELECT public.admin_reconcile_read_models(false);
        """,
    )
    run_psql(
        args.database_url,
        """
        SELECT public.admin_rebuild_application_scope_counts();
        SELECT public.admin_reconcile_read_models(false);
        UPDATE users SET data=data || '{"resilience_probe":2}'::jsonb
          WHERE user_id='u-001';
        """,
    )
    repaired = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(true);",
    )
    check(
        "corruption_reconcile_repair",
        mismatch["ok"] is False
        and mismatch["clean_reconciliation_count"] == 0
        and repaired["ok"] is True
        and repaired["ready"] is True,
        {"mismatch": mismatch, "repaired": repaired},
    )

    run_psql(
        args.database_url,
        "UPDATE admin_read_model_state SET bootstrap_state='verifying' WHERE singleton;",
    )
    run_file(args.database_url, DOWN)
    rollback = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'users',(SELECT count(*) FROM users),
          'applications',(SELECT count(*) FROM applications),
          'read_model',to_regclass('public.admin_application_read_model'),
          'jobs',(SELECT count(*) FROM jobs));
        """,
    )
    run_file(args.database_url, UP)
    reapplied_users = query_json(
        args.database_url,
        "SELECT public.admin_backfill_users(NULL,500);",
    )
    reapplied_apps = query_json(
        args.database_url,
        "SELECT public.admin_backfill_applications(NULL,1000);",
    )
    reapplied_user_facts = query_json(
        args.database_url,
        "SELECT public.admin_backfill_users(NULL,500);",
    )
    reapply_first = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(false);",
    )
    run_psql(
        args.database_url,
        """
        UPDATE users SET data=data || '{"resilience_probe":3}'::jsonb
          WHERE user_id='u-001';
        """,
    )
    reapply_second = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(true);",
    )
    reapply_rpc = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'applications',jsonb_array_length(
            public.admin_applications_cursor_v3(200,NULL,NULL,'next',NULL)
              ->'applications'),
          'total',(public.admin_applications_cursor_v3(
            1,NULL,NULL,'next',NULL)->>'total')::integer);
        """,
    )
    check(
        "rollback_reapply",
        rollback
        == {"users": 20, "applications": 600, "read_model": None, "jobs": 1}
        and reapplied_users["processed"] == 20
        and reapplied_apps["processed"] == 600
        and reapplied_user_facts["processed"] == 20
        and reapplied_user_facts["remaining"] is False
        and reapply_first["ok"] is True
        and reapply_second["ready"] is True
        and reapply_rpc == {"applications": 200, "total": 600},
        {
            "rollback": rollback,
            "users": reapplied_users,
            "applications": reapplied_apps,
            "user_facts": reapplied_user_facts,
            "first": reapply_first,
            "second": reapply_second,
            "rpc": reapply_rpc,
        },
    )

    evidence["pass"] = all(item["pass"] for item in evidence["checks"].values())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"pass": evidence["pass"], "output": str(args.output)}, indent=2))
    return 0 if evidence["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
