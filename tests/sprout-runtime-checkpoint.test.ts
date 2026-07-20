import { describe, expect, test } from "bun:test";
import {
  initialSproutCheckpoint,
  nextSproutCheckpoint,
  parseSproutNextOffset,
} from "../apps/worker/src/providers/sprout/checkpoint";
import {
  SPROUT_FRANCE_DISABLED_REGISTRATION,
  assertSproutActivationReady,
  type SproutActivation,
} from "../apps/worker/src/providers/sprout/registration";
import { runSproutPageTask } from "../apps/worker/src/providers/sprout/runtime";

function activeRegistration(): SproutActivation {
  return {
    ...SPROUT_FRANCE_DISABLED_REGISTRATION,
    authorizationStatus: "authorized",
    writerRuntime: "typescript",
    policyStatus: "approved",
    policyEvidenceRef: "policy-review-2026-07",
    redisplayAllowed: true,
    fullTextRetentionAllowed: true,
    credentialRef: "secret://sprout/france-api",
    approvedPageSize: 2,
    enabled: true,
    transportEnabled: true,
    backfillEnabled: true,
    providerCountryKillSwitch: false,
    sourceCountryKillSwitch: false,
  };
}

describe("Sprout checkpoint safety", () => {
  test("accepts only a rebuilt numeric or relative-query offset", () => {
    expect(parseSproutNextOffset(20)).toBe(20);
    expect(parseSproutNextOffset("?offset=20&limit=10")).toBe(20);
    expect(() =>
      parseSproutNextOffset("https://api.usesprout.com/jobs?offset=20"),
    ).toThrow("sprout_checkpoint_untrusted_next");
    expect(() => parseSproutNextOffset("?offset=-1")).toThrow(
      "sprout_checkpoint_invalid_next_offset",
    );
  });

  test("requires strict progress by the returned item count", () => {
    const current = initialSproutCheckpoint({ approvedPageSize: 10 });
    expect(
      nextSproutCheckpoint({
        current,
        returnedItemCount: 10,
        sourceReportedTotal: 25,
        next: "?offset=10&limit=10",
      }).checkpoint.offset,
    ).toBe(10);
    expect(() =>
      nextSproutCheckpoint({
        current,
        returnedItemCount: 10,
        sourceReportedTotal: 25,
        next: "?offset=20",
      }),
    ).toThrow("sprout_checkpoint_non_monotonic_offset");
  });
});

describe("Sprout activation and bounded page runtime", () => {
  test("ships disabled, unverified, writerless and killed for FR", () => {
    expect(SPROUT_FRANCE_DISABLED_REGISTRATION).toMatchObject({
      authorizationStatus: "unverified",
      writerRuntime: "none",
      enabled: false,
      transportEnabled: false,
      incrementalEnabled: false,
      backfillEnabled: false,
      providerCountryKillSwitch: true,
      sourceCountryKillSwitch: true,
      approvedPageSize: null,
      requestsPerMinute: 1,
      concurrency: 1,
    });
    expect(() =>
      assertSproutActivationReady(
        {
          ...SPROUT_FRANCE_DISABLED_REGISTRATION,
          policyEvidenceRef: null,
          redisplayAllowed: false,
          fullTextRetentionAllowed: false,
          credentialRef: "secret://sprout/france-api",
        },
        "backfill",
      ),
    ).toThrow("sprout_activation_blocked");
  });

  test("blocks before transport or repository access when authorization is absent", async () => {
    let fetches = 0;
    let commits = 0;
    const promise = runSproutPageTask({
      activation: {
        ...SPROUT_FRANCE_DISABLED_REGISTRATION,
        policyEvidenceRef: null,
        redisplayAllowed: false,
        fullTextRetentionAllowed: false,
        credentialRef: "secret://sprout/france-api",
      },
      mode: "backfill",
      checkpoint: initialSproutCheckpoint({ approvedPageSize: 1 }),
      transport: {
        async fetchPage() {
          fetches += 1;
          throw new Error("unexpected live API call");
        },
      },
      repository: {
        async commitPage(input) {
          commits += 1;
          return { committedCheckpoint: input.checkpointOut };
        },
      },
      hasFranceLocation: () => true,
      signal: new AbortController().signal,
      maxResponseBytes: 1_024,
    });

    await expect(promise).rejects.toThrow("sprout_activation_blocked");
    expect(fetches).toBe(0);
    expect(commits).toBe(0);
  });

  test("commits one bounded FR page and advances the checkpoint atomically", async () => {
    const commits: unknown[] = [];
    const result = await runSproutPageTask({
      activation: activeRegistration(),
      mode: "backfill",
      checkpoint: initialSproutCheckpoint({ approvedPageSize: 2 }),
      transport: {
        async fetchPage() {
          return {
            items: [{ id: "1", countries: ["FR"] }, { id: "2", countries: ["FR"] }],
            next: "?offset=2&limit=2",
            sourceReportedTotal: 3,
            responseBytes: 256,
            watermark: "2026-07-20T00:00:00.000Z",
          };
        },
      },
      repository: {
        async commitPage(input) {
          commits.push(input);
          return { committedCheckpoint: input.checkpointOut };
        },
      },
      hasFranceLocation: (row) => row.countries.includes("FR"),
      signal: new AbortController().signal,
      maxResponseBytes: 1_024,
      now: () => new Date("2026-07-20T01:00:00.000Z"),
    });
    expect(result).toMatchObject({ fetched: 2, complete: false });
    expect(result.checkpoint.offset).toBe(2);
    expect(commits).toHaveLength(1);
  });

  test("does not commit or advance on country leak, body breach, or cursor drift", async () => {
    for (const scenario of ["country", "bytes", "cursor"] as const) {
      let commits = 0;
      const promise = runSproutPageTask({
        activation: activeRegistration(),
        mode: "backfill",
        checkpoint: initialSproutCheckpoint({ approvedPageSize: 2 }),
        transport: {
          async fetchPage() {
            return {
              items: [
                { countries: scenario === "country" ? ["DE"] : ["FR"] },
              ],
              next: scenario === "cursor" ? "?offset=2" : "?offset=1",
              sourceReportedTotal: 3,
              responseBytes: scenario === "bytes" ? 2_000 : 100,
              watermark: null,
            };
          },
        },
        repository: {
          async commitPage(input) {
            commits += 1;
            return { committedCheckpoint: input.checkpointOut };
          },
        },
        hasFranceLocation: (row) => row.countries.includes("FR"),
        signal: new AbortController().signal,
        maxResponseBytes: 1_000,
      });
      await expect(promise).rejects.toThrow();
      expect(commits).toBe(0);
    }
  });
});
