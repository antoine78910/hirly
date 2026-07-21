import { describe, expect, test } from "bun:test";
import {
  initialSproutCheckpoint,
  nextSproutCheckpoint,
  parseSproutCheckpointOffset,
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
    canaryEnabled: true,
    backfillEnabled: true,
    providerCountryKillSwitch: false,
    sourceCountryKillSwitch: false,
    canaryEvidence: {
      status: "passed",
      evidenceRef: "artifact://sprout/canary-2026-07-21",
      pagesCommitted: 1,
      identityReadBack: true,
      rawSnapshotLinked: true,
      occurrenceLinked: true,
      checkpointReadBack: true,
      singleWriterVerified: true,
    },
    rollbackEvidence: {
      status: "passed",
      evidenceRef: "artifact://sprout/rollback-2026-07-21",
      providerKillSwitchVerified: true,
      sourceKillSwitchVerified: true,
      scheduleDisableVerified: true,
      transportDisableVerified: true,
      outstandingTasksStopVerified: true,
      writerClaimReleaseVerified: true,
    },
  };
}

describe("Sprout checkpoint safety", () => {
  test("accepts only a rebuilt numeric or relative-query offset", () => {
    expect(parseSproutCheckpointOffset(20)).toBe(20);
    expect(parseSproutCheckpointOffset("?offset=20&limit=10")).toBe(20);
    expect(() =>
      parseSproutCheckpointOffset(
        "https://api.usesprout.com/jobs?offset=20",
      ),
    ).toThrow("sprout_checkpoint_untrusted_next");
    expect(() => parseSproutCheckpointOffset("?offset=-1")).toThrow(
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
    expect(
      nextSproutCheckpoint({
        current,
        returnedItemCount: 10,
        sourceReportedTotal: 25,
        next: "?offset=20",
      }),
    ).toMatchObject({ checkpoint: { offset: 20 }, complete: false });
  });

  test("continues when the source-reported total drifts between pages", () => {
    const first = nextSproutCheckpoint({
      current: initialSproutCheckpoint({ approvedPageSize: 10 }),
      returnedItemCount: 10,
      sourceReportedTotal: 25,
      next: "?offset=10",
    });
    expect(
      nextSproutCheckpoint({
        current: first.checkpoint,
        returnedItemCount: 10,
        sourceReportedTotal: 26,
        next: "?offset=20",
      }),
    ).toMatchObject({ checkpoint: { offset: 20, observedTotal: 26 }, complete: false });
  });
});

describe("Sprout activation and bounded page runtime", () => {
  test("ships disabled, unverified, writerless and killed for FR", () => {
    expect(SPROUT_FRANCE_DISABLED_REGISTRATION).toMatchObject({
      authorizationStatus: "unverified",
      writerRuntime: "none",
      enabled: false,
      transportEnabled: false,
      canaryEnabled: false,
      incrementalEnabled: false,
      backfillEnabled: false,
      providerCountryKillSwitch: true,
      sourceCountryKillSwitch: true,
      approvedPageSize: null,
      requestsPerMinute: 20,
      concurrency: 1,
    });
    expect(() =>
      assertSproutActivationReady(
        {
          ...activeRegistration(),
          authorizationStatus: "unverified",
          writerRuntime: "none",
          enabled: false,
          transportEnabled: false,
          canaryEnabled: false,
          backfillEnabled: false,
          providerCountryKillSwitch: true,
          sourceCountryKillSwitch: true,
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
        ...activeRegistration(),
        authorizationStatus: "unverified",
        writerRuntime: "none",
        enabled: false,
        transportEnabled: false,
        canaryEnabled: false,
        backfillEnabled: false,
        providerCountryKillSwitch: true,
        sourceCountryKillSwitch: true,
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

  test("blocks production modes before canary read-back and rollback evidence pass", async () => {
    for (const incomplete of [
      {
        canaryEvidence: {
          ...activeRegistration().canaryEvidence,
          checkpointReadBack: false,
        },
      },
      {
        rollbackEvidence: {
          ...activeRegistration().rollbackEvidence,
          writerClaimReleaseVerified: false,
        },
      },
    ]) {
      let fetches = 0;
      let commits = 0;
      const promise = runSproutPageTask({
        activation: { ...activeRegistration(), ...incomplete },
        mode: "backfill",
        checkpoint: initialSproutCheckpoint({ approvedPageSize: 2 }),
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

      await expect(promise).rejects.toThrow(
        "sprout_release_evidence_incomplete",
      );
      expect(fetches).toBe(0);
      expect(commits).toBe(0);
    }
  });

  test("commits one bounded FR page and advances the checkpoint atomically", async () => {
    const transportInputs: unknown[] = [];
    const commits: unknown[] = [];
    const result = await runSproutPageTask({
      activation: {
        ...activeRegistration(),
        canaryEvidence: {
          ...activeRegistration().canaryEvidence,
          status: "pending",
          evidenceRef: null,
          pagesCommitted: 0,
        },
      },
      mode: "canary",
      checkpoint: initialSproutCheckpoint({ approvedPageSize: 2 }),
      transport: {
        async fetchPage(input) {
          transportInputs.push(input);
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
    expect(transportInputs).toEqual([
      {
        countryCode: "FR",
        offset: 0,
        pageSize: 2,
        credentialRef: "secret://sprout/france-api",
      },
    ]);
    expect(commits).toHaveLength(1);
    expect(JSON.stringify(commits)).not.toContain("credentialRef");
    expect(JSON.stringify(commits)).not.toContain("secret://");
  });

  test("allows only an initial one-page canary checkpoint", async () => {
    let fetches = 0;
    const promise = runSproutPageTask({
      activation: {
        ...activeRegistration(),
        canaryEvidence: {
          ...activeRegistration().canaryEvidence,
          status: "pending",
          evidenceRef: null,
          pagesCommitted: 0,
        },
        rollbackEvidence: {
          ...activeRegistration().rollbackEvidence,
          status: "pending",
          evidenceRef: null,
        },
      },
      mode: "canary",
      checkpoint: {
        ...initialSproutCheckpoint({ approvedPageSize: 2 }),
        offset: 2,
        observedTotal: 3,
      },
      transport: {
        async fetchPage() {
          fetches += 1;
          throw new Error("unexpected live API call");
        },
      },
      repository: {
        async commitPage(input) {
          return { committedCheckpoint: input.checkpointOut };
        },
      },
      hasFranceLocation: () => true,
      signal: new AbortController().signal,
      maxResponseBytes: 1_024,
    });

    await expect(promise).rejects.toThrow(
      "sprout_canary_must_start_at_initial_checkpoint",
    );
    expect(fetches).toBe(0);

    expect(() => assertSproutActivationReady(activeRegistration(), "canary")).toThrow(
      "sprout_canary_already_committed",
    );
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
      if (scenario === "cursor") {
        await expect(promise).resolves.toMatchObject({ checkpoint: { offset: 2 } });
        expect(commits).toBe(1);
      } else {
        await expect(promise).rejects.toThrow();
        expect(commits).toBe(0);
      }
    }
  });

  test("advances past quarantined response listings without losing later valid pages", async () => {
    const commits: Array<{ itemCount: number; offset: number }> = [];
    const result = await runSproutPageTask({
      activation: activeRegistration(),
      mode: "backfill",
      checkpoint: initialSproutCheckpoint({ approvedPageSize: 2 }),
      transport: {
        async fetchPage() {
          return {
            items: [
              {
                id: "valid",
                company: "Example SAS",
                title: "Engineer",
                locations: [{ countryCode: "FR", country: "France" }],
              },
            ],
            returnedItemCount: 2,
            rejected: 1,
            next: "?offset=2",
            sourceReportedTotal: 3,
            responseBytes: 128,
            watermark: null,
          };
        },
      },
      repository: {
        async commitPage(page) {
          commits.push({ itemCount: page.items.length, offset: page.checkpointOut.offset });
          return { committedCheckpoint: page.checkpointOut, inserted: 1, rejected: 0 };
        },
      },
      hasFranceLocation: () => true,
      signal: new AbortController().signal,
      maxResponseBytes: 1_024,
    });

    expect(commits).toEqual([{ itemCount: 1, offset: 2 }]);
    expect(result).toMatchObject({ fetched: 2, rejected: 1, checkpoint: { offset: 2 } });
  });
});
