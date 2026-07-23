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
 * Talks to the sandbox-ats mock (src/sandbox-ats/server.ts). Two separate
 * calls, deliberately: dispatch() only ever tells you the ATS *received* the
 * request, never that it succeeded. confirm() is the independent read that
 * actually observes the outcome — the submit handler must call both and
 * must not treat dispatch()'s response as proof of anything.
 */
export class SandboxAtsAdapter {
  constructor(private readonly baseUrl: string) {}

  async dispatch(plan: SubmissionPlan, nonce: string): Promise<DispatchResult> {
    const res = await fetch(`${this.baseUrl}/applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nonce,
        submissionPlanDigest: plan.planId,
        fields: plan.proposedFormFields,
      }),
    });
    if (!res.ok) {
      throw new Error(`sandbox-ats dispatch failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { id: string; replay: boolean };
    return { externalId: body.id, dispatchStatus: body.replay ? 'replay' : 'received' };
  }

  async confirm(externalId: string): Promise<ConfirmResult> {
    const res = await fetch(`${this.baseUrl}/applications/${externalId}`);
    if (!res.ok) {
      return { status: 'unknown', observedAt: new Date().toISOString(), raw: { httpStatus: res.status } };
    }
    const body = (await res.json()) as { status: string };
    const status = body.status === 'confirmed' ? 'confirmed' : body.status === 'rejected' ? 'rejected' : 'unknown';
    return { status, observedAt: new Date().toISOString(), raw: body };
  }

  /** Polls confirm() until the sandbox settles out of 'received'/'processing', or times out. */
  async waitForConfirmation(externalId: string, timeoutMs = 5000, intervalMs = 300): Promise<ConfirmResult> {
    const deadline = Date.now() + timeoutMs;
    let last: ConfirmResult = { status: 'unknown', observedAt: new Date().toISOString(), raw: null };
    while (Date.now() < deadline) {
      last = await this.confirm(externalId);
      if (last.status !== 'unknown') return last;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return last;
  }
}
