import { describe, expect, test } from "bun:test";
import {
  FEED_EFFECTIVE_QUERY_VERSION,
  createFeedEffectiveQuery,
  isFeedEffectiveQuery,
  type FeedEffectiveQueryPayload,
} from "../src";

export const parisFullstackQuery: FeedEffectiveQueryPayload = {
  version: FEED_EFFECTIVE_QUERY_VERSION,
  role: "Fullstack Engineer",
  radiusKm: 52,
  locations: [{
    label: "Paris, France",
    country: "France",
    countryCode: "FR",
    placeId: null,
    latitude: 48.8566,
    longitude: 2.3522,
  }],
  countryCode: "FR",
  workModes: ["hybrid", "remote"],
  jobTypes: ["full_time"],
  experienceLevels: [],
  freeTextLocations: [],
  minimumSalary: 0,
  postedWithin: null,
  onlyCompanies: [],
  hiddenCompanies: [],
  onlyIndustries: [],
  hiddenIndustries: [],
  includeUnknownLocation: true,
  includeUnknownSalary: true,
  includeNonAutoApply: false,
  onlyMyCountry: false,
};

describe("Feed v2 signed explicit-query contract", () => {
  test("normalizes and fingerprints the exact Paris 52km Fullstack query deterministically", () => {
    const first = createFeedEffectiveQuery(parisFullstackQuery);
    const second = createFeedEffectiveQuery({
      ...parisFullstackQuery,
      workModes: ["remote", "hybrid", "remote"],
    });
    expect(first).toEqual(second);
    expect(first.fingerprint).toBe("08225c46c605d1d6c18c22acc6a7fc67eed42dc91f4121fbebae67a50440b3cd");
    expect(isFeedEffectiveQuery(first)).toBe(true);
  });

  test("rejects semantic tampering, extra keys, and unbounded inputs", () => {
    const query = createFeedEffectiveQuery(parisFullstackQuery);
    expect(isFeedEffectiveQuery({ ...query, radiusKm: 53 })).toBe(false);
    expect(isFeedEffectiveQuery({ ...query, providerRefresh: true })).toBe(false);
    expect(() => createFeedEffectiveQuery({ ...parisFullstackQuery, radiusKm: 501 })).toThrow("invalid_explicit_query");
  });
});
