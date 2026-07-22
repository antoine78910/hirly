import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildRouteReadinessReport, type RouteReadinessAggregateInput } from "./route-readiness";

const values = new Map<string, string>();
for (let index = 0; index < Bun.argv.slice(2).length; index += 2) {
  const name = Bun.argv.slice(2)[index];
  const value = Bun.argv.slice(2)[index + 1];
  if (!["--input", "--output"].includes(name ?? "") || !value) {
    throw new Error("usage: route-readiness --input <aggregate.json> --output <report.json>");
  }
  values.set(name!, value);
}
const inputPath = values.get("--input");
const outputPath = values.get("--output");
if (!inputPath || !outputPath) throw new Error("--input and --output are required");

const input = JSON.parse(
  await readFile(resolve(inputPath), "utf8"),
) as RouteReadinessAggregateInput;
const report = buildRouteReadinessReport(input);
const output = resolve(outputPath);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    status: report.status,
    runtimeReadyAutoApplicable: report.runtimeReadyAutoApplicable,
    optimisticOverclaim: report.optimisticOverclaim,
    output: outputPath,
    digest: report.digest,
  }),
);
