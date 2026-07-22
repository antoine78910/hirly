import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabase } from "@hirly/db";
import { producePaidCohortCoverage, type PaidCohortCoverageInput } from "./paid-cohort-coverage";
import { PostgresPaidCohortCoverageStore } from "./paid-cohort-coverage-store";

const inputIndex = Bun.argv.indexOf("--input");
const inputPath = inputIndex === -1 ? null : Bun.argv[inputIndex + 1];
if (!inputPath || inputPath.startsWith("--")) {
  throw new Error("usage: bun paid-cohort-coverage-cli.ts --input <cohort-manifest.json>");
}
const databaseUrl = process.env.COVERAGE_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "COVERAGE_DATABASE_URL is required; use an isolated evidence database, not the production worker credential",
  );
}

const input = JSON.parse(
  await readFile(resolve(process.cwd(), inputPath), "utf8"),
) as PaidCohortCoverageInput;
const database = createDatabase(databaseUrl, { max: 2 });
try {
  const report = await producePaidCohortCoverage(
    input,
    new PostgresPaidCohortCoverageStore(database),
  );
  // This aggregate-only report intentionally excludes user, job, group and run IDs.
  console.log(JSON.stringify(report));
} finally {
  await database.end({ timeout: 5 });
}
