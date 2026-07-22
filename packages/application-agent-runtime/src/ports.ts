import type {
  ApplicationDraft, ApplicationOutcomeObservation, ApplicationSubmissionPlan,
  ApplicationSubmissionReceipt, AtsAdapterCapabilities, CandidateEvidenceItem,
  CandidateEvidenceSnapshot, ClaimSupport, JobSnapshot,
} from '@hirly/application-agent-contracts';

export interface CandidateEvidenceStore { getSnapshot(id: string): Promise<CandidateEvidenceSnapshot | undefined>; getItems(ids: readonly string[]): Promise<CandidateEvidenceItem[]>; }
export interface JobSnapshotStore { get(id: string): Promise<JobSnapshot | undefined>; put(value: JobSnapshot): Promise<void>; }
export interface ApplicationDraftStore { get(id: string): Promise<ApplicationDraft | undefined>; put(value: ApplicationDraft): Promise<void>; }
export interface SubmissionPlanStore { get(id: string): Promise<ApplicationSubmissionPlan | undefined>; put(value: ApplicationSubmissionPlan): Promise<void>; }
export interface SubmissionReceiptStore { get(planId: string): Promise<ApplicationSubmissionReceipt | undefined>; put(value: ApplicationSubmissionReceipt): Promise<void>; }
export interface ApplicationOutcomeStore { put(value: ApplicationOutcomeObservation): Promise<void>; }
export interface JobSourceReader { read(input: { jobUrl?: string; fixtureId?: string }): Promise<JobSnapshot>; }
export interface JobNormalizer { normalize(input: JobSnapshot): Promise<JobSnapshot>; }
export interface ApplicationModelGateway { createDraft(input: { snapshot: CandidateEvidenceSnapshot; job: JobSnapshot; evidence: CandidateEvidenceItem[] }): Promise<Omit<ApplicationDraft, 'candidateEvidenceSnapshotId' | 'jobSnapshotId'>>; }
export interface ClaimSupportVerifier { verify(draft: ApplicationDraft, evidence: CandidateEvidenceItem[]): Promise<{ supports: ClaimSupport[]; blockedReasonCodes: string[] }>; }
export interface AtsAdapter { key: string; version: string; capabilities: AtsAdapterCapabilities; submit(plan: ApplicationSubmissionPlan): Promise<{ providerApplicationId?: string }>; readBack(plan: ApplicationSubmissionPlan): Promise<{ confirmed: boolean; evidenceRef?: string }>; }
export interface AtsCapabilityRegistry { get(key: string, version: string): AtsAdapter | undefined; }
export interface ApprovalReviewRecord { ref: string; status: 'approved'; subject: { userId?: string | null; tenantId?: string | null; workspaceId?: string | null }; planDigest: string; targetOrigin: string; adapterVersion: string; issuedAt: string; expiresAt: string; }
export interface ApprovalReviewStore { get(ref: string): Promise<ApprovalReviewRecord | undefined>; }
export interface ApprovalNonceStore { consume(nonce: string): Promise<boolean>; }
export interface IdempotencyStore { claim(key: string): Promise<'claimed' | 'duplicate'>; }
export interface Clock { now(): Date; }
export interface IdGenerator { next(prefix: string): string; }
export interface Hasher { digest(value: unknown): string; }
export interface Redactor { redact(value: unknown): unknown; }
export interface SafeLogger { info(event: string, fields: Record<string, unknown>): void; error(event: string, fields: Record<string, unknown>): void; }
export interface AuditOutboxPublisher { publish(event: { key: string; version: string; payload: unknown }): Promise<void>; }
