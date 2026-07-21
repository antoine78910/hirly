-- TS_MIGRATION: preserve the migration slot without activating a source.
-- Incremental mode remains an operator-controlled change after all release
-- gates pass; applying migrations must never mutate a source into runnable.
BEGIN;
COMMIT;
