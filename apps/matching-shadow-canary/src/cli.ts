import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { executeFrozenShadowCanary, type FrozenShadowCanaryInput, type InjectedBreach } from "./exercise";

const fixturePath = resolve(import.meta.dir, "../test/fixtures/paris-fullstack-shadow.json");
const defaultOutputPath = resolve(import.meta.dir, "../../../artifacts/candidate-matching/g008-shadow-canary.json");

function argument(args: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export async function runShadowCanaryCli(args = process.argv.slice(2)): Promise<void> {
  const execute = args.includes("--execute-frozen");
  const injectedBreach = (argument(args, "inject-breach") ?? "none") as InjectedBreach;
  if (!["none", "parity", "latency", "supply", "error"].includes(injectedBreach)) {
    throw new Error(`unsupported injected breach: ${injectedBreach}`);
  }
  const input = JSON.parse(await readFile(fixturePath, "utf8")) as FrozenShadowCanaryInput;
  let visibleLegacyResponses = 0;
  const evidence = executeFrozenShadowCanary(input, {
    exposeLegacy() {
      visibleLegacyResponses += 1;
    },
  }, { execute, injectedBreach });
  if (visibleLegacyResponses !== 1) throw new Error("shadow canary must expose exactly one legacy response");

  const outputPath = resolve(argument(args, "output") ?? defaultOutputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${outputPath}\n`);
  if (execute && !evidence.decision.automaticRollback && injectedBreach !== "none") process.exitCode = 2;
}

if (import.meta.main) await runShadowCanaryCli();
