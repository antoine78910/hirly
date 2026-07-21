BEGIN;

DO $migration$
DECLARE
  v_extension_schema name;
  v_marker constant text :=
    'hirly:pgcrypto-schema-compatibility:20260721001950';
  v_text_wrapper regprocedure;
  v_bytea_wrapper regprocedure;
BEGIN
  SELECT namespace.nspname
  INTO v_extension_schema
  FROM pg_catalog.pg_extension AS extension
  INNER JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto';

  IF v_extension_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto extension is unavailable after installation';
  END IF;

  IF v_extension_schema = 'public' THEN
    RETURN;
  END IF;

  IF v_extension_schema <> 'extensions' THEN
    RAISE EXCEPTION USING
      ERRCODE = '0A000',
      MESSAGE = format(
        'pgcrypto extension must live in public or extensions, found %I',
        v_extension_schema
      );
  END IF;

  v_text_wrapper := pg_catalog.to_regprocedure('public.digest(text,text)');
  v_bytea_wrapper := pg_catalog.to_regprocedure('public.digest(bytea,text)');

  IF v_text_wrapper IS NULL AND v_bytea_wrapper IS NULL THEN
    RETURN;
  END IF;

  IF v_text_wrapper IS NULL OR v_bytea_wrapper IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42723',
      MESSAGE = 'pgcrypto compatibility wrappers are partially present; refusing down migration';
  END IF;

  IF pg_catalog.obj_description(v_text_wrapper, 'pg_proc') IS DISTINCT FROM v_marker
    OR pg_catalog.obj_description(v_bytea_wrapper, 'pg_proc') IS DISTINCT FROM v_marker
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42723',
      MESSAGE = 'pgcrypto compatibility wrappers are not marker-owned; refusing down migration';
  END IF;

  DROP FUNCTION public.digest(bytea, text);
  DROP FUNCTION public.digest(text, text);
END
$migration$;

COMMIT;
