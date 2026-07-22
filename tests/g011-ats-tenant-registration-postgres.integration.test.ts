import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const databaseUrl = process.env.G011_TEST_DATABASE_URL;
const repoRoot = join(import.meta.dir, "..");
const runIntegration = databaseUrl ? test : test.skip;

async function psql(args: string[]): Promise<string> {
  if (!databaseUrl) throw new Error("G011_TEST_DATABASE_URL is required");
  const process = Bun.spawn(["psql", databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
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

describe("G011 real-Postgres disabled ATS tenant registration", () => {
  runIntegration(
    "applies, registers idempotently, remains non-runnable, and rolls back",
    async () => {
      await apply("backend/db/jobs_inventory_schema.sql");
      for (const migration of [
        "20260720000100_typescript_worker_foundation.sql",
        "20260720000200_bun_worker_runtime.sql",
        "20260720000300_job_ingestion_run_ledger.sql",
        "20260720000400_job_supply_observability.sql",
        "20260720000500_job_dedup_linkage.sql",
        "20260720000600_typescript_ingestion_source_boundary.sql",
        "20260720000700_provider_ownership_epochs.sql",
        "20260720000800_ats_tenant_source_registration.sql",
        "20260720000900_ats_registration_activation_hardening.sql",
      ]) {
        await apply(`backend/db/migrations/${migration}`);
      }

      try {
        await psql([
          "-q",
          "-c",
          `
          INSERT INTO public.provider_registry (
            provider, access_method, authorization_status, enabled,
            writer_runtime, rate_limit_config
          ) VALUES (
            'greenhouse', 'discovery-only', 'unverified', false, 'none',
            '{"requestsPerMinute":1,"concurrency":1}'::jsonb
          );

          INSERT INTO public.source_policy (
            provider, policy_key, licence_name, permitted_access_methods
          ) VALUES (
            'greenhouse', 'greenhouse-tenant-review', 'tenant-specific',
            ARRAY['tenant_feed']
          );

          SELECT worker_private.register_career_source_candidate(
            'greenhouse',
            'greenhouse:hirly',
            'hirly',
            NULL,
            'Hirly',
            ARRAY['FR'],
            'https://boards.greenhouse.io/hirly',
            'tenant_feed',
            3600,
            '{"version":"ats-discovery.v1","cursor":"initial"}'::jsonb
          );

          DO $proof$
          BEGIN
            BEGIN
              PERFORM worker_private.register_career_source_candidate(
                'greenhouse', 'greenhouse:local', 'local', NULL, 'Local',
                ARRAY['FR'], 'https://localhost/jobs', 'tenant_feed',
                3600, '{}'::jsonb
              );
              RAISE EXCEPTION 'localhost registration unexpectedly succeeded';
            EXCEPTION WHEN invalid_parameter_value THEN NULL;
            END;
            BEGIN
              PERFORM worker_private.register_career_source_candidate(
                'greenhouse', 'greenhouse:ip', 'ip', NULL, 'IP',
                ARRAY['FR'], 'https://127.0.0.1/jobs', 'tenant_feed',
                3600, '{}'::jsonb
              );
              RAISE EXCEPTION 'IP registration unexpectedly succeeded';
            EXCEPTION WHEN invalid_parameter_value THEN NULL;
            END;
            BEGIN
              PERFORM worker_private.register_career_source_candidate(
                'greenhouse', 'greenhouse:port', 'port', NULL, 'Port',
                ARRAY['FR'], 'https://boards.greenhouse.io:8443/port',
                'tenant_feed', 3600, '{}'::jsonb
              );
              RAISE EXCEPTION 'custom-port registration unexpectedly succeeded';
            EXCEPTION WHEN invalid_parameter_value THEN NULL;
            END;
          END
          $proof$;

          UPDATE public.career_sources
          SET checkpoint = '{"version":"ats-discovery.v1","cursor":"runtime"}',
              consecutive_failures = 2,
              last_attempt_at = clock_timestamp()
          WHERE provider = 'greenhouse' AND tenant_key = 'hirly';

          SELECT worker_private.register_career_source_candidate(
            'greenhouse',
            'greenhouse:hirly',
            'hirly',
            'company-1',
            'Hirly SAS',
            ARRAY['BE', 'FR', 'FR'],
            'https://boards.greenhouse.io/hirly',
            'tenant_feed',
            7200,
            '{"version":"ats-discovery.v1","cursor":"must-not-overwrite"}'::jsonb
          );
        `,
        ]);

        const row = await psql([
          "-A",
          "-t",
          "-q",
          "-c",
          `
          SELECT jsonb_build_object(
            'count', (
              SELECT count(*) FROM public.career_sources
              WHERE provider = 'greenhouse' AND tenant_key = 'hirly'
            ),
            'company_name', company_name,
            'countries', country_codes,
            'checkpoint', checkpoint::text,
            'failures', consecutive_failures,
            'enabled', enabled,
            'transport', transport_enabled,
            'incremental', incremental_enabled,
            'backfill', backfill_enabled,
            'runnable', worker_private.career_source_runnable(
              id, 'FR', 'incremental'
            )
          )
          FROM public.career_sources
          WHERE provider = 'greenhouse' AND tenant_key = 'hirly'
        `,
        ]);
        expect(JSON.parse(row)).toEqual({
          count: 1,
          company_name: "Hirly SAS",
          countries: ["BE", "FR"],
          checkpoint: '{"cursor": "runtime", "version": "ats-discovery.v1"}',
          failures: 2,
          enabled: false,
          transport: false,
          incremental: false,
          backfill: false,
          runnable: false,
        });

        const policyState = await psql([
          "-A",
          "-t",
          "-q",
          "-c",
          `
          SELECT jsonb_build_object(
            'policy_id', policy_id,
            'discovery_state', discovery_state
          )
          FROM public.career_sources
          WHERE provider = 'greenhouse' AND tenant_key = 'hirly'
        `,
        ]);
        expect(JSON.parse(policyState)).toEqual({
          policy_id: null,
          discovery_state: "candidate",
        });

        await psql([
          "-q",
          "-c",
          `
          SELECT worker_private.approve_career_source_candidate(
            (
              SELECT id FROM public.career_sources
              WHERE provider = 'greenhouse' AND tenant_key = 'hirly'
            ),
            'https://boards.greenhouse.io/hirly',
            (
              SELECT id FROM public.source_policy
              WHERE provider = 'greenhouse'
                AND policy_key = 'greenhouse-tenant-review'
            )
          );
        `,
        ]);
        expect(
          await psql([
            "-A",
            "-t",
            "-q",
            "-c",
            `
            SELECT discovery_state || ':' || enabled::text
            FROM public.career_sources
            WHERE provider = 'greenhouse' AND tenant_key = 'hirly'
          `,
          ]),
        ).toBe("approved:false");

        const privileges = await psql([
          "-A",
          "-t",
          "-q",
          "-c",
          `
          SELECT jsonb_build_object(
            'direct_insert', has_table_privilege(
              'hirly_inventory_worker', 'public.career_sources', 'INSERT'
            ),
            'register', has_function_privilege(
              'hirly_inventory_worker',
              'worker_private.register_career_source_candidate(text,text,text,text,text,text[],text,text,integer,jsonb)',
              'EXECUTE'
            ),
            'worker_approve', has_function_privilege(
              'hirly_inventory_worker',
              'worker_private.approve_career_source_candidate(uuid,text,uuid)',
              'EXECUTE'
            ),
            'operator_approve', has_function_privilege(
              'hirly_inventory_operator',
              'worker_private.approve_career_source_candidate(uuid,text,uuid)',
              'EXECUTE'
            )
          )
        `,
        ]);
        expect(JSON.parse(privileges)).toEqual({
          direct_insert: false,
          register: true,
          worker_approve: false,
          operator_approve: true,
        });

        await apply(
          "backend/db/migrations/20260720000900_ats_registration_activation_hardening.down.sql",
        );
        expect(
          await psql([
            "-A",
            "-t",
            "-q",
            "-c",
            `
            SELECT to_regprocedure(
              'worker_private.career_source_base_url_is_safe(text)'
            ) IS NULL
          `,
          ]),
        ).toBe("t");
        await apply(
          "backend/db/migrations/20260720000900_ats_registration_activation_hardening.sql",
        );
        expect(
          await psql([
            "-A",
            "-t",
            "-q",
            "-c",
            `
            SELECT worker_private.career_source_base_url_is_safe(
              'https://boards.greenhouse.io/hirly'
            )
          `,
          ]),
        ).toBe("t");
      } finally {
        await apply(
          "backend/db/migrations/20260720000900_ats_registration_activation_hardening.down.sql",
        );
        await apply("backend/db/migrations/20260720000800_ats_tenant_source_registration.down.sql");
      }

      expect(
        await psql([
          "-A",
          "-t",
          "-q",
          "-c",
          `
          SELECT to_regprocedure(
            'worker_private.register_career_source_candidate(text,text,text,text,text,text[],text,text,integer,jsonb)'
          ) IS NULL
        `,
        ]),
      ).toBe("t");
    },
    60_000,
  );
});
