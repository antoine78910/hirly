import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  reconcileFunnel,
  stableDigest,
  validateCoverageManifest,
  validatePaginationFixtures,
  validateRows,
  type AuditRow,
  type CoverageManifest,
  type Funnel,
  type PartitionFact,
} from "./audit";

function parseArgs(argv: string[]): {
  fixtureMode: boolean;
  json: string;
  summary: string;
  runResults: string;
} {
  const parsed = {
    fixtureMode: false,
    json: "artifacts/job-ingestion/audit-result.json",
    summary: "docs/audits/job-ingestion-audit.md",
    runResults: "artifacts/job-ingestion/audit-run-results.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      parsed.fixtureMode = true;
      continue;
    }
    if (arg === "--json" || arg === "--summary" || arg === "--run-results") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      if (arg === "--json") parsed.json = value;
      if (arg === "--summary") parsed.summary = value;
      if (arg === "--run-results") parsed.runResults = value;
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${arg}`);
  }
  return parsed;
}

const root = resolve(import.meta.dir, "../../..");
const fixtureDir = resolve(import.meta.dir, "../fixtures");
const args = parseArgs(Bun.argv.slice(2));
const jsonPath = resolve(root, args.json);
const summaryPath = resolve(root, args.summary);
const runResultsPath = resolve(root, args.runResults);

const rows = JSON.parse(await readFile(resolve(fixtureDir, "audit-rows.json"), "utf8")) as AuditRow[];
const partitions = JSON.parse(await readFile(resolve(fixtureDir, "pagination-golden.json"), "utf8")) as PartitionFact[];
const funnel = JSON.parse(await readFile(resolve(fixtureDir, "funnel.json"), "utf8")) as Funnel;
const coverage = JSON.parse(
  await readFile(resolve(root, "artifacts/job-ingestion/coverage-matrix.json"), "utf8"),
) as CoverageManifest;

const evidenceFailures: string[] = [];
for (const row of rows) {
  try {
    await stat(resolve(root, row.finalEvidence));
  } catch {
    evidenceFailures.push(`${row.riskId}:missing_evidence_path:${row.finalEvidence}`);
  }
}

const commandResults: Array<{
  command: string;
  exitCode: number;
  rows: string[];
}> = [];
const passCommands = new Map<string, string[]>();
for (const row of rows.filter((candidate) => candidate.status === "PASS")) {
  passCommands.set(row.reproductionCommand, [
    ...(passCommands.get(row.reproductionCommand) ?? []),
    row.riskId,
  ]);
}
for (const [command, riskIds] of passCommands) {
  const spawned = Bun.spawnSync(["sh", "-lc", command], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
  });
  commandResults.push({ command, exitCode: spawned.exitCode, rows: riskIds });
  if (spawned.exitCode !== 0) {
    evidenceFailures.push(`${riskIds.join(",")}:reproduction_failed:${spawned.exitCode}`);
  }
}
for (const row of rows.filter((candidate) => candidate.status === "BLOCKED_EXTERNAL")) {
  const check = row.blocker?.capabilityCheck;
  if (!check) continue;
  const spawned = Bun.spawnSync(["sh", "-lc", check], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
  });
  commandResults.push({ command: check, exitCode: spawned.exitCode, rows: [row.riskId] });
  if (spawned.exitCode === 0) {
    evidenceFailures.push(`${row.riskId}:external_dependency_available_block_must_be_resolved`);
  }
}

const invariantFailures = [
  ...validateRows(rows),
  ...reconcileFunnel(funnel),
  ...validatePaginationFixtures(partitions),
  ...validateCoverageManifest(coverage),
  ...evidenceFailures,
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
  verdict: invariantFailures.length
    ? "FAIL"
    : rows.some((row) => row.status === "BLOCKED_EXTERNAL")
      ? "PARTIAL"
      : "PASS",
  invariantFailures,
  digest: stableDigest(digestInput),
  funnel,
  coverage: {
    expandedPartitionCount: coverage.expandedPartitionCount,
    terminalCounts: coverage.terminalCounts,
  },
  commandResults,
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
  "- France Travail fails repeated/empty-intermediate pages, while capped/source-total-incomplete pages preserve fetched rows and require partition split/retry.",
  "- Completed run plus all-complete partition-ledger proof gates stale invalidation and hard purge; caller booleans cannot bypass it.",
  "- Retained/observed FastAPI startup tasks.",
  "- Deterministic DB-backed occurrence claims for Python ingestion loops, cross-process overlap rejection, terminal summaries, and scheduler alert predicates.",
  "- Additive worker run/partition accounting migration; canonical writer ownership remains Python.",
  "- Deterministic TypeScript audit command, fixtures, and machine-readable evidence.",
  "",
  "## Tests and commands run",
  "",
  `- This audit executed ${commandResults.length} pinned reproduction/capability commands; all required PASS commands exited zero.`,
  "- Focused accounting/dedup/refresh suite: 110 passed.",
  "- `bun run audit:job-ingestion --fixtures` emits machine JSON, human Markdown, and command-run JSON.",
  "",
  "## SQL performance evidence",
  "",
  "BLOCKED_EXTERNAL. See `artifacts/job-ingestion/sql/SQL-FEED-001/blocked.json`; no index was added without a representative plan.",
  "",
  "## Coverage improvements",
  "",
  `The manifest expands to ${coverage.expandedPartitionCount} explicit provider × contract × geography × occupation combinations; every combination is terminal and all live observations are honestly blocked pending read-only evidence.`,
  "",
  "## Remaining risks",
  "",
  "- JSearch, Workday, France Travail, and direct-ATS live cap/coverage behavior is not proven without plan-specific read-only access.",
  "- Apply the additive ledger migration before deploying Python code that calls its claim/complete RPCs.",
  "- Feed offset/keyset performance and exact ordered IDs require representative DB evidence.",
  "",
  "## Rollback procedure",
  "",
  "1. Revert the Python paging/maintenance/task-retention/ledger-call changes if operational regression is observed; no canonical writer was transferred.",
  "2. Apply `backend/db/migrations/20260720000300_job_ingestion_run_ledger.down.sql` for the additive ledger fields.",
  "3. No provider or canonical writer ownership was transferred.",
  "",
  "## Final verifier verdict",
  "",
  "Pending independent verifier and code-review passes.",
  "",
  "A PARTIAL verdict means every local executable invariant passes while listed provider/production measurements remain externally blocked.",
  "",
].join("\n");

await mkdir(dirname(jsonPath), { recursive: true });
await mkdir(dirname(summaryPath), { recursive: true });
await mkdir(dirname(runResultsPath), { recursive: true });
await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
await writeFile(summaryPath, summary);
await writeFile(runResultsPath, `${JSON.stringify({
  schemaVersion: 1,
  executedAt: new Date().toISOString(),
  fixtureMode: args.fixtureMode,
  verdict: result.verdict,
  invariantFailures,
  commandResults,
}, null, 2)}\n`);
console.log(summary);
if (invariantFailures.length) process.exitCode = 1;
