import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const databaseUrl = process.env.G010_TEST_DATABASE_URL;
const repoRoot = join(import.meta.dir, "..");
const runIntegration = databaseUrl ? test : test.skip;

async function psql(args: string[]): Promise<string> {
  if (!databaseUrl) throw new Error("G010_TEST_DATABASE_URL is required");
  const process = Bun.spawn(
    ["psql", databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return stdout.trim();
}

async function apply(path: string): Promise<void> {
  await psql(["-q", "-f", join(repoRoot, path)]);
}

describe("G010 real-Postgres whole-provider fencing", () => {
  runIntegration(
    "applies, rejects ABA/direct DML, writes through the Python claim, rolls back, and reapplies",
    async () => {
      await apply("backend/db/jobs_inventory_schema.sql");
      await apply(
        "backend/db/migrations/20260720000100_typescript_worker_foundation.sql",
      );
      await apply("backend/db/migrations/20260720000500_job_dedup_linkage.sql");
      await apply(
        "backend/db/migrations/20260720000700_provider_ownership_epochs.sql",
      );
      try {
        await psql(["-q", "-c", `
          DO $precondition$
          BEGIN
            IF NOT EXISTS (
              SELECT 1
              FROM public.provider_registry
              WHERE provider = 'france_travail'
                AND enabled = false
                AND writer_runtime = 'python'
                AND ownership_epoch = 0
                AND claims_required = false
            ) THEN
              RAISE EXCEPTION 'fresh schema lacks the safe France Travail Python-owner precondition';
            END IF;
          END
          $precondition$;

          INSERT INTO public.jobs (job_id, provider, external_id, data)
          VALUES (
            'g010-pre-activation', 'france_travail',
            'g010-pre-activation', '{}'::jsonb
          );
          DELETE FROM public.jobs WHERE job_id = 'g010-pre-activation';

          INSERT INTO public.jobs (job_id, provider, external_id, data)
          VALUES ('g010-other-provider', 'apec', 'g010-other-provider', '{}'::jsonb)
          ON CONFLICT (job_id) DO UPDATE SET title = NULL;

          DO $proof$
          DECLARE
            v_old jsonb;
            v_new jsonb;
            v_job_id text;
          BEGIN
            BEGIN
              PERFORM worker_private.transition_provider_writer(
                'france_travail', 'python', 'none', 0
              );
              RAISE EXCEPTION 'transition bypassed lifecycle readiness gate';
            EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
            END;
            UPDATE public.provider_registry
            SET lifecycle_claims_ready = true
            WHERE provider = 'france_travail';

            v_old := public.python_provider_work_claim(
              'france_travail', 'g010-old-operation', 300
            );
            PERFORM worker_private.transition_provider_writer(
              'france_travail', 'python', 'none', 0
            );
            BEGIN
              PERFORM worker_private.transition_provider_writer(
                'france_travail', 'none', 'typescript', 0
              );
              RAISE EXCEPTION 'stale transition unexpectedly succeeded';
            EXCEPTION WHEN serialization_failure THEN NULL;
            END;
            PERFORM worker_private.transition_provider_writer(
              'france_travail', 'none', 'python', 1
            );
            IF public.python_provider_work_heartbeat(
              (v_old->>'claim_id')::uuid, 'g010-old-operation', 300
            ) THEN
              RAISE EXCEPTION 'ABA heartbeat unexpectedly succeeded';
            END IF;
            BEGIN
              PERFORM public.python_provider_jobs_upsert(
                (v_old->>'claim_id')::uuid, 'g010-old-operation', '[]'::jsonb
              );
              RAISE EXCEPTION 'ABA write unexpectedly succeeded';
            EXCEPTION WHEN insufficient_privilege THEN NULL;
            END;
            BEGIN
              PERFORM public.python_provider_work_claim(
                'france_travail', 'g010-old-operation', 300
              );
              RAISE EXCEPTION 'one-shot operation reacquired after ABA';
            EXCEPTION WHEN unique_violation THEN NULL;
            END;

            v_new := public.python_provider_work_claim(
              'france_travail', 'g010-new-operation', 300
            );
            BEGIN
              INSERT INTO public.jobs (job_id, provider, external_id, data)
              VALUES (
                'g010-direct-bypass', 'france_travail',
                'g010-direct-bypass', '{}'::jsonb
              );
              RAISE EXCEPTION 'direct claimed-provider DML unexpectedly succeeded';
            EXCEPTION WHEN insufficient_privilege THEN NULL;
            END;
            UPDATE public.jobs
            SET title = 'Other provider remains backward compatible'
            WHERE job_id = 'g010-other-provider';
            v_job_id := 'job_' || substr(encode(
              public.digest('france_travail:g010-1', 'sha1'), 'hex'
            ), 1, 16);
            IF public.python_provider_jobs_upsert(
              (v_new->>'claim_id')::uuid,
              'g010-new-operation',
              jsonb_build_array(jsonb_build_object(
                'job_id', v_job_id,
                'provider', 'france_travail',
                'external_id', 'g010-1',
                'title', 'Ingénieur',
                'city', 'Paris',
                'country_code', 'FR',
                'canonical_apply_url', 'https://example.test/jobs/g010-1',
                'data', jsonb_build_object('fixture', true)
              ))
            ) <> 1 THEN
              RAISE EXCEPTION 'claim-aware Python upsert failed';
            END IF;
            BEGIN
              UPDATE public.jobs
              SET provider = 'apec'
              WHERE job_id = v_job_id;
              RAISE EXCEPTION 'provider identity UPDATE bypass unexpectedly succeeded';
            EXCEPTION WHEN insufficient_privilege THEN NULL;
            END;
            BEGIN
              UPDATE public.jobs
              SET external_id = 'g010-mutated'
              WHERE job_id = v_job_id;
              RAISE EXCEPTION 'provider identity fields unexpectedly mutated';
            EXCEPTION WHEN insufficient_privilege THEN NULL;
            END;
            IF NOT public.python_provider_work_finish(
              (v_new->>'claim_id')::uuid, 'g010-new-operation'
            ) THEN
              RAISE EXCEPTION 'claim finish failed';
            END IF;
          END
          $proof$;
        `]);

        const count = await psql(["-A", "-t", "-q", "-c", `
          SELECT count(*) FROM public.jobs
          WHERE provider = 'france_travail' AND external_id = 'g010-1'
        `]);
        expect(count).toBe("1");
        expect(
          await psql(["-A", "-t", "-q", "-c", `
            SELECT title FROM public.jobs WHERE job_id = 'g010-other-provider'
          `]),
        ).toBe("Other provider remains backward compatible");
      } finally {
        await apply(
          "backend/db/migrations/20260720000700_provider_ownership_epochs.down.sql",
        );
      }

      expect(
        await psql(["-A", "-t", "-q", "-c", `
          SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'provider_registry'
            AND column_name = 'ownership_epoch'
        `]),
      ).toBe("0");
      await apply(
        "backend/db/migrations/20260720000700_provider_ownership_epochs.sql",
      );
      await apply(
        "backend/db/migrations/20260720000700_provider_ownership_epochs.down.sql",
      );
    },
    30_000,
  );
});
