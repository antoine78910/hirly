import { readFile } from "node:fs/promises";
import { buildTrialScorecard } from "./trial-scorecard";

const args = process.argv.slice(2);
const valueAfter = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const baselinePath = valueAfter("--baseline");
const snapshotsPath = valueAfter("--snapshots");
if (!baselinePath || !snapshotsPath) {
  console.error("Usage: bun run trial:scorecard --baseline <baseline.json> --snapshots <snapshots.json>");
  process.exit(2);
}

try {
  const [baseline, snapshots] = await Promise.all([
    readFile(baselinePath, "utf8").then(JSON.parse),
    readFile(snapshotsPath, "utf8").then(JSON.parse),
  ]);
  console.log(JSON.stringify(buildTrialScorecard(baseline, snapshots), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
