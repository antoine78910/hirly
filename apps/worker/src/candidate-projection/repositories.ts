import {
  candidateProjectionOutboxEventSchema,
  toCandidateActionProjectionPersistenceRow,
  toCandidateSearchProfilePersistenceRow,
  type CandidateActionProjection,
  type CandidateProjectionOutboxEvent,
  type CandidateSearchProfile,
} from "@hirly/contracts";
import type {
  CandidateProjectionSource,
  CandidateProjectionStore,
  CandidateSourceSnapshot,
  ProjectionApplyResult,
} from "@hirly/matching";
import type { Database } from "@hirly/db";

interface ClaimedOutboxRow {
  event_id: string;
  candidate_id: string;
  candidate_version: string;
  entity_family: CandidateProjectionOutboxEvent["eventFamily"];
  entity_id: string;
  operation: CandidateProjectionOutboxEvent["operation"];
  event_key: string;
  created_at: Date;
  lease_token: string;
}

export class PrimaryCandidateProjectionSource implements CandidateProjectionSource {
  private readonly leases = new Map<string, string>();

  constructor(
    private readonly sql: Database,
    private readonly leaseOwner: string,
  ) {}

  async claim(limit: number, leaseSeconds: number): Promise<CandidateProjectionOutboxEvent[]> {
    const rows = await this.sql<ClaimedOutboxRow[]>`
      SELECT * FROM public.claim_candidate_projection_outbox(
        ${this.leaseOwner}, ${limit}, ${leaseSeconds}
      )
    `;
    return rows.map((row) => {
      this.leases.set(row.event_id, row.lease_token);
      return candidateProjectionOutboxEventSchema.parse({
        schemaVersion: "hirly.matching.v1",
        eventId: row.event_id,
        candidateId: row.candidate_id,
        eventFamily: row.entity_family,
        entityId: row.entity_id,
        operation: row.operation,
        entityVersion: String(row.candidate_version),
        idempotencyKey: row.event_key,
        occurredAt: row.created_at.toISOString(),
      });
    });
  }

  async loadCandidate(candidateId: string): Promise<CandidateSourceSnapshot> {
    const [row] = await this.sql<
      { profile: Record<string, unknown> | null; user_record: Record<string, unknown> | null }[]
    >`
      SELECT
        (SELECT to_jsonb(profile) FROM public.profiles AS profile WHERE profile.user_id = ${candidateId}) AS profile,
        (SELECT to_jsonb(account) FROM public.users AS account WHERE account.user_id = ${candidateId}) AS user_record
    `;
    return { profile: row?.profile ?? null, user: row?.user_record ?? null };
  }

  async loadAction(event: CandidateProjectionOutboxEvent): Promise<Record<string, unknown> | null> {
    if (event.eventFamily === "applications") {
      const [row] = await this.sql<{ source: Record<string, unknown> }[]>`
        SELECT to_jsonb(application) AS source
        FROM public.applications AS application
        WHERE application.application_id = ${event.entityId}
          AND application.user_id = ${event.candidateId}
      `;
      return row?.source ?? null;
    }
    if (event.eventFamily === "swipes") {
      const separator = `${event.candidateId}:`;
      const jobId = event.entityId.startsWith(separator)
        ? event.entityId.slice(separator.length)
        : event.entityId;
      const [row] = await this.sql<{ source: Record<string, unknown> }[]>`
        SELECT to_jsonb(swipe) AS source
        FROM public.swipes AS swipe
        WHERE swipe.user_id = ${event.candidateId} AND swipe.job_id = ${jobId}
      `;
      return row?.source ?? null;
    }
    return null;
  }

  async acknowledge(eventId: string): Promise<boolean> {
    const leaseToken = this.leases.get(eventId);
    if (!leaseToken) return false;
    const [row] = await this.sql<{ acknowledged: boolean }[]>`
      SELECT public.ack_candidate_projection_outbox(
        ${eventId}::uuid, ${this.leaseOwner}, ${leaseToken}::uuid
      ) AS acknowledged
    `;
    if (row?.acknowledged) this.leases.delete(eventId);
    return row?.acknowledged === true;
  }
}

function outcome(rows: readonly unknown[]): ProjectionApplyResult {
  return rows.length > 0 ? "applied" : "stale";
}

export class InventoryCandidateProjectionStore implements CandidateProjectionStore {
  constructor(private readonly sql: Database) {}

  async resolveCanonicalGroup(sourceJobId: string): Promise<string | null> {
    const [row] = await this.sql<{ canonical_group_id: string }[]>`
      SELECT canonical_group_id::text
      FROM public.jobs
      WHERE job_id = ${sourceJobId} AND canonical_group_id IS NOT NULL
    `;
    return row?.canonical_group_id ?? null;
  }

  async applyProfile(
    profile: CandidateSearchProfile,
    sourceEventId: string,
  ): Promise<ProjectionApplyResult> {
    const row = toCandidateSearchProfilePersistenceRow(profile, sourceEventId);
    const rows = await this.sql<{ candidate_id: string }[]>`
      INSERT INTO public.candidate_search_profiles (
        schema_version, candidate_id, version, status,
        target_role_label_normalized, target_role_labels_normalized, role_family_ids,
        sector_ids, industry_ids, rome_codes, skill_ids,
        skill_terms, seniority_min, seniority_max, contract_types, work_modes,
        origin_latitude, origin_longitude, radius_km, country_codes,
        location_policy, salary_floor, currency, freshness_window_days,
        exposure_policy_version, feature_schema_version,
        source_profile_updated_at, projected_at, source_event_id
      ) SELECT
        ${row.schema_version}, ${row.candidate_id}, ${row.version}::bigint, ${row.status},
        ${row.target_role_label_normalized}, ${row.target_role_labels_normalized}, ${row.role_family_ids},
        ${row.sector_ids}, ${row.industry_ids}, ${row.rome_codes}, ${row.skill_ids},
        ${row.skill_terms}, ${row.seniority_min}, ${row.seniority_max}, ${row.contract_types}, ${row.work_modes},
        ${row.origin_latitude}, ${row.origin_longitude}, ${row.radius_km}, ${row.country_codes},
        ${row.location_policy}, ${row.salary_floor}, ${row.currency}, ${row.freshness_window_days},
        ${row.exposure_policy_version}, ${row.feature_schema_version},
        ${row.source_profile_updated_at}, ${row.projected_at}, ${row.source_event_id}::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM public.candidate_projection_tombstones
        WHERE candidate_id = ${row.candidate_id}
      )
      ON CONFLICT (candidate_id) DO UPDATE SET
        version = EXCLUDED.version,
        status = EXCLUDED.status,
        target_role_label_normalized = EXCLUDED.target_role_label_normalized,
        target_role_labels_normalized = EXCLUDED.target_role_labels_normalized,
        role_family_ids = EXCLUDED.role_family_ids,
        sector_ids = EXCLUDED.sector_ids,
        industry_ids = EXCLUDED.industry_ids,
        rome_codes = EXCLUDED.rome_codes,
        skill_ids = EXCLUDED.skill_ids,
        skill_terms = EXCLUDED.skill_terms,
        seniority_min = EXCLUDED.seniority_min,
        seniority_max = EXCLUDED.seniority_max,
        contract_types = EXCLUDED.contract_types,
        work_modes = EXCLUDED.work_modes,
        origin_latitude = EXCLUDED.origin_latitude,
        origin_longitude = EXCLUDED.origin_longitude,
        radius_km = EXCLUDED.radius_km,
        country_codes = EXCLUDED.country_codes,
        location_policy = EXCLUDED.location_policy,
        salary_floor = EXCLUDED.salary_floor,
        currency = EXCLUDED.currency,
        freshness_window_days = EXCLUDED.freshness_window_days,
        exposure_policy_version = EXCLUDED.exposure_policy_version,
        feature_schema_version = EXCLUDED.feature_schema_version,
        source_profile_updated_at = EXCLUDED.source_profile_updated_at,
        projected_at = EXCLUDED.projected_at,
        source_event_id = EXCLUDED.source_event_id,
        updated_at = clock_timestamp()
      WHERE candidate_search_profiles.version < EXCLUDED.version
      RETURNING candidate_id
    `;
    return outcome(rows);
  }

  async applyPausedProfile(
    profile: CandidateSearchProfile,
    sourceEventId: string,
  ): Promise<ProjectionApplyResult> {
    return this.sql.begin(async (transaction) => {
      const store = new InventoryCandidateProjectionStore(transaction);
      const applied = await store.applyProfile(profile, sourceEventId);
      if (applied === "applied") {
        await transaction`
          DELETE FROM public.candidate_action_projection
          WHERE candidate_id = ${profile.candidateId}
        `;
      }
      return applied;
    });
  }

  async applyAction(
    action: CandidateActionProjection,
    sourceEventId: string,
  ): Promise<ProjectionApplyResult> {
    const row = toCandidateActionProjectionPersistenceRow(action, sourceEventId);
    const rows = await this.sql<{ action_id: string }[]>`
      INSERT INTO public.candidate_action_projection (
        schema_version, candidate_id, action_id, candidate_version,
        source_job_id, canonical_group_id, canonical_group_aliases,
        action_kind, action_at, projected_at, retention_state,
        retained_until, source_event_id
      ) SELECT
        ${row.schema_version}, ${row.candidate_id}, ${row.action_id}, ${row.candidate_version}::bigint,
        ${row.source_job_id}, ${row.canonical_group_id}::uuid, ${row.canonical_group_aliases}::uuid[],
        ${row.action_kind}, ${row.action_at}, ${row.projected_at}, ${row.retention_state},
        ${row.retained_until}, ${row.source_event_id}::uuid
      WHERE NOT EXISTS (
        SELECT 1 FROM public.candidate_projection_tombstones
        WHERE candidate_id = ${row.candidate_id}
      )
      ON CONFLICT (candidate_id, action_id) DO UPDATE SET
        candidate_version = EXCLUDED.candidate_version,
        source_job_id = EXCLUDED.source_job_id,
        canonical_group_id = EXCLUDED.canonical_group_id,
        canonical_group_aliases = EXCLUDED.canonical_group_aliases,
        action_kind = EXCLUDED.action_kind,
        action_at = EXCLUDED.action_at,
        projected_at = EXCLUDED.projected_at,
        retention_state = EXCLUDED.retention_state,
        retained_until = EXCLUDED.retained_until,
        source_event_id = EXCLUDED.source_event_id,
        updated_at = clock_timestamp()
      WHERE candidate_action_projection.candidate_version < EXCLUDED.candidate_version
      RETURNING action_id
    `;
    return outcome(rows);
  }

  async retireAction(event: CandidateProjectionOutboxEvent): Promise<ProjectionApplyResult> {
    const rows = await this.sql<{ action_id: string }[]>`
      UPDATE public.candidate_action_projection
      SET candidate_version = ${event.entityVersion}::bigint,
          retention_state = 'deleted',
          retained_until = clock_timestamp(),
          projected_at = clock_timestamp(),
          source_event_id = ${event.eventId}::uuid,
          updated_at = clock_timestamp()
      WHERE candidate_id = ${event.candidateId}
        AND action_id = ${event.entityId}
        AND candidate_version < ${event.entityVersion}::bigint
      RETURNING action_id
    `;
    return outcome(rows);
  }

  async applyDeletion(event: CandidateProjectionOutboxEvent): Promise<ProjectionApplyResult> {
    const [row] = await this.sql<{ applied: boolean }[]>`
      SELECT public.apply_candidate_projection_tombstone(
        ${event.candidateId}, ${event.entityVersion}::bigint,
        ${event.eventId}::uuid, ${event.occurredAt}::timestamptz
      ) AS applied
    `;
    return row?.applied ? "applied" : "stale";
  }
}
