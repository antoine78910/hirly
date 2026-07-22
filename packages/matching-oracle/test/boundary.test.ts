import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const read = (path: string): string => readFileSync(join(packageRoot, path), "utf8");

describe("PR0 matching oracle production and supply boundaries", () => {
  test("has no production database dependency or mutation/network surface", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    const implementation = [
      read("src/oracle.ts"),
      read("src/online-matcher.ts"),
      read("src/query-plan.ts"),
      read("src/shadow-canary.ts"),
    ].join("\n");

    expect(packageJson.dependencies?.["@hirly/db"]).toBeUndefined();
    expect(implementation).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(implementation).not.toMatch(/\bfetch\s*\(|https?:\/\//i);
  });

  test("contains no hybrid generation, match-row, or fanout surface", () => {
    const implementation = [
      read("src/online-matcher.ts"),
      read("src/query-plan.ts"),
      read("src/shadow-canary.ts"),
    ].join("\n");

    expect(implementation).not.toMatch(
      /candidate_match_generations|candidate_job_matches|generation[_ -]fanout|CAS activation/i,
    );
    expect(implementation).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  test("keeps Paris supply readiness and staged peakx2 evidence as separate gates", () => {
    const benchmarkContract = read("benchmark/README.md");

    expect(benchmarkContract).toContain("does not establish Paris supply readiness");
    expect(benchmarkContract).toMatch(/`PR0-S` remains a\s+separate inventory-coverage gate/);
    expect(benchmarkContract).toContain("Before signing `ONLINE_FIRST`");
    expect(benchmarkContract).toContain("peak×2");
  });
});
