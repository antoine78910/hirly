import { createHash } from "node:crypto";
import type { SourceRuntimePolicy } from "@hirly/contracts";
import {
  sourceActivationBlockReason,
  type SourceActivationBlockReason,
} from "./index";

export const DATA_GOUV_QUALIFICATION_SCHEMA_VERSION =
  "data-gouv-qualification.v1" as const;

export type DataGouvQualificationBlockReason =
  | "missing_dataset_identity"
  | "missing_discovery_evidence"
  | "keyword_only_discovery"
  | "stale_resource"
  | "missing_licence_evidence"
  | "commercial_use_not_allowed"
  | "redisplay_not_allowed"
  | "full_text_retention_not_allowed"
  | "missing_attribution"
  | "missing_stable_external_id"
  | "missing_employer_evidence"
  | "missing_apply_route_evidence"
  | "missing_relevance_evidence"
  | "no_reviewed_jobs"
  | "missing_update_cadence"
  | "missing_removal_semantics";

export interface DataGouvQualificationEvidence {
  datasetId: string;
  resourceId: string;
  discovery: {
    keywordOnly: boolean;
    evidenceRef: string;
  };
  freshness: {
    resourceUpdatedAt: string;
    evaluatedAt: string;
    maximumAgeDays: number;
    evidenceRef: string;
  };
  licence: {
    name: string;
    evidenceRef: string;
    commercialUseAllowed: boolean;
    redisplayAllowed: boolean;
    fullTextRetentionAllowed: boolean;
    attributionText: string;
  };
  identity: {
    externalIdField: string;
    stableAcrossSnapshots: boolean;
    evidenceRef: string;
  };
  employer: {
    field: string;
    verified: boolean;
    evidenceRef: string;
  };
  applyRoute: {
    field: string;
    canonicalRoutesVerified: boolean;
    evidenceRef: string;
  };
  relevance: {
    reviewedRows: number;
    jobRows: number;
    actionableRows: number;
    evidenceRef: string;
  };
  lifecycle: {
    updateCadence: string;
    removalSemantics: string;
    evidenceRef: string;
  };
}

export interface DisabledSourceFlags {
  enabled: false;
  transportEnabled: false;
  incrementalEnabled: false;
  backfillEnabled: false;
}

export interface DataGouvQualificationArtifact {
  schemaVersion: typeof DATA_GOUV_QUALIFICATION_SCHEMA_VERSION;
  datasetId: string;
  resourceId: string;
  evaluatedAt: string;
  decision: "qualified" | "rejected";
  blockReasons: readonly DataGouvQualificationBlockReason[];
  evidenceDigest: string;
  activationDefaults: DisabledSourceFlags;
}

export type DataGouvProductionBlockReason =
  | "qualification_rejected"
  | "qualification_source_mismatch"
  | SourceActivationBlockReason;

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function evidenceDigest(evidence: DataGouvQualificationEvidence): string {
  return createHash("sha256").update(canonicalJson(evidence)).digest("hex");
}

export function disabledSourceFlags(): DisabledSourceFlags {
  return Object.freeze({
    enabled: false,
    transportEnabled: false,
    incrementalEnabled: false,
    backfillEnabled: false,
  });
}

export function qualifyDataGouvDataset(
  evidence: DataGouvQualificationEvidence,
): DataGouvQualificationArtifact {
  const reasons = new Set<DataGouvQualificationBlockReason>();
  const evaluatedAt = new Date(evidence.freshness.evaluatedAt);
  const resourceUpdatedAt = new Date(evidence.freshness.resourceUpdatedAt);
  const maximumAgeMs =
    evidence.freshness.maximumAgeDays * 24 * 60 * 60 * 1_000;

  if (!hasText(evidence.datasetId) || !hasText(evidence.resourceId)) {
    reasons.add("missing_dataset_identity");
  }
  if (!hasText(evidence.discovery.evidenceRef)) {
    reasons.add("missing_discovery_evidence");
  }
  if (evidence.discovery.keywordOnly) reasons.add("keyword_only_discovery");
  if (
    !Number.isFinite(evaluatedAt.getTime()) ||
    !Number.isFinite(resourceUpdatedAt.getTime()) ||
    !Number.isFinite(maximumAgeMs) ||
    maximumAgeMs < 0 ||
    resourceUpdatedAt.getTime() > evaluatedAt.getTime() ||
    evaluatedAt.getTime() - resourceUpdatedAt.getTime() > maximumAgeMs ||
    !hasText(evidence.freshness.evidenceRef)
  ) {
    reasons.add("stale_resource");
  }
  if (
    !hasText(evidence.licence.name) ||
    !hasText(evidence.licence.evidenceRef)
  ) {
    reasons.add("missing_licence_evidence");
  }
  if (!evidence.licence.commercialUseAllowed) {
    reasons.add("commercial_use_not_allowed");
  }
  if (!evidence.licence.redisplayAllowed) {
    reasons.add("redisplay_not_allowed");
  }
  if (!evidence.licence.fullTextRetentionAllowed) {
    reasons.add("full_text_retention_not_allowed");
  }
  if (!hasText(evidence.licence.attributionText)) {
    reasons.add("missing_attribution");
  }
  if (
    !hasText(evidence.identity.externalIdField) ||
    !evidence.identity.stableAcrossSnapshots ||
    !hasText(evidence.identity.evidenceRef)
  ) {
    reasons.add("missing_stable_external_id");
  }
  if (
    !hasText(evidence.employer.field) ||
    !evidence.employer.verified ||
    !hasText(evidence.employer.evidenceRef)
  ) {
    reasons.add("missing_employer_evidence");
  }
  if (
    !hasText(evidence.applyRoute.field) ||
    !evidence.applyRoute.canonicalRoutesVerified ||
    !hasText(evidence.applyRoute.evidenceRef)
  ) {
    reasons.add("missing_apply_route_evidence");
  }
  if (
    !hasText(evidence.relevance.evidenceRef) ||
    !Number.isInteger(evidence.relevance.reviewedRows) ||
    !Number.isInteger(evidence.relevance.jobRows) ||
    !Number.isInteger(evidence.relevance.actionableRows) ||
    evidence.relevance.reviewedRows <= 0 ||
    evidence.relevance.jobRows < 0 ||
    evidence.relevance.actionableRows < 0 ||
    evidence.relevance.jobRows > evidence.relevance.reviewedRows ||
    evidence.relevance.actionableRows > evidence.relevance.jobRows
  ) {
    reasons.add("missing_relevance_evidence");
  } else if (
    evidence.relevance.jobRows === 0 ||
    evidence.relevance.actionableRows === 0
  ) {
    reasons.add("no_reviewed_jobs");
  }
  if (!hasText(evidence.lifecycle.updateCadence)) {
    reasons.add("missing_update_cadence");
  }
  if (
    !hasText(evidence.lifecycle.removalSemantics) ||
    !hasText(evidence.lifecycle.evidenceRef)
  ) {
    reasons.add("missing_removal_semantics");
  }

  const blockReasons = Object.freeze([...reasons].sort());
  return Object.freeze({
    schemaVersion: DATA_GOUV_QUALIFICATION_SCHEMA_VERSION,
    datasetId: evidence.datasetId,
    resourceId: evidence.resourceId,
    evaluatedAt: evidence.freshness.evaluatedAt,
    decision: blockReasons.length === 0 ? "qualified" : "rejected",
    blockReasons,
    evidenceDigest: evidenceDigest(evidence),
    activationDefaults: disabledSourceFlags(),
  });
}

export function dataGouvProductionBlockReason(
  qualification: DataGouvQualificationArtifact,
  runtimePolicy: SourceRuntimePolicy,
  countryCode: string,
  mode: "incremental" | "backfill",
  now: Date,
): DataGouvProductionBlockReason | null {
  if (qualification.decision !== "qualified") {
    return "qualification_rejected";
  }
  if (
    runtimePolicy.source.provider !== "data_gouv" ||
    runtimePolicy.source.sourceKey !==
      `${qualification.datasetId}:${qualification.resourceId}`
  ) {
    return "qualification_source_mismatch";
  }
  return sourceActivationBlockReason(runtimePolicy, countryCode, mode, now);
}
