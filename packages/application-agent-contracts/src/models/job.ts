import { z } from "zod";
import { isoTimestamp, opaqueId, origin, sha256 } from "./common";
export const JobRequirementSchema = z
  .object({
    id: opaqueId("requirement"),
    text: z.string().min(1).max(1000),
    classification: z.enum(["required", "preferred", "constraint"]),
    sourceLocator: z.string().max(512).optional(),
    need: z.enum(["evidence", "candidate_answer", "none"]),
  })
  .strict();
export const JobQuestionSchema = z
  .object({
    id: opaqueId("question"),
    normalizedPrompt: z.string().min(1).max(1000),
    classification: z.enum([
      "work_authorization",
      "salary",
      "relocation",
      "legal_attestation",
      "demographic",
      "personal",
      "free_text",
      "other",
    ]),
    candidateOnly: z.boolean(),
    mandatory: z.boolean(),
  })
  .strict();
export const JobSnapshotSchema = z
  .object({
    id: opaqueId("job_snapshot"),
    canonicalSourceUrl: z.string().url(),
    origin,
    sourceFingerprint: sha256,
    capturedAt: isoTimestamp,
    roleTitle: z.string().min(1).max(256),
    companyName: z.string().min(1).max(256),
    requirements: z.array(JobRequirementSchema),
    questions: z.array(JobQuestionSchema),
    ats: z
      .object({
        adapterKey: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
        provider: z.string().max(128).optional(),
      })
      .strict(),
  })
  .strict();
export type JobRequirement = z.infer<typeof JobRequirementSchema>;
export type JobQuestion = z.infer<typeof JobQuestionSchema>;
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>;
