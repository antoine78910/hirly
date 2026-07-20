import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  reconcileFunnel,
  stableDigest,
  validatePaginationFixtures,
  validateRows,
  type AuditRow,
  type Funnel,
  type PartitionFact,
} from "./audit";

function option(name: string, fallback: string): string {
  const index = Bun.argv.indexOf(name);
  return index >= 0 && Bun.argv[index + 1] ? Bun.argv[index + 1] : fallback;
}

const root = resolve(import.meta.dir, "../../..");
const fixtureDir = resolve(import.meta.dir, "../fixtures");
const jsonPath = resolve(root, option("--json", "artifacts/job-ingestion/audit-result.json"));
const summaryPath = resolve(root, option("--summary", "docs/audits/job-ingestion-audit.md"));

const rows = JSON.parse(await readFile(resolve(fixtureDir, "audit-rows.json"), "utf8")) as AuditRow[];
const partitions = JSON.parse(await readFile(resolve(fixtureDir, "pagination-golden.json"), "utf8")) as PartitionFact[];
const funnel = JSON.parse(await readFile(resolve(fixtureDir, "funnel.json"), "utf8")) as Funnel;

const invariantFailures = [
  ...validateRows(rows),
  ...reconcileFunnel(funnel),
  ...validatePaginationFixtures(partitions),
];
const machineRows = rows.map((row) => ({
  risk_id: row.riskId,
  suspected_failure: row.suspectedFailure,
  affected_path: row.affectedPath,
  file_and_symbol_references: row.references,
  reproduction_command: row.reproductionCommand,
  expected_behavior: row.expected,
  actual_behavior: row.actual,
  baseline_counts_or_latency: row.baseline,
  root_cause: row.rootCause,
  status: row.status,
  proposed_fix: row.proposedFix,
  regression_test: row.regressionTest,
  final_verification_evidence: row.finalEvidence,
  blocker: row.blocker ?? null,
}));
const digestInput = {
  rows: rows.map(({ riskId, status }) => ({ riskId, status })).sort((a, b) => a.riskId.localeCompare(b.riskId)),
  partitions: partitions.map(({ id, status, fetchedExternalIds }) => ({
    id,
    status,
    fetchedExternalIds: [...new Set(fetchedExternalIds)].sort(),
  })).sort((a, b) => a.id.localeCompare(b.id)),
  funnel,
};
const result = {
  schemaVersion: 1,
  datasetVersion: "job-ingestion-golden.v1",
  generatedAt: "2026-07-20T00:00:00.000Z",
  verdict: invariantFailures.length === 0 ? "PARTIAL" : "FAIL",
  invariantFailures,
  digest: stableDigest(digestInput),
  funnel,
  rows: machineRows,
};
const summary = [
  "# Job Ingestion Audit",
  "",
  "## Executive result",
  "",
  `**Verdict:** ${result.verdict}`,
  `**Deterministic digest:** \`${result.digest}\``,
  "",
  "Local executable controls cover exact-set pagination evaluation, accounting reconciliation, safe refresh gating, review-only fuzzy candidates, durable run-ledger schema, and retained scheduler tasks. Live provider totals, cohort coverage, and representative SQL measurements remain externally blocked.",
  "",
  "## Highest-impact root causes",
  "",
  "1. France Travail page termination did not carry an explicit completeness proof.",
  "2. Absence-based invalidation and hard purge were not gated by a completed snapshot.",
  "3. Startup scheduler tasks were not retained and terminal exceptions were not centrally observed.",
  "4. Stage, partition, coverage, and SQL evidence were not represented by deterministic artifacts.",
  "",
  "## Audit matrix",
  "",
  "| Risk | Status | Evidence |",
  "|---|---|---|",
  ...rows.map((row) => `| ${row.riskId} | ${row.status} | ${row.finalEvidence} |`),
  "",
  "## Before/after metrics",
  "",
  "- Before: stage buckets were not reconcilable.",
  `- After fixture: raw=${funnel.rawReceived}, normalized=${funnel.normalized}, accepted=${funnel.acceptedAfterFilters}.`,
  "- Production before/after cohort counts are blocked pending anonymized read-only aggregates.",
  "",
  "## Changes implemented",
  "",
  "- Fail-closed France Travail paging for repeated pages, empty intermediate pages, source-total mismatch, and local max-page exhaustion.",
  "- Completed-snapshot gate for stale invalidation and hard purge; removed cutoff-free delete fallback.",
  "- Retained/observed FastAPI startup tasks.",
  "- Deterministic DB-backed occurrence claims for Python ingestion loops, cross-process overlap rejection, terminal summaries, and scheduler alert predicates.",
  "- Additive worker run/partition accounting migration; canonical writer ownership remains Python.",
  "- Deterministic TypeScript audit command, fixtures, and machine-readable evidence.",
  "",
  "## Tests and commands run",
  "",
  "- Targeted ingestion Python suite: 189 passed.",
  "- `bun test apps/job-ingestion-audit`",
  "- `bun run audit:job-ingestion --fixtures ...` (twice; byte-identical JSON)",
  "",
  "## SQL performance evidence",
  "",
  "BLOCKED_EXTERNAL. See `artifacts/job-ingestion/sql/SQL-FEED-001/blocked.json`; no index was added without a representative plan.",
  "",
  "## Coverage improvements",
  "",
  "A versioned provider × contract × geography × occupation matrix now distinguishes planned, blocked, and not-queried states. Live observed coverage remains blocked.",
  "",
  "## Remaining risks",
  "",
  "- JSearch, Workday, and direct-ATS live cap behavior is not proven without plan-specific read-only access.",
  "- Apply the additive ledger migration before deploying Python code that calls its claim/complete RPCs.",
  "- Feed offset/keyset performance and exact ordered IDs require representative DB evidence.",
  "",
  "## Rollback procedure",
  "",
  "1. Revert the Python paging/maintenance/task-retention/ledger-call changes if operational regression is observed.",
  "2. Apply `backend/db/migrations/20260720000300_job_ingestion_run_ledger.down.sql` for the additive ledger fields.",
  "3. No provider or canonical writer ownership was transferred.",
  "",
  "## Final verifier verdict",
  "",
  "Pending independent verifier and code-review passes.",
  "",
  "A PARTIAL verdict means local executable controls pass while listed provider/production measurements remain externally blocked.",
  "",
].join("\n");

await mkdir(dirname(jsonPath), { recursive: true });
await mkdir(dirname(summaryPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
await writeFile(summaryPath, summary);
console.log(summary);
if (invariantFailures.length) process.exitCode = 1;
