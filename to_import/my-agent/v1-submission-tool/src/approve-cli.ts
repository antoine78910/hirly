#!/usr/bin/env node
/**
 * Stands in for "Hirly's host application after the candidate clicks approve."
 * Real candidate approval UX doesn't exist in this session — there is no
 * Hirly host app to wire into. This CLI is the honest minimum: it shows the
 * EXACT frozen plan a human is being asked to approve, requires a real typed
 * "yes" (not a flag, not a default), and only then constructs a receipt bound
 * to that plan's exact digest. This is a stand-in for the real approval
 * surface, not a replacement for it — see NEXT-DIRECTIONS.
 *
 * Usage: node dist/approve-cli.js <submission-plan.json> <output-receipt.json>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { operationApprovalInputDigest } from './local-approval-runtime.js';
import type { SubmissionPlan } from './schemas.js';

async function main() {
  const [planPath, outputPath] = process.argv.slice(2);
  if (!planPath || !outputPath) {
    console.error('Usage: approve-cli <submission-plan.json> <output-receipt.json>');
    process.exit(1);
  }

  const plan = JSON.parse(await readFile(planPath, 'utf8')) as SubmissionPlan;

  console.log('\n=== SUBMISSION PLAN FOR APPROVAL ===');
  console.log(`Plan ID:  ${plan.planId}`);
  console.log(`Target:   ${plan.applicationTarget.company} (${plan.applicationTarget.kind})`);
  console.log(`Status:   ${plan.overallStatus}`);
  console.log(`\n${plan.doesNotAuthorizeSubmission}\n`);
  console.log('Proposed form field answers:');
  for (const f of plan.proposedFormFields) {
    console.log(`  - ${f.field}: ${f.proposedAnswer ?? '[BLANK — candidate must provide]'} (${f.status})`);
  }
  if (plan.unresolvedBlockers.length) {
    console.log('\nUnresolved blockers:');
    plan.unresolvedBlockers.forEach((b) => console.log(`  - ${b}`));
  }

  if (plan.overallStatus === 'BLOCKED') {
    console.log('\nThis plan is BLOCKED. Approval would be pointless — submit will refuse it regardless.');
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('\nType exactly "yes" to approve this EXACT plan for submission: ');
  rl.close();

  if (answer.trim() !== 'yes') {
    console.log('Not approved. No receipt issued.');
    process.exit(0);
  }

  const nonce = randomUUID();
  const submitArgs = { submissionPlan: plan, idempotencyNonce: nonce };
  const inputDigest = await operationApprovalInputDigest(submitArgs);
  const now = new Date();
  const receipt = {
    id: `approval_${randomUUID()}`,
    subject: { userId: 'candidate-review' },
    operation: { key: 'hirlyApplication.submit', version: '1.0.0' },
    inputDigest,
    effects: ['write', 'external-side-effect'],
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    nonce,
    issuer: 'approve-cli-manual-stand-in',
    evidenceRef: `evidence://manual-cli-approval/${randomUUID()}`,
  };

  await writeFile(outputPath, JSON.stringify({ receipt, submitArgs }, null, 2), 'utf8');
  console.log(`\nApproved. Receipt + submit args written to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
