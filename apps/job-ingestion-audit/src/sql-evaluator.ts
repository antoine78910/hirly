import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

export const FEED_QUERY = `
SELECT job_id
FROM public.jobs
WHERE validation_status IS DISTINCT FROM 'invalid'
  AND coalesce(last_seen_at, imported_at, posted_at) >= now() - interval '30 days'
ORDER BY posted_at DESC NULLS LAST, job_id DESC
LIMIT 100
`.trim();

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
        const rows = await tx.unsafe<{ job_id: string }[]>(query);
        resultDigests.push(createHash("sha256")
          .update(JSON.stringify(rows.map((row) => row.job_id)))
          .digest("hex"));
      }
      if (new Set(resultDigests).size !== 1) {
        throw new Error("feed result ID digest changed across evaluator samples");
      }
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        transactionMode: "read only",
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
