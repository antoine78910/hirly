import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  FEED_EFFECTIVE_QUERY_VERSION,
  createFeedEffectiveQuery,
  type FeedAuthAssertion,
} from "@hirly/feed-v2";
import {
  FEED_V2_INDEXED_READ_SQL,
  HmacFeedAssertionVerifier,
  PostgresFeedReadRepository,
  parseFeedV2Config,
  signFeedAssertion,
} from "../src";

const secret = "feed-v2-test-secret-that-is-at-least-32-bytes";
const assertion: FeedAuthAssertion = {
  subject: "user-1",
  candidateId: "candidate-1",
  scopes: ["feed:read"],
  issuedAt: "2026-07-21T11:59:00Z",
  expiresAt: "2026-07-21T12:01:00Z",
};

describe("Feed v2 runtime adapters", () => {
  test("keeps runtime routing disabled without database or secret configuration", () => {
    expect(parseFeedV2Config({})).toEqual({
      routingEnabled: false,
      port: 3_002,
      requestTimeoutMs: 1_500,
      databaseUrl: null,
      assertionSecret: null,
    });
    expect(() => parseFeedV2Config({ FEED_V2_ROUTING_ENABLED: "true" })).toThrow("JOBS_DATABASE_URL");
    expect(parseFeedV2Config({
      FEED_V2_ROUTING_ENABLED: "true",
      JOBS_DATABASE_URL: "postgres://feed-reader@inventory/feed",
      FEED_V2_ASSERTION_SECRET: secret,
    }).routingEnabled).toBe(true);
    expect(() => parseFeedV2Config({ FEED_V2_ROUTING_ENABLED: "maybe" })).toThrow("must be true or false");
  });

  test("verifies bounded signed assertions and rejects tampering", async () => {
    const signed = signFeedAssertion(assertion, secret);
    const request = new Request("http://feed.test/internal/feed/v2", { headers: {
      "x-hirly-feed-assertion": signed.encodedAssertion,
      "x-hirly-feed-signature": signed.signature,
    } });
    const verifier = new HmacFeedAssertionVerifier(secret, { now: () => new Date("2026-07-21T12:00:00Z") });
    expect(await verifier.verify(request)).toEqual(assertion);
    await expect(verifier.verify(new Request(request.url, { headers: {
      "x-hirly-feed-assertion": signed.encodedAssertion,
      "x-hirly-feed-signature": "0".repeat(64),
    } }))).rejects.toThrow("invalid_assertion_signature");
  });

  test("binds the effective explicit query to both its fingerprint and assertion signature", async () => {
    const explicitAssertion: FeedAuthAssertion = {
      ...assertion,
      effectiveQuery: createFeedEffectiveQuery({
        version: FEED_EFFECTIVE_QUERY_VERSION,
        role: "Fullstack Engineer",
        radiusKm: 52,
        locations: [{ label: "Paris, France", country: "France", countryCode: "FR", placeId: null, latitude: 48.8566, longitude: 2.3522 }],
        countryCode: "FR",
        workModes: [], jobTypes: [], experienceLevels: [], freeTextLocations: [], minimumSalary: 0,
        postedWithin: null, onlyCompanies: [], hiddenCompanies: [], onlyIndustries: [], hiddenIndustries: [],
        includeUnknownLocation: true, includeUnknownSalary: true, includeNonAutoApply: false, onlyMyCountry: false,
      }),
    };
    const signed = signFeedAssertion(explicitAssertion, secret);
    const verifier = new HmacFeedAssertionVerifier(secret, { now: () => new Date("2026-07-21T12:00:00Z") });
    expect(await verifier.verify(new Request("http://feed.test/internal/feed/v2", { headers: {
      "x-hirly-feed-assertion": signed.encodedAssertion,
      "x-hirly-feed-signature": signed.signature,
    } }))).toEqual(explicitAssertion);

    const tampered = { ...explicitAssertion, effectiveQuery: { ...explicitAssertion.effectiveQuery!, radiusKm: 53 } };
    const encoded = Buffer.from(JSON.stringify(tampered), "utf8").toString("base64url");
    const signature = createHmac("sha256", secret).update(encoded).digest("hex");
    await expect(verifier.verify(new Request("http://feed.test/internal/feed/v2", { headers: {
      "x-hirly-feed-assertion": encoded,
      "x-hirly-feed-signature": signature,
    } }))).rejects.toThrow("invalid_assertion_payload");
  });

  test("uses candidate-scoped indexed keyset SQL without any mutation surface", async () => {
    const calls: unknown[] = [];
    const repository = new PostgresFeedReadRepository({
      async unsafe(query, parameters) {
        calls.push({ query, parameters });
        return [{
          profile_version: "7#candidate-profile", action_watermark: "9",
          snapshot_version: "inventory-1#candidate-profile",
          query_fingerprint: "candidate-profile", canonical_group_id: "group-1", preferred_job_id: "job-1", job_version: "3",
          company_key: "company-1", relevance_score: 0.9, fulfillment_route: "manual",
          action_excluded: false, policy_eligible: true, lifecycle_eligible: true,
        }];
      },
    });
    const snapshot = await repository.readIndexedCandidates({
      candidateId: "candidate-1",
      effectiveQuery: null,
      limit: 12,
      after: { relevanceScore: 0.8, canonicalGroupId: "group-0" },
    });
    expect(snapshot.candidates).toHaveLength(1);
    expect(calls).toEqual([{ query: FEED_V2_INDEXED_READ_SQL, parameters: [
      "candidate-1", 0.8, "group-0", 13, "candidate-profile", null,
      [], [], [], [], [], [], 1, false,
    ] }]);
    expect(FEED_V2_INDEXED_READ_SQL).toContain("read_candidate_search_profile($1)");
    expect(FEED_V2_INDEXED_READ_SQL).toContain("candidate_group_is_excluded($1");
    expect(FEED_V2_INDEXED_READ_SQL).toContain("ORDER BY relevance_score DESC, canonical_group_id ASC");
    expect(FEED_V2_INDEXED_READ_SQL).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(FEED_V2_INDEXED_READ_SQL).not.toMatch(/provider_registry|worker_tasks|projection_reconciliation_tasks/i);
  });
  test("executes signed role, radius, country, work-mode, and contract filters as parameters", async () => {
    const effectiveQuery = createFeedEffectiveQuery({
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
      freeTextLocations: ["Paris"],
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
    const calls: Array<{ query: string; parameters: readonly unknown[] }> = [];
    const repository = new PostgresFeedReadRepository({
      async unsafe(query, parameters) {
        calls.push({ query, parameters });
        return [{
          profile_version: `7#${effectiveQuery.fingerprint}`,
          action_watermark: "9",
          snapshot_version: `inventory-1#${effectiveQuery.fingerprint}`,
          query_fingerprint: effectiveQuery.fingerprint,
          canonical_group_id: "group-1",
          preferred_job_id: "job-1",
          job_version: "3",
          company_key: "company-1",
          relevance_score: 0.9,
          fulfillment_route: "manual" as const,
          action_excluded: false,
          policy_eligible: true,
          lifecycle_eligible: true,
        }];
      },
    });
    const result = await repository.readIndexedCandidates({
      candidateId: "candidate-1",
      effectiveQuery,
      limit: 12,
      after: null,
    });
    expect(result.queryFingerprint).toBe(effectiveQuery.fingerprint);
    expect(result.snapshotVersion).toEndWith(`#${effectiveQuery.fingerprint}`);
    expect(result.profileVersion).toEndWith(`#${effectiveQuery.fingerprint}`);
    expect(calls[0]?.parameters).toEqual([
      "candidate-1", null, null, 13, effectiveQuery.fingerprint,
      "Fullstack Engineer", ["FR"], ["hybrid", "remote"], ["full-time", "permanent"],
      [48.8566], [2.3522],
      ["Paris"], 52, false,
    ]);
    expect(FEED_V2_INDEXED_READ_SQL).toContain("websearch_to_tsquery");
    expect(FEED_V2_INDEXED_READ_SQL).toContain("unnest(");
    expect(FEED_V2_INDEXED_READ_SQL).toContain("document.work_modes &&");
    expect(FEED_V2_INDEXED_READ_SQL).toContain("document.contract_families &&");
  });

});
