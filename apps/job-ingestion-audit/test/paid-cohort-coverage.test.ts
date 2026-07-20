import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  coverageDigest,
  producePaidCohortCoverage,
  type CoverageEvidence,
  type PaidCohortCoverageInput,
  type PaidCohortCoverageStore,
} from "../src/paid-cohort-coverage";
import { assertCoverageStoreHasNoCanonicalWrites } from "../src/paid-cohort-coverage-store";

const userA = coverageDigest("paid-user-a");
const userB = coverageDigest("paid-user-b");
const currentGroup = coverageDigest("current-job");
const trialGroup = coverageDigest("trial-job");
const input: PaidCohortCoverageInput = {
  coverageRunId: "00000000-0000-4000-8000-000000000031",
  generatedAt: "2026-07-20T14:00:00.000Z",
  freshnessCutoff: "2026-06-20T14:00:00.000Z",
  freshnessWindowDays: 30,
  evaluatorVersion: "g016.v1",
  cohort: [
    {
      hashedUserId: userA,
      cohortDimensions: { country_code: "FR", subscription_tier: "paid" },
      roleTokens: ["Engineer"],
      countryCodes: ["fr"],
      seenCanonicalGroupDigests: [currentGroup],
    },
    {
      hashedUserId: userB,
      cohortDimensions: { country_code: "FR", subscription_tier: "paid" },
      roleTokens: ["sales"],
      countryCodes: ["FR"],
      seenCanonicalGroupDigests: [],
    },
  ],
  trialSources: [{
    trialRunId: "00000000-0000-4000-8000-000000000020",
    sourceId: "00000000-0000-4000-8000-000000000010",
    provider: "greenhouse",
    tenantKey: "acme",
  }],
};

class FakeStore implements PaidCohortCoverageStore {
  evidence: CoverageEvidence | null = null;
  canonicalWrites = 0;

  async loadCurrentCandidates() {
    return [{
      canonicalGroupDigest: currentGroup,
      sourceId: null,
      provider: "france_travail",
      tenantKey: null,
      titleTokens: ["software", "engineer"],
      countryCode: "FR",
      freshAt: "2026-07-10T00:00:00.000Z",
      actionable: true,
      routeKnown: false,
      directEmployer: false,
    }];
  }

  async loadTrialCandidates() {
    return [{
      canonicalGroupDigest: trialGroup,
      sourceId: input.trialSources[0]!.sourceId,
      provider: "greenhouse",
      tenantKey: "acme",
      titleTokens: ["platform", "engineer"],
      countryCode: "FR",
      freshAt: "2026-07-19T00:00:00.000Z",
      actionable: true,
      routeKnown: true,
      directEmployer: true,
    }];
  }

  async persistEvidence(evidence: CoverageEvidence) {
    this.evidence = evidence;
    return "persisted" as const;
  }
}

describe("G016 paid cohort coverage producer", () => {
  test("freezes the cohort and persists aggregate-safe current/trial evidence", async () => {
    const store = new FakeStore();
    const report = await producePaidCohortCoverage(input, store);
    expect(report).toMatchObject({
      status: "COMPLETE",
      cohortSize: 2,
      trialSourceCount: 1,
      snapshotsPersisted: 2,
      contributionsPersisted: 1,
      relevantTotal: 2,
      actionableTotal: 2,
      unseenActionableTotal: 1,
      persistence: "persisted",
    });
    expect(report.cohortDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toContain(userA);
    expect(JSON.stringify(report)).not.toContain(userB);
    expect(JSON.stringify(report)).not.toContain(currentGroup);
    expect(JSON.stringify(report)).not.toContain(trialGroup);
    expect(store.evidence?.snapshots).toHaveLength(2);
    expect(store.evidence?.contributions[0]).toMatchObject({
      affectedPaidUsers: 1,
      incremental: true,
      fresh: true,
      relevant: true,
      actionable: true,
    });
  });

  test("is deterministic across cohort order and preserves zero canonical writes", async () => {
    const first = new FakeStore();
    const second = new FakeStore();
    const firstReport = await producePaidCohortCoverage(input, first);
    const secondReport = await producePaidCohortCoverage({
      ...input,
      cohort: [...input.cohort].reverse(),
    }, second);
    expect(secondReport.cohortDigest).toBe(firstReport.cohortDigest);
    expect(secondReport.evidenceDigest).toBe(firstReport.evidenceDigest);
    expect(first.canonicalWrites).toBe(0);
    expect(second.canonicalWrites).toBe(0);
    assertCoverageStoreHasNoCanonicalWrites();
    const storeSource = readFileSync(
      new URL("../src/paid-cohort-coverage-store.ts", import.meta.url),
      "utf8",
    );
    expect(storeSource).not.toMatch(
      /\b(insert\s+into|update|delete\s+from)\s+public\.(jobs|job_occurrences|canonical_jobs)\b/i,
    );
  });

  test("refuses stale windows, unsafe cohorts, and escaped source bindings", async () => {
    await expect(producePaidCohortCoverage({
      ...input,
      freshnessCutoff: "2026-06-21T14:00:00.000Z",
    }, new FakeStore())).rejects.toThrow("exactly match");
    await expect(producePaidCohortCoverage({
      ...input,
      cohort: [{
        ...input.cohort[0]!,
        cohortDimensions: { user_id: "unsafe" },
      }],
    }, new FakeStore())).rejects.toThrow("unsafe dimension");
    const escaped = new FakeStore();
    escaped.loadTrialCandidates = async () => [{
      ...(await new FakeStore().loadTrialCandidates())[0]!,
      provider: "lever",
    }];
    await expect(producePaidCohortCoverage(input, escaped))
      .rejects.toThrow("escaped its provider/source/tenant binding");
    const staleCurrent = new FakeStore();
    staleCurrent.loadCurrentCandidates = async () => [{
      ...(await new FakeStore().loadCurrentCandidates())[0]!,
      freshAt: "2026-06-01T00:00:00.000Z",
    }];
    await expect(producePaidCohortCoverage(input, staleCurrent))
      .rejects.toThrow("frozen freshness window");
  });
});
