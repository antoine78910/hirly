import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  freezeFranceTravailCensusManifest,
  type FranceTravailCensusManifest,
  type FranceTravailCensusManifestInput,
} from "./audit";
import {
  ExternalDependencyBlockedError,
  runFranceTravailLiveCensus,
} from "./france-travail-census";

function parseArgs(argv: string[]): {
  manifest: string;
  output: string;
  endpoint?: string;
} {
  const parsed = {
    manifest: "apps/job-ingestion-audit/fixtures/france-travail-census-manifest.json",
    output: "artifacts/job-ingestion/france-travail-census.json",
    endpoint: undefined as string | undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--manifest" && argument !== "--output" && argument !== "--endpoint") {
      throw new Error(`unsupported argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
    if (argument === "--manifest") parsed.manifest = value;
    if (argument === "--output") parsed.output = value;
    if (argument === "--endpoint") parsed.endpoint = value;
    index += 1;
  }
  return parsed;
}

const root = resolve(import.meta.dir, "../../..");
const args = parseArgs(Bun.argv.slice(2));
const manifestValue = JSON.parse(
  await readFile(resolve(root, args.manifest), "utf8"),
) as FranceTravailCensusManifestInput | FranceTravailCensusManifest;
const manifest = "manifestDigest" in manifestValue
  ? manifestValue
  : freezeFranceTravailCensusManifest(manifestValue);
const outputPath = resolve(root, args.output);

try {
  const result = await runFranceTravailLiveCensus(manifest, {
    accessToken: Bun.env.FRANCE_TRAVAIL_ACCESS_TOKEN,
    endpoint: args.endpoint,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    status: result.partitions.every((partition) => partition.status === "complete")
      ? "COMPLETE"
      : "PARTIAL",
    manifestDigest: result.manifestDigest,
    output: args.output,
    partitions: result.partitions.length,
  }));
} catch (error) {
  if (error instanceof ExternalDependencyBlockedError) {
    console.error(JSON.stringify({
      status: "BLOCKED_EXTERNAL",
      reason: error.message,
      unblockProcedure:
        "export FRANCE_TRAVAIL_ACCESS_TOKEN for the official API, then rerun the census command",
    }));
    process.exitCode = 2;
  } else {
    throw error;
  }
}
