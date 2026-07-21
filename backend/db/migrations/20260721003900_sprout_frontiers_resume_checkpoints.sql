BEGIN;

-- Scheduled frontier runs must continue their source checkpoint. Rewinding to
-- offset zero is appropriate only for an explicitly requested rescan; on the
-- broad Sprout feed it otherwise spends every cycle replaying the same window.
UPDATE public.worker_schedules
SET
  payload = jsonb_set(payload, '{cycleStart}', 'false'::jsonb, true),
  updated_at = clock_timestamp()
WHERE provider = 'sprout'
  AND enabled
  AND payload->>'mode' = 'incremental'
  AND payload ? 'sourceId'
  AND coalesce(payload->>'cycleStart', 'false') <> 'false';

COMMIT;
