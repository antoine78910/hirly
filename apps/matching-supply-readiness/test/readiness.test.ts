import { describe, expect, test } from "bun:test";
import manifestFixture from "./fixtures/paris-fullstack.json";
import {
  INDEX_EVIDENCE_SQL,
  PARIS_FULLSTACK_SCOPE,
  READINESS_SQL,
  REQUIRED_INDEXES,
  assertReadOnlySql,
  buildReadinessScorecard,
  type ReadinessManifest,
  type ReadinessRow,
} from "../src";

const manifest = manifestFixture as ReadinessManifest;

function row(overrides: Partial<ReadinessRow> = {}): ReadinessRow {
  return {
    canonical_group_id: "00000000-0000-4000-8000-000000000001",
    lifecycle_status: "active",
    validation_status: "valid",
    fulfillment_route: "auto",
    source_eligible: true,
    policy_eligible: true,
    last_seen_at: "2026-07-20T08:00:00Z",
    projected_at: "2026-07-21T07:58:00Z",
    duplicate_count: 1,
    action_excluded: false,
    scoped_candidate_count: 14,
    latest_profile_projected_at: "2026-07-21T07:59:00Z",
    ...overrides,
  };
}

const completeEvidence = {
  captured: true,
  availableIndexes: REQUIRED_INDEXES,
  plan: [{ Plan: { "Index Name": "job_search_documents_features_idx" } }],
};

describe("matching supply readiness", () => {
  test("binds the mandatory Paris 52km Fullstack scope", () => {
    expect(manifest.scope).toEqual(PARIS_FULLSTACK_SCOPE);
  });

  test("keeps every database operation read-only and projection-scoped", () => {
    expect(() => assertReadOnlySql(READINESS_SQL)).not.toThrow();
    expect(() => assertReadOnlySql(INDEX_EVIDENCE_SQL)).not.toThrow();
    expect(READINESS_SQL).toContain("public.candidate_search_profiles");
    expect(READINESS_SQL).toContain("public.job_search_documents");
    expect(READINESS_SQL).toContain("public.candidate_action_projection");
    expect(READINESS_SQL).toContain("distance_km <= $3");
    expect(READINESS_SQL).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|CALL)\b/i);
    expect(READINESS_SQL).not.toMatch(/provider_registry|projection_reconciliation_tasks|worker_tasks/i);
  });

  test("fails closed without complete rows, indexes, and query-plan evidence", () => {
    const scorecard = buildReadinessScorecard(manifest, [], {
      captured: false,
      availableIndexes: [],
      plan: null,
    });
    expect(scorecard.decision).toBe("disabled");
    expect(scorecard.failedGates).toContain("INCOMPLETE_QUERY_EVIDENCE");
    expect(scorecard.failedGates).toContain("INSUFFICIENT_FRESH_VISIBLE_GROUPS");
    expect(scorecard.failedGates).toContain("PROJECTION_LAG_EXCEEDED");
    expect(scorecard.rollbackReason).toBe("INCOMPLETE_QUERY_EVIDENCE");
  });

  test("emits deterministic route mix, rates, lag, and activation decision", () => {
    const rows = [
      row(),
      row({
        canonical_group_id: "00000000-0000-4000-8000-000000000002",
        fulfillment_route: "manual",
      }),
    ];
    const first = buildReadinessScorecard(manifest, rows, completeEvidence);
    const second = buildReadinessScorecard(manifest, [...rows].reverse(), completeEvidence);
    expect(first.decision).toBe("enabled");
    expect(first.counts).toMatchObject({
      scopedCandidates: 14,
      canonicalGroups: 2,
      freshVisibleCanonicalGroups: 2,
      visibleByRoute: { auto: 1, assisted: 0, manual: 1, blocked: 0 },
    });
    expect(first.rates).toEqual({ blocked: 0, invalid: 0, duplicate: 0, actionExclusion: 0 });
    expect(first.projectionLagSeconds).toBe(60);
    expect(first.digest).toBe(second.digest);
  });

  test("reports unsafe inventory rates and expired exceptions as rollback reasons", () => {
    const unsafeManifest: ReadinessManifest = {
      ...manifest,
      exception: {
        exceptionId: "temporary-low-supply",
        approvedBy: "product-owner",
        expiresAt: "2026-07-21T07:59:59Z",
        minimumFreshVisibleCanonicalGroups: 1,
        reason: "time-bounded launch evidence",
      },
    };
    const scorecard = buildReadinessScorecard(unsafeManifest, [
      row({ lifecycle_status: "blocked", fulfillment_route: "blocked", validation_status: "invalid" }),
      row({
        canonical_group_id: "00000000-0000-4000-8000-000000000002",
        action_excluded: true,
      }),
    ], completeEvidence);
    expect(scorecard.decision).toBe("disabled");
    expect(scorecard.failedGates).toContain("BLOCKED_RATE_EXCEEDED");
    expect(scorecard.failedGates).toContain("INVALID_RATE_EXCEEDED");
    expect(scorecard.failedGates).toContain("EXCEPTION_EXPIRED_OR_INVALID");
    expect(scorecard.exception).toBeNull();
  });

  test("refuses activation after the approved threshold evidence expires", () => {
    const expired: ReadinessManifest = {
      ...manifest,
      thresholds: { ...manifest.thresholds, expiresAt: "2026-07-21T08:00:00Z" },
    };
    const scorecard = buildReadinessScorecard(expired, [
      row(),
      row({ canonical_group_id: "00000000-0000-4000-8000-000000000002" }),
    ], completeEvidence);
    expect(scorecard.decision).toBe("disabled");
    expect(scorecard.failedGates).toContain("THRESHOLD_EXPIRED");
    expect(scorecard.rollbackReason).toBe("THRESHOLD_EXPIRED");
  });
});
