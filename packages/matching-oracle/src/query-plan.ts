export const ONLINE_MATCH_EXPLAIN_SQL = `
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT
  jsd.canonical_group_id,
  jsd.preferred_job_id,
  jsd.job_version,
  jsd.fulfillment_route
FROM job_search_documents AS jsd
WHERE jsd.lifecycle_status = 'active'
  AND jsd.validation_status = 'valid'
  AND jsd.source_eligible
  AND jsd.policy_eligible
  AND jsd.applyability_tier <> 'blocked'
  AND jsd.fulfillment_route <> 'blocked'
  AND (jsd.expires_at IS NULL OR jsd.expires_at > $1)
  AND jsd.posted_at >= $2
  AND jsd.role_family_codes && $3::text[]
  AND jsd.country_codes && $4::text[]
  AND jsd.contract_families && $5::text[]
  AND jsd.work_modes && $6::text[]
  AND NOT public.candidate_group_is_excluded($7, jsd.canonical_group_id)
ORDER BY jsd.posted_at DESC, jsd.canonical_group_id ASC
LIMIT 1000;
`.trim();

export const REQUIRED_INDEXES = [
  "job_search_documents_retrieval_idx",
  "job_search_documents_features_idx",
  "candidate_action_projection_exclusion_idx",
  "candidate_action_group_aliases_alias_idx",
] as const;

export interface QueryPlanEvidence {
  sql: string;
  requiredIndexes: readonly string[];
  databaseEvidence: "not_collected";
  gap: string;
}

export function queryPlanEvidence(): QueryPlanEvidence {
  return {
    sql: ONLINE_MATCH_EXPLAIN_SQL,
    requiredIndexes: REQUIRED_INDEXES,
    databaseEvidence: "not_collected",
    gap: "PR0 local harness has no representative inventory PostgreSQL snapshot; run this EXPLAIN against the staged 300k-group dataset before signing the serving ADR.",
  };
}
