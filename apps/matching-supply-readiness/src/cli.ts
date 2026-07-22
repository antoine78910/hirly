import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  INDEX_EVIDENCE_SQL,
  READINESS_SQL,
  REQUIRED_INDEXES,
  assertReadOnlySql,
  buildReadinessScorecard,
  type ReadinessManifest,
  type ReadinessRow,
} from "./index";

export async function runReadinessCli(input: {
  databaseUrl: string;
  manifestPath: string;
  outputPath?: string;
}): Promise<void> {
  assertReadOnlySql(READINESS_SQL);
  assertReadOnlySql(INDEX_EVIDENCE_SQL);
  const manifest = JSON.parse(
    await readFile(resolve(input.manifestPath), "utf8"),
  ) as ReadinessManifest;
  const sql = postgres(input.databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5 });
  try {
    const result = await sql.begin("read only", async (tx) => {
      const parameters = [
        manifest.scope.countryCode.toUpperCase(),
        manifest.scope.roleFamilyId.toLowerCase(),
        manifest.scope.radiusKm,
        manifest.scope.centerLatitude,
        manifest.scope.centerLongitude,
      ];
      const rows = await tx.unsafe<ReadinessRow[]>(READINESS_SQL, parameters);
      const indexes = await tx.unsafe<Array<{ indexname: string }>>(INDEX_EVIDENCE_SQL, [
        REQUIRED_INDEXES,
      ]);
      const plan = await tx.unsafe(`EXPLAIN (FORMAT JSON) ${READINESS_SQL}`, parameters);
      return buildReadinessScorecard(manifest, rows, {
        captured: Array.isArray(plan) && plan.length > 0,
        availableIndexes: indexes.map((row) => row.indexname),
        plan,
      });
    });
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (input.outputPath) await writeFile(resolve(input.outputPath), output);
    else process.stdout.write(output);
    if (result.decision !== "enabled") process.exitCode = 2;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.JOBS_DATABASE_URL?.trim();
  const manifestPath = process.argv[2];
  if (!databaseUrl || !manifestPath) {
    console.error("usage: JOBS_DATABASE_URL=... bun src/cli.ts <manifest.json> [output.json]");
    process.exit(2);
  }
  await runReadinessCli({ databaseUrl, manifestPath, outputPath: process.argv[3] });
}
