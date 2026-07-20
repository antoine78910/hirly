import { createDatabase } from "@hirly/db";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectLiveJobSupplyReport } from "./live-census";

const args = new Set(Bun.argv.slice(2));
const persist = args.has("--persist-manifest");
const outputArgument = Bun.argv[Bun.argv.indexOf("--output") + 1];
const output = outputArgument && !outputArgument.startsWith("--")
  ? outputArgument
  : "artifacts/job-ingestion/france-travail-census.json";
const databaseUrl = Bun.env.JOBS_DATABASE_URL;
if (!databaseUrl) throw new Error("JOBS_DATABASE_URL is required for the live census");

const sql = createDatabase(databaseUrl, { max: 2 });
try {
  const report = await collectLiveJobSupplyReport(sql, new Date().toISOString(), persist);
  if (report.sourceEnablement.some((source) => (
    source.collection_enabled || source.production_enabled
  ))) {
    throw new Error("census_requires_all_career_sources_disabled");
  }
  const path = resolve(import.meta.dir, "../../..", output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    output,
    censusDigest: report.census.digest,
    terminalState: report.census.terminalState,
    persisted: persist,
  }));
} finally {
  await sql.end({ timeout: 5 });
}
