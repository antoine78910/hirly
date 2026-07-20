import { readFile, writeFile } from "node:fs/promises";
import { runBackfill } from "./runner";
import type { BackfillCheckpoint, LegacyAnalyticsRow } from "./transform";

function valueAfter(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const inputPath = valueAfter("--input");
const manifestPath = valueAfter("--manifest");
const cutoff = valueAfter("--cutoff");
const checkpointPath = valueAfter("--checkpoint");
const execute = process.argv.includes("--execute");

if (!inputPath || !manifestPath || !cutoff) {
  throw new Error(
    "usage: --input rows.json --manifest manifest.json --cutoff ISO [--checkpoint checkpoint.json] [--execute]",
  );
}
if (
  execute &&
  process.env.HIRLY_POSTHOG_BACKFILL_OPERATOR_ACK !==
    "I_ACKNOWLEDGE_THIS_CAN_MUTATE_POSTHOG"
) {
  throw new Error("execute mode requires explicit operator acknowledgement");
}
if (execute) {
  throw new Error(
    "live transport is intentionally not implicit; inject repository/transport through runBackfill after credentialed operator review",
  );
}

const rows = JSON.parse(await readFile(inputPath, "utf8")) as LegacyAnalyticsRow[];
const checkpoint = checkpointPath
  ? (JSON.parse(await readFile(checkpointPath, "utf8")) as BackfillCheckpoint)
  : null;
const manifest = await runBackfill({
  rows,
  sourceCutoffAt: cutoff,
  checkpoint,
  dryRun: true,
});
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
