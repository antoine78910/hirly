import type {
  FeedCandidate,
  FeedCursorPosition,
  FeedReadRepository,
  FeedReadSnapshot,
} from "@hirly/feed-v2";

export const FEED_V2_INDEXED_READ_SQL = `
WITH profile AS (
  SELECT * FROM public.read_candidate_search_profile($1) WHERE status = 'active'
), action_meta AS (
  SELECT coalesce(max(candidate_version), 0)::text AS action_watermark
  FROM public.read_candidate_actions($1)
), inventory_meta AS (
  SELECT coalesce(max(projected_at), '-infinity'::timestamptz)::text AS snapshot_version
  FROM public.job_search_documents
  WHERE lifecycle_status = 'active'
), scored AS (
  SELECT
    document.canonical_group_id::text AS canonical_group_id,
    document.preferred_job_id,
    document.job_version::text AS job_version,
    document.canonical_group_id::text AS company_key,
    round((
      0.40
      + CASE WHEN document.skill_codes && profile.skill_ids THEN 0.25 ELSE 0 END
      + CASE WHEN document.country_codes && profile.country_codes THEN 0.15 ELSE 0 END
      + CASE WHEN document.contract_families && profile.contract_types THEN 0.10 ELSE 0 END
      + CASE WHEN document.work_modes && profile.work_modes THEN 0.10 ELSE 0 END
    )::numeric, 6)::double precision AS relevance_score,
    document.fulfillment_route,
    public.candidate_group_is_excluded($1, document.canonical_group_id) AS action_excluded,
    (document.source_eligible AND document.policy_eligible) AS policy_eligible,
    (
      document.lifecycle_status = 'active'
      AND document.validation_status = 'valid'
      AND document.applyability_tier <> 'blocked'
      AND (document.expires_at IS NULL OR document.expires_at > clock_timestamp())
    ) AS lifecycle_eligible
  FROM public.job_search_documents AS document
  CROSS JOIN profile
  WHERE document.lifecycle_status = 'active'
    AND document.role_family_codes && profile.role_family_ids
    AND document.last_seen_at >= clock_timestamp() - make_interval(days => profile.freshness_window_days)
), paged AS (
  SELECT * FROM scored
  WHERE ($2::double precision IS NULL OR relevance_score < $2
    OR (relevance_score = $2 AND canonical_group_id > $3::text))
  ORDER BY relevance_score DESC, canonical_group_id ASC
  LIMIT $4
)
SELECT
  profile.version::text AS profile_version,
  action_meta.action_watermark,
  inventory_meta.snapshot_version,
  paged.*
FROM profile
CROSS JOIN action_meta
CROSS JOIN inventory_meta
LEFT JOIN paged ON true
ORDER BY paged.relevance_score DESC, paged.canonical_group_id ASC;
`.trim();

interface FeedReadRow {
  profile_version: string;
  action_watermark: string;
  snapshot_version: string;
  canonical_group_id: string | null;
  preferred_job_id: string | null;
  job_version: string | null;
  company_key: string | null;
  relevance_score: number | null;
  fulfillment_route: FeedCandidate["fulfillmentRoute"] | null;
  action_excluded: boolean | null;
  policy_eligible: boolean | null;
  lifecycle_eligible: boolean | null;
}

export interface FeedReadSqlClient {
  unsafe(query: string, parameters: readonly unknown[]): Promise<readonly FeedReadRow[]>;
}

export class PostgresFeedReadRepository implements FeedReadRepository {
  constructor(private readonly sql: FeedReadSqlClient) {}

  async readIndexedCandidates(input: {
    candidateId: string;
    limit: number;
    after: FeedCursorPosition | null;
  }): Promise<FeedReadSnapshot> {
    if (!input.candidateId || input.candidateId.length > 256) throw new Error("invalid_candidate_scope");
    const limit = Math.max(1, Math.min(Math.trunc(input.limit), 1_000));
    const rows = await this.sql.unsafe(FEED_V2_INDEXED_READ_SQL, [
      input.candidateId,
      input.after?.relevanceScore ?? null,
      input.after?.canonicalGroupId ?? null,
      limit + 1,
    ]);
    const metadata = rows[0];
    if (!metadata) {
      return {
        snapshotVersion: "unavailable",
        profileVersion: "unavailable",
        actionWatermark: "0",
        profileReady: false,
        inventoryState: "matching_pending",
        candidates: [],
        hasMore: false,
      };
    }
    const candidates = rows.flatMap((row): FeedCandidate[] => {
      if (row.canonical_group_id === null || row.preferred_job_id === null || row.job_version === null
        || row.company_key === null || row.relevance_score === null || row.fulfillment_route === null) return [];
      return [{
        canonicalGroupId: row.canonical_group_id,
        preferredJobId: row.preferred_job_id,
        jobVersion: row.job_version,
        companyKey: row.company_key,
        relevanceScore: row.relevance_score,
        fulfillmentRoute: row.fulfillment_route,
        actionExcluded: row.action_excluded === true,
        policyEligible: row.policy_eligible === true,
        lifecycleEligible: row.lifecycle_eligible === true,
      }];
    });
    return {
      snapshotVersion: metadata.snapshot_version,
      profileVersion: metadata.profile_version,
      actionWatermark: metadata.action_watermark,
      profileReady: true,
      inventoryState: candidates.length === 0 ? "inventory_gap" : "ready",
      candidates: candidates.slice(0, limit),
      hasMore: candidates.length > limit,
    };
  }
}
