#!/usr/bin/env python3
"""Release-scale 66-cell maintained admin read-model/cursor plan harness."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import statistics
import subprocess
from typing import Any


FILTERS = [
    None, "action_required", "blocked", "blocked_captcha", "prepare_failed",
    "prepared", "ready", "submitted", "failed", "manual_review_needed",
    "manual_in_progress", "manually_submitted", "manual_blocked",
    "needs_user_input", "offer_expired",
]
POSITIONS = ("first", "middle", "terminal")
CANONICAL_FACTS = {"applications", "swipes", "analytics_events"}


def literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def psql(database_url: str, statement: str, *, timeout: int = 300) -> str:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", database_url],
        input=statement, text=True, capture_output=True, timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def psql_json(database_url: str, statement: str, *, timeout: int = 300) -> Any:
    return json.loads(psql(database_url, statement, timeout=timeout))


def explain(database_url: str, query: str) -> dict[str, Any]:
    return psql_json(
        database_url,
        "SET statement_timeout='30s';"
        f"EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) {query};",
    )[0]


def walk(plan: dict[str, Any]):
    yield plan
    for child in plan.get("Plans", []):
        yield from walk(child)


def summarize(payload: dict[str, Any]) -> dict[str, Any]:
    root = payload["Plan"]
    nodes = list(walk(root))
    relations: dict[str, float] = {}
    for node in nodes:
        relation = node.get("Relation Name")
        if relation:
            relations[relation] = relations.get(relation, 0) + (
                float(node.get("Actual Rows", 0)) * float(node.get("Actual Loops", 0))
            )
    return {
        "execution_ms": float(payload.get("Execution Time", 0)),
        "planning_ms": float(payload.get("Planning Time", 0)),
        "shared_blocks": int(root.get("Shared Hit Blocks", 0))
        + int(root.get("Shared Read Blocks", 0)),
        "temp_blocks": int(root.get("Temp Read Blocks", 0))
        + int(root.get("Temp Written Blocks", 0)),
        "disk_sort": any(
            "external" in str(n.get("Sort Method", "")).lower()
            or "disk" in str(n.get("Sort Space Type", "")).lower()
            for n in nodes
        ),
        "relations": relations,
        "node_types": sorted({str(n.get("Node Type")) for n in nodes}),
    }


def user_where(q: str | None, paying: bool = False) -> str:
    clauses = []
    if q:
        escaped = q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append(f"search_text LIKE {literal('%' + escaped + '%')} ESCAPE '\\'")
    if paying:
        clauses.append("is_premium")
    return " AND ".join(clauses) or "true"


def app_where(status_filter: str | None) -> str:
    if not status_filter:
        return "true"
    if status_filter == "prepared":
        return "submission_status IN ('ready','prepared')"
    if status_filter == "offer_expired":
        return "user_facing_submission_status='expired'"
    if status_filter.startswith("manual_") or status_filter in {"needs_user_input", "manually_submitted"}:
        return f"manual_status={literal(status_filter)}"
    return f"submission_status={literal(status_filter)}"


def anchor(
    database_url: str, *, table: str, where: str, time_col: str, id_col: str,
    position: str,
) -> dict[str, str] | None:
    if position == "first":
        return None
    if position == "terminal":
        value = psql(
            database_url,
            "SELECT json_build_object('time',"
            f"{time_col},'id',{id_col}) FROM {table} WHERE {where} "
            f"ORDER BY {time_col} ASC,{id_col} DESC OFFSET 199 LIMIT 1;",
        )
        return json.loads(value) if value else None
    total = int(psql(database_url, f"SELECT count(*) FROM {table} WHERE {where};"))
    offset = max(total // 2, 0)
    return psql_json(
        database_url,
        "SELECT json_build_object('time',"
        f"{time_col},'id',{id_col}) FROM {table} WHERE {where} "
        f"ORDER BY {time_col} DESC,{id_col} ASC OFFSET {offset} LIMIT 1;",
    )


def cursor_predicate(time_col: str, id_col: str, value: dict[str, str] | None) -> str:
    if value is None:
        return "true"
    return (
        f"({time_col}<{literal(value['time'])}::timestamptz OR "
        f"({time_col}={literal(value['time'])}::timestamptz AND "
        f"{id_col}>{literal(value['id'])}))"
    )


def scenarios():
    for scope, q, paying in (
        ("unfiltered", None, False), ("paying", None, True),
        ("selective", "selective-user", False), ("broad", "scale candidate", False),
    ):
        for position in POSITIONS:
            yield f"users_{scope}_{position}", "users", q, paying, None, position
    for scope, q in (
        ("unfiltered", None), ("selective", "selective-user"),
        ("broad", "scale candidate"),
    ):
        for position in POSITIONS:
            yield f"analytics_{scope}_{position}", "analytics", q, False, None, position
    for status_filter in FILTERS:
        for position in POSITIONS:
            yield f"applications_{status_filter or 'all'}_{position}", (
                "applications", None, False, status_filter, position
            )


def queries(
    database_url: str, resource: str, q: str | None, paying: bool,
    status_filter: str | None, position: str,
) -> tuple[str, str]:
    if resource in {"users", "analytics"}:
        where = user_where(q, paying)
        a = anchor(
            database_url, table="public.admin_user_read_model", where=where,
            time_col="last_active_at", id_col="user_id", position=position,
        )
        pred = cursor_predicate("last_active_at", "user_id", a)
        args = ",".join([
            "200", literal(a["time"] if a else None), literal(a["id"] if a else None),
            "'next'", literal(q),
        ])
        rpc = (
            f"SELECT public.admin_users_cursor_v3({args},{literal(paying)})"
            if resource == "users"
            else f"SELECT public.admin_user_analytics_cursor_v2({args})"
        )
        facts = ""
        if resource == "analytics":
            facts = """,
            distributions AS (
              SELECT answer_key,answer_label,count(*) count
              FROM public.admin_onboarding_answer_fact f JOIN matched m USING(user_id)
              GROUP BY 1,2
            )"""
        direct = f"""WITH matched AS NOT MATERIALIZED (
          SELECT * FROM public.admin_user_read_model WHERE {where}
        ), page AS (
          SELECT * FROM matched WHERE {pred}
          ORDER BY last_active_at DESC,user_id ASC LIMIT 201
        ){facts}
        SELECT jsonb_build_object(
          'rows',(SELECT jsonb_agg(to_jsonb(page)) FROM page),
          'total',(SELECT count(*) FROM matched)
          {",'answers',(SELECT jsonb_agg(to_jsonb(distributions)) FROM distributions)" if facts else ""}
        )"""
        return rpc, direct
    where = app_where(status_filter)
    a = anchor(
        database_url, table="public.admin_application_read_model", where=where,
        time_col="sort_at", id_col="application_id", position=position,
    )
    pred = cursor_predicate("sort_at", "application_id", a)
    args = ",".join([
        "200", literal(a["time"] if a else None), literal(a["id"] if a else None),
        "'next'", literal(status_filter),
    ])
    rpc = f"SELECT public.admin_applications_cursor_v3({args})"
    direct = f"""WITH page AS (
      SELECT * FROM public.admin_application_read_model
      WHERE {where} AND {pred} ORDER BY sort_at DESC,application_id ASC LIMIT 201
    ), queue AS (
      SELECT * FROM public.admin_application_read_model
      WHERE auto_apply_queue_status IN ('queued','running','awaiting_review')
      ORDER BY sort_at DESC,application_id ASC LIMIT 20
    )
    SELECT jsonb_build_object(
      'rows',(SELECT jsonb_agg(to_jsonb(page)) FROM page),
      'total',(SELECT COALESCE(sum(total),0) FROM public.admin_application_scope_count
        WHERE scope_key={literal(status_filter or 'all')}),
      'queue',(SELECT jsonb_agg(to_jsonb(queue)) FROM queue)
    )"""
    return rpc, direct


def p95(values: list[float]) -> float:
    return statistics.quantiles(values, n=100, method="inclusive")[94]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--warmups", type=int, default=5)
    parser.add_argument("--warm-runs", type=int, default=20)
    args = parser.parse_args()
    cardinalities = psql_json(args.database_url, """SELECT json_build_object(
      'users',(SELECT count(*) FROM public.users),
      'applications',(SELECT count(*) FROM public.applications),
      'swipes',(SELECT count(*) FROM public.swipes),
      'analytics_events',(SELECT count(*) FROM public.analytics_events));""")
    output: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cardinalities": cardinalities, "expected_matrix_cells": 66, "scenarios": {},
    }
    failures: list[str] = []
    for scenario in scenarios():
        if len(scenario) == 6:
            label, resource, q, paying, status_filter, position = scenario
        else:
            label, packed = scenario
            resource, q, paying, status_filter, position = packed
        item: dict[str, Any] = {"resource": resource, "position": position}
        try:
            rpc, direct = queries(
                args.database_url, resource, q, paying, status_filter, position,
            )
            item["transparent"] = summarize(explain(args.database_url, direct))
            cold = summarize(explain(args.database_url, rpc))
            for _ in range(args.warmups):
                explain(args.database_url, rpc)
            warm = [summarize(explain(args.database_url, rpc)) for _ in range(args.warm_runs)]
            timings = [run["execution_ms"] for run in warm]
            item["cold_ms"] = cold["execution_ms"]
            item["warm_p95_ms"] = p95(timings)
            item["warm_ms"] = timings
            item["shared_blocks_max"] = max(run["shared_blocks"] for run in warm)
            item["temp_blocks_max"] = max(run["temp_blocks"] for run in warm)
            item["canonical_fact_relations"] = sorted(
                CANONICAL_FACTS & set(item["transparent"]["relations"])
            )
            latency = 2500 if position in {"middle", "terminal"} else 1500
            item["pass"] = (
                item["warm_p95_ms"] <= latency and item["cold_ms"] <= 4000
                and item["shared_blocks_max"] <= 150000
                and item["temp_blocks_max"] == 0
                and not item["transparent"]["disk_sort"]
                and not item["canonical_fact_relations"]
            )
        except Exception as exc:
            item["pass"] = False
            item["error"] = str(exc)
        if not item["pass"]:
            failures.append(label)
        output["scenarios"][label] = item
        output["failed_scenarios"] = failures
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    payloads = psql_json(args.database_url, """SELECT json_build_object(
      'users',pg_column_size(public.admin_users_cursor_v3(200,NULL,NULL,'next',NULL,false)),
      'analytics',pg_column_size(public.admin_user_analytics_cursor_v2(200,NULL,NULL,'next',NULL)),
      'applications',pg_column_size(public.admin_applications_cursor_v3(200,NULL,NULL,'next',NULL)));""")
    output["payload_bytes"] = payloads
    output["payload_gate"] = all(value < 2 * 1024 * 1024 for value in payloads.values())
    output["executed_matrix_cells"] = len(output["scenarios"])
    output["matrix_complete"] = output["executed_matrix_cells"] == 66
    output["pass"] = (
        cardinalities == {
            "users": 100200, "applications": 5000000,
            "swipes": 5000000, "analytics_events": 5000000,
        }
        and output["matrix_complete"] and output["payload_gate"] and not failures
    )
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "pass": output["pass"], "cells": output["executed_matrix_cells"],
        "failures": failures, "payload_bytes": payloads,
    }, indent=2))
    return 0 if output["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
