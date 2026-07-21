import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (name: string): string =>
  readFileSync(new URL(`../backend/db/migrations/${name}`, import.meta.url), "utf8");
const up = read("20260721001950_pgcrypto_schema_compatibility.sql");
const down = read("20260721001950_pgcrypto_schema_compatibility.down.sql");
const compact = (sql: string): string =>
  sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toLowerCase();

describe("portable pgcrypto schema compatibility contract", () => {
  test("creates only absent public digest overloads for a non-public pgcrypto schema", () => {
    const sql = compact(up);
    expect(sql).toContain("create extension if not exists pgcrypto");
    expect(sql).toContain("extension.extnamespace");
    expect(sql).toContain("if v_extension_schema = 'public' then return");
    expect(sql).toContain("to_regprocedure('public.digest(text,text)') is null");
    expect(sql).toContain("to_regprocedure('public.digest(bytea,text)') is null");
    expect(sql.match(/create function public\.digest/g)).toHaveLength(2);
    expect(sql).not.toContain("create or replace function");
    expect(sql).not.toContain("security definer");
    expect(sql).not.toContain("alter extension");
  });

  test("marks only created wrappers and removes only exact marker-owned signatures", () => {
    const sql = compact(down);
    expect(up.match(/hirly:pgcrypto-schema-compatibility:20260721001950/g))
      .toHaveLength(3);
    expect(down.match(/hirly:pgcrypto-schema-compatibility:20260721001950/g))
      .toHaveLength(1);
    expect(sql).toContain("obj_description(v_function, 'pg_proc') = v_marker");
    expect(sql).toContain("drop function public.digest(bytea, text)");
    expect(sql).toContain("drop function public.digest(text, text)");
    expect(sql).not.toContain("drop extension");
    expect(sql).not.toContain("alter extension");
  });
});
