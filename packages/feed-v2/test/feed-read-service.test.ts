import { describe, expect, test } from "bun:test";
import {
  FEED_EFFECTIVE_QUERY_VERSION,
  FeedAuthorizationError,
  FeedCursorError,
  FeedV2ReadService,
  createFeedEffectiveQuery,
  type FeedAuthAssertion,
  type FeedCandidate,
  type FeedReadRepository,
  type FeedReadSnapshot,
} from "../src";

const assertion: FeedAuthAssertion = {
  subject: "user-1",
  candidateId: "candidate-1",
  scopes: ["feed:read"],
  issuedAt: "2026-07-21T10:00:00.000Z",
  expiresAt: "2026-07-21T13:00:00.000Z",
};

function candidate(
  id: string,
  score: number,
  overrides: Partial<FeedCandidate> = {},
): FeedCandidate {
  return {
    canonicalGroupId: id,
    preferredJobId: `job:${id}`,
    jobVersion: "1",
    companyKey: `company:${id}`,
    relevanceScore: score,
    fulfillmentRoute: "manual",
    actionExcluded: false,
    policyEligible: true,
    lifecycleEligible: true,
    ...overrides,
  };
}

function snapshot(
  candidates: readonly FeedCandidate[],
  overrides: Partial<FeedReadSnapshot> = {},
): FeedReadSnapshot {
  return {
    snapshotVersion: "inventory-7",
    profileVersion: "profile-3",
    actionWatermark: "actions-11",
    queryFingerprint: "candidate-profile",
    profileReady: true,
    inventoryState: "ready",
    candidates,
    hasMore: false,
    ...overrides,
  };
}

function repository(read: FeedReadRepository["readIndexedCandidates"]): FeedReadRepository {
  return { readIndexedCandidates: read };
}

describe("Feed v2 indexed read service", () => {
  test("paginates with snapshot-bound cursors and stable score/group positions", async () => {
    const rows = [candidate("group-a", 0.9), candidate("group-b", 0.8), candidate("group-c", 0.7)];
    const calls: Array<{ candidateId: string; effectiveQuery: unknown; after: unknown }> = [];
    const service = new FeedV2ReadService(
      repository(async (input) => {
        calls.push({
          candidateId: input.candidateId,
          effectiveQuery: input.effectiveQuery,
          after: input.after,
        });
        const start = input.after
          ? rows.findIndex((row) => row.canonicalGroupId === input.after?.canonicalGroupId) + 1
          : 0;
        return snapshot(rows.slice(start), { hasMore: false });
      }),
      { now: () => new Date("2026-07-21T12:00:00Z") },
    );

    const first = await service.read({ assertion, limit: 2 });
    expect(first.jobs.map((job) => job.canonicalGroupId)).toEqual(["group-a", "group-b"]);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.read({
      assertion,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.jobs.map((job) => job.canonicalGroupId)).toEqual(["group-c"]);
    expect(second.nextCursor).toBeNull();
    expect(calls).toEqual([
      { candidateId: "candidate-1", effectiveQuery: null, after: null },
      {
        candidateId: "candidate-1",
        effectiveQuery: null,
        after: { relevanceScore: 0.8, canonicalGroupId: "group-b" },
      },
    ]);
  });

  test("rejects a cursor when inventory, profile, or action versions change", async () => {
    let version = "inventory-1";
    const service = new FeedV2ReadService(
      repository(async () =>
        snapshot([candidate("group-a", 1), candidate("group-b", 0.5)], {
          snapshotVersion: version,
        }),
      ),
      { now: () => new Date("2026-07-21T12:00:00Z") },
    );
    const first = await service.read({ assertion, limit: 1 });
    version = "inventory-2";
    await expect(service.read({ assertion, cursor: first.nextCursor })).rejects.toEqual(
      new FeedCursorError("stale_cursor"),
    );
  });

  test("filters actioned, policy-hidden, blocked, and duplicate groups before diversity", async () => {
    const service = new FeedV2ReadService(
      repository(async () =>
        snapshot([
          candidate("actioned", 1, { actionExcluded: true }),
          candidate("policy", 0.99, { policyEligible: false }),
          candidate("blocked", 0.98, { fulfillmentRoute: "blocked" }),
          candidate("group-a", 0.9, { companyKey: "same-company" }),
          candidate("group-a", 0.89, { companyKey: "same-company" }),
          candidate("group-b", 0.88, { companyKey: "same-company" }),
          candidate("group-c", 0.87, { companyKey: "same-company" }),
          candidate("group-d", 0.86, { companyKey: "other-company", fulfillmentRoute: "auto" }),
        ]),
      ),
      {
        now: () => new Date("2026-07-21T12:00:00Z"),
        maxPerCompany: 2,
      },
    );

    const response = await service.read({ assertion, limit: 12 });
    expect(response.jobs.map((job) => job.canonicalGroupId)).toEqual([
      "group-a",
      "group-b",
      "group-d",
    ]);
    expect(response.summary).toMatchObject({
      evaluated: 8,
      eligible: 3,
      hiddenActioned: 1,
      hiddenPolicy: 1,
      hiddenBlocked: 1,
      visibleByRoute: { auto: 1, assisted: 0, manual: 2, blocked: 0 },
    });
  });

  test.each([
    ["PROFILE_NOT_READY", snapshot([], { profileReady: false })],
    ["NO_MATCHING_INVENTORY", snapshot([])],
    ["ALL_MATCHES_ACTIONED", snapshot([candidate("a", 1, { actionExcluded: true })])],
    ["ALL_MATCHES_POLICY_HIDDEN", snapshot([candidate("a", 1, { policyEligible: false })])],
    ["ALL_MATCHES_BLOCKED", snapshot([candidate("a", 1, { lifecycleEligible: false })])],
  ] as const)("returns typed empty state %s", async (expected, state) => {
    const service = new FeedV2ReadService(
      repository(async () => state),
      {
        now: () => new Date("2026-07-21T12:00:00Z"),
      },
    );
    const response = await service.read({ assertion });
    expect(response.jobs).toEqual([]);
    expect(response.emptyReason).toBe(expected);
  });

  test("fails authorization before the only read-only repository method can run", async () => {
    let reads = 0;
    const service = new FeedV2ReadService(
      repository(async () => {
        reads += 1;
        return snapshot([]);
      }),
      { now: () => new Date("2026-07-21T12:00:00Z") },
    );

    await expect(
      service.read({
        assertion: { ...assertion, expiresAt: "2026-07-21T11:59:59Z" },
      }),
    ).rejects.toEqual(new FeedAuthorizationError("assertion_expired"));
    await expect(service.read({ assertion: { ...assertion, scopes: [] } })).rejects.toEqual(
      new FeedAuthorizationError("feed_scope_required"),
    );
    expect(reads).toBe(0);
    expect(Object.keys(repository(async () => snapshot([])))).toEqual(["readIndexedCandidates"]);
  });

  test("rejects malformed cursors without touching inventory", async () => {
    let reads = 0;
    const service = new FeedV2ReadService(
      repository(async () => {
        reads += 1;
        return snapshot([]);
      }),
      { now: () => new Date("2026-07-21T12:00:00Z") },
    );
    await expect(service.read({ assertion, cursor: "not-a-cursor" })).rejects.toEqual(
      new FeedCursorError("invalid_cursor"),
    );
    expect(reads).toBe(0);
  });
  test("binds a cursor to the signed effective-query fingerprint before reading", async () => {
    const query = (role: string) =>
      createFeedEffectiveQuery({
        version: FEED_EFFECTIVE_QUERY_VERSION,
        role,
        radiusKm: 52,
        locations: [
          {
            label: "Paris, France",
            country: "France",
            countryCode: "FR",
            placeId: null,
            latitude: 48.8566,
            longitude: 2.3522,
          },
        ],
        countryCode: "FR",
        workModes: ["hybrid"],
        jobTypes: ["permanent"],
        experienceLevels: [],
        freeTextLocations: [],
        minimumSalary: 0,
        postedWithin: null,
        onlyCompanies: [],
        hiddenCompanies: [],
        onlyIndustries: [],
        hiddenIndustries: [],
        includeUnknownLocation: false,
        includeUnknownSalary: true,
        includeNonAutoApply: true,
        onlyMyCountry: false,
      });
    let reads = 0;
    const service = new FeedV2ReadService(
      repository(async (input) => {
        reads += 1;
        return snapshot([candidate("group-a", 1), candidate("group-b", 0.5)], {
          queryFingerprint: input.effectiveQuery?.fingerprint ?? "candidate-profile",
        });
      }),
      { now: () => new Date("2026-07-21T12:00:00Z") },
    );
    const firstAssertion = { ...assertion, effectiveQuery: query("Fullstack Engineer") };
    const first = await service.read({ assertion: firstAssertion, limit: 1 });
    expect(first.nextCursor).not.toBeNull();
    await expect(
      service.read({
        assertion: { ...assertion, effectiveQuery: query("Backend Engineer") },
        cursor: first.nextCursor,
      }),
    ).rejects.toEqual(new FeedCursorError("stale_cursor"));
    expect(reads).toBe(1);
  });
});
