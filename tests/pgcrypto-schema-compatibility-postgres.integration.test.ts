import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const databaseUrl = process.env.PGCRYPTO_COMPAT_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const read = (name: string): string =>
  readFileSync(new URL(`../backend/db/migrations/${name}`, import.meta.url), "utf8");
const up = read("20260721001950_pgcrypto_schema_compatibility.sql");
const down = read("20260721001950_pgcrypto_schema_compatibility.down.sql");
const marker = "hirly:pgcrypto-schema-compatibility:20260721001950";

async function psql(statement: string): Promise<string> {
  if (!databaseUrl) throw new Error("PGCRYPTO_COMPAT_TEST_DATABASE_URL is required");
  const child = Bun.spawn([
    "psql",
    databaseUrl,
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-A",
    "-t",
    "-q",
    "-c",
    statement,
  ], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim());
  return stdout.trim();
}

async function resetPgcrypto(schema: "public" | "extensions"): Promise<void> {
  await psql(down).catch(() => undefined);
  await psql(`
    DROP EXTENSION IF EXISTS pgcrypto CASCADE;
    DROP FUNCTION IF EXISTS public.digest(text, text);
    DROP FUNCTION IF EXISTS public.digest(bytea, text);
    ${schema === "extensions" ? "CREATE SCHEMA IF NOT EXISTS extensions;" : ""}
    CREATE EXTENSION pgcrypto WITH SCHEMA ${schema};
  `);
}

async function topology(): Promise<string> {
  return psql(`
    SELECT concat_ws('|',
      namespace.nspname,
      COALESCE(pg_catalog.to_regprocedure('public.digest(text,text)')::text, ''),
      COALESCE(pg_catalog.to_regprocedure('public.digest(bytea,text)')::text, ''),
      COALESCE(pg_catalog.obj_description(
        pg_catalog.to_regprocedure('public.digest(text,text)'), 'pg_proc'
      ), ''),
      COALESCE(pg_catalog.obj_description(
        pg_catalog.to_regprocedure('public.digest(bytea,text)'), 'pg_proc'
      ), '')
    )
    FROM pg_catalog.pg_extension AS extension
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'pgcrypto';
  `);
}

async function expectStableVectors(): Promise<void> {
  expect(await psql(`
    SELECT concat_ws('|',
      encode(public.digest('sprout:compat-fixture', 'sha1'), 'hex'),
      encode(public.digest(convert_to('sprout:compat-fixture', 'UTF8'), 'sha1'), 'hex'),
      encode(public.digest(E'sprout:é whitespace\\n', 'sha1'), 'hex'),
      encode(public.digest(convert_to(E'sprout:é whitespace\\n', 'UTF8'), 'sha1'), 'hex')
    );
  `)).toBe([
    "4e3094c40d768d4801a995f8bb01d7414ee05a8f",
    "4e3094c40d768d4801a995f8bb01d7414ee05a8f",
    "a377985acb3dcd567d534d794f9e3341abca0762",
    "a377985acb3dcd567d534d794f9e3341abca0762",
  ].join("|"));
}

describePostgres("pgcrypto compatibility on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const databaseName = await psql("SELECT current_database()");
    if (!/(?:^|_)(?:test|disposable)(?:$|_)/i.test(databaseName)) {
      throw new Error("PGCRYPTO_COMPAT_TEST_DATABASE_URL must target a disposable database");
    }
  }, 20_000);

  afterAll(async () => {
    await psql(down).catch(() => undefined);
    await psql("DROP EXTENSION IF EXISTS pgcrypto CASCADE").catch(() => undefined);
    await psql("DROP SCHEMA IF EXISTS extensions CASCADE").catch(() => undefined);
  }, 20_000);

  test("is a no-op for public pgcrypto across repeated up/down/up", async () => {
    await resetPgcrypto("public");
    await psql(up);
    await psql(up);
    expect(await topology()).toBe("public|digest(text,text)|digest(bytea,text)||");
    await expectStableVectors();
    await psql(down);
    await psql(down);
    expect(await topology()).toBe("public|digest(text,text)|digest(bytea,text)||");
    await psql(up);
    await expectStableVectors();
  }, 20_000);

  test("owns only missing wrappers for non-public pgcrypto across up/down/up", async () => {
    await resetPgcrypto("extensions");
    await psql(up);
    await psql(up);
    expect(await topology()).toBe(
      `extensions|digest(text,text)|digest(bytea,text)|${marker}|${marker}`,
    );
    await expectStableVectors();

    await psql(down);
    await psql(down);
    expect(await topology()).toBe("extensions||||");
    expect(await psql(`
      SELECT encode(extensions.digest('sprout:compat-fixture', 'sha1'), 'hex')
    `)).toBe("4e3094c40d768d4801a995f8bb01d7414ee05a8f");

    await psql(up);
    await expectStableVectors();
  }, 20_000);

  test("preserves an unmarked pre-existing overload", async () => {
    await resetPgcrypto("extensions");
    await psql(`
      CREATE FUNCTION public.digest(text, text)
      RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
      AS 'SELECT extensions.digest($1, $2)';
      COMMENT ON FUNCTION public.digest(text, text) IS 'fixture:foreign-owner';
    `);
    await psql(up);
    expect(await topology()).toBe(
      `extensions|digest(text,text)|digest(bytea,text)|fixture:foreign-owner|${marker}`,
    );
    await psql(down);
    expect(await topology()).toBe(
      "extensions|digest(text,text)||fixture:foreign-owner|",
    );
  }, 20_000);
});

if (!databaseUrl) {
  test("pgcrypto compatibility disposable PostgreSQL suite is opt-in", () => {
    expect(databaseUrl).toBeUndefined();
  });
}
