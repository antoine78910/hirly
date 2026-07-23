import { randomUUID } from 'node:crypto';
import { operationApprovalInputDigest } from '../local-approval-runtime.js';
import type { HandlerCtx } from '@lssm-tech/lib.contracts-spec/types';
import type { OperationApprovalReceipt } from '@lssm-tech/lib.contracts-spec/operations/approval';
import { createSandboxAtsServer } from '../sandbox-ats/server.js';
import { createGenericFormServer } from '../test-targets/genericFormTarget.js';
import { createJsFormServer } from '../test-targets/jsFormTarget.js';
import { buildApprovalRuntime, buildRegistry } from '../runtime.js';
import type { AtomicClaim, SubmissionPlan } from '../schemas.js';
import { rm } from 'node:fs/promises';

const PORT = 4791;
const FORM_PORT = 4793;
const JS_FORM_PORT = 4796;
const OUTBOX_DIR = './outbox-test';
process.env.SANDBOX_ATS_URL = `http://localhost:${PORT}`;
process.env.GENERIC_FORM_URL = `http://localhost:${FORM_PORT}`;
process.env.BROWSER_FORM_URL = `http://localhost:${JS_FORM_PORT}`;
process.env.EMAIL_OUTBOX_DIR = OUTBOX_DIR;

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`, detail ?? '');
  }
}

/**
 * Simulates what the deployed MCP runtime actually does automatically, using
 * the SAME approvalPort, before it ever calls the bound handler: validate +
 * atomically consume the receipt's nonce. The handler itself does NOT call
 * this (see runtime.ts) — calling it twice for one logical approval double-
 * consumes the nonce, which is exactly the live bug this test suite caught.
 */
async function runtimeApprovalPreCheck(
  approvalPort: { authorize: (req: any) => Promise<{ effect: string; reason?: string }> },
  receipt: OperationApprovalReceipt,
  submitArgs: unknown
) {
  const inputDigest = await operationApprovalInputDigest(submitArgs);
  return approvalPort.authorize({
    receipt,
    operation: { key: 'hirlyApplication.submit', version: '1.0.0' },
    subject: { userId: receipt.subject.userId ?? null, tenantId: receipt.subject.tenantId ?? null },
    input: submitArgs,
    requiredEffects: ['write', 'external-side-effect'],
  }).then((d) => ({ ...d, inputDigest }));
}

async function main() {
  const httpServer = createSandboxAtsServer();
  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
  console.log(`sandbox-ats up on :${PORT}`);

  const formServer = createGenericFormServer();
  await new Promise<void>((resolve) => formServer.listen(FORM_PORT, resolve));
  console.log(`generic-form-target up on :${FORM_PORT}`);

  const jsFormServer = createJsFormServer();
  await new Promise<void>((resolve) => jsFormServer.listen(JS_FORM_PORT, resolve));
  console.log(`js-form-target up on :${JS_FORM_PORT}`);

  await rm(OUTBOX_DIR, { recursive: true, force: true });

  const registry = buildRegistry();
  const { approvalPort } = buildApprovalRuntime();
  const submitHandler = registry.getHandler('hirlyApplication.submit', '1.0.0')!;
  const freezeHandler = registry.getHandler('hirlyApplication.freeze', '1.0.0')!;
  const verifyHandler = registry.getHandler('hirlyApplication.verify', '1.0.0')!;

  const claims: AtomicClaim[] = [
    {
      claimId: 'C1',
      claim: 'Test claim',
      evidenceIds: ['evidence_001'],
      supportStatus: 'supported',
      verifierReason: 'directly stated in evidence_001',
    },
  ];

  console.log('\n=== Structural checks ===');
  const verifyResult = (await verifyHandler(
    { claims, candidateEvidence: {} },
    {}
  )) as { allMaterialClaimsSupported: boolean; blockers: string[] };
  check('verify: all claims supported, no blockers', verifyResult.allMaterialClaimsSupported === true, verifyResult);

  const freezeArgs = {
    candidateId: 'candidate_synthetic_001',
    jobSource: { type: 'url' as const, value: 'https://lssm.tech/tech-builder' },
    applicationTarget: { kind: 'sandbox' as const, company: 'LSSM Tech' },
    draft: {
      roleSummary: 'Architect',
      companySummary: 'LSSM',
      materialRequirements: [],
      fitAndGaps: '',
      narrative: '',
      unresolvedQuestions: [],
      limitations: [],
    },
    verifiedClaims: claims,
    proposedFormFields: [],
    candidateOnlyFields: [],
  };
  const { submissionPlan } = (await freezeHandler(freezeArgs, {})) as { submissionPlan: SubmissionPlan };
  check('freeze: plan is READY_FOR_REVIEW', submissionPlan.overallStatus === 'READY_FOR_REVIEW', submissionPlan);
  check('freeze: plan has planId + frozenAt', Boolean(submissionPlan.planId && submissionPlan.frozenAt));

  console.log('\n=== Good path: approved submission ===');
  const nonce1 = randomUUID();
  const submitArgs = { submissionPlan, idempotencyNonce: nonce1 };
  const digest1 = await operationApprovalInputDigest(submitArgs);
  const now = new Date();
  const validReceipt: OperationApprovalReceipt = {
    id: `approval_${randomUUID()}`,
    subject: { userId: 'candidate-review' },
    operation: { key: 'hirlyApplication.submit', version: '1.0.0' },
    inputDigest: digest1,
    effects: ['write', 'external-side-effect'],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    nonce: nonce1,
    issuer: 'hirly-host-app-simulated-approval',
    evidenceRef: 'evidence://candidate-approval/simulated-click-1',
  };
  const goodCtx: HandlerCtx = { userId: 'candidate-review', approvalPort, approvalReceipt: validReceipt };

  // In production, the MCP runtime runs this exact check (and consumes the nonce)
  // BEFORE ever calling the handler. Simulate that here so the test reflects reality.
  const goodPreCheck = await runtimeApprovalPreCheck(approvalPort, validReceipt, submitArgs);
  check('runtime pre-check: valid first-use receipt is allowed', goodPreCheck.effect === 'allow', goodPreCheck);

  let goodResult: { receipt: { status: string; independentConfirmation?: { status: string } } } | undefined;
  let goodErr: unknown;
  try {
    goodResult = (await submitHandler(submitArgs, goodCtx)) as typeof goodResult;
  } catch (e) {
    goodErr = e;
  }
  check('submit: approved submission does not throw', !goodErr, goodErr);
  check(
    'submit: receipt status is dry_run_completed',
    goodResult?.receipt.status === 'dry_run_completed',
    goodResult
  );
  check(
    'submit: independent confirmation observed (not just dispatch response)',
    goodResult?.receipt.independentConfirmation?.status === 'confirmed',
    goodResult
  );

  console.log('\n=== Bad path: replay of the same approved nonce ===');
  // The nonce was already consumed by goodPreCheck above — a second pre-check
  // for the same receipt is exactly what a replayed/duplicated call looks like.
  const replayPreCheck = await runtimeApprovalPreCheck(approvalPort, validReceipt, submitArgs);
  check(
    'runtime pre-check: replaying the same receipt/nonce is denied',
    replayPreCheck.effect === 'deny' && replayPreCheck.reason === 'replayed_receipt',
    replayPreCheck
  );

  console.log('\n=== Bad path: missing receipt ===');
  const missingResult = (await submitHandler(
    { submissionPlan, idempotencyNonce: randomUUID() },
    { userId: 'candidate-review', approvalPort }
  )) as { receipt: { status: string; errorSummary?: string } };
  check(
    'submit: missing approval receipt is rejected, not crashed',
    missingResult.receipt.status === 'blocked' && Boolean(missingResult.receipt.errorSummary?.includes('missing_receipt')),
    missingResult
  );

  console.log('\n=== Bad path: receipt bound to a different (tampered) plan ===');
  const tamperedPlan: SubmissionPlan = { ...submissionPlan, overallStatus: 'BLOCKED' };
  const tamperedArgs = { submissionPlan: tamperedPlan, idempotencyNonce: nonce1 };
  // Reuse validReceipt, whose inputDigest was computed over the ORIGINAL args, not tamperedArgs.
  const tamperedResult = (await submitHandler(tamperedArgs, {
    userId: 'candidate-review',
    approvalPort,
    approvalReceipt: validReceipt,
  })) as { receipt: { status: string; errorSummary?: string } };
  check(
    'submit: receipt for a different plan digest is rejected, not crashed',
    tamperedResult.receipt.status === 'blocked' &&
      Boolean(tamperedResult.receipt.errorSummary?.includes('wrong_input') || tamperedResult.receipt.errorSummary?.includes('submission_denied')),
    tamperedResult
  );

  console.log('\n=== Bad path: expired receipt ===');
  const nonce2 = randomUUID();
  const expiredArgs = { submissionPlan, idempotencyNonce: nonce2 };
  const expiredDigest = await operationApprovalInputDigest(expiredArgs);
  const expiredReceipt: OperationApprovalReceipt = {
    ...validReceipt,
    id: `approval_${randomUUID()}`,
    inputDigest: expiredDigest,
    nonce: nonce2,
    issuedAt: new Date(now.getTime() - 10 * 60_000).toISOString(),
    expiresAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
  };
  const expiredPreCheck = await runtimeApprovalPreCheck(approvalPort, expiredReceipt, expiredArgs);
  check(
    'runtime pre-check: expired receipt is rejected',
    expiredPreCheck.effect === 'deny' && expiredPreCheck.reason === 'expired_receipt',
    expiredPreCheck
  );

  console.log('\n=== Direct BLOCKED-plan short-circuit (valid receipt, but plan itself is BLOCKED) ===');
  const nonce3 = randomUUID();
  const blockedPlan: SubmissionPlan = { ...submissionPlan, planId: `plan_${randomUUID()}`, overallStatus: 'BLOCKED' };
  const blockedArgs = { submissionPlan: blockedPlan, idempotencyNonce: nonce3 };
  const blockedDigest = await operationApprovalInputDigest(blockedArgs);
  const blockedReceipt: OperationApprovalReceipt = {
    ...validReceipt,
    id: `approval_${randomUUID()}`,
    inputDigest: blockedDigest,
    nonce: nonce3,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const blockedResult = (await submitHandler(blockedArgs, {
    userId: 'candidate-review',
    approvalPort,
    approvalReceipt: blockedReceipt,
  })) as { receipt: { status: string } };
  check(
    'submit: a BLOCKED plan is refused even with a valid, matching receipt',
    blockedResult.receipt.status === 'blocked',
    blockedResult
  );

  console.log('\n=== Generic web-form adapter: approved submission against a real (local, safe) HTML form ===');
  const webFreezeArgs = {
    ...freezeArgs,
    applicationTarget: { kind: 'generic-web-form' as const, company: 'Generic Test Co', url: `http://localhost:${FORM_PORT}/apply` },
    proposedFormFields: [
      { field: 'Full Name', type: 'text', proposedAnswer: 'Alex Mercier', status: 'proposed' as const },
      { field: 'Email', type: 'email', proposedAnswer: null, status: 'blocked' as const, note: 'candidate-only' },
      { field: 'Portfolio URL', type: 'text', proposedAnswer: null, status: 'blocked' as const },
      { field: 'Cover Note', type: 'textarea', proposedAnswer: 'Tailored note referencing evidence_001.', status: 'proposed' as const },
    ],
  };
  const { submissionPlan: webPlan } = (await freezeHandler(webFreezeArgs, {})) as { submissionPlan: SubmissionPlan };
  const webNonce = randomUUID();
  const webSubmitArgs = { submissionPlan: webPlan, idempotencyNonce: webNonce };
  const webDigest = await operationApprovalInputDigest(webSubmitArgs);
  const webReceipt: OperationApprovalReceipt = {
    ...validReceipt,
    id: `approval_${randomUUID()}`,
    inputDigest: webDigest,
    nonce: webNonce,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  let webResult: { receipt: { status: string; independentConfirmation?: { status: string } } } | undefined;
  let webErr: unknown;
  try {
    webResult = (await submitHandler(webSubmitArgs, {
      userId: 'candidate-review',
      approvalPort,
      approvalReceipt: webReceipt,
    })) as typeof webResult;
  } catch (e) {
    webErr = e;
  }
  check('web-form: submission does not throw', !webErr, webErr);
  check('web-form: receipt status is dry_run_completed', webResult?.receipt.status === 'dry_run_completed', webResult);
  check(
    'web-form: independent confirmation observed via separate GET',
    webResult?.receipt.independentConfirmation?.status === 'confirmed',
    webResult
  );

  console.log('\n=== Email adapter: approved submission writes a real .eml draft, never sends ===');
  const emailFreezeArgs = {
    ...freezeArgs,
    applicationTarget: { kind: 'email' as const, company: 'Generic Test Co', formHeading: 'Application' },
  };
  const { submissionPlan: emailPlan } = (await freezeHandler(emailFreezeArgs, {})) as { submissionPlan: SubmissionPlan };
  const emailNonce = randomUUID();
  const emailSubmitArgs = { submissionPlan: emailPlan, idempotencyNonce: emailNonce };
  const emailDigest = await operationApprovalInputDigest(emailSubmitArgs);
  const emailReceipt: OperationApprovalReceipt = {
    ...validReceipt,
    id: `approval_${randomUUID()}`,
    inputDigest: emailDigest,
    nonce: emailNonce,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  let emailResult: { receipt: { status: string; outputRef?: { id: string } } } | undefined;
  let emailErr: unknown;
  try {
    emailResult = (await submitHandler(emailSubmitArgs, {
      userId: 'candidate-review',
      approvalPort,
      approvalReceipt: emailReceipt,
    })) as typeof emailResult;
  } catch (e) {
    emailErr = e;
  }
  check('email: submission does not throw', !emailErr, emailErr);
  check('email: receipt status is dry_run_completed', emailResult?.receipt.status === 'dry_run_completed', emailResult);
  if (emailResult?.receipt.outputRef?.id) {
    const emlPath = `${OUTBOX_DIR}/${emailResult.receipt.outputRef.id}.eml`;
    const { readFile } = await import('node:fs/promises');
    let emlContent = '';
    try {
      emlContent = await readFile(emlPath, 'utf8');
    } catch {
      /* checked below */
    }
    check('email: .eml file actually exists on disk', emlContent.length > 0, emlPath);
    check(
      'email: .eml never claims it was sent/delivered (draft-only)',
      !/\b(sent|delivered)\b/i.test(emlContent),
      emlContent
    );
  } else {
    check('email: .eml file actually exists on disk', false, emailResult);
  }

  console.log('\n=== Browser-form adapter: real Chromium automation against a JS-rendered form ===');
  const browserFreezeArgs = {
    ...freezeArgs,
    applicationTarget: { kind: 'browser-form' as const, company: 'JS Test Co', url: `http://localhost:${JS_FORM_PORT}/apply` },
    proposedFormFields: [
      { field: 'Full Name', type: 'text', proposedAnswer: 'Alex Mercier', status: 'proposed' as const },
      { field: 'Email', type: 'email', proposedAnswer: null, status: 'blocked' as const, note: 'candidate-only' },
      { field: 'Why this role', type: 'textarea', proposedAnswer: 'Tailored note referencing evidence_002.', status: 'proposed' as const },
    ],
  };
  const { submissionPlan: browserPlan } = (await freezeHandler(browserFreezeArgs, {})) as { submissionPlan: SubmissionPlan };
  const browserNonce = randomUUID();
  const browserSubmitArgs = { submissionPlan: browserPlan, idempotencyNonce: browserNonce };
  const browserDigest = await operationApprovalInputDigest(browserSubmitArgs);
  const browserReceipt: OperationApprovalReceipt = {
    ...validReceipt,
    id: `approval_${randomUUID()}`,
    inputDigest: browserDigest,
    nonce: browserNonce,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const browserResult = (await submitHandler(browserSubmitArgs, {
    userId: 'candidate-review',
    approvalPort,
    approvalReceipt: browserReceipt,
  })) as { receipt: { status: string; independentConfirmation?: { status: string } } };
  check(
    'browser-form: submission does not throw, receipt is dry_run_completed',
    browserResult.receipt.status === 'dry_run_completed',
    browserResult
  );
  check(
    'browser-form: independent confirmation observed via separate HTTP call',
    browserResult.receipt.independentConfirmation?.status === 'confirmed',
    browserResult
  );

  console.log('\n=== ats-adapter target with no real integration is refused honestly, not silently routed elsewhere ===');
  const atsFreezeArgs = { ...freezeArgs, applicationTarget: { kind: 'ats-adapter' as const, company: 'Some Real ATS' } };
  const { submissionPlan: atsPlan } = (await freezeHandler(atsFreezeArgs, {})) as { submissionPlan: SubmissionPlan };
  const atsNonce = randomUUID();
  const atsSubmitArgs = { submissionPlan: atsPlan, idempotencyNonce: atsNonce };
  const atsDigest = await operationApprovalInputDigest(atsSubmitArgs);
  const atsReceipt: OperationApprovalReceipt = {
    ...validReceipt,
    id: `approval_${randomUUID()}`,
    inputDigest: atsDigest,
    nonce: atsNonce,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const atsResult = (await submitHandler(atsSubmitArgs, {
    userId: 'candidate-review',
    approvalPort,
    approvalReceipt: atsReceipt,
  })) as { receipt: { status: string; errorSummary?: string } };
  check(
    'ats-adapter: no real integration is refused honestly (no_adapter), not crashed',
    atsResult.receipt.status === 'blocked' && Boolean(atsResult.receipt.errorSummary?.includes('no_adapter')),
    atsResult
  );

  httpServer.close();
  formServer.close();
  jsFormServer.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('e2e crashed:', err);
  process.exit(1);
});
