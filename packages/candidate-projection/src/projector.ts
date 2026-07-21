import type { CandidateProjectionOutboxEvent } from "@hirly/contracts";
import { normalizeCandidateAction, normalizeCandidateProfile } from "./normalization";
import type {
  CandidateProjectionSource,
  CandidateProjectionStore,
  ProjectionApplyResult,
  ProjectionBatchResult,
} from "./types";

function emptyBatch(claimed: number): ProjectionBatchResult {
  return { claimed, acknowledged: 0, applied: 0, stale: 0, missing: 0 };
}

export class CandidateProjector {
  constructor(
    private readonly source: CandidateProjectionSource,
    private readonly store: CandidateProjectionStore,
  ) {}

  async project(event: CandidateProjectionOutboxEvent): Promise<ProjectionApplyResult> {
    if (event.eventFamily === "deletion") return this.store.applyDeletion(event);

    if (event.eventFamily === "profiles" || event.eventFamily === "users") {
      const profile = normalizeCandidateProfile({
        event,
        snapshot: await this.source.loadCandidate(event.candidateId),
      });
      return profile.status === "paused"
        ? this.store.applyPausedProfile(profile, event.eventId)
        : this.store.applyProfile(profile, event.eventId);
    }

    if (event.operation === "delete") return this.store.retireAction(event);

    const source = await this.source.loadAction(event);
    if (!source) return "missing";
    const sourceJobId = String(source.job_id ?? source.source_job_id ?? "").trim();
    if (!sourceJobId) return "missing";
    const canonicalGroupId = await this.store.resolveCanonicalGroup(sourceJobId);
    if (!canonicalGroupId) return "missing";
    return this.store.applyAction(
      normalizeCandidateAction({ event, source, canonicalGroupId }),
      event.eventId,
    );
  }

  async runBatch(limit: number, leaseSeconds: number): Promise<ProjectionBatchResult> {
    const events = await this.source.claim(limit, leaseSeconds);
    const result = emptyBatch(events.length);
    for (const event of events) {
      const outcome = await this.project(event);
      result[outcome] += 1;
      if (outcome !== "missing" && (await this.source.acknowledge(event.eventId))) {
        result.acknowledged += 1;
      }
    }
    return result;
  }
}
