import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { SourceRegistryEntry } from "../packages/contracts/src";
import {
  IngestionError,
  stableJobId,
  toCanonicalJob,
  validateApplyability,
  type SourceContext,
} from "../packages/ingestion/src";
import {
  buildAtsRepeatedShadowScorecard,
  approveAtsInventoryShadowScope,
} from "../apps/worker/src/providers/ats-inventory-readiness";
import {
  createNicokaFixtureSourceAdapter,
  createNicokaShadowTransport,
  nicokaProvider,
  nicokaRawJobSchema,
  type NicokaRawJob,
} from "../apps/worker/src/providers/nicoka";
import { AtsTrialTransportError } from "../apps/worker/src/providers/ats-trial-transport";

const policyId = "00000000-0000-4000-8000-000000000019";

async function fixture(): Promise<{
  tenantKey: string;
  countryCodes: string[];
  raw: NicokaRawJob[];
}> {
  return JSON.parse(
    await readFile(new URL("./fixtures/g019/nicoka.json", import.meta.url), "utf8"),
  );
}

function source(tenantKey = "acme"): SourceRegistryEntry {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    provider: "nicoka",
    sourceKey: `nicoka:${tenantKey}`,
    tenantKey,
    countryCodes: ["FR"],
    accessType: "public_api",
    policyId,
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
    checkpoint: { fixturePageSize: 1 },
  };
}

function context(entry: SourceRegistryEntry): SourceContext {
  return {
    source: entry,
    runId: "g019-fixture",
    fetchedAt: new Date("2026-07-21T00:00:00.000Z"),
  };
}

describe("G019 Nicoka shadow connector", () => {
  test("keeps canonical writes disabled while exposing explicit shadow readiness", () => {
    expect(nicokaProvider.liveTransportReady).toBe(false);
    expect(nicokaProvider.shadowModeReady).toBe(true);
    expect(nicokaProvider.canonicalWriteReady).toBe(false);
  });

  test("normalizes stable Nicoka identity, direct apply URL, country and readiness", async () => {
    const data = await fixture();
    const rows = data.raw.map((row) => nicokaRawJobSchema.parse(row));
    const entry = source(data.tenantKey);
    const adapter = createNicokaFixtureSourceAdapter(rows, policyId);
    const occurrence = adapter.normalize(rows[0], context(entry));
    expect(occurrence).toMatchObject({
      externalId: "acme:76",
      canonicalSourceUrl: "https://acme.nicoka.com/api/jobs/published?jobid=76",
      canonicalApplyUrl: "https://acme.nicoka.com/public/jobs/1-sanitized-php/apply",
      atsPostingId: "76",
      job: {
        countryCode: "FR",
        status: "published",
        envelope: { provider: "nicoka", externalId: "acme:76" },
      },
    });
    const canonical = toCanonicalJob(occurrence.job, context(entry).fetchedAt);
    expect(canonical.jobId).toBe(stableJobId("nicoka", "acme:76"));
    expect(canonical.selectedApplyUrl).toBe(occurrence.canonicalApplyUrl);
    expect(canonical.validationStatus).toBe("valid");
    expect(canonical.manualFulfillmentReady).toBe(true);
    expect(canonical.autoApplySupported).toBe(false);
    expect(validateApplyability(occurrence.job, context(entry).fetchedAt)).toMatchObject({
      atsProvider: "nicoka",
      applyabilityTier: "B",
      manualFulfillmentReady: true,
      autoApplySupported: false,
    });
  });

  test("deduplicates fixture pages through stable canonical upserts", async () => {
    const data = await fixture();
    const entry = source(data.tenantKey);
    const adapter = createNicokaFixtureSourceAdapter(data.raw, policyId);
    const ids: string[] = [];
    for await (const page of adapter.discover({
      source: entry,
      mode: "full",
      cursor: null,
      signal: new AbortController().signal,
    })) {
      ids.push(
        ...page.items.map(
          (row) =>
            toCanonicalJob(adapter.normalize(row, context(entry)).job, context(entry).fetchedAt)
              .jobId,
        ),
      );
    }
    expect(ids).toEqual([stableJobId("nicoka", "acme:76"), stableJobId("nicoka", "acme:77")]);
    expect(new Set([...ids, ...ids]).size).toBe(2);
  });

  test("redacts PII canaries from the canonical source document", async () => {
    const data = await fixture();
    const entry = source(data.tenantKey);
    const adapter = createNicokaFixtureSourceAdapter(data.raw, policyId);
    const canary = {
      ...data.raw[0],
      recruiter_email: "pii-canary@example.test",
      phone: "+33 6 12 34 56 78",
      debug: "contact pii-canary@example.test",
      token: "secret-canary",
    };
    const canonical = toCanonicalJob(
      adapter.normalize(canary, context(entry)).job,
      context(entry).fetchedAt,
    );
    const serialized = JSON.stringify(canonical.data);
    expect(serialized).not.toContain("pii-canary@example.test");
    expect(serialized).not.toContain("+33 6 12 34 56 78");
    expect(serialized).not.toContain("secret-canary");
    expect(serialized).toContain("[REDACTED]");
  });

  test("rejects hostile, cross-tenant and mismatched Nicoka routes", async () => {
    const data = await fixture();
    const entry = source(data.tenantKey);
    const adapter = createNicokaFixtureSourceAdapter(data.raw, policyId);
    for (const applicationUrl of [
      "http://acme.nicoka.com/public/jobs/1-sanitized-php/apply",
      "https://user:secret@acme.nicoka.com/public/jobs/1-sanitized-php/apply",
      "https://acme.nicoka.com.evil.example/public/jobs/1-sanitized-php/apply",
      "https://other.nicoka.com/public/jobs/1-sanitized-php/apply",
      "https://acme.nicoka.com/public/jobs/other/apply",
      "https://acme.nicoka.com/public/jobs/1-sanitized-php/apply#token",
      "https://acme.nicoka.com/public/jobs/1-sanitized-php/apply?token=secret",
    ]) {
      expect(() => adapter.normalize({ ...data.raw[0], applicationUrl }, context(entry))).toThrow(
        IngestionError,
      );
    }
    expect(() => nicokaRawJobSchema.parse({ ...data.raw[0], jobid: 999 })).toThrow();
  });

  test("reconciles bounded production and trial pagination without credentials", async () => {
    const data = await fixture();
    const requested: string[] = [];
    const transport = createNicokaShadowTransport({
      approvedTenantId: "acme",
      environment: "production",
      fetch: async (input, init) => {
        requested.push(input);
        expect(init.method).toBe("GET");
        expect(init.credentials).toBe("omit");
        expect(init.redirect).toBe("error");
        const page = Number(new URL(input).searchParams.get("page"));
        const row = data.raw[page - 1];
        return Response.json({
          queryUid: "fixture-query",
          offset: page - 1,
          limit: 1,
          page,
          pages: 2,
          total: 2,
          data: [row],
        });
      },
    });
    expect(await transport.fetch(new AbortController().signal)).toHaveLength(2);
    expect(requested).toEqual([
      "https://acme.nicoka.com/api/jobs/published?page=1",
      "https://acme.nicoka.com/api/jobs/published?page=2",
    ]);
    expect(transport).toMatchObject({
      shadowOnly: true,
      manualInvocationOnly: true,
      canonicalWriteReady: false,
      credentialsAccepted: false,
    });

    const trial = createNicokaShadowTransport({
      approvedTenantId: "acme",
      environment: "trial",
      fetch: async (input) => {
        expect(input).toBe("https://trial.nicoka.com/acme/api/jobs/published?page=1");
        return Response.json({
          queryUid: "trial-fixture",
          offset: 0,
          limit: 0,
          page: 1,
          pages: 1,
          total: 0,
          data: [],
        });
      },
    });
    expect(await trial.fetch(new AbortController().signal)).toEqual([]);
  });

  test("fails closed on pagination drift, duplicates, and page-budget overflow", async () => {
    const data = await fixture();
    const drift = createNicokaShadowTransport({
      approvedTenantId: "acme",
      environment: "production",
      fetch: async () =>
        Response.json({
          queryUid: "drift",
          offset: 0,
          limit: 1,
          page: 2,
          pages: 2,
          total: 2,
          data: [data.raw[0]],
        }),
    });
    await expect(drift.fetch(new AbortController().signal)).rejects.toBeInstanceOf(
      AtsTrialTransportError,
    );

    const budget = createNicokaShadowTransport({
      approvedTenantId: "acme",
      environment: "production",
      budgets: { maxPages: 1 },
      fetch: async () =>
        Response.json({
          queryUid: "budget",
          offset: 0,
          limit: 1,
          page: 1,
          pages: 2,
          total: 2,
          data: [data.raw[0]],
        }),
    });
    await expect(budget.fetch(new AbortController().signal)).rejects.toMatchObject({
      classification: "budget_exceeded",
    });
  });

  test("seals a complete shadow scorecard only after page, offset, and total reconciliation", async () => {
    const data = await fixture();
    const transport = createNicokaShadowTransport({
      approvedTenantId: "acme",
      environment: "production",
      fetch: async (input) => {
        const page = Number(new URL(input).searchParams.get("page"));
        return Response.json({
          queryUid: "sealed-fixture-query",
          offset: page - 1,
          limit: 1,
          page,
          pages: 2,
          total: 2,
          data: [data.raw[page - 1]],
        });
      },
    });
    const policyDigest = approveAtsInventoryShadowScope({
      policy: {
        schemaVersion: 1,
        provider: "nicoka",
        mode: "shadow",
        canonicalWritesEnabled: false,
        policyId: "nicoka-reconciliation-test",
        policyExpiresAt: "2026-08-21T00:00:00.000Z",
        tenantAllowlist: ["acme"],
        countryAllowlist: ["FR"],
      },
      provider: "nicoka",
      approvedTenantId: "acme",
      countryCode: "FR",
      now: new Date("2026-07-21T00:00:00.000Z"),
    }).policyDigest;
    const records = await transport.fetch(new AbortController().signal);
    const jobs = records.map((record) => ({
      externalId: `acme:${record.id}`,
      fingerprint: record.uid,
    }));
    const scorecard = buildAtsRepeatedShadowScorecard([
      {
        runId: "nicoka-reconciled-a",
        capturedAt: "2026-07-21T00:00:00.000Z",
        provider: "nicoka",
        tenantId: "acme",
        countryCode: "FR",
        policyDigest,
        complete: true,
        requestCount: 2,
        jobs,
      },
      {
        runId: "nicoka-reconciled-b",
        capturedAt: "2026-07-22T00:00:00.000Z",
        provider: "nicoka",
        tenantId: "acme",
        countryCode: "FR",
        policyDigest,
        complete: true,
        requestCount: 2,
        jobs,
      },
    ]);
    expect(scorecard).toMatchObject({
      verdict: "complete_shadow_ready",
      canonicalWritesEnabled: false,
      provider: "nicoka",
      runIds: ["nicoka-reconciled-a", "nicoka-reconciled-b"],
      reconciliation: [{ additions: [], updates: [], removals: [] }],
    });
  });
});
