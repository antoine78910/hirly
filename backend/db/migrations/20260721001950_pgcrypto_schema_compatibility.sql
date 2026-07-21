-- TS_NEW: provide a portable pgcrypto digest surface without relocating the extension.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $migration$
DECLARE
  v_extension_schema name;
  v_has_text_wrapper boolean;
  v_has_bytea_wrapper boolean;
  v_marker constant text :=
    'hirly:pgcrypto-schema-compatibility:20260721001950';
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

  v_has_text_wrapper := pg_catalog.to_regprocedure('public.digest(text,text)') IS NOT NULL;
  v_has_bytea_wrapper := pg_catalog.to_regprocedure('public.digest(bytea,text)') IS NOT NULL;

  IF v_has_text_wrapper OR v_has_bytea_wrapper THEN
    RAISE EXCEPTION USING
      ERRCODE = '42723',
      MESSAGE = 'public.digest compatibility wrappers already exist; refusing partial creation';
  END IF;

  EXECUTE pg_catalog.format(
    'CREATE FUNCTION public.digest(text, text) RETURNS bytea '
    || 'LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER '
    || 'SET search_path = pg_catalog '
    || 'AS %L',
    pg_catalog.format('SELECT %I.digest($1, $2)', v_extension_schema)
  );
  COMMENT ON FUNCTION public.digest(text, text) IS
    'hirly:pgcrypto-schema-compatibility:20260721001950';

  EXECUTE pg_catalog.format(
    'CREATE FUNCTION public.digest(bytea, text) RETURNS bytea '
    || 'LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SECURITY INVOKER '
    || 'SET search_path = pg_catalog '
    || 'AS %L',
    pg_catalog.format('SELECT %I.digest($1, $2)', v_extension_schema)
  );
  COMMENT ON FUNCTION public.digest(bytea, text) IS
    'hirly:pgcrypto-schema-compatibility:20260721001950';
END
$migration$;

COMMIT;
