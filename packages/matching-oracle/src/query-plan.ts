export const ONLINE_MATCH_EXPLAIN_SQL = `
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT
  jsd.canonical_group_id,
  jsd.preferred_job_id,
  jsd.job_version,
  jsd.fulfillment_route
FROM job_search_documents AS jsd
WHERE jsd.lifecycle_status = 'active'
  AND jsd.validation_status <> 'invalid'
  AND jsd.expires_at > $1
  AND jsd.published_at >= $2
  AND jsd.role_family_ids && $3::text[]
  AND jsd.country_code = ANY($4::text[])
  AND jsd.contract_type = ANY($5::text[])
  AND jsd.work_mode = ANY($6::text[])
  AND NOT EXISTS (
    SELECT 1
    FROM candidate_action_projection AS cap
    WHERE cap.candidate_id = $7
      AND cap.canonical_group_id = jsd.canonical_group_id
      AND cap.retention_state = 'active'
  )
ORDER BY jsd.published_at DESC, jsd.canonical_group_id ASC
LIMIT 1000;
`.trim();

export const REQUIRED_INDEXES = [
  "job_search_documents_active_role_family_gin",
  "job_search_documents_active_country_contract_mode_published",
  "candidate_action_projection_candidate_group_active",
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
