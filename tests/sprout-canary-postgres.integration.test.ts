import { describe, expect, test } from "bun:test";

const databaseUrl = process.env.SPROUT_CANARY_TEST_DATABASE_URL;
const runIntegration = databaseUrl ? test : test.skip;

async function psql(sql: string): Promise<string> {
  if (!databaseUrl) {
    throw new Error("SPROUT_CANARY_TEST_DATABASE_URL is required");
  }
  const child = Bun.spawn(
    [
      "psql",
      databaseUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-A",
      "-t",
      "-q",
      "-c",
      sql,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return stdout.trim();
}

describe("Sprout one-page canary PostgreSQL boundary", () => {
  runIntegration("keeps migrated canary and evidence state default-off", async () => {
    expect(
      await psql(`
        SELECT concat_ws('|', canary_enabled, canary_evidence->>'status',
          canary_evidence->>'pagesCommitted', rollback_evidence->>'status')
        FROM public.career_sources
        WHERE provider = 'sprout' AND source_key = 'sprout:france';
      `),
    ).toBe("f|pending|0|pending");
  });

  runIntegration("refuses canary and production runtime reads before activation", async () => {
    expect(
      await psql(`
        WITH source AS (
          SELECT id FROM public.career_sources
          WHERE provider = 'sprout' AND source_key = 'sprout:france'
        )
        SELECT concat_ws('|',
          worker_private.career_source_runnable(source.id, 'FR', 'canary'),
          worker_private.career_source_runnable(source.id, 'FR', 'backfill'),
          worker_private.career_source_runnable(source.id, 'FR', 'incremental'),
          (SELECT count(*) FROM worker_private.get_sprout_source_runtime(source.id, 'canary')),
          (SELECT count(*) FROM worker_private.get_sprout_source_runtime(source.id, 'backfill'))
        )
        FROM source;
      `),
    ).toBe("f|f|f|0|0");
  });

  runIntegration("rejects a non-initial canary before any fenced writer lookup", async () => {
    expect(
      await psql(`
        DO $$
        BEGIN
          PERFORM worker_private.commit_sprout_source_page(
            gen_random_uuid(), gen_random_uuid(), 1, 'sprout-canary-test',
            gen_random_uuid(), gen_random_uuid(), 'FR', 'canary',
            '{"version":"sprout.offset.v1","offset":1,"pageSize":1,"observedTotal":2,"watermark":null}'::jsonb,
            '{"version":"sprout.offset.v1","offset":2,"pageSize":1,"observedTotal":2,"watermark":null}'::jsonb,
            true, '[]'::jsonb
          );
          RAISE EXCEPTION 'expected non-initial canary rejection';
        EXCEPTION
          WHEN SQLSTATE '22023' THEN NULL;
        END
        $$;
        SELECT 'rejected-without-write';
      `),
    ).toBe("rejected-without-write");
  });

  test("is opt-in outside an already migrated disposable PostgreSQL database", () => {
    if (databaseUrl) expect(databaseUrl).toMatch(/^postgres(?:ql)?:\/\//);
    else expect(databaseUrl).toBeUndefined();
  });
});
