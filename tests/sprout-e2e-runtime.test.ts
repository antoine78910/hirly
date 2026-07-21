import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/sprout/france-page.sanitized.json";
import { sourcePageCommitSchema } from "../packages/contracts/src/index";
import type { RuntimeStore } from "../apps/worker/src/runtime/types";
import { createTaskHandlers } from "../apps/worker/src/runtime/handlers";
import {
  SproutHttpTransport,
  buildSproutCommitEntry,
  initialSproutCheckpoint,
  parseSproutResponse,
} from "../apps/worker/src/providers/sprout";

const sourceId = "11111111-1111-4111-8111-111111111111";
const policyId = "22222222-2222-4222-8222-222222222222";

function task() {
  return {
    taskId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    taskKey: "sprout:france:0",
    taskType: "provider.fetch_page",
    provider: "sprout",
    payload: { sourceId, mode: "backfill", maxResponseBytes: 1_000_000 },
    leaseToken: "55555555-5555-4555-8555-555555555555",
    claimGeneration: 1n,
    leaseOwner: "test-worker",
    attempts: 1,
    maxAttempts: 3,
    leaseUntil: new Date(Date.now() + 60_000),
  };
}

describe("Sprout authenticated transport", () => {
  test("uses only the allowlisted HTTPS origin, omits cookies, and consumes jobs once", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const transport = new SproutHttpTransport({
      endpoint: "https://api.sprout.invalid/jobs",
      allowedOrigins: ["https://api.sprout.invalid"],
      maxResponseBytes: 1_000_000,
      secrets: { async resolve() { return "fixture-token"; } },
      fetch: (async (input, init) => {
        calls.push({ url: new URL(String(input)), init: init ?? {} });
        return Response.json(fixture);
      }) as typeof fetch,
    });

    const page = await transport.fetchPage(
      { countryCode: "FR", offset: 0, pageSize: 2, credentialRef: "secret://sprout/france-api" },
      new AbortController().signal,
    );

    expect(page.items).toHaveLength(2);
    expect(page.wrapperMismatch).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.origin).toBe("https://api.sprout.invalid");
    expect(calls[0]?.url.searchParams.get("location[countryCode]")).toBe("FR");
    expect(calls[0]?.init).toMatchObject({ redirect: "manual", credentials: "omit" });
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer fixture-token");
  });

  test("fails closed on origins, redirects, auth failures, and response budgets", async () => {
    expect(() => new SproutHttpTransport({
      endpoint: "http://api.sprout.invalid/jobs",
      allowedOrigins: ["https://api.sprout.invalid"],
      maxResponseBytes: 10,
      secrets: { async resolve() { return "token"; } },
    })).toThrow("sprout_transport_origin_not_allowed");

    for (const response of [
      new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }),
      new Response(null, { status: 401 }),
      new Response("01234567890", { status: 200 }),
    ]) {
      const transport = new SproutHttpTransport({
        endpoint: "https://api.sprout.invalid/jobs",
        allowedOrigins: ["https://api.sprout.invalid"],
        maxResponseBytes: 10,
        maxAttempts: 1,
        secrets: { async resolve() { return "never-log-this-token"; } },
        fetch: (async () => response) as typeof fetch,
      });
      await expect(transport.fetchPage(
        { countryCode: "FR", offset: 0, pageSize: 1, credentialRef: "secret://sprout/france-api" },
        new AbortController().signal,
      )).rejects.toThrow();
    }
  });
});

describe("Sprout source commit pipeline", () => {
  test("normalizes, validates, canonicalizes tracking URLs, and preserves sanitized source evidence", () => {
    const raw = parseSproutResponse(fixture).jobs[0]!;
    const entry = buildSproutCommitEntry({
      raw,
      policyId,
      fetchedAt: new Date("2026-07-21T00:00:00.000Z"),
    });
    expect(entry.canonical).toMatchObject({
      provider: "sprout",
      externalId: "101",
      city: "Paris",
      region: "Île-de-France",
      salaryMin: 50_000,
      salaryMax: 70_000,
      currency: "EUR",
      postedAt: "2026-07-18T08:00:00.000Z",
    });
    expect(entry.canonicalApplyUrl).toBe("https://jobs.lever.co/example/abc-101");
    expect(entry.atsPostingId).toBe("abc-101");
    expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.sourceDocument).toEqual(raw);
  });

  test("runs fetch-to-atomic-source-commit through the production task handler", async () => {
    const commits: unknown[] = [];
    let released = 0;
    const store = {
      async assertProviderRunnable() {},
      async claimProviderWork() {
        return {
          claimId: "66666666-6666-4666-8666-666666666666",
          provider: "sprout" as const,
          runtime: "typescript" as const,
          ownershipEpoch: 1n,
          expiresAt: new Date(Date.now() + 60_000),
        };
      },
      async heartbeatProviderWork() { return true; },
      async finishProviderWork() { return true; },
      async releaseProviderWork() { released += 1; return true; },
      async writeJobsAndComplete() { throw new Error("legacy writer must not run"); },
      async getSproutSourceRuntime() {
        return {
          sourceId,
          policyId,
          endpoint: "https://api.sprout.invalid/jobs",
          credentialRef: "secret://sprout/france-api",
          approvedPageSize: 2,
          checkpoint: initialSproutCheckpoint({ approvedPageSize: 2 }),
          policyEvidenceRef: "reviewed-policy",
        };
      },
      async commitSproutSourcePage(_lease: unknown, _claim: unknown, commit: unknown) {
        commits.push(commit);
        const parsed = sourcePageCommitSchema.parse(commit);
        return {
          snapshotsInserted: parsed.entries.length,
          canonicalUpserts: parsed.entries.length,
          occurrencesUpserted: parsed.entries.length,
          groupsCreated: parsed.entries.length,
          checkpoint: parsed.checkpointOut,
        };
      },
    } as unknown as RuntimeStore;
    const handler = createTaskHandlers(store, undefined, undefined, {
      sproutAllowedOrigins: ["https://api.sprout.invalid"],
      sproutSecretResolver: { async resolve() { return "fixture-token"; } },
      sproutFetch: (async () => Response.json(fixture)) as typeof fetch,
      providerClaimHeartbeatMs: 10_000,
    })["provider.fetch_page"]!;

    await expect(handler(task(), new AbortController().signal)).resolves.toEqual({ taskCompleted: true });
    expect(commits).toHaveLength(1);
    const commit = sourcePageCommitSchema.parse(commits[0]);
    expect(commit.entries).toHaveLength(2);
    expect(commit.checkpointOut).toMatchObject({ offset: 2, pageSize: 2, observedTotal: 3 });
    expect(released).toBe(0);
  });
});
