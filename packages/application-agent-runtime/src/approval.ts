import type { OperationApprovalPort, OperationApprovalRequest } from '@lssm-tech/lib.contracts-spec/operations';
import type { ApprovalNonceStore, ApprovalReviewStore, Clock, Hasher } from './ports';

export const createApprovalPort = (deps: { reviews: ApprovalReviewStore; nonces: ApprovalNonceStore; clock: Clock; hasher: Hasher }): OperationApprovalPort => ({
  async authorize(request: OperationApprovalRequest) {
    const { receipt } = request;
    if (receipt.operation.key !== request.operation.key || receipt.operation.version !== request.operation.version) return { effect: 'deny', reason: 'wrong_operation' };
    if (receipt.subject.userId !== request.subject.userId) return { effect: 'deny', reason: 'wrong_subject' };
    if ((receipt.subject.tenantId ?? null) !== (request.subject.tenantId ?? null) || (receipt.subject.workspaceId ?? null) !== (request.subject.workspaceId ?? null)) return { effect: 'deny', reason: 'wrong_tenant' };
    if (receipt.issuedAt > deps.clock.now().toISOString()) return { effect: 'deny', reason: 'not_yet_valid' };
    if (receipt.expiresAt <= deps.clock.now().toISOString()) return { effect: 'deny', reason: 'expired_receipt' };
    if (receipt.inputDigest !== deps.hasher.digest(request.input)) return { effect: 'deny', reason: 'wrong_input' };
    if (!request.requiredEffects.every((effect) => receipt.effects.includes(effect))) return { effect: 'deny', reason: 'insufficient_effects' };
    const review = await deps.reviews.get(receipt.evidenceRef);
    const input = request.input as { planDigest?: string; targetOrigin?: string; adapterVersion?: string };
    const now = deps.clock.now().toISOString();
    if (!review || review.status !== 'approved' || review.issuedAt > now || review.expiresAt <= now || review.issuedAt >= review.expiresAt || review.subject.userId !== request.subject.userId || (review.subject.tenantId ?? null) !== (request.subject.tenantId ?? null) || (review.subject.workspaceId ?? null) !== (request.subject.workspaceId ??null) || review.planDigest !== input.planDigest || review.targetOrigin !== input.targetOrigin || review.adapterVersion !== input.adapterVersion) return { effect: 'deny', reason: 'invalid_evidence' };
    if (!await deps.nonces.consume(receipt.nonce)) return { effect: 'deny', reason: 'replayed_receipt' };
    return { effect: 'allow', receiptId: receipt.id, nonce: receipt.nonce };
  },
});
