import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { provisionSourceTrial } from "./source-trial-provisioning";

function parseArgs(argv: string[]): {
  input: string;
  policyEvidence: string;
  sqlOutput: string;
  manifestOutput: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !["--input", "--policy-evidence", "--sql-output", "--manifest-output"].includes(name ?? "") ||
      !value ||
      value.startsWith("--") ||
      values.has(name!)
    ) {
      throw new Error(
        "usage: source-trial:provision --input <json> --policy-evidence <reviewed-json> --sql-output <sql> --manifest-output <json>",
      );
    }
    values.set(name!, value);
  }
  const input = values.get("--input");
  const policyEvidence = values.get("--policy-evidence");
  const sqlOutput = values.get("--sql-output");
  const manifestOutput = values.get("--manifest-output");
  if (!input || !policyEvidence || !sqlOutput || !manifestOutput) {
    throw new Error(
      "source-trial:provision requires input, policy evidence, SQL output and manifest output",
    );
  }
  return { input, policyEvidence, sqlOutput, manifestOutput };
}

async function writeNew(path: string, value: string): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, value, { flag: "wx" });
}

const args = parseArgs(Bun.argv.slice(2));
const result = provisionSourceTrial(
  JSON.parse(await readFile(resolve(args.input), "utf8")),
  JSON.parse(await readFile(resolve(args.policyEvidence), "utf8")),
);
await writeNew(args.sqlOutput, result.sql);
await writeNew(args.manifestOutput, `${JSON.stringify(result.manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    status: "REVIEW_REQUIRED",
    sqlOutput: args.sqlOutput,
    manifestOutput: args.manifestOutput,
    digest: result.digest,
    canonicalWrites: false,
    sourceActivationChanges: false,
    databaseCalls: 0,
  }),
);
