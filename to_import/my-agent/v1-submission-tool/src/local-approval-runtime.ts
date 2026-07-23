/**
 * Local, drop-in replacement for @lssm-tech/lib.contracts-runtime-core's
 * approval helpers (createMemoryApprovalNonceStore, createOperationApprovalPort,
 * operationApprovalInputDigest).
 *
 * WHY THIS EXISTS: that package's published dist/node (and dist/default) ESM
 * bundles throw `SyntaxError: Export '...' is not defined in module` on both
 * `node` and `bun` — a real build defect in the vendored package (traced by
 * hand; unrelated to our code or tsconfig). Rather than block the safety-
 * critical approval gate on an upstream fix, this file reimplements the same
 * documented contract (see node_modules/@lssm-tech/lib.contracts-runtime-core/
 * dist/approval.d.ts and @lssm-tech/lib.contracts-spec/operations/approval.d.ts)
 * with identical function signatures. Swap the import back to the real
 * package once its ESM build is fixed upstream — see NEXT-DIRECTIONS.md.
 */
import { createHash } from 'node:crypto';
import type {
  OperationApprovalDecision,
  OperationApprovalPort,
  OperationApprovalReceipt,
  OperationApprovalRequest,
} from '@lssm-tech/lib.contracts-spec/operations/approval';

export interface ApprovalNonceStore {
  consume(nonce: string, expiresAt: string): Promise<boolean>;
}

export function createMemoryApprovalNonceStore(now: () => Date = () => new Date()): ApprovalNonceStore {
  const consumed = new Map<string, string>(); // nonce -> expiresAt
  return {
    async consume(nonce, expiresAt) {
      if (consumed.has(nonce)) return false;
      consumed.set(nonce, expiresAt);
      void now; // reserved for future TTL sweep; not required for correctness here
      return true;
    },
  };
}

export interface OperationApprovalPortOptions {
  now?: () => Date;
  nonceStore?: ApprovalNonceStore;
  verifyEvidence?: (receipt: OperationApprovalReceipt) => Promise<boolean>;
}

export function createOperationApprovalPort(options: OperationApprovalPortOptions = {}): OperationApprovalPort {
  const now = options.now ?? (() => new Date());
  const nonceStore = options.nonceStore ?? createMemoryApprovalNonceStore(now);
  const verifyEvidence = options.verifyEvidence ?? (async () => true);

  return {
    async authorize(request: OperationApprovalRequest): Promise<OperationApprovalDecision> {
      const { receipt, operation, subject, requiredEffects } = request;

      if (!receipt || !receipt.id || !receipt.nonce || !receipt.inputDigest) {
        return { effect: 'deny', reason: 'malformed_receipt' };
      }
      if (receipt.operation.key !== operation.key || receipt.operation.version !== operation.version) {
        return { effect: 'deny', reason: 'wrong_operation' };
      }
      const nowMs = now().getTime();
      const issuedMs = Date.parse(receipt.issuedAt);
      const expiresMs = Date.parse(receipt.expiresAt);
      if (Number.isNaN(issuedMs) || Number.isNaN(expiresMs)) {
        return { effect: 'deny', reason: 'malformed_receipt' };
      }
      if (nowMs < issuedMs) {
        return { effect: 'deny', reason: 'not_yet_valid' };
      }
      if (nowMs > expiresMs) {
        return { effect: 'deny', reason: 'expired_receipt' };
      }
      if (subject.userId != null && receipt.subject.userId != null && subject.userId !== receipt.subject.userId) {
        return { effect: 'deny', reason: 'wrong_subject' };
      }
      if (subject.tenantId != null && receipt.subject.tenantId != null && subject.tenantId !== receipt.subject.tenantId) {
        return { effect: 'deny', reason: 'wrong_tenant' };
      }
      const missingEffect = requiredEffects.some((e) => !receipt.effects.includes(e));
      if (missingEffect) {
        return { effect: 'deny', reason: 'insufficient_effects' };
      }
      const evidenceOk = await verifyEvidence(receipt);
      if (!evidenceOk) {
        return { effect: 'deny', reason: 'invalid_evidence' };
      }
      // Atomic nonce consumption MUST be the last check — everything above is a
      // read-only scope check; only a fully-valid receipt should burn its nonce.
      const consumed = await nonceStore.consume(receipt.nonce, receipt.expiresAt);
      if (!consumed) {
        return { effect: 'deny', reason: 'replayed_receipt' };
      }
      return { effect: 'allow', receiptId: receipt.id, nonce: receipt.nonce };
    },
  };
}

/** Canonical JSON stringify (sorted keys, recursively) so digests are stable regardless of key order. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export async function operationApprovalInputDigest(input: unknown): Promise<string> {
  return createHash('sha256').update(canonicalize(input)).digest('hex');
}
