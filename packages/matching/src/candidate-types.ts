import type {
  CandidateActionProjection,
  CandidateProjectionOutboxEvent,
  CandidateSearchProfile,
} from "@hirly/contracts";

export type ProjectionApplyResult = "applied" | "stale" | "missing";

export interface CandidateSourceSnapshot {
  profile: Record<string, unknown> | null;
  user: Record<string, unknown> | null;
}

export interface CandidateProjectionSource {
  claim(limit: number, leaseSeconds: number): Promise<CandidateProjectionOutboxEvent[]>;
  loadCandidate(candidateId: string): Promise<CandidateSourceSnapshot>;
  loadAction(event: CandidateProjectionOutboxEvent): Promise<Record<string, unknown> | null>;
  acknowledge(eventId: string): Promise<boolean>;
}

export interface CandidateProjectionStore {
  resolveCanonicalGroup(sourceJobId: string): Promise<string | null>;
  applyProfile(
    profile: CandidateSearchProfile,
    sourceEventId: string,
  ): Promise<ProjectionApplyResult>;
  applyPausedProfile(
    profile: CandidateSearchProfile,
    sourceEventId: string,
  ): Promise<ProjectionApplyResult>;
  applyAction(
    action: CandidateActionProjection,
    sourceEventId: string,
  ): Promise<ProjectionApplyResult>;
  retireAction(event: CandidateProjectionOutboxEvent): Promise<ProjectionApplyResult>;
  applyDeletion(event: CandidateProjectionOutboxEvent): Promise<ProjectionApplyResult>;
}

export interface ProjectionBatchResult {
  claimed: number;
  acknowledged: number;
  applied: number;
  stale: number;
  missing: number;
}
