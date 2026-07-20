#!/usr/bin/env python3
"""Exercise admin read-model operational gates on disposable PostgreSQL."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).parents[1]
SCHEMA = ROOT / "supabase_schema.sql"
UP = ROOT / "db/migrations/20260720001800_admin_read_models.sql"
DOWN = ROOT / "db/migrations/20260720001800_admin_read_models.down.sql"


def run_psql(database_url: str, sql: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", database_url],
        input=sql,
        text=True,
        capture_output=True,
        timeout=120,
    )
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result


def run_file(database_url: str, path: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", database_url, "-f", str(path)],
        text=True,
        capture_output=True,
        timeout=120,
    )
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result


def query_json(database_url: str, sql: str) -> Any:
    output = run_psql(database_url, sql).stdout.strip()
    return json.loads(output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    parsed = urlparse(args.database_url)
    database_name = parsed.path.removeprefix("/")
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise SystemExit("operational harness requires localhost PostgreSQL")
    if not any(marker in database_name for marker in ("task4", "disposable", "test")):
        raise SystemExit("database name must identify a disposable task4/test database")

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
        GRANT EXECUTE ON FUNCTION public.admin_overview_snapshot() TO service_role;
        """,
    )
    run_psql(args.database_url, "DROP TABLE public.jobs;")
    run_file(args.database_url, UP)
    run_psql(
        args.database_url,
        """
        CREATE TABLE public.jobs (
          job_id text PRIMARY KEY,
          title text,
          company text,
          ats_provider text,
          data jsonb NOT NULL DEFAULT '{}'::jsonb
        );
        """,
    )

    unavailable = run_psql(
        args.database_url,
        "SELECT public.admin_users_cursor_v3(10,NULL,NULL,'next',NULL,false);",
        check=False,
    )
    check(
        "readiness_fail_closed",
        unavailable.returncode != 0 and "admin read model unavailable" in unavailable.stderr,
        unavailable.stderr.strip(),
    )

    first_clean = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(true);",
    )
    immediate_second = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(true);",
    )
    run_psql(
        args.database_url,
        """
        INSERT INTO users(user_id,email,data)
          VALUES ('reconciliation-probe','probe@example.com','{}');
        DELETE FROM users WHERE user_id='reconciliation-probe';
        """,
    )
    after_write_reconcile = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(true);",
    )
    after_write_state = run_psql(
        args.database_url,
        "SELECT bootstrap_state FROM admin_read_model_state WHERE singleton;",
    ).stdout.strip()
    after_write = {
        "reconcile": after_write_reconcile,
        "state": after_write_state,
    }
    check(
        "two_pass_readiness",
        first_clean["clean_reconciliation_count"] == 1
        and first_clean["ready"] is False
        and immediate_second["clean_reconciliation_count"] == 1
        and immediate_second["intervening_normal_write"] is False
        and immediate_second["ready"] is False
        and after_write["reconcile"]["clean_reconciliation_count"] == 2
        and after_write["reconcile"]["intervening_normal_write"] is True
        and after_write["reconcile"]["ready"] is True
        and after_write["state"] == "ready",
        {
            "first_clean": first_clean,
            "immediate_second": immediate_second,
            "after_write": after_write,
        },
    )

    run_psql(
        args.database_url,
        """
        INSERT INTO users(user_id,email,data) VALUES
          ('u1','u1@example.com','{"name":"Ada","created_at":"2026-01-01T00:00:00Z",
            "updated_at":"2026-01-02T00:00:00Z","billing":{"subscription_status":"active",
            "plan":"pro","credits_total":10,"credits_remaining":7,
            "referral_bonus_credits_total":3,"referral_bonus_credits_remaining":2}}');
        INSERT INTO profiles(user_id,data) VALUES
          ('u1','{"target_role":"Engineer","target_location":"Paris",
            "updated_at":"2026-01-03T00:00:00Z",
            "extras":{"onboarding":{"job_search_status":"active"}}}');
        INSERT INTO jobs(job_id,title,company,ats_provider,data)
          VALUES ('j1','Stale title','Stale company','stale-provider','{}');
        INSERT INTO applications(application_id,user_id,job_id,data) VALUES
          ('a1','u1','j1','{"submission_status":"ready",
            "company":"Acme","title":"Engineer","ats_provider":"greenhouse",
            "auto_apply_queue_status":"queued","created_at":"2026-01-04T00:00:00Z",
            "updated_at":"2026-01-05T00:00:00Z","tailored_resume_structured":{},
            "tailored_resume":{"ok":true}}');
        INSERT INTO swipes(user_id,job_id,data) VALUES
          ('u1','j1','{"direction":"right","created_at":"2026-01-06T00:00:00Z"}');
        INSERT INTO analytics_events(event_id,user_id,event,created_at,data) VALUES
          ('e1','u1','onboarding_started','2026-01-07T00:00:00Z','{}'),
          ('e2','u1','onboarding_step_completed','2026-01-07T00:01:00Z',
            '{"properties":{"step_index":2,"step":"jobSearch"}}'),
          ('e3','u1','activity','2026-01-07T00:10:00Z','{}'),
          ('e4','u1','activity','2026-01-07T01:00:00Z','{}');
        SELECT public.admin_reconcile_read_models(false);
        UPDATE users SET data=data || '{"reconciliation_probe":1}'::jsonb
          WHERE user_id='u1';
        SELECT public.admin_reconcile_read_models(true);
        """,
    )

    base = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'user',(SELECT json_build_object(
            'credits_total',credits_total,'credits_remaining',credits_remaining,
            'sessions',sessions_count,'minutes',time_spent_minutes,
            'furthest',furthest_step,'dropoff',drop_off_step,
            'applications',total_applications,'swipes',total_swipes)
            FROM admin_user_read_model WHERE user_id='u1'),
          'application',(SELECT json_build_object(
            'company',company,'title',title,'ats',ats_provider,
            'has_resume',has_tailored_resume,'package',package_status)
            FROM admin_application_read_model WHERE application_id='a1'),
          'users_rpc',public.admin_users_cursor_v3(10,NULL,NULL,'next',NULL,false),
          'analytics_rpc',public.admin_user_analytics_cursor_v2(10,NULL,NULL,'next',NULL),
          'applications_rpc',public.admin_applications_cursor_v3(10,NULL,NULL,'next',NULL));
        """,
    )
    check(
        "projection_and_aggregates",
        base["user"]["credits_total"] == 13
        and base["user"]["credits_remaining"] == 9
        and base["user"]["sessions"] == 2
        and float(base["user"]["minutes"]) == 10.5
        and base["user"]["furthest"] == "jobSearch"
        and base["user"]["dropoff"] == "jobGoal"
        and base["application"] == {
            "company": "Acme",
            "title": "Engineer",
            "ats": "greenhouse",
            "has_resume": True,
            "package": "generated",
        }
        and base["users_rpc"]["aggregates"]["matching_paying"] == 1
        and base["analytics_rpc"]["summary"]["total_applications"] == 1
        and base["applications_rpc"]["queue"]["active_count"] == 1
        and len(base["applications_rpc"]["queue"]["items"]) == 1,
        base,
    )

    concurrent_sql = [
        """
        INSERT INTO applications(application_id,user_id,job_id,data)
        VALUES ('a2','u1','j1','{"submission_status":"submitted",
          "created_at":"2026-01-08T00:00:00Z","updated_at":"2026-01-08T00:00:00Z"}');
        """,
        """
        INSERT INTO applications(application_id,user_id,job_id,data)
        VALUES ('a3','u1','j1','{"submission_status":"failed",
          "created_at":"2026-01-09T00:00:00Z","updated_at":"2026-01-09T00:00:00Z"}');
        """,
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        concurrent_results = list(pool.map(lambda sql: run_psql(args.database_url, sql), concurrent_sql))
    concurrency = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'canonical',(SELECT count(*) FROM applications),
          'model',(SELECT count(*) FROM admin_application_read_model),
          'counter',(SELECT COALESCE(sum(total),0)
            FROM admin_application_scope_count WHERE scope_key='all'),
          'user_total',(SELECT total_applications FROM admin_user_read_model WHERE user_id='u1'));
        """,
    )
    check(
        "concurrent_projection",
        all(result.returncode == 0 for result in concurrent_results)
        and concurrency == {"canonical": 3, "model": 3, "counter": 3, "user_total": 3},
        concurrency,
    )

    freshness = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'state',(SELECT json_build_object(
            'bootstrap_state',bootstrap_state,
            'lag_seconds',GREATEST(extract(epoch FROM
              COALESCE(last_canonical_change_at,last_model_change_at)-
              COALESCE(last_model_change_at,last_canonical_change_at)),0))
            FROM admin_read_model_state WHERE singleton),
          'rpc_lag',(public.admin_users_cursor_v3(10,NULL,NULL,'next',NULL,false)
            ->>'freshness_lag_seconds')::numeric);
        """,
    )
    check(
        "freshness",
        freshness["state"]["bootstrap_state"] == "ready"
        and float(freshness["state"]["lag_seconds"]) <= 30
        and float(freshness["rpc_lag"]) <= 30,
        freshness,
    )

    security = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'existing_admin_rpc',has_function_privilege(
            'service_role','public.admin_overview_snapshot()','execute'),
          'cursor_rpc',has_function_privilege(
            'service_role',
            'public.admin_users_cursor_v3(integer,timestamp with time zone,text,text,text,boolean)',
            'execute'),
          'helper_rpc',has_function_privilege(
            'service_role','public.admin_rebuild_users(text[])','execute'),
          'direct_table',has_table_privilege(
            'service_role','public.admin_user_read_model','select'),
          'anon_cursor',has_function_privilege(
            'anon',
            'public.admin_users_cursor_v3(integer,timestamp with time zone,text,text,text,boolean)',
            'execute'));
        """,
    )
    check(
        "security",
        security == {
            "existing_admin_rpc": True,
            "cursor_rpc": True,
            "helper_rpc": False,
            "direct_table": False,
            "anon_cursor": False,
        },
        security,
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
        UPDATE admin_application_scope_count SET total=total+1
          WHERE scope_key='all'
          AND ctid=(SELECT ctid FROM admin_application_scope_count
            WHERE scope_key='all' LIMIT 1);
        SELECT public.admin_reconcile_read_models(false);
        UPDATE users SET data=data || '{"reconciliation_probe":2}'::jsonb
          WHERE user_id='u1';
        SELECT public.admin_reconcile_read_models(true);
        """,
    )
    repaired = query_json(
        args.database_url,
        "SELECT public.admin_reconcile_read_models(true);",
    )
    check(
        "reconcile_failure_and_repair",
        mismatch["ok"] is False and repaired["ok"] is True,
        {"mismatch": mismatch, "repaired": repaired},
    )

    refused_down = run_file(args.database_url, DOWN, check=False)
    check(
        "down_refuses_ready",
        refused_down.returncode != 0
        and "refusing admin read-model down migration" in refused_down.stderr,
        refused_down.stderr.strip(),
    )
    run_psql(
        args.database_url,
        "UPDATE admin_read_model_state SET bootstrap_state='verifying' WHERE singleton;",
    )
    run_file(args.database_url, DOWN)
    canonical_after_down = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'users',(SELECT count(*) FROM users),
          'applications',(SELECT count(*) FROM applications),
          'swipes',(SELECT count(*) FROM swipes),
          'events',(SELECT count(*) FROM analytics_events),
          'model_table',to_regclass('public.admin_user_read_model'));
        """,
    )
    run_file(args.database_url, UP)
    run_psql(
        args.database_url,
        """
        SELECT public.admin_project_application(application_id) FROM applications;
        SELECT public.admin_rebuild_users(ARRAY(SELECT user_id FROM users));
        SELECT public.admin_reconcile_read_models(false);
        UPDATE users SET data=data || '{"reconciliation_probe":3}'::jsonb
          WHERE user_id='u1';
        SELECT public.admin_reconcile_read_models(true);
        """,
    )
    reapplied = query_json(
        args.database_url,
        """
        SELECT json_build_object(
          'reconcile',public.admin_reconcile_read_models(true),
          'users_rpc',jsonb_array_length(
            public.admin_users_cursor_v3(10,NULL,NULL,'next',NULL,false)->'users'),
          'applications_rpc',jsonb_array_length(
            public.admin_applications_cursor_v3(10,NULL,NULL,'next',NULL)->'applications'));
        """,
    )
    check(
        "apply_down_reapply",
        canonical_after_down
        == {"users": 1, "applications": 3, "swipes": 1, "events": 4, "model_table": None}
        and reapplied["reconcile"]["ok"] is True
        and reapplied["users_rpc"] == 1
        and reapplied["applications_rpc"] == 3,
        {"after_down": canonical_after_down, "reapplied": reapplied},
    )

    evidence["pass"] = all(item["pass"] for item in evidence["checks"].values())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"pass": evidence["pass"], "output": str(args.output)}, indent=2))
    return 0 if evidence["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
