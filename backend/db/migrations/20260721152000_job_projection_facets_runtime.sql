-- Persist additive matching facets through the fenced TypeScript projection writer.
-- The existing completion RPC retains lease/version/source-digest ownership; this
-- wrapper only adds the facet columns after that guarded write succeeds.
BEGIN;

CREATE OR REPLACE FUNCTION worker_private.complete_job_projection_upsert_with_facets(
  p_task_id uuid,
  p_lease_token uuid,
  p_claim_generation bigint,
  p_lease_owner text,
  p_document jsonb,
  p_source_content_hash text,
  p_duration_ms integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_completed boolean;
  v_group_id uuid;
  v_version bigint;
BEGIN
  v_completed := worker_private.complete_job_projection_upsert(
    p_task_id,
    p_lease_token,
    p_claim_generation,
    p_lease_owner,
    p_document,
    p_source_content_hash,
    p_duration_ms
  );
  IF NOT v_completed THEN
    RETURN false;
  END IF;

  -- Do not let a stale/reconciled task overwrite a newer projection's facets.
  v_group_id := (p_document->>'canonical_group_id')::uuid;
  v_version := (p_document->>'job_version')::bigint;
  UPDATE public.job_search_documents
  SET
    sector_ids = ARRAY(
      SELECT jsonb_array_elements_text(
        coalesce(p_document->'sector_ids', '[]'::jsonb)
      )
    ),
    industry_ids = ARRAY(
      SELECT jsonb_array_elements_text(
        coalesce(p_document->'industry_ids', '[]'::jsonb)
      )
    ),
    updated_at = clock_timestamp()
  WHERE canonical_group_id = v_group_id
    AND job_version = v_version
    AND source_content_hash = p_source_content_hash;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION worker_private.complete_job_projection_upsert_with_facets(uuid, uuid, bigint, text, jsonb, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_private.complete_job_projection_upsert_with_facets(uuid, uuid, bigint, text, jsonb, text, integer) TO hirly_matching_projector;

COMMIT;
