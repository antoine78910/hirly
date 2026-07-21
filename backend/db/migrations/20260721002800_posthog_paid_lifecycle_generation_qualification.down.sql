DO $migration$
DECLARE
  v_function regprocedure := to_regprocedure(
    'analytics_private.record_posthog_paid_invoice(text,text,text,text,text,timestamptz,text,numeric,text,text)'
  );
  v_definition text;
  v_fixed constant text := E'SELECT 1 FROM public.posthog_paid_lifecycle_evidence AS ended\n'
    || E'    WHERE ended.evidence_type = ''end''\n'
    || E'      AND ended.subscription_id = p_subscription_id\n'
    || E'      AND ended.generation = v_generation';
  v_broken constant text := E'SELECT 1 FROM public.posthog_paid_lifecycle_evidence\n'
    || E'    WHERE evidence_type = ''end''\n'
    || E'      AND subscription_id = p_subscription_id\n'
    || E'      AND generation = v_generation';
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'posthog paid lifecycle invoice function is missing';
  END IF;

  SELECT pg_get_functiondef(v_function) INTO v_definition;
  IF strpos(v_definition, v_broken) > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_definition, v_fixed) = 0 THEN
    RAISE EXCEPTION 'posthog paid lifecycle invoice function has an unexpected definition';
  END IF;

  EXECUTE replace(v_definition, v_fixed, v_broken);
END
$migration$;
