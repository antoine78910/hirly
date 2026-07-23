import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { SubmissionPlan } from '../schemas.js';

export interface DispatchResult {
  externalId: string;
  dispatchStatus: 'received' | 'replay';
}
export interface ConfirmResult {
  status: 'confirmed' | 'rejected' | 'unknown';
  observedAt: string;
  raw: unknown;
}

/**
 * Default mode (and the only mode this build actually exercises) is drafts-only:
 * dispatch() writes a real .eml file to outboxDir and NEVER sends anything.
 * This matches the project's existing drafts-first default for delivery
 * connectors — "make the v0 deliverable the message itself."
 *
 * Real SMTP sending is intentionally NOT implemented here — it would need a
 * real mailbox credential this session doesn't have, and per this project's
 * hard rule, no credential handling gets added speculatively. Wiring a real
 * transport (nodemailer + vault SMTP credential) is a flagged NEXT-DIRECTIONS
 * step once a real mailbox exists.
 */
export class EmailAdapter {
  constructor(private readonly outboxDir: string) {}

  private buildEml(plan: SubmissionPlan, nonce: string): { subject: string; to: string; body: string } {
    const to =
      plan.applicationTarget.url && plan.applicationTarget.url.includes('@')
        ? plan.applicationTarget.url
        : `careers@${plan.applicationTarget.company.toLowerCase().replace(/\s+/g, '')}.example-unresolved`;
    const subject = `Application: ${plan.applicationTarget.formHeading ?? plan.applicationTarget.company}`;
    const fieldsBlock = plan.proposedFormFields
      .map((f) => `${f.field}: ${f.proposedAnswer ?? '[CANDIDATE TO PROVIDE]'}`)
      .join('\n');
    const body = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `X-Hirly-Submission-Plan-Id: ${plan.planId}`,
      `X-Hirly-Idempotency-Nonce: ${nonce}`,
      '',
      fieldsBlock,
      '',
      plan.doesNotAuthorizeSubmission,
    ].join('\n');
    return { subject, to, body };
  }

  async dispatch(plan: SubmissionPlan, nonce: string): Promise<DispatchResult> {
    await mkdir(this.outboxDir, { recursive: true });
    const existingPath = `${this.outboxDir}/${nonce}.eml`;
    try {
      await readFile(existingPath, 'utf8');
      return { externalId: nonce, dispatchStatus: 'replay' };
    } catch {
      // doesn't exist yet — proceed to write
    }
    const { body } = this.buildEml(plan, nonce);
    await writeFile(existingPath, body, 'utf8');
    return { externalId: nonce, dispatchStatus: 'received' };
  }

  /** Independent confirmation: re-reads the file from disk rather than trusting the write call's return. */
  async confirm(externalId: string): Promise<ConfirmResult> {
    const path = `${this.outboxDir}/${externalId}.eml`;
    try {
      const content = await readFile(path, 'utf8');
      return {
        status: content.includes('X-Hirly-Submission-Plan-Id') ? 'confirmed' : 'unknown',
        observedAt: new Date().toISOString(),
        raw: { path },
      };
    } catch {
      return { status: 'unknown', observedAt: new Date().toISOString(), raw: { path, error: 'not_found' } };
    }
  }

  async waitForConfirmation(externalId: string): Promise<ConfirmResult> {
    return this.confirm(externalId);
  }
}

// Re-export a throwaway id helper so callers don't need node:crypto directly for tests.
export function newDraftId(): string {
  return randomUUID();
}
