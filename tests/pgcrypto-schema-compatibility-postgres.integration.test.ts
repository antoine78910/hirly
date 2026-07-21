import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createDatabase, type Database } from "../packages/db/src";

const databaseUrl = process.env.PGCRYPTO_COMPAT_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const read = (name: string): string =>
  readFileSync(new URL(`../backend/db/migrations/${name}`, import.meta.url), "utf8");
const up = read("20260721001950_pgcrypto_schema_compatibility.sql");
const down = read("20260721001950_pgcrypto_schema_compatibility.down.sql");
const marker = "hirly:pgcrypto-schema-compatibility:20260721001950";

type Topology = {
  extension_schema: string;
  text_signature: string | null;
  bytea_signature: string | null;
  text_marker: string | null;
  bytea_marker: string | null;
};

describePostgres("pgcrypto compatibility on disposable PostgreSQL", () => {
  let sql: Database;

  beforeAll(async () => {
    sql = createDatabase(databaseUrl!, { max: 1 });
    const [{ database_name }] = await sql<{ database_name: string }[]>`
      SELECT current_database() AS database_name
    `;
    if (!/(?:^|_)(?:test|disposable)(?:$|_)/i.test(database_name)) {
      throw new Error("PGCRYPTO_COMPAT_TEST_DATABASE_URL must target a disposable database");
    }
  });

  afterAll(async () => {
    await sql.unsafe(down).catch(() => undefined);
    await sql.unsafe("DROP EXTENSION IF EXISTS pgcrypto CASCADE").catch(() => undefined);
    await sql.unsafe("DROP SCHEMA IF EXISTS extensions CASCADE").catch(() => undefined);
    await sql.end({ timeout: 5 });
  });

  async function resetPgcrypto(schema: "public" | "extensions"): Promise<void> {
    await sql.unsafe(down).catch(() => undefined);
    await sql.unsafe("DROP EXTENSION IF EXISTS pgcrypto CASCADE");
    await sql.unsafe("DROP FUNCTION IF EXISTS public.digest(text, text)");
    await sql.unsafe("DROP FUNCTION IF EXISTS public.digest(bytea, text)");
    if (schema === "extensions") {
      await sql.unsafe("CREATE SCHEMA IF NOT EXISTS extensions");
    }
    await sql.unsafe(`CREATE EXTENSION pgcrypto WITH SCHEMA ${schema}`);
  }

  async function topology(): Promise<Topology> {
    const [row] = await sql<Topology[]>`
      SELECT
        namespace.nspname AS extension_schema,
        pg_catalog.to_regprocedure('public.digest(text,text)')::text AS text_signature,
        pg_catalog.to_regprocedure('public.digest(bytea,text)')::text AS bytea_signature,
        pg_catalog.obj_description(
          pg_catalog.to_regprocedure('public.digest(text,text)'), 'pg_proc'
        ) AS text_marker,
        pg_catalog.obj_description(
          pg_catalog.to_regprocedure('public.digest(bytea,text)'), 'pg_proc'
        ) AS bytea_marker
      FROM pg_catalog.pg_extension AS extension
      INNER JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = extension.extnamespace
      WHERE extension.extname = 'pgcrypto'
    `;
    return row;
  }

  async function expectStableVectors(): Promise<void> {
    const [vectors] = await sql<{
      text_ascii: string;
      bytea_ascii: string;
      text_utf8: string;
      bytea_utf8: string;
    }[]>`
      SELECT
        encode(public.digest('sprout:compat-fixture', 'sha1'), 'hex') AS text_ascii,
        encode(public.digest(convert_to('sprout:compat-fixture', 'UTF8'), 'sha1'), 'hex') AS bytea_ascii,
        encode(public.digest(E'sprout:é whitespace\\n', 'sha1'), 'hex') AS text_utf8,
        encode(public.digest(convert_to(E'sprout:é whitespace\\n', 'UTF8'), 'sha1'), 'hex') AS bytea_utf8
    `;
    expect(vectors).toEqual({
      text_ascii: "4e3094c40d768d4801a995f8bb01d7414ee05a8f",
      bytea_ascii: "4e3094c40d768d4801a995f8bb01d7414ee05a8f",
      text_utf8: "a377985acb3dcd567d534d794f9e3341abca0762",
      bytea_utf8: "a377985acb3dcd567d534d794f9e3341abca0762",
    });
  }

  test("is a no-op for public pgcrypto across repeated up/down/up", async () => {
    await resetPgcrypto("public");
    await sql.unsafe(up);
    await sql.unsafe(up);
    expect(await topology()).toEqual({
      extension_schema: "public",
      text_signature: "digest(text,text)",
      bytea_signature: "digest(bytea,text)",
      text_marker: null,
      bytea_marker: null,
    });
    await expectStableVectors();
    await sql.unsafe(down);
    await sql.unsafe(down);
    expect((await topology()).text_signature).toBe("digest(text,text)");
    await sql.unsafe(up);
    await expectStableVectors();
  });

  test("owns only missing wrappers for non-public pgcrypto across up/down/up", async () => {
    await resetPgcrypto("extensions");
    await sql.unsafe(up);
    await sql.unsafe(up);
    expect(await topology()).toEqual({
      extension_schema: "extensions",
      text_signature: "digest(text,text)",
      bytea_signature: "digest(bytea,text)",
      text_marker: marker,
      bytea_marker: marker,
    });
    await expectStableVectors();

    await sql.unsafe(down);
    await sql.unsafe(down);
    expect(await topology()).toEqual({
      extension_schema: "extensions",
      text_signature: null,
      bytea_signature: null,
      text_marker: null,
      bytea_marker: null,
    });
    const [native] = await sql<{ digest: string }[]>`
      SELECT encode(extensions.digest('sprout:compat-fixture', 'sha1'), 'hex') AS digest
    `;
    expect(native.digest).toBe("4e3094c40d768d4801a995f8bb01d7414ee05a8f");

    await sql.unsafe(up);
    await expectStableVectors();
  });

  test("preserves an unmarked pre-existing overload", async () => {
    await resetPgcrypto("extensions");
    await sql.unsafe(`
      CREATE FUNCTION public.digest(text, text)
      RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
      AS 'SELECT extensions.digest($1, $2)';
      COMMENT ON FUNCTION public.digest(text, text) IS 'fixture:foreign-owner';
    `);
    await sql.unsafe(up);
    expect(await topology()).toEqual({
      extension_schema: "extensions",
      text_signature: "digest(text,text)",
      bytea_signature: "digest(bytea,text)",
      text_marker: "fixture:foreign-owner",
      bytea_marker: marker,
    });
    await sql.unsafe(down);
    const state = await topology();
    expect(state.text_signature).toBe("digest(text,text)");
    expect(state.text_marker).toBe("fixture:foreign-owner");
    expect(state.bytea_signature).toBeNull();
  });
});

if (!databaseUrl) {
  test("pgcrypto compatibility disposable PostgreSQL suite is opt-in", () => {
    expect(databaseUrl).toBeUndefined();
  });
}
