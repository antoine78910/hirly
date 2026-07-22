import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { evaluateG009RetirementGate, type G009RetirementGateInput } from "./evaluator";

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_value:${flag}`);
  return value;
}

export async function runG009RetirementGateCli(argv: string[]): Promise<void> {
  const inputPath = valueAfter(argv, "--input");
  const outputPath =
    valueAfter(argv, "--output") ?? "artifacts/candidate-matching/g009-retirement-gate.json";
  const input = inputPath
    ? (JSON.parse(await readFile(inputPath, "utf8")) as G009RetirementGateInput)
    : {};
  const evidence = evaluateG009RetirementGate(input);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
}

if (import.meta.main) await runG009RetirementGateCli(Bun.argv.slice(2));
