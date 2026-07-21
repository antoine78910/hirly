import { describe, expect, test } from "bun:test";
import {
  assertReadOnlySelect,
  buildOnlineOracleQuery,
  summarizeSamples,
} from "../src/sql-evaluator";

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

  test("builds a stable candidate-scoped canonical-group oracle query", () => {
    const query = buildOnlineOracleQuery({
      role: "Fullstack Engineer",
      countryCode: "FR",
      freshnessWindowDays: 30,
      limit: 25,
    });

    expect(query).toContain("AS canonical_group_id");
    expect(query).toContain("country_code = 'fr'");
    expect(query).toContain("LIKE '%fullstack%'");
    expect(query).toContain("LIKE '%engineer%'");
    expect(query).toContain("LIMIT 25");
    expect(() => assertReadOnlySelect(query)).not.toThrow();
  });

  test("rejects unsafe oracle input before SQL construction", () => {
    expect(() => buildOnlineOracleQuery({
      role: "Fullstack Engineer",
      countryCode: "fr'; DELETE FROM jobs; --",
      freshnessWindowDays: 30,
      limit: 25,
    })).toThrow("ISO alpha-2");
    expect(() => buildOnlineOracleQuery({
      role: "Fullstack Engineer",
      countryCode: "fr",
      freshnessWindowDays: 0,
      limit: 25,
    })).toThrow("freshnessWindowDays");
    expect(() => buildOnlineOracleQuery({
      role: "--",
      countryCode: "fr",
      freshnessWindowDays: 30,
      limit: 25,
    })).toThrow("searchable term");
  });
});
