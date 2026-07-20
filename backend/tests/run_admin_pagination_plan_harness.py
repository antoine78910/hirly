#!/usr/bin/env python3
"""Run transparent and end-to-end admin pagination plan probes."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import statistics
import subprocess
from typing import Any


ROOT = Path(__file__).parents[1]
MIGRATION = ROOT / "db/migrations/20260720001800_admin_table_server_pagination.sql"
FILTERS = [
    None,
    "action_required",
    "blocked",
    "blocked_captcha",
    "prepare_failed",
    "prepared",
    "ready",
    "submitted",
    "failed",
    "manual_review_needed",
    "manual_in_progress",
    "manually_submitted",
    "manual_blocked",
    "needs_user_input",
    "offer_expired",
]


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def function_body(sql: str, name: str) -> str:
    pattern = re.compile(
        rf"CREATE OR REPLACE FUNCTION public\.{re.escape(name)}\("
        rf".*?\nRETURNS jsonb.*?\nAS \$\$\n(.*?)\n\$\$;",
        re.DOTALL,
    )
    match = pattern.search(sql)
    if not match:
        raise RuntimeError(f"Unable to extract {name} from migration")
    return match.group(1).strip().rstrip(";")


def bind_body(body: str, parameters: dict[str, Any]) -> str:
    bound = body
    for name in sorted(parameters, key=len, reverse=True):
        bound = re.sub(rf"\b{re.escape(name)}\b", sql_literal(parameters[name]), bound)
    return bound


def psql_json(database_url: str, statement: str, timeout: int = 120) -> Any:
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", database_url],
        input=statement,
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return json.loads(result.stdout.strip())


def explain(database_url: str, query: str) -> dict[str, Any]:
    payload = psql_json(
        database_url,
        "SET statement_timeout='30s';\n"
        f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {query};",
    )
    return payload[0]


def nodes(plan: dict[str, Any]):
    yield plan
    for child in plan.get("Plans", []):
        yield from nodes(child)


def summarize_plan(explain_payload: dict[str, Any]) -> dict[str, Any]:
    root = explain_payload["Plan"]
    plan_nodes = list(nodes(root))
    relation_visits: dict[str, float] = {}
    for node in plan_nodes:
        relation = node.get("Relation Name")
        if relation:
            relation_visits[relation] = relation_visits.get(relation, 0) + (
                float(node.get("Actual Rows", 0)) * float(node.get("Actual Loops", 0))
            )
    disk_sorts = [
        node.get("Sort Method")
        for node in plan_nodes
        if "external" in str(node.get("Sort Method", "")).casefold()
        or "disk" in str(node.get("Sort Space Type", "")).casefold()
    ]
    return {
        "execution_ms": explain_payload.get("Execution Time"),
        "planning_ms": explain_payload.get("Planning Time"),
        "shared_blocks": int(root.get("Shared Hit Blocks", 0))
        + int(root.get("Shared Read Blocks", 0)),
        "temp_blocks": int(root.get("Temp Read Blocks", 0))
        + int(root.get("Temp Written Blocks", 0)),
        "disk_sorts": disk_sorts,
        "subplans": sum(
            1 for node in plan_nodes if node.get("Parent Relationship") == "SubPlan"
        ),
        "relation_visits": relation_visits,
        "node_types": sorted({str(node.get("Node Type")) for node in plan_nodes}),
        "plan": explain_payload,
    }


def scenarios():
    offsets = (("first", 0, "common"), ("common", 10000, "common"), ("max", 100000, "max"))
    user_scopes = (
        ("unfiltered", None, False),
        ("paying", None, True),
        ("selective", "selective-user", False),
        ("broad", "scale candidate", False),
    )
    for scope, query, paying_only in user_scopes:
        for offset_label, offset, tier in offsets:
            yield f"users_{scope}_{offset_label}", "admin_users_page_v2", {
                "p_limit": 200,
                "p_offset": offset,
                "p_q": query,
                "p_paying_only": paying_only,
            }, tier
    for scope, query in (
        ("unfiltered", None),
        ("selective", "selective-user"),
        ("broad", "scale candidate"),
    ):
        for offset_label, offset, tier in offsets:
            yield f"analytics_{scope}_{offset_label}", "admin_user_analytics_page_v1", {
                "p_limit": 200, "p_offset": offset, "p_q": query,
            }, tier
    for status_filter in FILTERS:
        label = status_filter or "all"
        for offset_label, offset, tier in offsets:
            yield f"applications_{label}_{offset_label}", "admin_applications_page_v2", {
                "p_limit": 200, "p_offset": offset, "p_filter": status_filter,
            }, tier


def function_call(name: str, parameters: dict[str, Any]) -> str:
    order = {
        "admin_users_page_v2": ["p_limit", "p_offset", "p_q", "p_paying_only"],
        "admin_user_analytics_page_v1": ["p_limit", "p_offset", "p_q"],
        "admin_applications_page_v2": ["p_limit", "p_offset", "p_filter"],
    }[name]
    arguments = ", ".join(sql_literal(parameters[key]) for key in order)
    return f"SELECT public.{name}({arguments})"


def percentile_95(values: list[float]) -> float:
    if len(values) == 1:
        return values[0]
    return statistics.quantiles(values, n=100, method="inclusive")[94]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--warmups", type=int, default=5)
    parser.add_argument("--warm-runs", type=int, default=20)
    parser.add_argument("--scenario-regex")
    args = parser.parse_args()

    migration_sql = MIGRATION.read_text()
    bodies = {
        name: function_body(migration_sql, name)
        for name in (
            "admin_users_page_v2",
            "admin_user_analytics_page_v1",
            "admin_applications_page_v2",
        )
    }
    cardinalities = psql_json(
        args.database_url,
        """SELECT json_build_object(
          'users',(SELECT count(*) FROM public.users),
          'applications',(SELECT count(*) FROM public.applications),
          'swipes',(SELECT count(*) FROM public.swipes),
          'analytics_events',(SELECT count(*) FROM public.analytics_events)
        );""",
    )
    minimums = {
        "users": 100200,
        "applications": 5000000,
        "swipes": 5000000,
        "analytics_events": 5000000,
    }
    results: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cardinalities": cardinalities,
        "minimums": minimums,
        "cardinality_gate": all(cardinalities[key] >= value for key, value in minimums.items()),
        "budgets": {
            "warm_common_ms": 1500,
            "warm_max_ms": 2500,
            "shared_blocks": 150000,
            "temp_blocks": 0,
            "list_payload_bytes": 2 * 1024 * 1024,
            "aggregate_payload_bytes": 512 * 1024,
        },
        "expected_matrix_cells": 66,
        "scenarios": {},
    }

    failures = []
    selected_scenarios = [
        scenario for scenario in scenarios()
        if not args.scenario_regex or re.search(args.scenario_regex, scenario[0])
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for label, name, parameters, tier in selected_scenarios:
        item: dict[str, Any] = {"function": name, "parameters": parameters, "tier": tier}
        try:
            transparent_query = bind_body(bodies[name], parameters)
            item["transparent"] = summarize_plan(explain(args.database_url, transparent_query))
            cold = summarize_plan(explain(args.database_url, function_call(name, parameters)))
            for _ in range(max(0, args.warmups)):
                explain(args.database_url, function_call(name, parameters))
            opaque_runs = [
                summarize_plan(explain(args.database_url, function_call(name, parameters)))
                for _ in range(max(1, args.warm_runs))
            ]
            timings = [float(run["execution_ms"]) for run in opaque_runs]
            item["end_to_end"] = {
                "execution_ms": timings,
                "cold_ms": cold["execution_ms"],
                "warm_p95_ms": percentile_95(timings),
                "shared_blocks_max": max(run["shared_blocks"] for run in opaque_runs),
                "temp_blocks_max": max(run["temp_blocks"] for run in opaque_runs),
            }
            latency_budget = 2500 if tier == "max" else 1500
            fact_visit_gate = all(
                item["transparent"]["relation_visits"].get(relation, 0)
                <= cardinalities[cardinality_key] * 1.5 + 10000
                for relation, cardinality_key in (
                    ("applications", "applications"),
                    ("swipes", "swipes"),
                    ("analytics_events", "analytics_events"),
                )
            )
            item["fact_visit_gate"] = fact_visit_gate
            item["pass"] = (
                item["end_to_end"]["warm_p95_ms"] <= latency_budget
                and float(item["end_to_end"]["cold_ms"]) <= 4000
                and item["end_to_end"]["shared_blocks_max"] <= 150000
                and item["end_to_end"]["temp_blocks_max"] == 0
                and not item["transparent"]["disk_sorts"]
                and item["transparent"]["subplans"] == 0
                and fact_visit_gate
            )
        except Exception as exc:  # evidence harness must retain every failure
            item["pass"] = False
            item["error"] = str(exc)
        if not item["pass"]:
            failures.append(label)
        results["scenarios"][label] = item
        results["failed_scenarios"] = failures
        results["executed_matrix_cells"] = len(results["scenarios"])
        results["matrix_complete"] = len(results["scenarios"]) == 66
        args.output.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n")

    try:
        payloads = psql_json(
            args.database_url,
            """SET statement_timeout='30s';
            WITH payloads AS MATERIALIZED (
              SELECT
                public.admin_users_page_v2(200,0,NULL,false) AS users,
                public.admin_user_analytics_page_v1(200,0,NULL) AS analytics,
                public.admin_applications_page_v2(200,0,NULL) AS applications
            )
            SELECT json_build_object(
              'users_list',pg_column_size(users),
              'users_aggregate',pg_column_size(users-'users'),
              'analytics_list',pg_column_size(analytics),
              'analytics_aggregate',pg_column_size(analytics-'users'),
              'applications_list',pg_column_size(applications),
              'applications_aggregate',pg_column_size(
                applications-'applications'
              )
            ) FROM payloads;""",
            timeout=60,
        )
        results["payload_bytes"] = payloads
        results["payload_gate"] = (
            all(payloads[key] < 2 * 1024 * 1024 for key in (
                "users_list", "analytics_list", "applications_list",
            ))
            and all(payloads[key] < 512 * 1024 for key in (
                "users_aggregate", "analytics_aggregate", "applications_aggregate",
            ))
        )
    except Exception as exc:
        results["payload_gate"] = False
        results["payload_error"] = str(exc)
    results["failed_scenarios"] = failures
    results["pass"] = (
        results["cardinality_gate"]
        and results["payload_gate"]
        and results["matrix_complete"]
        and not failures
    )
    args.output.write_text(json.dumps(results, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "pass": results["pass"],
        "cardinalities": cardinalities,
        "payload_gate": results["payload_gate"],
        "failed_scenarios": failures,
        "output": str(args.output),
    }, indent=2))
    return 0 if results["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
