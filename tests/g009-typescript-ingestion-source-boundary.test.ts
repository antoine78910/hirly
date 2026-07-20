import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  sourceCheckpointSchema,
  sourceRegistryEntrySchema,
  sourceRuntimePolicySchema,
  type SourceRuntimePolicy,
} from "../packages/contracts/src/index";
import {
  DisabledSourceTransport,
  sourceActivationBlockReason,
} from "../packages/ingestion/src/index";

const migration = readFileSync(
  new URL(
    "../backend/db/migrations/20260720000600_typescript_ingestion_source_boundary.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../backend/db/migrations/20260720000600_typescript_ingestion_source_boundary.down.sql",
    import.meta.url,
  ),
  "utf8",
);

function policy(
  overrides: Partial<SourceRuntimePolicy> = {},
): SourceRuntimePolicy {
  return sourceRuntimePolicySchema.parse({
    providerEnabled: true,
    writerRuntime: "typescript",
    providerCountryKillSwitches: {},
    sourceCountryKillSwitches: {},
    source: {
      id: "11111111-1111-4111-8111-111111111111",
      provider: "apec",
      sourceKey: "fixture-source",
      tenantKey: null,
      countryCodes: ["FR"],
      accessType: "open_data",
      policyId: "22222222-2222-4222-8222-222222222222",
      enabled: true,
      transportEnabled: true,
      incrementalEnabled: true,
      backfillEnabled: false,
      checkpoint: {},
    },
    policy: {
      approvalStatus: "approved",
      enabled: true,
      commercialUseAllowed: true,
      redisplayAllowed: true,
      expiresAt: "2026-08-20T00:00:00.000Z",
    },
    ...overrides,
  });
}

describe("G009 disabled TypeScript source contract", () => {
  test("accepts the existing empty checkpoint and keeps registry modes explicit", () => {
    expect(sourceCheckpointSchema.parse({})).toEqual({});
    expect(
      sourceRegistryEntrySchema.parse(policy().source),
    ).toMatchObject({
      enabled: true,
      transportEnabled: true,
      incrementalEnabled: true,
      backfillEnabled: false,
    });
  });

  test("ships no live transport", async () => {
    const transport = new DisabledSourceTransport<unknown>();
    expect(transport.liveTransportReady).toBeFalse();
    await expect(
      transport.fetch(
        {
          provider: "apec",
          sourceId: "11111111-1111-4111-8111-111111111111",
          sourceKey: "fixture-source",
          tenantKey: null,
          countryCode: "FR",
          mode: "dry_run",
          checkpoint: {},
          pageSize: 100,
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: "IngestionError",
      code: "authorization_blocked",
    });
  });

  test("requires provider ownership, policy, mode, and country gates", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(sourceActivationBlockReason(policy(), "FR", "incremental", now))
      .toBeNull();
    expect(
      sourceActivationBlockReason(
        policy({ writerRuntime: "python" }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("writer_not_typescript");
    expect(
      sourceActivationBlockReason(
        policy({
          source: {
            ...policy().source,
            transportEnabled: false,
          },
        }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("transport_disabled");
    expect(
      sourceActivationBlockReason(
        policy({ providerCountryKillSwitches: { FR: true } }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("provider_country_killed");
    expect(sourceActivationBlockReason(policy(), "FR", "backfill", now))
      .toBe("mode_disabled");
    expect(
      sourceActivationBlockReason(
        policy({
          policy: {
            ...policy().policy,
            expiresAt: "2026-07-19T00:00:00.000Z",
          },
        }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("policy_expired");
  });
});

describe("G009 additive database boundary", () => {
  test("adds immutable snapshots, occurrences, and stable groups", () => {
    for (const object of [
      "raw_job_snapshots",
      "job_occurrences",
      "canonical_job_groups",
      "canonical_job_group_members",
      "canonical_job_group_events",
    ]) {
      expect(migration).toContain(`public.${object}`);
      expect(rollback).toContain(object);
    }
    expect(migration).toContain(
      "UNIQUE (id, source_id, external_id, content_hash)",
    );
    expect(migration).toContain(
      "CONSTRAINT job_occurrences_source_external_unique UNIQUE (source_id, external_id)",
    );
    expect(migration).toContain(
      "job_id text NOT NULL UNIQUE REFERENCES public.jobs(job_id)",
    );
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("superseded_by_group_id uuid");
    expect(migration).toContain("event_type IN ('created', 'merged', 'split'");
  });

  test("keeps legacy jobs identity and reads additive", () => {
    expect(migration).toContain("ALTER TABLE public.jobs");
    expect(migration).not.toMatch(
      /\b(?:DROP|ALTER)\s+(?:COLUMN\s+)?job_id\b/i,
    );
    expect(migration).not.toMatch(/\bUPDATE\s+public\.jobs\b/i);
    for (const column of [
      "source_id",
      "canonical_group_id",
      "first_seen_at",
      "expires_at",
      "removed_at",
      "lifecycle_checked_at",
      "route_classification",
      "route_confidence",
      "route_verified_at",
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
      expect(rollback).toContain(`DROP COLUMN IF EXISTS ${column}`);
    }
  });

  test("keeps every new source mode disabled and provider registry authoritative", () => {
    for (const disabledDefault of [
      "transport_enabled boolean NOT NULL DEFAULT false",
      "incremental_enabled boolean NOT NULL DEFAULT false",
      "backfill_enabled boolean NOT NULL DEFAULT false",
    ]) {
      expect(migration).toContain(disabledDefault);
    }
    expect(migration).toContain("registry.writer_runtime = 'typescript'");
    expect(migration).not.toMatch(
      /\b(?:INSERT\s+INTO|UPDATE)\s+(?:public\.)?provider_registry\b/i,
    );
    expect(migration).not.toContain(
      "ADD COLUMN IF NOT EXISTS writer_runtime",
    );
  });
});
