import { z } from "zod";
import { isoTimestamp, opaqueId, safeRef, sensitivity, sha256 } from "./common";
export const CandidateEvidenceItemSchema = z
  .object({
    id: opaqueId("evidence"),
    evidenceKind: z.enum([
      "cv",
      "profile",
      "portfolio",
      "certificate",
      "candidate_statement",
      "other",
    ]),
    atomicSupportedStatement: z.string().min(1).max(2000),
    sourceArtifactRef: safeRef,
    sourceArtifactVersion: z.string().min(1).max(128),
    stableLocator: z.string().max(512).optional(),
    sourceFingerprint: sha256,
    confidence: z.number().min(0).max(1),
    reviewStatus: z.enum(["unreviewed", "reviewed", "rejected"]),
    sensitivity,
  })
  .strict();
export const CandidateEvidenceSnapshotSchema = z
  .object({
    id: opaqueId("evidence_snapshot"),
    candidateSubjectRef: safeRef,
    evidenceItemIds: z.array(opaqueId("evidence")).min(1),
    snapshotFingerprint: sha256,
    createdAt: isoTimestamp,
  })
  .strict();
export type CandidateEvidenceItem = z.infer<typeof CandidateEvidenceItemSchema>;
export type CandidateEvidenceSnapshot = z.infer<typeof CandidateEvidenceSnapshotSchema>;
