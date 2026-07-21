import { describe, expect, test } from "bun:test";
import {
  affectedCanonicalGroupIds,
  projectJobSearchDocument,
  type JobProjectionSource,
} from "../src";

const source = (overrides: Partial<JobProjectionSource> = {}): JobProjectionSource => ({
  authoritativeVersion: "7",
  canonicalGroupId: "11111111-1111-4111-8111-111111111111",
  preferredJobId: "job_0123456789abcdef",
  groupStatus: "active",
  title: "Sr. Développeur Full Stack",
  normalizedTitle: "senior developpeur full stack",
  company: "Exemple SAS",
  location: "Paris, France",
  countryCode: "fr",
  remote: null,
  latitude: 48.8566,
  longitude: 2.3522,
  publishedAt: "2026-07-01T08:00:00.000Z",
  importedAt: "2026-07-01T09:00:00.000Z",
  firstSeenAt: "2026-07-01T09:00:00.000Z",
  lastSeenAt: "2026-07-20T09:00:00.000Z",
  expiresAt: null,
  lifecycleState: "active",
  validationStatus: "valid",
  applyabilityTier: "A",
  applyFulfillmentStatus: "manual_ready",
  autoApplySupported: false,
  manualFulfillmentReady: true,
  sourceEligible: true,
  policyEligible: true,
  data: {
    role_family_ids: ["software-engineering"],
    rome_codes: ["M1805"],
    skills: ["TypeScript", "React"],
    contract_type: "CDI",
    work_modes: ["hybrid"],
  },
  ...overrides,
});

const now = new Date("2026-07-21T08:00:00.000Z");

describe("job search-document projection", () => {
  test("is deterministic across irrelevant object and feature ordering", async () => {
    const first = await projectJobSearchDocument(source(), now);
    const second = await projectJobSearchDocument(
      source({
        data: {
          work_modes: ["hybrid"],
          skills: ["React", "TypeScript", "React"],
          contract_type: "CDI",
          rome_codes: ["m1805"],
          role_family_ids: ["software-engineering"],
          ignored: null,
        },
      }),
      now,
    );
    expect(first.action).toBe("upsert");
    expect(second.action).toBe("upsert");
    if (first.action !== "upsert" || second.action !== "upsert") return;
    expect(second.sourceContentHash).toBe(first.sourceContentHash);
    expect(second.row.job_version).toBe(first.row.job_version);
    expect(second.row.skill_codes).toEqual(["react", "typescript"]);
  });

  test("changes version only for projected material and preserves group identity", async () => {
    const first = await projectJobSearchDocument(source(), now);
    const preferred = await projectJobSearchDocument(
      source({ preferredJobId: "job_fedcba9876543210" }),
      now,
    );
    const route = await projectJobSearchDocument(
      source({ autoApplySupported: true, manualFulfillmentReady: false }),
      now,
    );
    expect(first.action).toBe("upsert");
    expect(preferred.action).toBe("upsert");
    expect(route.action).toBe("upsert");
    if (first.action !== "upsert" || preferred.action !== "upsert" || route.action !== "upsert") return;
    expect(preferred.canonicalGroupId).toBe(first.canonicalGroupId);
    expect(preferred.row.job_version).not.toBe(first.row.job_version);
    expect(route.row.fulfillment_route).toBe("auto");
    expect(route.row.lifecycle_status).toBe("active");
    expect(route.row.job_version).not.toBe(first.row.job_version);
  });

  test("keeps lifecycle, validation, freshness, and fulfillment independent", async () => {
    const result = await projectJobSearchDocument(
      source({
        lifecycleState: "stale",
        validationStatus: "invalid",
        applyabilityTier: "B",
        autoApplySupported: true,
        manualFulfillmentReady: false,
      }),
      now,
    );
    expect(result.action).toBe("upsert");
    if (result.action !== "upsert") return;
    expect(result.row.lifecycle_status).toBe("stale");
    expect(result.row.validation_status).toBe("invalid");
    expect(result.row.fulfillment_route).toBe("auto");
    expect(result.row.last_seen_at).toBe("2026-07-20T09:00:00.000Z");
  });

  test("removes non-active groups and enumerates merge/split reconciliation", async () => {
    expect(await projectJobSearchDocument(source({ groupStatus: "superseded" }), now)).toEqual({
      action: "remove",
      canonicalGroupId: "11111111-1111-4111-8111-111111111111",
      authoritativeVersion: "7",
    });
    expect(
      affectedCanonicalGroupIds({
        kind: "merged",
        canonicalGroupId: "winner",
        mergedGroupIds: ["loser-b", "loser-a", "loser-b"],
      }),
    ).toEqual(["loser-a", "loser-b", "winner"]);
    expect(
      affectedCanonicalGroupIds({
        kind: "split",
        canonicalGroupId: "parent",
        splitGroupIds: ["child-b", "child-a"],
      }),
    ).toEqual(["child-a", "child-b", "parent"]);
  });
});
