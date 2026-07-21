-- Operational rollback refuses to remove an activated or evidence-bearing source.
BEGIN;

REVOKE ALL ON FUNCTION worker_private.get_sprout_source_runtime(uuid, text)
  FROM hirly_inventory_worker;
DROP FUNCTION IF EXISTS worker_private.get_sprout_source_runtime(uuid, text);

REVOKE ALL ON FUNCTION worker_private.commit_sprout_source_page(
  uuid, uuid, bigint, text, uuid, uuid, text, text, jsonb, jsonb, boolean, jsonb
) FROM hirly_inventory_worker;
DROP FUNCTION IF EXISTS worker_private.commit_sprout_source_page(
  uuid, uuid, bigint, text, uuid, uuid, text, text, jsonb, jsonb, boolean, jsonb
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.career_sources AS source
    WHERE source.provider = 'sprout'
      AND (
        source.enabled OR source.transport_enabled OR source.incremental_enabled
        OR source.backfill_enabled OR source.policy_id IS NOT NULL
        OR source.credential_ref IS NOT NULL OR source.approved_page_size IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM public.raw_job_snapshots AS snapshot
          WHERE snapshot.source_id = source.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'refusing to roll back activated or evidence-bearing Sprout source';
  END IF;
END
$$;

ALTER TABLE public.career_sources
  DROP CONSTRAINT IF EXISTS career_sources_credential_ref_guard,
  DROP CONSTRAINT IF EXISTS career_sources_approved_page_size_guard,
  DROP COLUMN IF EXISTS credential_ref,
  DROP COLUMN IF EXISTS approved_page_size;

DROP TRIGGER IF EXISTS source_identity_collisions_immutable
  ON public.source_identity_collisions;
DROP TABLE IF EXISTS public.source_identity_collisions;
DELETE FROM public.career_sources
WHERE provider = 'sprout' AND source_key = 'sprout:france';
DELETE FROM public.provider_registry
WHERE provider = 'sprout'
  AND authorization_status = 'unverified'
  AND authorization_evidence_ref IS NULL
  AND NOT enabled
  AND writer_runtime = 'none';

COMMIT;
