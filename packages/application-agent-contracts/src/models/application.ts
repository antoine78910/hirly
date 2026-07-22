import { z } from "zod";
import { isoTimestamp, opaqueId, safeReasonCode, safeRef, sha256 } from "./common";
/**
 * Drafts are safe coordination records, not a second copy of classified evidence.
 * The supporting statement stays behind the evidence store's secure reference.
 */
export const ApplicationClaimSchema = z
  .object({
    id: opaqueId("claim"),
    evidenceId: opaqueId("evidence"),
    supportStatus: z.enum(["supported", "unsupported", "conflicted", "uncertain"]),
    verifierReasonCodes: z.array(safeReasonCode),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export const ClaimSupportSchema = z
  .object({
    claimId: opaqueId("claim"),
    evidenceIds: z.array(opaqueId("evidence")),
    status: z.enum(["supported", "unsupported", "conflicted", "uncertain"]),
    verifierIdentity: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    verifierVersion: z.string().max(64),
    safeEvidenceRefs: z.array(safeRef).optional(),
  })
  .strict();
export const ApplicationDraftSchema = z
  .object({
    id: opaqueId("draft"),
    version: z.number().int().positive(),
    candidateEvidenceSnapshotId: opaqueId("evidence_snapshot"),
    jobSnapshotId: opaqueId("job_snapshot"),
    candidateSnapshotFingerprint: sha256,
    jobSnapshotFingerprint: sha256,
    secureContentRef: safeRef,
    claims: z.array(ApplicationClaimSchema),
    unresolvedCandidateQuestionIds: z.array(opaqueId("question")),
    status: z.enum([
      "ready",
      "candidate_input_required",
      "conflicted",
      "degraded",
      "refused",
      "blocked",
    ]),
    createdAt: isoTimestamp,
  })
  .strict();
export const AtsAdapterCapabilitiesSchema = z
  .object({
    readJob: z.boolean(),
    extractRequirements: z.boolean(),
    fillTextFields: z.boolean(),
    uploadCv: z.boolean(),
    answerCustomQuestions: z.boolean(),
    submit: z.boolean(),
    captchaSupport: z.literal(false),
    submissionApprovalRequired: z.literal(true),
  })
  .strict();
export type ApplicationClaim = z.infer<typeof ApplicationClaimSchema>;
export type ClaimSupport = z.infer<typeof ClaimSupportSchema>;
export type ApplicationDraft = z.infer<typeof ApplicationDraftSchema>;
export type AtsAdapterCapabilities = z.infer<typeof AtsAdapterCapabilitiesSchema>;
