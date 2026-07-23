import { randomUUID } from 'node:crypto';
import { OperationSpecRegistry } from '@lssm-tech/lib.contracts-spec/operations/registry';
import { requiredApprovalEffects, type OperationApprovalRequest } from '@lssm-tech/lib.contracts-spec/operations/approval';
import type { HandlerCtx } from '@lssm-tech/lib.contracts-spec/types';
import {
  createMemoryApprovalNonceStore,
  createOperationApprovalPort,
  operationApprovalInputDigest,
} from './local-approval-runtime.js';
import {
  hirlyApplicationFreeze,
  hirlyApplicationPrepare,
  hirlyApplicationSubmit,
  hirlyApplicationVerify,
  hirlyJobAnalyze,
} from './operations.js';
import type { AtomicClaim, SubmissionPlan, SubmissionReceipt } from './schemas.js';
import { SandboxAtsAdapter } from './adapters/sandboxAtsAdapter.js';
import { GenericWebFormAdapter } from './adapters/genericWebFormAdapter.js';
import { BrowserFormAdapter } from './adapters/browserFormAdapter.js';
import { EmailAdapter } from './adapters/emailAdapter.js';

interface SubmissionAdapter {
  dispatch(plan: SubmissionPlan, nonce: string): Promise<{ externalId: string; dispatchStatus: 'received' | 'replay' }>;
  waitForConfirmation(externalId: string): Promise<{ status: 'confirmed' | 'rejected' | 'unknown'; observedAt: string }>;
  close?(): Promise<void>;
}

/**
 * kind -> adapter. 'ats-adapter' has no real implementation yet (no specific
 * ATS — Greenhouse/Lever/etc. — has been integrated); selecting it throws a
 * clear, honest error rather than silently falling back to another adapter.
 */
function selectAdapter(kind: SubmissionPlan['applicationTarget']['kind']): { adapter: SubmissionAdapter; providerKey: string } {
  switch (kind) {
    case 'sandbox':
      return {
        adapter: new SandboxAtsAdapter(process.env.SANDBOX_ATS_URL ?? 'http://localhost:4790'),
        providerKey: 'sandbox-ats',
      };
    case 'generic-web-form':
      return {
        adapter: new GenericWebFormAdapter(process.env.GENERIC_FORM_URL ?? 'http://localhost:4792'),
        providerKey: 'generic-web-form',
      };
    case 'browser-form':
      return {
        adapter: new BrowserFormAdapter(process.env.BROWSER_FORM_URL ?? 'http://localhost:4794'),
        providerKey: 'browser-form',
      };
    case 'email':
      return {
        adapter: new EmailAdapter(process.env.EMAIL_OUTBOX_DIR ?? './outbox'),
        providerKey: 'email-draft',
      };
    case 'ats-adapter':
      throw new Error(
        'no_adapter: applicationTarget.kind is "ats-adapter" but no specific ATS integration (Greenhouse/Lever/etc.) exists yet — see NEXT-DIRECTIONS'
      );
  }
}

export function buildRegistry() {
  const registry = new OperationSpecRegistry([
    hirlyJobAnalyze,
    hirlyApplicationPrepare,
    hirlyApplicationVerify,
    hirlyApplicationFreeze,
    hirlyApplicationSubmit,
  ]);

  // hirlyJob.analyze — validation/commit only, see operations.ts.
  registry.bind(hirlyJobAnalyze, async (args: any) => args);

  // hirlyApplication.prepare — validation/commit only.
  registry.bind(hirlyApplicationPrepare, async (args: any) => args);

  // hirlyApplication.verify — the one real mechanical check we CAN do deterministically:
  // did every claim end up with a support_status, and is anything non-'supported' still
  // present without being flagged? (Whether the *narrative text* smooths it over is a
  // semantic check the calling agent is responsible for — this is the structural half.)
  registry.bind(hirlyApplicationVerify, async (args: any) => {
    const claims = args.claims as AtomicClaim[];
    const blockers: string[] = [];
    for (const c of claims) {
      if (!c.evidenceIds.length && c.supportStatus === 'supported') {
        blockers.push(`Claim ${c.claimId} is marked supported but cites no evidence_id.`);
      }
      if (c.supportStatus !== 'supported' && !c.verifierReason) {
        blockers.push(`Claim ${c.claimId} is ${c.supportStatus} but has no verifier_reason explaining it.`);
      }
    }
    return {
      verifiedClaims: claims,
      allMaterialClaimsSupported: blockers.length === 0,
      blockers,
    };
  });

  // hirlyApplication.freeze — the real logic: stamp a planId + frozenAt and compute
  // the canonical input digest that any approval receipt must bind to.
  registry.bind(hirlyApplicationFreeze, async (args: any) => {
    const planId = `plan_${randomUUID()}`;
    const frozenAt = new Date().toISOString();
    const submissionPlan: SubmissionPlan = {
      planId,
      candidateId: args.candidateId,
      jobSource: args.jobSource,
      applicationTarget: args.applicationTarget,
      claims: args.verifiedClaims,
      proposedFormFields: args.proposedFormFields as SubmissionPlan['proposedFormFields'],
      candidateOnlyFields: args.candidateOnlyFields as SubmissionPlan['candidateOnlyFields'],
      unresolvedBlockers: [],
      overallStatus: args.verifiedClaims.some(
        (c: AtomicClaim) => c.supportStatus !== 'supported' && (c as { blocking?: boolean }).blocking
      )
        ? 'BLOCKED'
        : 'READY_FOR_REVIEW',
      doesNotAuthorizeSubmission:
        'This plan is a draft for candidate review only. It does NOT authorize, trigger, or constitute submission of any application. No application has been submitted; no callback, interview, offer, or outcome is implied.',
      frozenAt,
    };
    return { submissionPlan };
  });

  // hirlyApplication.submit — THE gated write-action.
  //
  // Deliberately NEVER throws for an anticipated denial (missing/expired/wrong
  // receipt, replay, a BLOCKED plan, no adapter). A refused submission is a
  // normal outcome, not an exceptional one — and in production, a thrown
  // Error surfaced as "Tool execution was interrupted by a crash" over MCP
  // instead of a clean denial (found live against the real deployed server;
  // the vendored MCP tool-call wrapper does not translate a thrown handler
  // exception into a well-formed tool result). Every path below returns a
  // receipt describing exactly what happened and why.
  registry.bind(hirlyApplicationSubmit, async (args: any, ctx: HandlerCtx) => {
    const spec = hirlyApplicationSubmit;
    const requiredEffects = requiredApprovalEffects(spec.execution ?? {});
    const nonce = args?.idempotencyNonce as string | undefined;
    const plan = args?.submissionPlan as SubmissionPlan | undefined;

    const denyReceipt = (reason: string): { receipt: SubmissionReceipt } => ({
      receipt: {
        id: `receipt_${randomUUID()}`,
        executionPlanId: plan?.planId ?? 'unknown',
        dispatchId: `dispatch_${randomUUID()}`,
        lane: 'dry_run',
        status: 'blocked',
        idempotencyKey: nonce ?? 'unknown',
        startedAt: new Date().toISOString(),
        errorSummary: reason,
      },
    });

    if (!ctx.approvalPort) {
      return denyReceipt('approval_runtime_unavailable: no approval port configured on this handler ctx');
    }
    if (!ctx.approvalReceipt) {
      return denyReceipt('missing_receipt: hirlyApplication.submit requires a scoped approval receipt');
    }
    if (!plan || !nonce) {
      return denyReceipt('malformed_input: submissionPlan and idempotencyNonce are required');
    }

    // NOTE: does NOT call ctx.approvalPort.authorize() here. The MCP runtime
    // (registerMcpTools, via the same ctx.approvalPort + ctx.approvalReceipt)
    // already runs the full authorize() check — including nonce consumption —
    // before this handler is ever invoked, for any op with execution.approval.
    // Confirmed live: calling authorize() a second time here double-consumed
    // the nonce and reported every real first-use submission as "replayed."
    // What's left as this handler's OWN job is a non-consuming defense-in-depth
    // check: the receipt must bind to THIS exact input, re-verified independently.
    const inputDigest = await operationApprovalInputDigest(args);
    if (ctx.approvalReceipt.inputDigest !== inputDigest) {
      return denyReceipt('submission_denied: wrong_input (approval receipt does not match this exact submission plan)');
    }
    void requiredEffects; // kept for callers (e.g. direct registry.execute() use, tests) that build their own OperationApprovalRequest

    const dispatchId = `dispatch_${randomUUID()}`;
    const startedAt = new Date().toISOString();

    if (plan.overallStatus === 'BLOCKED') {
      const receipt: SubmissionReceipt = {
        id: `receipt_${randomUUID()}`,
        executionPlanId: plan.planId,
        dispatchId,
        lane: 'dry_run',
        status: 'blocked',
        idempotencyKey: nonce,
        startedAt,
        errorSummary: 'Submission plan status is BLOCKED — refusing to dispatch.',
      };
      return { receipt };
    }

    let selected: { adapter: SubmissionAdapter; providerKey: string };
    try {
      selected = selectAdapter(plan.applicationTarget.kind);
    } catch (err) {
      return denyReceipt(String(err instanceof Error ? err.message : err));
    }
    const { adapter, providerKey } = selected;

    try {
      const dispatch = await adapter.dispatch(plan, nonce);
      // Independent confirmation — never trust dispatch()'s own response as proof of success.
      const confirmation = await adapter.waitForConfirmation(dispatch.externalId);

      const receipt: SubmissionReceipt = {
        id: `receipt_${randomUUID()}`,
        executionPlanId: plan.planId,
        dispatchId,
        lane: 'dry_run',
        status: confirmation.status === 'confirmed' ? 'dry_run_completed' : 'failed',
        idempotencyKey: nonce,
        startedAt,
        completedAt: new Date().toISOString(),
        outputRef: { id: dispatch.externalId, type: `${providerKey}-application` },
        independentConfirmation: {
          observedAt: confirmation.observedAt,
          externalId: dispatch.externalId,
          providerKey,
          status: confirmation.status,
        },
      };
      return { receipt };
    } catch (err) {
      // A genuinely unexpected adapter failure (network error, etc.) still
      // becomes a normal 'failed' receipt, not a crashed tool call.
      return {
        receipt: {
          id: `receipt_${randomUUID()}`,
          executionPlanId: plan.planId,
          dispatchId,
          lane: 'dry_run',
          status: 'failed',
          idempotencyKey: nonce,
          startedAt,
          completedAt: new Date().toISOString(),
          errorSummary: `adapter_error: ${String(err instanceof Error ? err.message : err)}`,
        } satisfies SubmissionReceipt,
      };
    } finally {
      // Each submit call gets a fresh adapter instance (see selectAdapter); browser-form
      // holds a real Chromium process, so it must be closed here or it leaks.
      await adapter.close?.();
    }
  });

  return registry;
}

export function buildApprovalRuntime() {
  const nonceStore = createMemoryApprovalNonceStore();
  const approvalPort = createOperationApprovalPort({ nonceStore });
  return { approvalPort, nonceStore };
}

export function baseHandlerCtx(overrides: Partial<HandlerCtx> = {}): HandlerCtx {
  return { userId: 'candidate-review', ...overrides };
}
