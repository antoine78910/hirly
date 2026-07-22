import { OperationSpecRegistry } from "@lssm-tech/lib.contracts-spec/operations";
import { contractFail, contractOk } from "@lssm-tech/lib.contracts-spec/results";
import type { OperationApprovalPort } from "@lssm-tech/lib.contracts-spec/operations";
import type { HandlerCtx } from "@lssm-tech/lib.contracts-spec/types";
import {
  analyzeJobOperation,
  applicationAgentOperations,
  freezeApplicationOperation,
  observeOutcomeOperation,
  prepareApplicationOperation,
  submitApplicationOperation,
  verifyApplicationOperation,
} from "@hirly/application-agent-contracts";
import type {
  ApplicationDraft,
  ApplicationSubmissionPlan,
  ApplicationSubmissionReceipt,
} from "@hirly/application-agent-contracts";
import type {
  ApplicationDraftStore,
  ApplicationModelGateway,
  AtsCapabilityRegistry,
  CandidateEvidenceStore,
  ClaimSupportVerifier,
  Clock,
  Hasher,
  IdGenerator,
  IdempotencyStore,
  JobSnapshotStore,
  JobSourceReader,
  SafeLogger,
  SubmissionPlanStore,
  SubmissionReceiptStore,
  AuditOutboxPublisher,
} from "./ports";
import { createGuardedEventPublisher } from "./events";
import { assertFixtureOnlyMode } from "./core";

export interface RuntimeDependencies {
  compositionMode: "fixture" | "production";
  evidence: CandidateEvidenceStore;
  jobs: JobSnapshotStore;
  drafts: ApplicationDraftStore;
  plans: SubmissionPlanStore;
  receipts: SubmissionReceiptStore;
  reader: JobSourceReader;
  model: ApplicationModelGateway;
  verifier: ClaimSupportVerifier;
  adapters: AtsCapabilityRegistry;
  idempotency: IdempotencyStore;
  clock: Clock;
  ids: IdGenerator;
  hasher: Hasher;
  logger: SafeLogger;
  outbox: AuditOutboxPublisher;
  /** Composition-owned approval authority. Caller-supplied ports are ignored. */
  approvalPort?: () => OperationApprovalPort | undefined;
}

const failure = (code: string) => contractFail(code, { code }, { status: 409, detail: code });
const safeEvent = (deps: RuntimeDependencies, values: Record<string, unknown>) => ({
  eventId: deps.ids.next("event"),
  subjectRef: "candidate:fixture-a",
  occurredAt: deps.clock.now().toISOString(),
  ...values,
});

/** All effectful calls enter through this ContractSpec registry; handlers are not public. */
/**
 * Production composition is deliberately unavailable in this foundation.
 * A future production integration must opt in through a separately approved
 * adapter project rather than reusing fixture composition by accident.
 */
export const createApplicationAgentOperationRegistry = (deps: RuntimeDependencies) => {
  assertFixtureOnlyMode(deps.compositionMode);
  const registry = new OperationSpecRegistry([...applicationAgentOperations]);
  const runtimeContext = (ctx: HandlerCtx): HandlerCtx => ({
    ...ctx,
    approvalPort: deps.approvalPort?.(),
  });
  // Approval is enforced by ContractSpec before the submit handler. Wrap both
  // public execution entry points so a transport cannot supply its own port.
  const execute = registry.execute.bind(registry);
  const executeResult = registry.executeResult.bind(registry);
  registry.execute = (key, version, input, ctx) =>
    execute(key, version, input, runtimeContext(ctx));
  registry.executeResult = (key, version, input, ctx) =>
    executeResult(key, version, input, runtimeContext(ctx));
  const events = createGuardedEventPublisher(deps.outbox);
  const bind = (spec: any, handler: any) => registry.bind(spec, handler);

  bind(analyzeJobOperation, async (input: any) => {
    try {
      const job = await deps.reader.read(input);
      await deps.jobs.put(job);
      return contractOk({ ok: true, data: job });
    } catch {
      return failure(input.jobUrl ? "JOB_EXTRACTION_FAILED" : "INVALID_JOB_URL");
    }
  });

  bind(prepareApplicationOperation, async (input: any) => {
    const snapshot = await deps.evidence.getSnapshot(input.candidateEvidenceSnapshotId);
    const job = await deps.jobs.get(input.jobSnapshotId);
    if (!snapshot) return failure("CANDIDATE_EVIDENCE_NOT_FOUND");
    if (!job) return failure("JOB_EXTRACTION_FAILED");
    const evidence = await deps.evidence.getItems(snapshot.evidenceItemIds);
    const generated = await deps.model.createDraft({ snapshot, job, evidence });
    const hasUnboundClaim = generated.claims.some(
      (claim) => !evidence.some((item) => item.id === claim.evidenceId),
    );
    const draft: ApplicationDraft = {
      ...generated,
      candidateEvidenceSnapshotId: snapshot.id,
      jobSnapshotId: job.id,
      status: hasUnboundClaim ? "blocked" : generated.status,
      claims: generated.claims.filter((claim) =>
        evidence.some((item) => item.id === claim.evidenceId),
      ),
    };
    await deps.drafts.put(draft);
    const eventName =
      draft.status === "ready" ? "hirlyApplication.prepared" : "hirlyApplication.blocked";
    await events.publish(
      eventName,
      "1.0.0",
      safeEvent(deps, { draftId: draft.id, jobSnapshotFingerprint: draft.jobSnapshotFingerprint }),
    );
    return contractOk({ ok: true, data: draft });
  });

  bind(verifyApplicationOperation, async (input: any) => {
    const draft = await deps.drafts.get(input.draftId);
    if (!draft) return failure("CANDIDATE_EVIDENCE_NOT_FOUND");
    const snapshot = await deps.evidence.getSnapshot(draft.candidateEvidenceSnapshotId);
    const evidence = snapshot ? await deps.evidence.getItems(snapshot.evidenceItemIds) : [];
    const verified = await deps.verifier.verify(draft, evidence);
    return contractOk({ ok: true, data: { draftId: draft.id, ...verified } });
  });

  bind(freezeApplicationOperation, async (input: any) => {
    const draft = await deps.drafts.get(input.draftId);
    if (!draft) return failure("STALE_SUBMISSION_PLAN");
    const snapshot = await deps.evidence.getSnapshot(draft.candidateEvidenceSnapshotId);
    const evidence = snapshot ? await deps.evidence.getItems(snapshot.evidenceItemIds) : [];
    const verification = await deps.verifier.verify(draft, evidence);
    if (verification.blockedReasonCodes.includes("MISSING_CANDIDATE_INPUT"))
      return failure("MISSING_CANDIDATE_INPUT");
    if (verification.blockedReasonCodes.length) return failure("UNSUPPORTED_APPLICATION_CLAIM");
    const base = {
      id: deps.ids.next("submission_plan"),
      version: 1,
      draftId: draft.id,
      candidateEvidenceSnapshotId: draft.candidateEvidenceSnapshotId,
      jobSnapshotId: draft.jobSnapshotId,
      candidateSnapshotFingerprint: draft.candidateSnapshotFingerprint,
      jobSnapshotFingerprint: draft.jobSnapshotFingerprint,
      draftFingerprint: deps.hasher.digest(draft),
      secureFormPayloadRef: "vault:form-payload",
      formPayloadFingerprint: deps.hasher.digest({ draft: draft.id }),
      targetOrigin: input.targetOrigin,
      adapterKey: input.adapterKey,
      adapterVersion: input.adapterVersion,
      allowedActionIds: ["submit"],
      idempotencyKey: `idem_${draft.id.replace("draft_", "")}_12345678`,
      expiresAt: new Date(deps.clock.now().getTime() + 3_600_000).toISOString(),
    };
    const plan: ApplicationSubmissionPlan = { ...base, planDigest: deps.hasher.digest(base) };
    await deps.plans.put(plan);
    await events.publish(
      "hirlyApplication.planFrozen",
      "1.0.0",
      safeEvent(deps, { planId: plan.id }),
    );
    return contractOk({ ok: true, data: plan });
  });

  bind(submitApplicationOperation, async (input: any, ctx: any) => {
    const plan = await deps.plans.get(input.planId);
    if (!plan || plan.planDigest !== input.planDigest) return failure("STALE_SUBMISSION_PLAN");
    if (plan.targetOrigin !== input.targetOrigin) return failure("TARGET_ORIGIN_MISMATCH");
    if (plan.adapterKey !== input.adapterKey || plan.adapterVersion !== input.adapterVersion)
      return failure("ADAPTER_CAPABILITY_MISMATCH");
    if (
      plan.idempotencyKey !== input.idempotencyKey ||
      plan.expiresAt <= deps.clock.now().toISOString()
    )
      return failure("STALE_SUBMISSION_PLAN");
    const base = { ...plan };
    delete (base as any).planDigest;
    if (deps.hasher.digest(base) !== plan.planDigest) return failure("STALE_SUBMISSION_PLAN");
    const draft = await deps.drafts.get(plan.draftId);
    const snapshot = await deps.evidence.getSnapshot(plan.candidateEvidenceSnapshotId);
    const job = await deps.jobs.get(plan.jobSnapshotId);
    if (
      !draft ||
      !snapshot ||
      !job ||
      draft.candidateEvidenceSnapshotId !== snapshot.id ||
      draft.jobSnapshotId !== job.id ||
      draft.candidateSnapshotFingerprint !== snapshot.snapshotFingerprint ||
      draft.jobSnapshotFingerprint !== job.sourceFingerprint ||
      snapshot.snapshotFingerprint !== plan.candidateSnapshotFingerprint ||
      job.sourceFingerprint !== plan.jobSnapshotFingerprint ||
      deps.hasher.digest(draft) !== plan.draftFingerprint
    )
      return failure("STALE_SUBMISSION_PLAN");
    const evidence = await deps.evidence.getItems(snapshot.evidenceItemIds);
    if (
      evidence.length !== snapshot.evidenceItemIds.length ||
      !snapshot.evidenceItemIds.every((id) => evidence.some((item) => item.id === id))
    )
      return failure("STALE_SUBMISSION_PLAN");
    const verification = await deps.verifier.verify(draft, evidence);
    if (verification.blockedReasonCodes.includes("MISSING_CANDIDATE_INPUT"))
      return failure("MISSING_CANDIDATE_INPUT");
    if (verification.blockedReasonCodes.length) return failure("UNSUPPORTED_APPLICATION_CLAIM");
    const adapter = deps.adapters.get(plan.adapterKey, plan.adapterVersion);
    if (
      !adapter ||
      !adapter.capabilities.submit ||
      adapter.capabilities.captchaSupport !== false ||
      adapter.capabilities.submissionApprovalRequired !== true
    )
      return failure("ADAPTER_CAPABILITY_MISMATCH");
    if ((await deps.idempotency.claim(plan.idempotencyKey)) !== "claimed")
      return failure("IDEMPOTENCY_CONFLICT");
    await events.publish(
      "hirlyApplication.submissionAttempted",
      "1.0.0",
      safeEvent(deps, { planId: plan.id }),
    );
    try {
      const submitted = await adapter.submit(plan);
      const readBack = await adapter.readBack(plan);
      if (!readBack.confirmed || !readBack.evidenceRef) {
        await events.publish(
          "hirlyApplication.submissionFailed",
          "1.0.0",
          safeEvent(deps, { planId: plan.id, reasonCodes: ["SUBMISSION_NOT_CONFIRMED"] }),
        );
        return failure("SUBMISSION_NOT_CONFIRMED");
      }
      const receipt: ApplicationSubmissionReceipt = {
        attemptId: deps.ids.next("attempt"),
        planId: plan.id,
        planDigest: plan.planDigest,
        approvalReceiptId: ctx.approvalReceipt.id,
        idempotencyKey: plan.idempotencyKey,
        targetOrigin: plan.targetOrigin,
        adapterKey: plan.adapterKey,
        adapterVersion: plan.adapterVersion,
        status: "submitted",
        providerApplicationId: submitted.providerApplicationId,
        safeEvidenceRefs: [readBack.evidenceRef],
        observedAt: deps.clock.now().toISOString(),
      };
      await deps.receipts.put(receipt);
      await events.publish(
        "hirlyApplication.submitted",
        "1.0.0",
        safeEvent(deps, {
          planId: plan.id,
          attemptId: receipt.attemptId,
          safeEvidenceRefs: receipt.safeEvidenceRefs,
        }),
      );
      return contractOk({ ok: true, data: receipt });
    } catch (error) {
      const code = String(error).includes("RATE_LIMIT")
        ? "PROVIDER_RATE_LIMITED"
        : "INTERNAL_ERROR";
      await events.publish(
        "hirlyApplication.submissionFailed",
        "1.0.0",
        safeEvent(deps, { planId: plan.id, reasonCodes: [code] }),
      );
      return failure(code);
    }
  });
  bind(observeOutcomeOperation, async () => failure("INTERNAL_ERROR"));
  return registry;
};
