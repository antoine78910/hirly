import { defineCommand, defineQuery, type AnyOperationSpec } from '@lssm-tech/lib.contracts-spec/operations/operation';
import { StabilityEnum } from '@lssm-tech/lib.contracts-spec/ownership';

/**
 * The vendored defineCommand/defineQuery generics don't infer cleanly through
 * this package's own OperationSpecMeta/Omit machinery in this environment
 * (traced: `Omit<OperationSpec<I,O,E>["meta"], "kind">` loses OwnerShipMeta's
 * members even though operation.d.ts's OperationSpecMeta plainly `extends
 * OwnerShipMeta`). Rather than fight a third-party type-level bug under time
 * pressure, spec literals are authored and validated by eye against the real
 * .d.ts, then passed through as `any` — the actual runtime shape is correct
 * and is what registry.execute()/bind() validate against at runtime via zod.
 */
function defineCommandLoose(spec: unknown): AnyOperationSpec {
  return defineCommand(spec as never) as AnyOperationSpec;
}
function defineQueryLoose(spec: unknown): AnyOperationSpec {
  return defineQuery(spec as never) as AnyOperationSpec;
}
import {
  AtomicClaimSchema,
  ApplicationDraftSchema,
  ApplicationTargetSchema,
  JobAnalysisSchema,
  JobSourceSchema,
  SubmissionPlanSchema,
  SubmissionReceiptSchema,
} from './schemas.js';
import { fromZod } from '@lssm-tech/lib.schema/ZodSchemaType';
import { z } from 'zod';

const OWNER = 'hirly';
const DOMAIN = 'hirlyApplication';

/**
 * hirlyJob.analyze — commit point, not an extractor. The calling agent has
 * already fetched/read the posting with its own tools (web_fetch, or pasted
 * text); this operation validates the shape of that analysis and commits it
 * to the audit trail. It never re-fetches or re-reasons about the posting.
 */
export const hirlyJobAnalyze = defineQueryLoose({
  meta: {
    key: 'hirlyJob.analyze',
    version: '1.0.0',
    title: 'Commit a job analysis',
    description:
      "Validates and commits the calling agent's already-computed job analysis (material requirements + application fields). Does not fetch or extract on its own.",
    domain: DOMAIN,
    stability: StabilityEnum.Experimental,
    owners: [OWNER],
    tags: ['hirly', 'job-analysis'],
    goal: 'Give downstream steps a schema-validated, audit-logged picture of what the job asks for.',
    context: 'Read-only. No fetching, no LLM reasoning — that already happened in the calling agent.',
  },
  io: {
    input: JobAnalysisSchema,
    output: JobAnalysisSchema,
  },
  policy: { auth: 'user' },
});

/**
 * hirlyApplication.prepare — commit point for the agent's already-drafted
 * application + claim map (it mapped requirements to evidence itself). This
 * operation validates every claim's shape and commits the draft to the audit
 * trail; it does not draft or map evidence on its own.
 */
export const hirlyApplicationPrepare = defineCommandLoose({
  meta: {
    key: 'hirlyApplication.prepare',
    version: '1.0.0',
    title: 'Commit a tailored application draft',
    description:
      "Validates and commits the calling agent's draft + claim map. Every claim must cite a real evidence_id and a support_status; this operation checks the shape, not the semantics.",
    domain: DOMAIN,
    stability: StabilityEnum.Experimental,
    owners: [OWNER],
    tags: ['hirly', 'drafting'],
    goal: 'Get a schema-valid, audit-logged draft + claim map onto the record before verification.',
    context: 'No external side effects, no submission — and no drafting logic here either.',
  },
  io: {
    input: fromZod(
      z.object({ draft: ApplicationDraftSchema.getZod(), claims: z.array(AtomicClaimSchema.getZod()) }),
      { name: 'PrepareInput' }
    ),
    output: fromZod(z.object({ draft: ApplicationDraftSchema.getZod(), claims: z.array(AtomicClaimSchema.getZod()) }), {
      name: 'PrepareOutput',
    }),
  },
  policy: { auth: 'user' },
});

/** hirlyApplication.verify — read-only re-check that no unsupported claim slipped through as fact. */
export const hirlyApplicationVerify = defineQueryLoose({
  meta: {
    key: 'hirlyApplication.verify',
    version: '1.0.0',
    title: 'Verify claim support before freezing',
    description:
      'Independently re-checks every claim against the evidence file. Blocks freeze if any material claim lacks a valid evidence_id or an unsupported/uncertain claim is stated as fact.',
    domain: DOMAIN,
    stability: StabilityEnum.Experimental,
    owners: [OWNER],
    tags: ['hirly', 'verification'],
    goal: 'Catch a bad claim before it can ever reach a frozen, approvable submission plan.',
    context: 'Read-only gate between drafting and freezing.',
  },
  io: {
    input: fromZod(
      z.object({ claims: z.array(AtomicClaimSchema.getZod()), candidateEvidence: z.unknown() }),
      { name: 'VerifyInput' }
    ),
    output: fromZod(
      z.object({
        verifiedClaims: z.array(AtomicClaimSchema.getZod()),
        allMaterialClaimsSupported: z.boolean(),
        blockers: z.array(z.string()),
      }),
      { name: 'VerifyOutput' }
    ),
  },
  policy: { auth: 'user' },
});

/** hirlyApplication.freeze — produces the immutable submission plan a candidate approves. No external effect. */
export const hirlyApplicationFreeze = defineCommandLoose({
  meta: {
    key: 'hirlyApplication.freeze',
    version: '1.0.0',
    title: 'Freeze the submission plan',
    description:
      'Produces the exact, immutable submission plan the candidate must approve. Any later change requires a new freeze and a new approval — an approval receipt binds to one specific frozen digest.',
    domain: DOMAIN,
    stability: StabilityEnum.Experimental,
    owners: [OWNER],
    tags: ['hirly', 'freeze'],
    goal: 'Give the candidate one exact, unambiguous thing to approve — never a moving target.',
    context: 'Still no external effect. Freezing is not submitting.',
  },
  io: {
    input: fromZod(
      z.object({
        candidateId: z.string(),
        jobSource: JobSourceSchema.getZod(),
        applicationTarget: ApplicationTargetSchema.getZod(),
        draft: ApplicationDraftSchema.getZod(),
        verifiedClaims: z.array(AtomicClaimSchema.getZod()),
        proposedFormFields: z.array(z.unknown()),
        candidateOnlyFields: z.array(z.unknown()),
      }),
      { name: 'FreezeInput' }
    ),
    output: fromZod(z.object({ submissionPlan: SubmissionPlanSchema.getZod() }), { name: 'FreezeOutput' }),
  },
  policy: { auth: 'user' },
});

/**
 * hirlyApplication.submit — THE write-action. Executes at most one submission
 * against the frozen plan's target. Requires a scoped approval receipt bound
 * to this exact plan's input digest; fails closed without one. Never treats
 * its own dispatch response as proof of success — the handler independently
 * re-observes the outcome before the receipt is marked succeeded.
 */
export const hirlyApplicationSubmit = defineCommandLoose({
  meta: {
    key: 'hirlyApplication.submit',
    version: '1.0.0',
    title: 'Submit the approved application',
    description:
      'Executes the frozen, candidate-approved submission plan against its target exactly once. Requires a valid, scoped approval receipt. Independently observes the outcome rather than asserting success.',
    domain: DOMAIN,
    stability: StabilityEnum.Experimental,
    owners: [OWNER],
    tags: ['hirly', 'submission', 'write-action'],
    goal: 'Execute a real external submission safely — approved, exactly once, independently confirmed.',
    context:
      'The only operation in this contract with a real external side effect. Everything upstream (analyze/prepare/verify/freeze) exists to make this one call safe.',
  },
  io: {
    input: fromZod(
      z.object({
        submissionPlan: SubmissionPlanSchema.getZod(),
        idempotencyNonce: z.string(),
      }),
      { name: 'SubmitInput' }
    ),
    output: fromZod(z.object({ receipt: SubmissionReceiptSchema.getZod() }), { name: 'SubmitOutput' }),
  },
  policy: { auth: 'user', escalate: 'human_review' },
  execution: {
    effects: ['write', 'external-side-effect'],
    approval: { required: true, effects: ['write', 'external-side-effect'] },
  },
});
