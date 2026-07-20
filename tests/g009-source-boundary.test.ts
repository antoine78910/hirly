import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runIngestion,
  stableJobId,
  type NormalizedProviderJob,
  type ProviderAdapter,
  type ProviderTransport,
} from "../packages/ingestion/src";

const repoRoot = join(import.meta.dir, "..");
const migrationsDirectory = join(repoRoot, "backend", "db", "migrations");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function sourceBoundaryMigration(): {
  migration: string;
  rollback: string;
} {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql") && !name.endsWith(".down.sql"))
    .filter((name) => {
      const sql = read(`backend/db/migrations/${name}`);
      return [
        "public.raw_job_snapshots",
        "public.job_occurrences",
        "public.canonical_job_groups",
        "public.canonical_job_group_members",
      ].every((object) => sql.includes(object));
    });

  expect(matches).toHaveLength(1);
  const filename = matches[0]!;
  return {
    migration: read(`backend/db/migrations/${filename}`),
    rollback: read(
      `backend/db/migrations/${filename.replace(/\.sql$/, ".down.sql")}`,
    ),
  };
}

function normalizedJob(externalId: string): NormalizedProviderJob {
  return {
    envelope: {
      provider: "apec",
      externalId,
      payload: { externalId, source: "contract-fixture" },
    },
    title: "Ingénieur Logiciel",
    company: "Hirly SAS",
    location: "Paris, France",
    countryCode: "France",
    description: "Build reliable job ingestion.",
    contractType: "CDI",
    status: "active",
    applyUrls: [
      "https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/1",
      "https://boards.greenhouse.io/hirly/jobs/1",
    ],
  };
}

describe("G009 source adapter contract", () => {
  test("rejects a provider identity mismatch before transport access", async () => {
    let fetched = false;
    const transport: ProviderTransport<unknown> = {
      async fetch() {
        fetched = true;
        return { items: [], nextCursor: null };
      },
    };
    const adapter: ProviderAdapter<unknown> = {
      provider: "indeed",
      normalizeRaw() {
        return normalizedJob("identity-mismatch");
      },
    };

    await expect(
      runIngestion({
        provider: "apec",
        transport,
        adapter,
        repository: {
          async upsertCanonicalBatch() {
            throw new Error("writer must not run");
          },
        },
        request: {
          provider: "apec",
          query: null,
          location: null,
          countryCode: "FR",
          cursor: null,
          pageSize: 50,
          maxPages: 1,
        },
        rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
      }),
    ).rejects.toMatchObject({ code: "integrity_error" });
    expect(fetched).toBeFalse();
  });

  test("keeps stable IDs and deduplicates repeated source occurrences before one write", async () => {
    const raw = [
      { externalId: "same-source-id" },
      { externalId: "same-source-id" },
    ];
    let writtenIds: string[] = [];

    const result = await runIngestion({
      provider: "apec",
      transport: {
        async fetch() {
          return { items: raw, nextCursor: null };
        },
      },
      adapter: {
        provider: "apec",
        normalizeRaw(item: { externalId: string }) {
          return normalizedJob(item.externalId);
        },
      },
      repository: {
        async upsertCanonicalBatch(jobs) {
          writtenIds = jobs.map(({ jobId }) => jobId);
          return jobs.length;
        },
      },
      request: {
        provider: "apec",
        query: null,
        location: null,
        countryCode: "FR",
        cursor: null,
        pageSize: 50,
        maxPages: 1,
      },
      rateLimit: { requestsPerMinute: 60_000, concurrency: 1 },
      now: () => new Date("2026-07-20T00:00:00Z"),
    });

    expect(writtenIds).toEqual([stableJobId("apec", "same-source-id")]);
    expect(result.metrics).toMatchObject({
      fetched: 2,
      accepted: 1,
      rejected: 0,
      deduplicated: 1,
      upserted: 1,
      pages: 1,
    });
    expect(result.jobs[0]).toMatchObject({
      countryCode: "FR",
      selectedApplyUrl: "https://boards.greenhouse.io/hirly/jobs/1",
      validationStatus: "valid",
      applyabilityTier: "A",
      applyFulfillmentStatus: "manual_ready",
      manualFulfillmentReady: true,
      autoApplySupported: true,
    });
  });

  test("keeps every existing and future transport disabled by default", () => {
    const providerCore = readFileSync(
      new URL("../apps/worker/src/providers/core.ts", import.meta.url),
      "utf8",
    );
    const providerRegistry = readFileSync(
      new URL(
        "../backend/db/migrations/20260720000100_typescript_worker_foundation.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(providerCore).toContain("liveTransportReady: false");
    expect(providerCore).toContain("provider transport is disabled");
    expect(providerRegistry).toContain(
      "false, 'none', '{\"requestsPerMinute\":1,\"concurrency\":1}'",
    );
  });
});

describe("G009 source persistence contract", () => {
  test("links immutable raw snapshots to source identity and the run checkpoint ledger", () => {
    const { migration } = sourceBoundaryMigration();

    expect(migration).toMatch(
      /raw_job_snapshots_run_source_external_hash_unique[\s\S]*UNIQUE\s*\(\s*run_id\s*,\s*source_id\s*,\s*external_id\s*,\s*content_hash\s*\)/i,
    );
    expect(migration).toMatch(
      /raw_job_snapshots_source_provider_fk[\s\S]*FOREIGN KEY\s*\(\s*source_id\s*,\s*provider\s*\)[\s\S]*REFERENCES public\.career_sources\s*\(\s*id\s*,\s*provider\s*\)/i,
    );
    expect(migration).toMatch(
      /raw_job_snapshots_run_source_provider_fk[\s\S]*FOREIGN KEY\s*\(\s*run_id\s*,\s*source_id\s*,\s*provider\s*\)[\s\S]*REFERENCES public\.worker_runs\s*\(\s*id\s*,\s*career_source_id\s*,\s*provider\s*\)/i,
    );
    expect(migration).toMatch(
      /raw_job_snapshots_immutable[\s\S]*BEFORE UPDATE OR DELETE ON public\.raw_job_snapshots/i,
    );
  });

  test("keeps occurrence IDs stable and preserves every legacy jobs reference", () => {
    const { migration } = sourceBoundaryMigration();

    expect(migration).toMatch(
      /job_id text NOT NULL UNIQUE REFERENCES public\.jobs\(job_id\) ON DELETE RESTRICT/i,
    );
    expect(migration).toMatch(
      /job_occurrences_source_external_unique UNIQUE\s*\(\s*source_id\s*,\s*external_id\s*\)/i,
    );
    expect(migration).toMatch(
      /raw_job_snapshots_identity_unique[\s\S]*UNIQUE\s*\(\s*id\s*,\s*source_id\s*,\s*external_id\s*,\s*content_hash\s*\)[\s\S]*job_occurrences_snapshot_identity_fk[\s\S]*FOREIGN KEY\s*\(\s*raw_snapshot_id\s*,\s*source_id\s*,\s*external_id\s*,\s*content_hash\s*\)\s*REFERENCES public\.raw_job_snapshots\s*\(\s*id\s*,\s*source_id\s*,\s*external_id\s*,\s*content_hash\s*\)/i,
    );
    expect(migration).not.toMatch(
      /\b(?:DROP|RENAME)\s+(?:COLUMN\s+)?(?:public\.)?jobs?\b|\bALTER\s+COLUMN\s+job_id\b/i,
    );
  });

  test("uses immutable UUID groups without re-keying occurrence-derived jobs", () => {
    const { migration } = sourceBoundaryMigration();

    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.canonical_job_groups\s*\([\s\S]*?id uuid PRIMARY KEY DEFAULT gen_random_uuid\(\)/i,
    );
    expect(migration).toMatch(
      /canonical_job_group_members\s*\([\s\S]*?job_id text PRIMARY KEY REFERENCES public\.jobs\(job_id\) ON DELETE RESTRICT/i,
    );
    expect(migration).toMatch(
      /canonical_job_group_events_immutable[\s\S]*BEFORE UPDATE OR DELETE ON public\.canonical_job_group_events/i,
    );
    expect(migration).toContain(
      "event_type IN ('created', 'merged', 'split', 'preferred_job_changed', 'manual_override')",
    );
  });

  test("keeps sources disabled behind policy and provider/country kill switches", () => {
    const { migration } = sourceBoundaryMigration();
    const observability = read(
      "backend/db/migrations/20260720000400_job_supply_observability.sql",
    );

    for (const disabledDefault of [
      "transport_enabled boolean NOT NULL DEFAULT false",
      "incremental_enabled boolean NOT NULL DEFAULT false",
      "backfill_enabled boolean NOT NULL DEFAULT false",
    ]) {
      expect(migration).toContain(disabledDefault);
    }
    expect(migration).toContain(
      "country_kill_switches jsonb NOT NULL DEFAULT '{}'::jsonb",
    );
    expect(migration).toContain("registry.country_kill_switches");
    expect(migration).toContain("registry.writer_runtime = 'typescript'");
    expect(migration).toContain("policy.approval_status = 'approved'");
    expect(observability).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(migration).not.toMatch(
      /\b(?:UPDATE|INSERT\s+INTO)\s+(?:public\.)?provider_registry\b/i,
    );
    expect(migration).not.toMatch(
      /\b(?:UPDATE|INSERT\s+INTO)\s+(?:public\.)?career_sources\b/i,
    );
  });

  test("is reversible and grants no canonical mutation capability", () => {
    const { migration, rollback } = sourceBoundaryMigration();

    for (const object of [
      "raw_job_snapshots",
      "job_occurrences",
      "canonical_job_groups",
      "canonical_job_group_members",
      "canonical_job_group_events",
    ]) {
      expect(rollback).toContain(`DROP TABLE IF EXISTS public.${object}`);
    }
    expect(rollback).toContain("DROP COLUMN IF EXISTS canonical_group_id");
    expect(rollback).toContain("DROP COLUMN IF EXISTS source_id");
    expect(migration).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]*?(?:raw_job_snapshots|job_occurrences|canonical_job_groups)/i,
    );
  });
});
