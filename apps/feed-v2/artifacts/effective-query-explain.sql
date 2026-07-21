-- Disposable read-only evidence; run after common matching migrations.
BEGIN TRANSACTION READ ONLY;
SET LOCAL enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
SELECT canonical_group_id, preferred_job_id, job_version
FROM public.job_search_documents
WHERE lifecycle_status = 'active'
  AND search_vector @@ websearch_to_tsquery('simple', 'Fullstack Engineer')
  AND country_codes && ARRAY['FR']::text[]
  AND work_modes && ARRAY['hybrid', 'remote']::text[]
  AND contract_families && ARRAY['permanent']::text[]
  AND latitude IS NOT NULL AND longitude IS NOT NULL
  AND 6371.0 * acos(LEAST(1.0, GREATEST(-1.0,
    sin(radians(latitude)) * sin(radians(48.8566))
    + cos(radians(latitude)) * cos(radians(48.8566))
    * cos(radians(longitude - 2.3522))
  ))) <= 52
ORDER BY projected_at DESC, canonical_group_id
LIMIT 13;
ROLLBACK;
