BEGIN;

DO $migration$
DECLARE
  v_marker constant text :=
    'hirly:pgcrypto-schema-compatibility:20260721001950';
  v_function regprocedure;
BEGIN
  v_function := pg_catalog.to_regprocedure('public.digest(bytea,text)');
  IF v_function IS NOT NULL
    AND pg_catalog.obj_description(v_function, 'pg_proc') = v_marker
  THEN
    DROP FUNCTION public.digest(bytea, text);
  END IF;

  v_function := pg_catalog.to_regprocedure('public.digest(text,text)');
  IF v_function IS NOT NULL
    AND pg_catalog.obj_description(v_function, 'pg_proc') = v_marker
  THEN
    DROP FUNCTION public.digest(text, text);
  END IF;
END
$migration$;

COMMIT;
