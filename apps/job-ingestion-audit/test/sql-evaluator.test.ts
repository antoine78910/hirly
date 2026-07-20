import { describe, expect, test } from "bun:test";
import { assertReadOnlySelect, summarizeSamples } from "../src/sql-evaluator";

describe("read-only SQL evaluator", () => {
  test("accepts SELECT and rejects mutations", () => {
    expect(() => assertReadOnlySelect("SELECT job_id FROM jobs")).not.toThrow();
    expect(() => assertReadOnlySelect("UPDATE jobs SET title = 'x'")).toThrow();
    expect(() => assertReadOnlySelect("SELECT 1; DELETE FROM jobs")).toThrow();
  });

  test("requires and summarizes exactly five samples", () => {
    expect(summarizeSamples([5, 1, 3, 2, 4])).toEqual({
      minMs: 1, maxMs: 5, meanMs: 3, p50Ms: 3, p95Ms: 5,
    });
    expect(() => summarizeSamples([1])).toThrow();
  });
});
