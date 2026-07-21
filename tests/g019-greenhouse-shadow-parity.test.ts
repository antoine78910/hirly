import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { SourceRegistryEntry } from "../packages/contracts/src";
import {
  toCanonicalJob,
  type SourceContext,
} from "../packages/ingestion/src";
import {
  createGreenhouseFixtureSourceAdapter,
  createGreenhouseShadowTransport,
  greenhouseProvider,
  greenhouseRawJobSchema,
} from "../apps/worker/src/providers/greenhouse";

const policyId = "00000000-0000-4000-8000-000000000019";

function context(entry: SourceRegistryEntry): SourceContext {
  return {
    source: entry,
    runId: "g019-greenhouse-parity",
    fetchedAt: new Date("2026-07-21T00:00:00.000Z"),
  };
}

describe("G019 Greenhouse shadow migration", () => {
  test("keeps canonical writes disabled while exposing explicit shadow readiness", () => {
    expect(greenhouseProvider.liveTransportReady).toBe(false);
    expect(greenhouseProvider.shadowModeReady).toBe(true);
    expect(greenhouseProvider.canonicalWriteReady).toBe(false);
  });

  test("shadow transport remains read-only and fixed-host", async () => {
    const transport = createGreenhouseShadowTransport({
      approvedTenantId: "vaulttec",
      fetch: async (input, init) => {
        expect(input).toBe(
          "https://boards-api.greenhouse.io/v1/boards/vaulttec/jobs?content=true",
        );
        expect(init.method).toBe("GET");
        expect(init.credentials).toBe("omit");
        expect(init.redirect).toBe("error");
        return Response.json({ jobs: [], meta: { total: 0 } });
      },
    });
    expect(await transport.fetch(new AbortController().signal)).toEqual([]);
    expect(transport).toMatchObject({
      shadowOnly: true,
      manualInvocationOnly: true,
      liveTransportReady: false,
      canonicalWriteReady: false,
      credentialsAccepted: false,
    });
  });

  test("rejects a response whose documented total is not a complete snapshot", async () => {
    const transport = createGreenhouseShadowTransport({
      approvedTenantId: "vaulttec",
      fetch: async () => Response.json({
        jobs: [{
          id: "127817",
          title: "Incomplete snapshot",
          location: { name: "Paris, France" },
          absolute_url: "https://boards.greenhouse.io/vaulttec/jobs/127817",
          content: "Read-only shadow fixture",
        }],
        meta: { total: 2 },
      }),
    });

    await expect(transport.fetch(new AbortController().signal)).rejects.toMatchObject({
      classification: "malformed",
      message: "Greenhouse shadow response total did not reconcile",
    });
  });

  test("matches the frozen Python/TypeScript parity fixture", async () => {
    const parity = JSON.parse(
      await readFile(
        new URL("./fixtures/g019/greenhouse-parity.json", import.meta.url),
        "utf8",
      ),
    );
    const raw = greenhouseRawJobSchema.parse(parity.raw);
    const entry: SourceRegistryEntry = {
      id: "00000000-0000-4000-8000-000000000020",
      provider: "greenhouse",
      sourceKey: `greenhouse:${parity.tenantKey}`,
      tenantKey: parity.tenantKey,
      countryCodes: [parity.countryCode],
      accessType: "public_api",
      policyId,
      enabled: false,
      transportEnabled: false,
      incrementalEnabled: false,
      backfillEnabled: false,
      checkpoint: { fixturePageSize: 1 },
    };
    const adapter = createGreenhouseFixtureSourceAdapter([raw], policyId);
    const occurrence = adapter.normalize(raw, context(entry));
    const canonical = toCanonicalJob(occurrence.job, context(entry).fetchedAt);
    expect({
      externalId: occurrence.externalId,
      providerJobId: occurrence.atsPostingId,
      title: occurrence.job.title,
      company: occurrence.job.company,
      location: occurrence.job.location,
      countryCode: occurrence.job.countryCode,
      description: occurrence.job.description,
      sourceUrl: occurrence.canonicalSourceUrl,
      applyUrl: occurrence.canonicalApplyUrl,
      validationTier: canonical.applyabilityTier,
      manualFulfillmentReady: canonical.manualFulfillmentReady,
      autoApplySupported: canonical.autoApplySupported,
    }).toEqual(parity.expected);
  });
});
