-- TS_MIGRATION: the scheduled frontier scan runs in incremental mode and
-- requires the proven country-only lane to explicitly opt into that mode.
BEGIN;

UPDATE public.career_sources AS source
SET incremental_enabled = true,
    updated_at = clock_timestamp()
WHERE source.provider = 'sprout'
  AND source.source_key = 'sprout:france:country-only'
  AND source.discovery_state = 'approved'
  AND source.enabled
  AND source.transport_enabled
  AND source.backfill_enabled
  AND source.canary_evidence->>'status' = 'passed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.career_sources AS source
    WHERE source.provider = 'sprout'
      AND source.source_key = 'sprout:france:country-only'
      AND source.incremental_enabled
  ) THEN
    RAISE EXCEPTION 'Sprout country-only frontier lane must be approved and incremental-enabled';
  END IF;
END
$$;

COMMIT;
