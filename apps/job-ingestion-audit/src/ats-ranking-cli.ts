import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  rankAtsCandidates,
  type AtsDeliveryCost,
  type AtsHostInventoryRow,
  type AtsPaidImpactRow,
  type AtsPolicyRow,
  type AtsRequestCostRow,
} from "./ats-ranking";

interface AtsRankingInput {
  status: "COMPLETE" | "BLOCKED_EXTERNAL";
  blockerReason?: string;
  sampleEvidence?: boolean;
  hostInventory: AtsHostInventoryRow[];
  paidImpact: AtsPaidImpactRow[];
  requestCosts: AtsRequestCostRow[];
  policy: AtsPolicyRow[];
  deliveryCosts: AtsDeliveryCost[];
}

function parseArgs(argv: string[]): { input: string; output: string } {
  const parsed = {
    input: "apps/job-ingestion-audit/fixtures/ats-ranking-input.json",
    output: "artifacts/job-ingestion/ats-ranking.json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--input" && argument !== "--output") {
      throw new Error(`unsupported argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
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
) as AtsRankingInput;
const report = rankAtsCandidates(input);
const output = resolve(root, args.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    status: report.status,
    sampleEvidence: report.sampleEvidence,
    connectorChoice: report.connectorChoice,
    candidates: report.ranking.length,
    output: args.output,
  }),
);
