import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/sprout/france-page.sanitized.json";
import { sourcePageCommitSchema } from "../packages/contracts/src/index";
import type { RuntimeStore } from "../apps/worker/src/runtime/types";
import {
  createTaskHandlers,
  sproutDiscoveryProfile,
} from "../apps/worker/src/runtime/handlers";
import { createJsonLogger } from "../packages/observability/src/index";
import {
  SproutHttpTransport,
  buildSproutCommitEntry,
  initialSproutCheckpoint,
  parseSproutResponse,
  runSproutPageSizeQualification,
  runSproutQualificationMatrix,
  sproutTaskPayloadSchema,
} from "../apps/worker/src/providers/sprout";

const sourceId = "11111111-1111-4111-8111-111111111111";
const policyId = "22222222-2222-4222-8222-222222222222";

function task(mode: "canary" | "backfill" | "incremental" = "backfill") {
  return {
    taskId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    taskKey: "sprout:france:0",
    taskType: "provider.fetch_page",
    provider: "sprout",
    payload: { sourceId, mode, maxResponseBytes: 1_000_000 },
    leaseToken: "55555555-5555-4555-8555-555555555555",
    claimGeneration: 1n,
    leaseOwner: "test-worker",
    attempts: 1,
    maxAttempts: 3,
    leaseUntil: new Date(Date.now() + 60_000),
  };
}

describe("Sprout authenticated transport", () => {
  test("uses an immutable query profile for each checkpoint lane", () => {
    expect(sproutDiscoveryProfile("sprout:france")).toEqual({
      filterVariant: "global_unfiltered",
      includeUnknownWorkLocation: true,
    });
    expect(sproutDiscoveryProfile("sprout:france:country-only")).toEqual({
      filterVariant: "global_unfiltered",
      includeUnknownWorkLocation: true,
    });
    expect(() => sproutDiscoveryProfile("sprout:france:unapproved")).toThrow(
      "sprout_unknown_discovery_lane",
    );
  });

  test("accepts legacy chained-task counters without blocking recovery", () => {
    expect(sproutTaskPayloadSchema.parse({
      sourceId,
      mode: "backfill",
      maxResponseBytes: 1_000_000,
      emptyInsertStreak: 3,
    }).emptyInsertStreak).toBe(3);
  });

  test("uses only the allowlisted HTTPS origin, omits cookies, and consumes jobs once", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const transport = new SproutHttpTransport({
      endpoint: "https://api.sprout.invalid/jobs",
      allowedOrigins: ["https://api.sprout.invalid"],
      maxResponseBytes: 1_000_000,
      secrets: {
        async resolve() {
          return {
            accessToken: "fixture-access-token",
            refreshToken: "fixture-refresh-token",
          };
        },
      },
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
    expect(calls[0]?.url.searchParams.has("location[countryCode]")).toBe(false);
    expect(calls[0]?.init).toMatchObject({ redirect: "manual", credentials: "omit" });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer fixture-access-token");
    expect(headers.get("x-refresh-token")).toBe("fixture-refresh-token");
  });

  test("reports allowlisted response and retry/backoff telemetry", async () => {
    const operations: unknown[] = [];
    const sleeps: number[] = [];
    let requests = 0;
    const transport = new SproutHttpTransport({
      endpoint: "https://api.sprout.invalid/jobs",
      allowedOrigins: ["https://api.sprout.invalid"],
      maxResponseBytes: 1_000_000,
      secrets: {
        async resolve() {
          return { accessToken: "private-access", refreshToken: "private-refresh" };
        },
      },
      fetch: (async () => {
        requests += 1;
        return requests === 1
          ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
          : Response.json(fixture);
      }) as typeof fetch,
      sleep: async (milliseconds) => { sleeps.push(milliseconds); },
      onOperation(operation) { operations.push(operation); },
    });

    await transport.fetchPage(
      { countryCode: "FR", offset: 0, pageSize: 2, credentialRef: "secret://sprout/france-api" },
      new AbortController().signal,
    );

    expect(sleeps).toEqual([0]);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      type: "retry_backoff",
      attempt: 1,
      nextAttempt: 2,
      status: 429,
      classification: "rate_limited",
      backoffMs: 0,
    });
    expect(operations[1]).toMatchObject({
      type: "fetch_response",
      attempt: 2,
      status: 200,
      itemCount: 2,
    });
    expect(JSON.stringify(operations)).not.toContain("private-access");
    expect(JSON.stringify(operations)).not.toContain("private-refresh");
  });

  test("quarantines malformed listings and emits sanitized schema diagnostics", async () => {
    const operations: unknown[] = [];
    const transport = new SproutHttpTransport({
      endpoint: "https://api.sprout.invalid/jobs",
      allowedOrigins: ["https://api.sprout.invalid"],
      maxResponseBytes: 1_000_000,
      secrets: {
        async resolve() {
          return { accessToken: "private-access", refreshToken: "private-refresh" };
        },
      },
      fetch: (async () => Response.json({
        jobs: [{ id: 1, company: "Example", title: "Role", locations: [], unknown: "do-not-log" }],
        count: 1,
        next: null,
        previous: null,
      })) as typeof fetch,
      onOperation(operation) { operations.push(operation); },
    });

    const page = await transport.fetchPage(
      { countryCode: "FR", offset: 0, pageSize: 2, credentialRef: "secret://sprout/france-api" },
      new AbortController().signal,
    );

    expect(page).toMatchObject({ items: [], returnedItemCount: 1, rejected: 1 });
    expect(operations).toMatchObject([
      {
        type: "fetch_response",
        itemCount: 0,
        rejectedCount: 1,
        schemaDiagnostics: [{ itemIndex: 0, code: "unrecognized_keys", path: "$" }],
      },
    ]);
    expect(JSON.stringify(operations)).not.toContain("do-not-log");
    expect(JSON.stringify(operations)).not.toContain("private-access");
  });

  test("fails closed before fetch when either runtime credential is unavailable", async () => {
    let fetches = 0;
    const transport = new SproutHttpTransport({
      endpoint: "https://api.sprout.invalid/jobs",
      allowedOrigins: ["https://api.sprout.invalid"],
      maxResponseBytes: 1_000_000,
      secrets: {
        async resolve() {
          return { accessToken: "private-access-token", refreshToken: "   " };
        },
      },
      fetch: (async () => {
        fetches += 1;
        return Response.json(fixture);
      }) as typeof fetch,
    });

    const failure = transport.fetchPage(
      { countryCode: "FR", offset: 0, pageSize: 1, credentialRef: "secret://sprout/france-api" },
      new AbortController().signal,
    );
    await expect(failure).rejects.toThrow("sprout_credential_unavailable");
    await failure.catch((error) => {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
      expect(serialized).not.toContain("private-access-token");
      expect(serialized).not.toContain("fixture-refresh-token");
    });
    expect(fetches).toBe(0);
  });

  test("fails closed on origins, redirects, auth failures, and response budgets", async () => {
    expect(() => new SproutHttpTransport({
      endpoint: "http://api.sprout.invalid/jobs",
      allowedOrigins: ["https://api.sprout.invalid"],
      maxResponseBytes: 10,
      secrets: {
        async resolve() {
          return { accessToken: "token", refreshToken: "refresh-token" };
        },
      },
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
        secrets: {
          async resolve() {
            return {
              accessToken: "never-log-this-access-token",
              refreshToken: "never-log-this-refresh-token",
            };
          },
        },
        fetch: (async () => response) as typeof fetch,
      });
      const failure = transport.fetchPage(
        { countryCode: "FR", offset: 0, pageSize: 1, credentialRef: "secret://sprout/france-api" },
        new AbortController().signal,
      );
      await expect(failure).rejects.toThrow();
      await failure.catch((error) => {
        const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
        expect(serialized).not.toContain("never-log-this-access-token");
        expect(serialized).not.toContain("never-log-this-refresh-token");
      });
    }
  });
});

describe("Sprout source commit pipeline", () => {
  test("bounds semantic and page-size qualification without writes", async () => {
    const queries: URLSearchParams[] = [];
    const requester = {
      async request(query: URLSearchParams) {
        queries.push(query);
        return { parsed: parseSproutResponse(fixture), responseBytes: 512 };
      },
    };
    const sleep = async () => {};
    const signal = new AbortController().signal;

    const matrix = await runSproutQualificationMatrix({
      requester,
      signal,
      delayMs: 2_000,
      sleep,
    });
    expect(matrix).toHaveLength(6);
    expect(queries.every((query) => query.get("limit") === "1")).toBe(true);
    expect(queries.some((query) => query.has("location[radius]") === false)).toBe(true);
    expect(queries.some((query) => query.get("includeUnknownWorkLocation") === "true")).toBe(true);

    const pageSizes = await runSproutPageSizeQualification({
      pageSizes: [10, 50, 100],
      requester,
      signal,
      delayMs: 2_000,
      maxResponseBytes: 1_024,
      sleep,
    });
    expect(pageSizes.map((entry) => entry.scenario)).toEqual([
      "page-size-10",
      "page-size-50",
      "page-size-100",
    ]);
    await expect(runSproutPageSizeQualification({
      pageSizes: [1, 2, 3, 4],
      requester,
      signal,
      delayMs: 2_000,
      maxResponseBytes: 1_024,
      sleep,
    })).rejects.toThrow("sprout_page_size_trial_request_budget_exceeded");
  });

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

  test("runs one initial canary page through the production task handler", async () => {
    const commits: unknown[] = [];
    const enqueued: unknown[] = [];
    const logLines: string[] = [];
    const cycleStarts: string[] = [];
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
      async beginSproutIncrementalCycle(_lease: unknown, _claim: unknown, currentSourceId: string) {
        cycleStarts.push(currentSourceId);
      },
      async getSproutSourceRuntime(_sourceId: string, mode: "canary" | "backfill" | "incremental") {
        return {
          sourceId,
          sourceKey: "sprout:france",
          countryCode: "FR",
          policyId,
          endpoint: "https://api.sprout.invalid/jobs",
          credentialRef: "secret://sprout/france-api",
          approvedPageSize: 2,
          checkpoint: initialSproutCheckpoint({ approvedPageSize: 2 }),
          policyEvidenceRef: "reviewed-policy",
          canaryEvidence: mode === "canary"
            ? {
              status: "pending" as const,
              evidenceRef: null,
              pagesCommitted: 0 as const,
              identityReadBack: false,
              rawSnapshotLinked: false,
              occurrenceLinked: false,
              checkpointReadBack: false,
              singleWriterVerified: false,
            }
            : {
              status: "passed" as const,
              evidenceRef: "canary-readback",
              pagesCommitted: 1 as const,
              identityReadBack: true,
              rawSnapshotLinked: true,
              occurrenceLinked: true,
              checkpointReadBack: true,
              singleWriterVerified: true,
            },
          rollbackEvidence: {
            status: "passed" as const,
            evidenceRef: "rollback-drill",
            providerKillSwitchVerified: true,
            sourceKillSwitchVerified: true,
            scheduleDisableVerified: true,
            transportDisableVerified: true,
            outstandingTasksStopVerified: true,
            writerClaimReleaseVerified: true,
          },
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
      async enqueue(input: unknown) {
        enqueued.push(input);
        return "77777777-7777-4777-8777-777777777777";
      },
      async attachCareerSource() {},
    } as unknown as RuntimeStore;
    const handler = createTaskHandlers(
      store,
      createJsonLogger((line) => logLines.push(line)),
      undefined,
      {
      sproutAllowedOrigins: ["https://api.sprout.invalid"],
      sproutSecretResolver: {
        async resolve() {
          return {
            accessToken: "fixture-access-token",
            refreshToken: "fixture-refresh-token",
          };
        },
      },
      sproutFetch: (async () => Response.json(fixture)) as typeof fetch,
      providerClaimHeartbeatMs: 10_000,
      },
    )["provider.fetch_page"]!;

    await expect(handler(task("canary"), new AbortController().signal)).resolves.toEqual({ taskCompleted: true });
    expect(commits).toHaveLength(1);
    const commit = sourcePageCommitSchema.parse(commits[0]);
    expect(commit.mode).toBe("canary");
    expect(commit.entries).toHaveLength(2);
    expect(commit.checkpointOut).toMatchObject({ offset: 2, pageSize: 2, observedTotal: 3 });
    expect(JSON.stringify(commits)).not.toContain("fixture-access-token");
    expect(JSON.stringify(commits)).not.toContain("fixture-refresh-token");
    expect(released).toBe(0);

    const events = logLines.map((line) => JSON.parse(line));
    expect(events.map((event) => event.event)).toEqual([
      "sprout.page_start",
      "sprout.fetch_response",
      "sprout.page_committed",
      "sprout.page_complete",
    ]);
    for (const event of events) {
      expect(event).toMatchObject({
        runId: task().runId,
        taskId: task().taskId,
        taskType: "provider.fetch_page",
        provider: "sprout",
      });
    }
    expect(events[1]).toMatchObject({
      details: { status: 200, responseBytes: expect.any(Number), itemCount: 2 },
    });
    expect(events[2]).toMatchObject({
      details: {
        itemCount: 2,
        checkpointInOffset: 0,
        checkpointOutOffset: 2,
        snapshotsInserted: 2,
        canonicalUpserts: 2,
      },
    });
    const serializedLogs = JSON.stringify(events);
    expect(serializedLogs).not.toContain("fixture-access-token");
    expect(serializedLogs).not.toContain("fixture-refresh-token");
    expect(serializedLogs).not.toContain("secret://");
    expect(serializedLogs).not.toContain("api.sprout.invalid");
    expect(serializedLogs).not.toContain(JSON.stringify(fixture.jobs[0]));

    await expect(
      handler(task("backfill"), new AbortController().signal),
    ).resolves.toEqual({ taskCompleted: true });
    expect(enqueued).toHaveLength(1);
    expect((enqueued[0] as { idempotencyKey: string }).idempotencyKey).toBe(
      `sprout:${sourceId}:backfill:11111111-1111-4111-8111-111111111111:2`,
    );

    const failedLines: string[] = [];
    const failedHandler = createTaskHandlers(
      store,
      createJsonLogger((line) => failedLines.push(line)),
      undefined,
      {
        sproutAllowedOrigins: ["https://api.sprout.invalid"],
        sproutSecretResolver: {
          async resolve() {
            throw {
              message: "Authorization: Basic private-auth Cookie: private-cookie",
              refreshToken: "private-refresh",
            };
          },
        },
        sproutFetch: (async () => Response.json(fixture)) as typeof fetch,
        providerClaimHeartbeatMs: 10_000,
      },
    )["provider.fetch_page"]!;
    await expect(
      failedHandler(task("canary"), new AbortController().signal),
    ).rejects.toThrow("sprout_credential_unavailable");
    const terminal = failedLines
      .map((line) => JSON.parse(line))
      .find((event) => event.event === "sprout.page_terminal");
    expect(terminal).toMatchObject({
      outcome: "failed",
      reasonCode: "authorization_blocked",
      details: { message: "sprout_credential_unavailable" },
    });
    expect(JSON.stringify(failedLines)).not.toContain("private-auth");
    expect(JSON.stringify(failedLines)).not.toContain("private-cookie");
    expect(JSON.stringify(failedLines)).not.toContain("private-refresh");

    const fallbackLines: string[] = [];
    const fallbackHandler = createTaskHandlers(
      store,
      createJsonLogger((line) => fallbackLines.push(line)),
      undefined,
      {
        sproutAllowedOrigins: ["https://api.sprout.invalid"],
        sproutSecretResolver: {
          async resolve() {
            return {
              accessToken: "fixture-access-token",
              refreshToken: "fixture-refresh-token",
            };
          },
        },
        sproutFetch: (async () => Response.json({
          message: "Jobs fetched successfully",
          jobs: [],
          count: 3,
          next: "?offset=0&limit=2",
          previous: null,
        })) as typeof fetch,
        providerClaimHeartbeatMs: 10_000,
      },
    )["provider.fetch_page"]!;
    await expect(
      fallbackHandler(task("backfill"), new AbortController().signal),
    ).resolves.toEqual({ taskCompleted: true });
    // An empty terminal page ends this lane. A distinct source owns the broad
    // country-only query, so a completed radius scan never reuses this
    // source's checkpoint with different query semantics.
    expect(enqueued).toHaveLength(0);
    expect(fallbackLines.map((line) => JSON.parse(line).event)).not.toContain(
      "sprout.filter_fallback",
    );

    const frontierHandler = createTaskHandlers(
      store,
      undefined,
      undefined,
      {
        sproutAllowedOrigins: ["https://api.sprout.invalid"],
        sproutSecretResolver: {
          async resolve() {
            return {
              accessToken: "fixture-access-token",
              refreshToken: "fixture-refresh-token",
            };
          },
        },
        sproutFetch: (async () => Response.json(fixture)) as typeof fetch,
        providerClaimHeartbeatMs: 10_000,
      },
    )["provider.fetch_page"]!;
    await expect(frontierHandler({
      ...task("incremental"),
      payload: {
        sourceId,
        mode: "incremental",
        maxResponseBytes: 1_000_000,
        cycleStart: true,
        pageCount: 0,
        maxPages: 1,
      },
    }, new AbortController().signal)).resolves.toEqual({ taskCompleted: true });
    expect(cycleStarts).toEqual([sourceId]);
    // The first frontier page has a provider continuation, but the bounded
    // scan intentionally ends after this page rather than replaying the full
    // historical corpus on every scheduled cycle.
    expect(enqueued).toHaveLength(0);
  });
});
