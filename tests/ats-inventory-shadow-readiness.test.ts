import { describe, expect, test } from "bun:test";
import {
  approveAtsInventoryShadowScope,
  AtsShadowRefusal,
  buildAtsRepeatedShadowScorecard,
  expiryDispositionAfterShadowFailure,
} from "../apps/worker/src/providers/ats-inventory-readiness";
import { createApprovedGreenhouseShadowTransport } from "../apps/worker/src/providers/greenhouse";
import { createApprovedRecruiteeShadowTransport } from "../apps/worker/src/providers/recruitee";
import { createApprovedNicokaShadowTransport } from "../apps/worker/src/providers/nicoka";

const now = new Date("2026-07-21T00:00:00.000Z");

function policy(provider: "greenhouse" | "recruitee" | "nicoka" = "greenhouse") {
  return {
    schemaVersion: 1,
    provider,
    mode: "shadow",
    canonicalWritesEnabled: false,
    policyId: `approved-${provider}`,
    policyExpiresAt: "2026-08-21T00:00:00.000+00:00",
    tenantAllowlist: ["Other_Tenant", "VaultTec"],
    countryAllowlist: ["US", "fr"],
  };
}

function approve(provider: "greenhouse" | "recruitee" | "nicoka", input = policy(provider)) {
  return approveAtsInventoryShadowScope({
    policy: input,
    provider,
    approvedTenantId: "VAULTTEC",
    countryCode: "fr",
    now,
  });
}

describe("ATS inventory production shadow readiness", () => {
  test("approves an exact future scope with canonical normalization and digest", () => {
    const first = approve("greenhouse");
    const second = approve("greenhouse", {
      ...policy(),
      tenantAllowlist: ["vaulttec", "other_tenant"],
      countryAllowlist: ["FR", "US"],
    });
    expect(first).toMatchObject({
      approvedTenantId: "vaulttec",
      countryCode: "FR",
      policy: { tenantAllowlist: ["other_tenant", "vaulttec"], countryAllowlist: ["US", "FR"] },
    });
    expect(first.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.policyDigest).toBe(second.policyDigest);
  });

  test("fails closed on invalid, mismatched, expired, duplicate, or unlisted policy", () => {
    const invalidPolicies = [
      { ...policy("recruitee") },
      { ...policy(), policyExpiresAt: now.toISOString() },
      { ...policy(), policyExpiresAt: "2026-07-20T23:59:59.000+00:00" },
      { ...policy(), tenantAllowlist: ["other"] },
      { ...policy(), countryAllowlist: ["US"] },
      { ...policy(), tenantAllowlist: [] },
      { ...policy(), tenantAllowlist: ["*"] },
      { ...policy(), tenantAllowlist: ["VaultTec", "vaulttec"] },
      { ...policy(), countryAllowlist: ["FR", "fr"] },
      { ...policy(), canonicalWritesEnabled: true },
      { ...policy(), policyId: "" },
      { ...policy(), mode: "live" },
    ];
    for (const invalid of invalidPolicies) {
      expect(() => approve("greenhouse", invalid as ReturnType<typeof policy>)).toThrow(
        AtsShadowRefusal,
      );
      try {
        approve("greenhouse", invalid as ReturnType<typeof policy>);
      } catch (error) {
        expect(error).toMatchObject({ code: "ATS_SHADOW_REFUSED" });
      }
    }
  });

  test("approved wrappers are default-off, lazy, and expose policy metadata", () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return Response.json({ jobs: [] });
    };
    const greenhouse = createApprovedGreenhouseShadowTransport({
      approvedTenantId: "vaulttec",
      countryCode: "FR",
      policy: policy(),
      now,
      fetch,
    });
    const recruitee = createApprovedRecruiteeShadowTransport({
      approvedTenantId: "vaulttec",
      countryCode: "FR",
      policy: policy("recruitee"),
      now,
      fetch: async () => {
        calls += 1;
        return Response.json({ offers: [] });
      },
    });
    const nicoka = createApprovedNicokaShadowTransport({
      approvedTenantId: "vaulttec",
      countryCode: "FR",
      policy: policy("nicoka"),
      now,
      environment: "production",
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    expect(calls).toBe(0);
    for (const transport of [greenhouse, recruitee, nicoka]) {
      expect(transport).toMatchObject({
        productionShadowApproved: true,
        shadowOnly: true,
        trialOnly: true,
        manualInvocationOnly: true,
        liveTransportReady: false,
        canonicalWriteReady: false,
        credentialsAccepted: false,
        approvedTenantId: "vaulttec",
        countryCode: "FR",
      });
      expect(transport.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("rejects mismatch before the injected fetch can run", () => {
    let calls = 0;
    expect(() =>
      createApprovedGreenhouseShadowTransport({
        approvedTenantId: "other",
        countryCode: "FR",
        policy: policy(),
        now,
        fetch: async () => {
          calls += 1;
          return Response.json({ jobs: [] });
        },
      }),
    ).toThrow(AtsShadowRefusal);
    expect(calls).toBe(0);
  });

  test("approved wrappers retain official GET hosts and omit credentials", async () => {
    const observed: Array<[string, RequestInit]> = [];
    const greenhouse = createApprovedGreenhouseShadowTransport({
      approvedTenantId: "vaulttec",
      countryCode: "FR",
      policy: policy(),
      now,
      fetch: async (url, init) => {
        observed.push([url, init]);
        return Response.json({ jobs: [], meta: { total: 0 } });
      },
    });
    const recruitee = createApprovedRecruiteeShadowTransport({
      approvedTenantId: "vaulttec",
      countryCode: "FR",
      policy: policy("recruitee"),
      now,
      fetch: async (url, init) => {
        observed.push([url, init]);
        return Response.json({ offers: [] });
      },
    });
    const nicoka = createApprovedNicokaShadowTransport({
      approvedTenantId: "vaulttec",
      countryCode: "FR",
      policy: policy("nicoka"),
      now,
      environment: "production",
      fetch: async (url, init) => {
        observed.push([url, init]);
        return Response.json({
          queryUid: "complete",
          offset: 0,
          limit: 0,
          page: 1,
          pages: 1,
          total: 0,
          data: [],
        });
      },
    });
    await greenhouse.fetch(new AbortController().signal);
    await recruitee.fetch(new AbortController().signal);
    await nicoka.fetch(new AbortController().signal);
    expect(observed.map(([url]) => url)).toEqual([
      "https://boards-api.greenhouse.io/v1/boards/vaulttec/jobs?content=true",
      "https://vaulttec.recruitee.com/api/offers/?format=json",
      "https://vaulttec.nicoka.com/api/jobs/published?page=1",
    ]);
    for (const [, init] of observed) {
      expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    }
  });

  test("reconciles two complete runs deterministically", () => {
    const digest = approve("nicoka").policyDigest;
    const scorecard = buildAtsRepeatedShadowScorecard([
      {
        runId: "run-b",
        capturedAt: "2026-07-22T00:00:00.000+00:00",
        provider: "nicoka",
        tenantId: "vaulttec",
        countryCode: "FR",
        policyDigest: digest,
        complete: true,
        requestCount: 1,
        jobs: [
          { externalId: "3", fingerprint: "c" },
          { externalId: "2", fingerprint: "changed" },
        ],
      },
      {
        runId: "run-a",
        capturedAt: "2026-07-21T00:00:00.000+00:00",
        provider: "nicoka",
        tenantId: "vaulttec",
        countryCode: "fr",
        policyDigest: digest,
        complete: true,
        requestCount: 1,
        jobs: [
          { externalId: "2", fingerprint: "b" },
          { externalId: "1", fingerprint: "a" },
        ],
      },
    ]);
    expect(scorecard).toMatchObject({
      verdict: "complete_shadow_ready",
      canonicalWritesEnabled: false,
      runIds: ["run-a", "run-b"],
      reconciliation: [{ additions: ["3"], updates: ["2"], removals: ["1"] }],
    });
    expect(scorecard.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(
      buildAtsRepeatedShadowScorecard(
        [
          ...[
            {
              runId: "run-b",
              capturedAt: "2026-07-22T00:00:00.000+00:00",
              provider: "nicoka",
              tenantId: "vaulttec",
              countryCode: "FR",
              policyDigest: digest,
              complete: true,
              requestCount: 1,
              jobs: [
                { externalId: "3", fingerprint: "c" },
                { externalId: "2", fingerprint: "changed" },
              ],
            },
            {
              runId: "run-a",
              capturedAt: "2026-07-21T00:00:00.000+00:00",
              provider: "nicoka",
              tenantId: "vaulttec",
              countryCode: "FR",
              policyDigest: digest,
              complete: true,
              requestCount: 1,
              jobs: [
                { externalId: "2", fingerprint: "b" },
                { externalId: "1", fingerprint: "a" },
              ],
            },
          ],
        ].reverse(),
      ).evidenceDigest,
    ).toBe(scorecard.evidenceDigest);
  });

  test("rejects incomplete, drifting, or duplicate run evidence", () => {
    const digest = approve("greenhouse").policyDigest;
    const base = {
      runId: "a",
      capturedAt: "2026-07-21T00:00:00.000+00:00",
      provider: "greenhouse",
      tenantId: "vaulttec",
      countryCode: "FR",
      policyDigest: digest,
      complete: true,
      requestCount: 1,
      jobs: [{ externalId: "1", fingerprint: "a" }],
    };
    const valid = { ...base, runId: "b", capturedAt: "2026-07-22T00:00:00.000+00:00" };
    const invalidSets = [
      [base],
      [base, { ...valid, complete: false }],
      [base, { ...valid, tenantId: "other" }],
      [base, { ...valid, policyDigest: "b".repeat(64) }],
      [base, { ...valid, runId: "a" }],
      [base, { ...valid, capturedAt: base.capturedAt }],
      [
        base,
        {
          ...valid,
          jobs: [
            { externalId: "1", fingerprint: "a" },
            { externalId: "1", fingerprint: "b" },
          ],
        },
      ],
    ];
    for (const runs of invalidSets)
      expect(() => buildAtsRepeatedShadowScorecard(runs)).toThrow(AtsShadowRefusal);
  });

  test("permits Greenhouse but keeps Recruitee fail-closed for complete snapshots", () => {
    const greenhouseDigest = approve("greenhouse").policyDigest;
    expect(
      buildAtsRepeatedShadowScorecard([
        {
          runId: "a",
          capturedAt: "2026-07-21T00:00:00.000+00:00",
          provider: "greenhouse",
          tenantId: "vaulttec",
          countryCode: "FR",
          policyDigest: greenhouseDigest,
          complete: true,
          requestCount: 1,
          jobs: [{ externalId: "1", fingerprint: "a" }],
        },
        {
          runId: "b",
          capturedAt: "2026-07-22T00:00:00.000+00:00",
          provider: "greenhouse",
          tenantId: "vaulttec",
          countryCode: "FR",
          policyDigest: greenhouseDigest,
          complete: true,
          requestCount: 1,
          jobs: [{ externalId: "1", fingerprint: "a" }],
        },
      ]),
    ).toMatchObject({ provider: "greenhouse", verdict: "complete_shadow_ready" });

    const recruiteeDigest = approve("recruitee").policyDigest;
    const recruiteeRun = {
      capturedAt: "2026-07-21T00:00:00.000+00:00",
      provider: "recruitee" as const,
      tenantId: "vaulttec",
      countryCode: "FR",
      policyDigest: recruiteeDigest,
      complete: true,
      requestCount: 1,
      jobs: [{ externalId: "1", fingerprint: "a" }],
    };
    expect(() =>
      buildAtsRepeatedShadowScorecard([
        { ...recruiteeRun, runId: "a" },
        { ...recruiteeRun, runId: "b", capturedAt: "2026-07-22T00:00:00.000+00:00" },
      ]),
    ).toThrow("recruitee public transport cannot prove complete snapshots");
  });

  test("complete empty snapshots can report removals without expiry mutation", () => {
    const digest = approve("nicoka").policyDigest;
    const scorecard = buildAtsRepeatedShadowScorecard([
      {
        runId: "a",
        capturedAt: "2026-07-21T00:00:00.000+00:00",
        provider: "nicoka",
        tenantId: "vaulttec",
        countryCode: "FR",
        policyDigest: digest,
        complete: true,
        requestCount: 1,
        jobs: [{ externalId: "1", fingerprint: "a" }],
      },
      {
        runId: "b",
        capturedAt: "2026-07-22T00:00:00.000+00:00",
        provider: "nicoka",
        tenantId: "vaulttec",
        countryCode: "FR",
        policyDigest: digest,
        complete: true,
        requestCount: 1,
        jobs: [],
      },
    ]);
    expect(scorecard.reconciliation[0]?.removals).toEqual(["1"]);
    expect(expiryDispositionAfterShadowFailure()).toEqual({
      expireMissingJobs: false,
      reason: "incomplete_or_failed_shadow_run",
    });
  });
});
