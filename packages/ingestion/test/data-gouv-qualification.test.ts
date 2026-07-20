import { describe, expect, test } from "bun:test";
import {
  sourceRuntimePolicySchema,
  type SourceRuntimePolicy,
} from "@hirly/contracts";
import {
  dataGouvProductionBlockReason,
  disabledSourceFlags,
  qualifyDataGouvDataset,
  type DataGouvQualificationEvidence,
} from "../src/data-gouv-qualification";

function evidence(
  overrides: Partial<DataGouvQualificationEvidence> = {},
): DataGouvQualificationEvidence {
  return {
    datasetId: "dataset-offres-emploi",
    resourceId: "resource-2026-07",
    discovery: {
      keywordOnly: false,
      evidenceRef: "evidence/catalogue-record.json",
    },
    freshness: {
      resourceUpdatedAt: "2026-07-19T00:00:00.000Z",
      evaluatedAt: "2026-07-20T00:00:00.000Z",
      maximumAgeDays: 7,
      evidenceRef: "evidence/resource-metadata.json",
    },
    licence: {
      name: "Licence Ouverte 2.0",
      evidenceRef: "evidence/licence.json",
      commercialUseAllowed: true,
      redisplayAllowed: true,
      fullTextRetentionAllowed: true,
      attributionText: "Source: publisher via data.gouv.fr",
    },
    identity: {
      externalIdField: "offer_id",
      stableAcrossSnapshots: true,
      evidenceRef: "evidence/four-snapshot-id-diff.json",
    },
    employer: {
      field: "employer_name",
      verified: true,
      evidenceRef: "evidence/employer-sample.json",
    },
    applyRoute: {
      field: "apply_url",
      canonicalRoutesVerified: true,
      evidenceRef: "evidence/apply-route-sample.json",
    },
    relevance: {
      reviewedRows: 100,
      jobRows: 80,
      actionableRows: 70,
      evidenceRef: "evidence/relevance-review.json",
    },
    lifecycle: {
      updateCadence: "four times per day",
      removalSemantics: "absence from a complete snapshot after grace period",
      evidenceRef: "evidence/lifecycle-review.md",
    },
    ...overrides,
  };
}

function runtimePolicy(
  overrides: Partial<SourceRuntimePolicy> = {},
): SourceRuntimePolicy {
  return sourceRuntimePolicySchema.parse({
    providerEnabled: true,
    providerAuthorizationStatus: "authorized",
    writerRuntime: "typescript",
    providerCountryKillSwitches: {},
    sourceCountryKillSwitches: {},
    source: {
      id: "11111111-1111-4111-8111-111111111111",
      provider: "data_gouv",
      sourceKey: "dataset-offres-emploi:resource-2026-07",
      tenantKey: null,
      countryCodes: ["FR"],
      accessType: "open_data",
      policyId: "22222222-2222-4222-8222-222222222222",
      enabled: true,
      transportEnabled: true,
      incrementalEnabled: true,
      backfillEnabled: false,
      checkpoint: {},
    },
    policy: {
      approvalStatus: "approved",
      enabled: true,
      commercialUseAllowed: true,
      redisplayAllowed: true,
      fullTextRetentionAllowed: true,
      enabledEnvironments: ["production"],
      permittedAccessMethods: ["open_data"],
      expiresAt: "2026-08-20T00:00:00.000Z",
    },
    ...overrides,
  });
}

describe("data.gouv dataset qualification", () => {
  test("qualifies only complete reviewed evidence while preserving no-enable defaults", () => {
    const result = qualifyDataGouvDataset(evidence());
    expect(result).toMatchObject({
      decision: "qualified",
      blockReasons: [],
      activationDefaults: {
        enabled: false,
        transportEnabled: false,
        incrementalEnabled: false,
        backfillEnabled: false,
      },
    });
    expect(result.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(disabledSourceFlags()).toEqual(result.activationDefaults);
  });

  test("rejects keyword-only catalogue matches even when other evidence exists", () => {
    const result = qualifyDataGouvDataset(
      evidence({
        discovery: {
          keywordOnly: true,
          evidenceRef: "evidence/catalogue-keyword-match.json",
        },
      }),
    );
    expect(result.decision).toBe("rejected");
    expect(result.blockReasons).toContain("keyword_only_discovery");
  });

  test("requires resource identity and discovery evidence", () => {
    const result = qualifyDataGouvDataset(
      evidence({
        datasetId: " ",
        resourceId: "",
        discovery: { keywordOnly: false, evidenceRef: "" },
      }),
    );
    expect(result.blockReasons).toContain("missing_dataset_identity");
    expect(result.blockReasons).toContain("missing_discovery_evidence");
  });

  test("requires freshness, rights, stable IDs, employer, apply route, relevance, and lifecycle evidence", () => {
    const result = qualifyDataGouvDataset(
      evidence({
        freshness: {
          resourceUpdatedAt: "2026-06-01T00:00:00.000Z",
          evaluatedAt: "2026-07-20T00:00:00.000Z",
          maximumAgeDays: 7,
          evidenceRef: "evidence/resource-metadata.json",
        },
        licence: {
          name: "",
          evidenceRef: "",
          commercialUseAllowed: false,
          redisplayAllowed: false,
          fullTextRetentionAllowed: false,
          attributionText: "",
        },
        identity: {
          externalIdField: "",
          stableAcrossSnapshots: false,
          evidenceRef: "",
        },
        employer: { field: "", verified: false, evidenceRef: "" },
        applyRoute: {
          field: "",
          canonicalRoutesVerified: false,
          evidenceRef: "",
        },
        relevance: {
          reviewedRows: 0,
          jobRows: 0,
          actionableRows: 0,
          evidenceRef: "",
        },
        lifecycle: {
          updateCadence: "",
          removalSemantics: "",
          evidenceRef: "",
        },
      }),
    );
    expect(result.decision).toBe("rejected");
    expect(result.blockReasons).toEqual([
      "commercial_use_not_allowed",
      "full_text_retention_not_allowed",
      "missing_apply_route_evidence",
      "missing_attribution",
      "missing_employer_evidence",
      "missing_licence_evidence",
      "missing_relevance_evidence",
      "missing_removal_semantics",
      "missing_stable_external_id",
      "missing_update_cadence",
      "redisplay_not_allowed",
      "stale_resource",
    ]);
  });

  test("uses qualification and the existing policy/ownership gates for production eligibility", () => {
    const qualified = qualifyDataGouvDataset(evidence());
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(
      dataGouvProductionBlockReason(
        qualified,
        runtimePolicy(),
        "FR",
        "incremental",
        now,
      ),
    ).toBeNull();
    expect(
      dataGouvProductionBlockReason(
        qualifyDataGouvDataset(
          evidence({
            discovery: {
              keywordOnly: true,
              evidenceRef: "evidence/keyword-only.json",
            },
          }),
        ),
        runtimePolicy(),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("qualification_rejected");
    expect(
      dataGouvProductionBlockReason(
        qualified,
        runtimePolicy({ providerCountryKillSwitches: { FR: true } }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("provider_country_killed");
    expect(
      dataGouvProductionBlockReason(
        qualified,
        runtimePolicy({ sourceCountryKillSwitches: { FR: true } }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("source_country_killed");
    expect(
      dataGouvProductionBlockReason(
        qualified,
        runtimePolicy({
          source: {
            ...runtimePolicy().source,
            sourceKey: "another-dataset:another-resource",
          },
        }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("qualification_source_mismatch");
    expect(
      dataGouvProductionBlockReason(
        qualified,
        runtimePolicy({
          source: {
            ...runtimePolicy().source,
            enabled: false,
          },
        }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("source_disabled");
    expect(
      dataGouvProductionBlockReason(
        qualified,
        runtimePolicy(),
        "FR",
        "backfill",
        now,
      ),
    ).toBe("mode_disabled");
    expect(
      dataGouvProductionBlockReason(
        qualified,
        runtimePolicy({
          policy: {
            ...runtimePolicy().policy,
            expiresAt: "2026-07-19T00:00:00.000Z",
          },
        }),
        "FR",
        "incremental",
        now,
      ),
    ).toBe("policy_expired");
  });
});
