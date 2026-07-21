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
    expect(sql).toContain("if v_extension_schema <> 'extensions' then");
    expect(sql).toContain("errcode = '0a000'");
    expect(sql).toContain("errcode = '42723'");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = pg_catalog");
    expect(sql).toContain("public.digest compatibility wrappers already exist; refusing partial creation");
    expect(sql.match(/create function public\.digest/g)).toHaveLength(2);
    expect(sql).not.toContain("create or replace function");
    expect(sql).not.toContain("alter extension");
  });

  test("marks only created wrappers and removes only exact marker-owned signatures", () => {
    const sql = compact(down);
    expect(up.match(/hirly:pgcrypto-schema-compatibility:20260721001950/g))
      .toHaveLength(3);
    expect(down.match(/hirly:pgcrypto-schema-compatibility:20260721001950/g))
      .toHaveLength(1);
    expect(sql).toContain("v_text_wrapper");
    expect(sql).toContain("v_bytea_wrapper");
    expect(sql).toContain("is distinct from v_marker");
    expect(sql).toContain("partially present; refusing down migration");
    expect(sql).toContain("not marker-owned; refusing down migration");
    expect(sql).toContain("drop function public.digest(bytea, text)");
    expect(sql).toContain("drop function public.digest(text, text)");
    expect(sql).not.toContain("drop extension");
    expect(sql).not.toContain("alter extension");
  });
});
