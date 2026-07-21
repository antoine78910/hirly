import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

export interface OnlineOracleQueryInput {
  role: string;
  countryCode: string;
  freshnessWindowDays: number;
  limit: number;
}

export const DEFAULT_ONLINE_ORACLE_INPUT: OnlineOracleQueryInput = {
  role: "Fullstack Engineer",
  countryCode: "fr",
  freshnessWindowDays: 30,
  limit: 100,
};

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildOnlineOracleQuery(input: OnlineOracleQueryInput): string {
  const role = input.role.trim().toLocaleLowerCase();
  const countryCode = input.countryCode.trim().toLocaleLowerCase();
  if (!role || role.length > 120) throw new Error("oracle role must contain 1-120 characters");
  if (!/^[a-z]{2}$/.test(countryCode)) throw new Error("oracle countryCode must be ISO alpha-2");
  if (!Number.isSafeInteger(input.freshnessWindowDays) || input.freshnessWindowDays < 1 || input.freshnessWindowDays > 90) {
    throw new Error("oracle freshnessWindowDays must be an integer from 1 to 90");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) {
    throw new Error("oracle limit must be an integer from 1 to 1000");
  }
  const terms = [...new Set(role.split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1))];
  if (terms.length === 0) throw new Error("oracle role must contain a searchable term");
  const rolePredicates = terms.map((term) => {
    const pattern = sqlLiteral(`%${term}%`);
    return `(lower(coalesce(normalized_title, title, '')) LIKE ${pattern})`;
  });
  return `
SELECT
  coalesce(
    nullif(data ->> 'canonical_group_id', ''),
    nullif(concat_ws(':', provider, external_id), ''),
    job_id
  ) AS canonical_group_id,
  job_id,
  applyability_tier,
  CASE
    WHEN auto_apply_supported IS TRUE THEN 'auto'
    WHEN manual_fulfillment_ready IS TRUE THEN 'manual'
    ELSE 'blocked'
  END AS fulfillment_route
FROM public.jobs
WHERE validation_status IS DISTINCT FROM 'invalid'
  AND applyability_tier IN ('A', 'B', 'C')
  AND country_code = ${sqlLiteral(countryCode)}
  AND coalesce(last_seen_at, imported_at, posted_at) >= now() - interval '${input.freshnessWindowDays} days'
  AND ${rolePredicates.join("\n  AND ")}
ORDER BY coalesce(last_seen_at, imported_at, posted_at) DESC NULLS LAST, job_id DESC
LIMIT ${input.limit}
`.trim();
}

export const FEED_QUERY = buildOnlineOracleQuery(DEFAULT_ONLINE_ORACLE_INPUT);

export function assertReadOnlySelect(query: string): void {
  const normalized = query.replace(/--.*$/gm, "").trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(normalized)) throw new Error("SQL evaluator accepts SELECT only");
  if (/\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|call)\b/i.test(normalized)) {
    throw new Error("SQL evaluator rejected a mutating token");
  }
}

export function summarizeSamples(samples: number[]): {
  minMs: number; maxMs: number; meanMs: number; p50Ms: number; p95Ms: number;
} {
  if (samples.length !== 5) throw new Error("exactly five SQL samples are required");
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    minMs: sorted[0]!,
    maxMs: sorted[4]!,
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    p50Ms: sorted[2]!,
    p95Ms: sorted[4]!,
  };
}

export async function evaluateSql(
  databaseUrl: string,
  outputPath: string,
  query = FEED_QUERY,
): Promise<void> {
  assertReadOnlySelect(query);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5 });
  try {
    const evidence = await sql.begin("read only", async (tx) => {
      const plans: unknown[] = [];
      const samples: number[] = [];
      const resultDigests: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const started = performance.now();
        const plan = await tx.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
        samples.push(performance.now() - started);
        plans.push(plan);
        const rows = await tx.unsafe<{ canonical_group_id: string }[]>(query);
        resultDigests.push(createHash("sha256")
          .update(JSON.stringify(rows.map((row) => row.canonical_group_id)))
          .digest("hex"));
      }
      if (new Set(resultDigests).size !== 1) {
        throw new Error("feed result ID digest changed across evaluator samples");
      }
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        transactionMode: "read only",
        queryDigest: createHash("sha256").update(query).digest("hex"),
        samplesMs: samples,
        distribution: summarizeSamples(samples),
        resultIdDigest: resultDigests[0],
        plans,
      };
    });
    await writeFile(resolve(outputPath), `${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const url = process.env.INGESTION_AUDIT_SQL_DATABASE_URL;
  if (!url) {
    console.error("BLOCKED_EXTERNAL: INGESTION_AUDIT_SQL_DATABASE_URL is missing");
    process.exit(2);
  }
  const output = process.argv[2] ?? "artifacts/job-ingestion/sql/SQL-FEED-001/evaluation.json";
  await evaluateSql(url, output);
}
