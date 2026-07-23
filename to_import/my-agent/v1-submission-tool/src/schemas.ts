import { z } from 'zod';
import { fromZod } from '@lssm-tech/lib.schema/ZodSchemaType';

export const SupportStatusZ = z.enum(['supported', 'unsupported', 'uncertain', 'conflicted']);

export const AtomicClaimZ = z.object({
  claimId: z.string(),
  claim: z.string(),
  evidenceIds: z.array(z.string()),
  supportStatus: SupportStatusZ,
  verifierReason: z.string(),
});
export type AtomicClaim = z.infer<typeof AtomicClaimZ>;

export const JobRequirementZ = z.object({
  id: z.string(),
  text: z.string(),
  mustHave: z.boolean(),
});

export const JobSourceZ = z.object({
  type: z.enum(['url', 'text']),
  value: z.string(),
});

export const ProposedFormFieldZ = z.object({
  field: z.string(),
  type: z.string(),
  proposedAnswer: z.string().nullable(),
  status: z.enum(['proposed', 'proposed_pending_options', 'blocked']),
  note: z.string().optional(),
});

export const CandidateOnlyFieldZ = z.object({
  field: z.string(),
  status: z.literal('not_provided'),
  note: z.string(),
});

export const ApplicationDraftZ = z.object({
  roleSummary: z.string(),
  companySummary: z.string(),
  materialRequirements: z.array(JobRequirementZ),
  fitAndGaps: z.string(),
  narrative: z.string(),
  unresolvedQuestions: z.array(z.string()),
  limitations: z.array(z.string()),
});

/**
 * Computed by the calling agent (it has already fetched/read the posting with
 * its own tools) and handed to hirlyJob.analyze purely for schema validation
 * and an audit-trail commit — this tool does not re-fetch or re-reason.
 */
export const JobAnalysisZ = z.object({
  jobSource: JobSourceZ,
  readableReliably: z.boolean(),
  readMethod: z.enum(['web_fetch', 'pasted_text']),
  requirements: z.array(JobRequirementZ),
  applicationFields: z.array(z.object({ field: z.string(), type: z.string() })),
  companyName: z.string(),
  roleTitle: z.string(),
});

export const ApplicationTargetZ = z.object({
  kind: z.enum(['sandbox', 'generic-web-form', 'browser-form', 'email', 'ats-adapter']),
  company: z.string(),
  url: z.string().optional(),
  formHeading: z.string().optional(),
});

/**
 * The frozen submission plan — output of hirlyApplication.freeze.
 * Its canonical digest (via operationApprovalInputDigest) is what a candidate's
 * approval receipt must bind to. Nothing about it may change after freezing;
 * any change requires a new freeze + a new approval.
 */
export const SubmissionPlanZ = z.object({
  planId: z.string(),
  candidateId: z.string(),
  jobSource: JobSourceZ,
  applicationTarget: ApplicationTargetZ,
  claims: z.array(AtomicClaimZ),
  proposedFormFields: z.array(ProposedFormFieldZ),
  candidateOnlyFields: z.array(CandidateOnlyFieldZ),
  unresolvedBlockers: z.array(z.string()),
  overallStatus: z.enum(['READY_FOR_REVIEW', 'BLOCKED']),
  doesNotAuthorizeSubmission: z.string(),
  frozenAt: z.string(),
});
export type SubmissionPlan = z.infer<typeof SubmissionPlanZ>;

export const IndependentConfirmationZ = z.object({
  observedAt: z.string(),
  externalId: z.string().optional(),
  providerKey: z.string(),
  url: z.string().optional(),
  status: z.enum(['confirmed', 'rejected', 'unknown']),
});

/**
 * Mirrors the load-bearing fields of @lssm-tech/lib.companyos-spec's
 * CompanyOsExecutionReceiptSchema. Kept as our own zod schema (rather than a
 * direct re-export) so this tool's receipt shape doesn't silently drift if
 * that package's schema changes underneath us.
 */
export const SubmissionReceiptZ = z.object({
  id: z.string(),
  executionPlanId: z.string(),
  dispatchId: z.string(),
  lane: z.enum(['dry_run', 'agent', 'integration']),
  status: z.enum(['dispatched', 'succeeded', 'failed', 'blocked', 'dry_run_completed']),
  idempotencyKey: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  outputRef: z.object({ id: z.string(), type: z.string(), label: z.string().optional() }).optional(),
  errorSummary: z.string().optional(),
  independentConfirmation: IndependentConfirmationZ.optional(),
});
export type SubmissionReceipt = z.infer<typeof SubmissionReceiptZ>;

// SchemaType wrappers for use as ContractSpec operation io.input/io.output.
export const AtomicClaimSchema = fromZod(AtomicClaimZ, { name: 'AtomicClaim' });
export const JobSourceSchema = fromZod(JobSourceZ, { name: 'JobSource' });
export const JobAnalysisSchema = fromZod(JobAnalysisZ, { name: 'JobAnalysis' });
export const ApplicationDraftSchema = fromZod(ApplicationDraftZ, { name: 'ApplicationDraft' });
export const ApplicationTargetSchema = fromZod(ApplicationTargetZ, { name: 'ApplicationTarget' });
export const SubmissionPlanSchema = fromZod(SubmissionPlanZ, { name: 'SubmissionPlan' });
export const SubmissionReceiptSchema = fromZod(SubmissionReceiptZ, { name: 'SubmissionReceipt' });
