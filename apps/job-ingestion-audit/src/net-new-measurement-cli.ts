import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildNetNewMeasurement,
  type NetNewMeasurementInput,
} from "./net-new-measurement";

function parseArgs(argv: string[]): { input: string; output: string } {
  const parsed = {
    input: "artifacts/job-ingestion/g016-net-new-measurement-input.json",
    output: "artifacts/job-ingestion/g016-net-new-measurement.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--input" && argument !== "--output") {
      throw new Error(`unsupported argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
    if (argument === "--input") parsed.input = value;
    if (argument === "--output") parsed.output = value;
    index += 1;
  }
  return parsed;
}

const root = resolve(import.meta.dir, "../../..");
const args = parseArgs(Bun.argv.slice(2));
const input = JSON.parse(
  await readFile(resolve(root, args.input), "utf8"),
) as NetNewMeasurementInput;
const report = buildNetNewMeasurement(input);
const output = resolve(root, args.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status,
  incrementalNetNew: report.uplift.incrementalNetNew,
  incrementalAutoApplicable: report.uplift.incrementalAutoApplicable,
  output: args.output,
  digest: report.digest,
}));
