import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { persistSourcePolicyResult } from "./source-policy-result";

function parseArgs(argv: string[]): { input: string; output: string } {
  let input: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--input" && argument !== "--output") {
      throw new Error(`unsupported argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
    if (argument === "--input") input = value;
    if (argument === "--output") output = value;
    index += 1;
  }
  if (!input || !output) {
    throw new Error("--input and --output are required");
  }
  return { input, output };
}

const root = resolve(import.meta.dir, "../../..");
const args = parseArgs(Bun.argv.slice(2));
const value = JSON.parse(await readFile(resolve(root, args.input), "utf8"));
const result = await persistSourcePolicyResult(
  resolve(root, args.output),
  value,
);
console.log(
  JSON.stringify({
    status: result.status,
    sourceKey: result.sourceKey,
    recordDigest: result.recordDigest,
    output: args.output,
  }),
);
