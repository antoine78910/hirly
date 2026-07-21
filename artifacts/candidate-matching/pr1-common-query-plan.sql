-- Disposable PostgreSQL proof for the common ONLINE_FIRST retrieval indexes.
-- Run after 20260721002400_candidate_matching_common_schema.sql. The transaction
-- rolls back all representative fixtures and never mutates canonical jobs.
BEGIN;

INSERT INTO public.job_search_documents (
  canonical_group_id, preferred_job_id, job_version, lifecycle_status,
  normalized_title, role_family_codes, contract_families, work_modes,
  country_codes, fresh_until, fulfillment_route, source_eligible,
  policy_eligible, feature_schema_version, search_vector, source_updated_at
)
SELECT
  md5('pr1-group-' || n::text)::uuid,
  'pr1-job-' || n::text,
  1,
  'active',
  CASE WHEN n % 10 = 0 THEN 'fullstack engineer' ELSE 'account manager' END,
  CASE WHEN n % 10 = 0 THEN ARRAY['software-engineering'] ELSE ARRAY['sales'] END,
  ARRAY['permanent'],
  CASE WHEN n % 3 = 0 THEN ARRAY['remote'] ELSE ARRAY['onsite'] END,
  CASE WHEN n % 5 = 0 THEN ARRAY['FR'] ELSE ARRAY['DE'] END,
  clock_timestamp() + interval '30 days',
  'manual',
  true,
  true,
  1,
  to_tsvector('simple', CASE WHEN n % 10 = 0 THEN 'fullstack engineer' ELSE 'account manager' END),
  clock_timestamp()
FROM generate_series(1, 300000) AS fixture(n)
ON CONFLICT (canonical_group_id) DO NOTHING;

ANALYZE public.job_search_documents;

EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT canonical_group_id, preferred_job_id, job_version
FROM public.job_search_documents
WHERE lifecycle_status = 'active'
  AND source_eligible
  AND policy_eligible
  AND fresh_until > clock_timestamp()
  AND country_codes && ARRAY['FR']::text[]
  AND role_family_codes && ARRAY['software-engineering']::text[]
  AND work_modes && ARRAY['remote', 'onsite']::text[]
  AND contract_families && ARRAY['permanent']::text[]
ORDER BY fresh_until DESC, canonical_group_id
LIMIT 200;

ROLLBACK;
