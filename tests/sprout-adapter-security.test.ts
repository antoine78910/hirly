import { describe, expect, test } from "bun:test";
import { stableJobId } from "../packages/ingestion/src/index";
import { getProviderModule } from "../apps/worker/src/providers";
import {
  buildSproutFranceQuery,
  buildSproutCommitEntry,
  parseSproutResponse,
  sproutProvider,
  sproutRawJobSchema,
  tryNormalizeSproutJob,
  type SproutRawJob,
} from "../apps/worker/src/providers/sprout";

function rawJob(overrides: Partial<SproutRawJob> = {}): SproutRawJob {
  return sproutRawJobSchema.parse({
    id: 42,
    company: "Example SAS",
    title: "Backend Engineer",
    rawDescription: "Build safe ingestion systems",
    postedAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z",
    createdAt: "2026-07-18T10:00:00.000Z",
    lastCheckedAt: "2026-07-20T11:00:00.000Z",
    postingUrl: "https://jobs.example.com/roles/42?utm_source=sprout",
    workLocation: "REMOTE",
    salaryMin: 50_000,
    salaryMax: 70_000,
    currency: "eur",
    locations: [
      {
        city: "Paris",
        region: "Ile-de-France",
        country: "France",
        countryCode: "fr",
        coordinates: [0, 0],
      },
    ],
    ...overrides,
  });
}

describe("Sprout adapter security and inventory contract", () => {
  test("repairs inverted salary bounds before canonical validation", () => {
    const result = tryNormalizeSproutJob(
      rawJob({ salaryMin: 70_000, salaryMax: 50_000 }),
    );

    expect(result).toMatchObject({
      accepted: true,
      job: { salaryMin: 50_000, salaryMax: 70_000 },
    });
  });

  test("builds the validated France request shape without narrowing filters", () => {
    const query = buildSproutFranceQuery({ offset: 20, limit: 100 });

    expect(Object.fromEntries(query)).toMatchObject({
      "location[address]": "France",
      "location[countryCode]": "FR",
      "location[isCountry]": "true",
      "location[radius]": "50",
      jobTitle: "",
      jobCategory: "",
      minimumSalary: "0",
      postedDate: "any",
      includeUnknownSalaryRange: "true",
      includeUnknownWorkLocation: "false",
      additionalRequirements: "[]",
      offset: "20",
      limit: "100",
    });
    for (const forbidden of [
      "types",
      "experienceLevels",
      "workLocations",
    ]) {
      expect(query.has(forbidden)).toBe(false);
    }
  });

  test("consumes the authoritative jobs wrapper exactly once", () => {
    const job = rawJob();
    const parsed = parseSproutResponse({
      jobs: [job],
      results: [job],
      count: 1,
      next: null,
      previous: null,
    });

    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.wrapperMismatch).toBe(false);
    expect(
      parseSproutResponse({
        jobs: [job],
        results: [rawJob({ id: "different" })],
        count: 1,
        next: null,
        previous: null,
      }).wrapperMismatch,
    ).toBe(true);
  });

  test("keeps stable Sprout identity and accepts only positive France evidence", () => {
    const now = new Date("2026-07-21T00:00:00.000Z");
    const first = tryNormalizeSproutJob(rawJob(), now);
    const replay = tryNormalizeSproutJob(rawJob({ title: "Updated title" }), now);

    expect(first.accepted).toBe(true);
    expect(replay.accepted).toBe(true);
    if (!first.accepted || !replay.accepted) throw new Error("fixture rejected");
    expect(first.job.envelope.externalId).toBe("42");
    expect(replay.job.envelope.externalId).toBe("42");
    expect(stableJobId("sprout", first.job.envelope.externalId)).toBe(
      stableJobId("sprout", replay.job.envelope.externalId),
    );
    expect(first.job).toMatchObject({
      countryCode: "FR",
      city: "Paris",
      region: "Ile-de-France",
      remote: true,
      currency: "EUR",
      postedAt: "2026-07-19T10:00:00.000Z",
    });
    expect(first.job.allLocations[0]).toMatchObject({
      latitude: null,
      longitude: null,
    });

    const leaked = tryNormalizeSproutJob(
      rawJob({
        locations: [{ city: "Berlin", country: "Germany", countryCode: "DE" }],
      }),
      now,
    );
    expect(leaked).toEqual({
      accepted: false,
      reason: "country_leak",
      externalId: "42",
    });
  });

  test("quarantines invalid apply routes and future freshness", () => {
    expect(
      tryNormalizeSproutJob(rawJob({ postingUrl: "http://jobs.example.com/42" })),
    ).toEqual({
      accepted: false,
      reason: "invalid_apply_url",
      externalId: "42",
    });

    const normalized = tryNormalizeSproutJob(
      rawJob({
        postedAt: "2026-07-22T10:00:00.000Z",
        updatedAt: "2026-07-22T11:00:00.000Z",
      }),
      new Date("2026-07-21T00:00:00.000Z"),
    );
    expect(normalized.accepted).toBe(true);
    if (!normalized.accepted) throw new Error("fixture rejected");
    expect(normalized.job.postedAt).toBeNull();
  });

  test("stays disabled in the authoritative registry without invoking fetch", async () => {
    let networkCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      networkCalls += 1;
      throw new Error("unexpected live API call");
    }) as typeof fetch;

    try {
      expect(getProviderModule("sprout")).toBe(sproutProvider);
      expect(sproutProvider).toMatchObject({
        authorizationStatus: "unverified",
        rateLimit: { requestsPerMinute: 20, concurrency: 1 },
        liveTransportReady: false,
        canonicalWriteReady: false,
      });
      await expect(
        sproutProvider.transport.fetch(
          { provider: "sprout", countryCode: "FR", pageSize: 1 },
          new AbortController().signal,
        ),
      ).rejects.toThrow("provider transport is disabled");
      expect(networkCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("fails closed on response schema drift", () => {
    expect(() =>
      parseSproutResponse({
        jobs: [{ ...rawJob(), unexpectedSecret: "must-not-be-retained" }],
        count: 1,
        next: null,
        previous: null,
      }),
    ).toThrow();
  });

  test("accepts only the bounded observed Sprout drift and preserves it", () => {
    const location = rawJob().locations[0]!;
    const parsed = parseSproutResponse({
      jobs: [
        {
          ...rawJob(),
          sourceId: 101,
          socMajorGroup: "15-0000",
          socMinorGroup: "15-1200",
          socBroadOccupation: "15-1250",
          socDetailedOccupation: "15-1252",
          locations: [
            {
              ...location,
              id: 701,
              jobId: 42,
              createdAt: "2026-07-18T10:00:00.000Z",
              stateCode: "IDF",
            },
          ],
        },
      ],
      count: 1,
      next: null,
      previous: null,
    });
    const raw = parsed.jobs[0]!;
    const entry = buildSproutCommitEntry({
      raw,
      policyId: "22222222-2222-4222-8222-222222222222",
      fetchedAt: new Date("2026-07-21T00:00:00.000Z"),
    });

    expect(raw.sourceId).toBe(101);
    expect(raw.locations[0]).toMatchObject({
      id: 701,
      jobId: 42,
      createdAt: "2026-07-18T10:00:00.000Z",
      stateCode: "IDF",
    });
    expect(raw).toMatchObject({
      socMajorGroup: "15-0000",
      socMinorGroup: "15-1200",
      socBroadOccupation: "15-1250",
      socDetailedOccupation: "15-1252",
    });
    expect(entry.sourceDocument).toEqual(raw);
    expect(entry.attribution.sourceId).toBe("101");

    for (const incompatible of [
      { ...raw, sourceId: { unsafe: true } },
      { ...raw, socMajorGroup: ["15-0000"] },
      { ...raw, locations: [{ ...raw.locations[0]!, stateCode: 75 }] },
    ]) {
      expect(() =>
        parseSproutResponse({
          jobs: [incompatible],
          count: 1,
          next: null,
          previous: null,
        }),
      ).toThrow();
    }
  });
});
