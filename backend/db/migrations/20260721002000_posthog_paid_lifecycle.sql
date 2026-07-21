-- PY_EXCEPTION: durable lifecycle authority must share the Python Stripe writer transaction boundary.
BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics_private;
REVOKE ALL ON SCHEMA analytics_private FROM PUBLIC;

CREATE TABLE public.posthog_paid_lifecycle_evidence (
  business_key text PRIMARY KEY CHECK (length(btrim(business_key)) > 0),
  evidence_type text NOT NULL CHECK (
    evidence_type IN ('invoice_paid', 'subscription_state', 'paid_generation', 'activation', 'end')
  ),
  user_id text NOT NULL CHECK (
    user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND user_id = lower(user_id)
  ),
  subscription_id text NOT NULL CHECK (length(btrim(subscription_id)) > 0),
  generation integer CHECK (generation IS NULL OR generation > 0),
  invoice_id text,
  stripe_event_id text NOT NULL CHECK (length(btrim(stripe_event_id)) > 0),
  stripe_event_type text NOT NULL CHECK (length(btrim(stripe_event_type)) > 0),
  source_occurred_at timestamptz NOT NULL,
  loss_occurred_at timestamptz,
  status text,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT posthog_paid_lifecycle_evidence_shape CHECK (
    (evidence_type NOT IN ('invoice_paid', 'paid_generation', 'activation') OR invoice_id IS NOT NULL)
    AND (evidence_type NOT IN ('paid_generation', 'end') OR generation > 0)
    AND (evidence_type <> 'end' OR (loss_occurred_at IS NOT NULL AND status IS NOT NULL))
    AND (evidence_type <> 'paid_generation' OR loss_occurred_at IS NULL)
  )
);

CREATE UNIQUE INDEX posthog_paid_lifecycle_paid_generation_uidx
  ON public.posthog_paid_lifecycle_evidence (subscription_id, generation)
  WHERE evidence_type = 'paid_generation';
CREATE UNIQUE INDEX posthog_paid_lifecycle_end_uidx
  ON public.posthog_paid_lifecycle_evidence (subscription_id, generation)
  WHERE evidence_type = 'end';
CREATE UNIQUE INDEX posthog_paid_lifecycle_activation_uidx
  ON public.posthog_paid_lifecycle_evidence (user_id)
  WHERE evidence_type = 'activation';
CREATE INDEX posthog_paid_lifecycle_evidence_subscription_idx
  ON public.posthog_paid_lifecycle_evidence (
    subscription_id, source_occurred_at, evidence_type
  );
CREATE INDEX posthog_paid_lifecycle_evidence_stripe_event_idx
  ON public.posthog_paid_lifecycle_evidence (stripe_event_id, evidence_type);

CREATE TABLE public.posthog_paid_lifecycle_watermarks (
  subscription_id text NOT NULL CHECK (length(btrim(subscription_id)) > 0),
  stream text NOT NULL CHECK (stream IN ('invoice_paid', 'subscription_state')),
  source_occurred_at timestamptz NOT NULL,
  stripe_event_id text NOT NULL CHECK (length(btrim(stripe_event_id)) > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (subscription_id, stream)
);

CREATE TABLE public.posthog_paid_lifecycle_outbox (
  fact_key text PRIMARY KEY REFERENCES public.posthog_paid_lifecycle_evidence(business_key)
    ON DELETE RESTRICT,
  event_name text NOT NULL CHECK (
    event_name IN ('subscription_activated', 'subscription_churned')
  ),
  posthog_uuid uuid NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'claimed', 'retrying', 'sent', 'blocked')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text,
  lease_token uuid,
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT posthog_paid_lifecycle_outbox_lease_shape CHECK (
    (status = 'claimed') =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT posthog_paid_lifecycle_outbox_sent_shape CHECK (
    (status = 'sent') = (sent_at IS NOT NULL)
  ),
  CONSTRAINT posthog_paid_lifecycle_outbox_blocked_shape CHECK (
    status <> 'blocked' OR (last_error_code IS NOT NULL AND last_error_message IS NOT NULL)
  )
);

CREATE INDEX posthog_paid_lifecycle_outbox_due_idx
  ON public.posthog_paid_lifecycle_outbox (next_attempt_at, created_at, fact_key)
  WHERE status IN ('pending', 'retrying');
CREATE INDEX posthog_paid_lifecycle_outbox_expired_lease_idx
  ON public.posthog_paid_lifecycle_outbox (lease_expires_at, fact_key)
  WHERE status = 'claimed';
CREATE INDEX posthog_paid_lifecycle_outbox_observability_idx
  ON public.posthog_paid_lifecycle_outbox (status, created_at);

CREATE OR REPLACE FUNCTION analytics_private.reject_posthog_paid_lifecycle_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'paid lifecycle evidence is append-only' USING ERRCODE = '55000';
END
$$;

CREATE TRIGGER posthog_paid_lifecycle_evidence_immutable
BEFORE UPDATE OR DELETE ON public.posthog_paid_lifecycle_evidence
FOR EACH ROW EXECUTE FUNCTION analytics_private.reject_posthog_paid_lifecycle_evidence_mutation();

CREATE OR REPLACE FUNCTION analytics_private.reject_posthog_paid_lifecycle_outbox_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.fact_key IS DISTINCT FROM OLD.fact_key
    OR NEW.event_name IS DISTINCT FROM OLD.event_name
    OR NEW.posthog_uuid IS DISTINCT FROM OLD.posthog_uuid
    OR NEW.payload IS DISTINCT FROM OLD.payload
  THEN
    RAISE EXCEPTION 'paid lifecycle outbox identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER posthog_paid_lifecycle_outbox_identity_immutable
BEFORE UPDATE ON public.posthog_paid_lifecycle_outbox
FOR EACH ROW EXECUTE FUNCTION analytics_private.reject_posthog_paid_lifecycle_outbox_identity_mutation();

CREATE OR REPLACE FUNCTION analytics_private.record_posthog_paid_invoice(
  p_user_id text,
  p_subscription_id text,
  p_invoice_id text,
  p_stripe_event_id text,
  p_stripe_event_type text,
  p_source_occurred_at timestamptz,
  p_currency text,
  p_revenue numeric,
  p_plan text DEFAULT NULL,
  p_billing_reason text DEFAULT NULL
)
RETURNS TABLE (
  invoice_key text,
  paid_generation_key text,
  activation_key text,
  churn_key text,
  generation integer,
  watermark_advanced boolean,
  activation_created boolean,
  churn_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_invoice_key text := 'invoice-paid:' || p_stripe_event_id;
  v_paid_key text;
  v_activation_key text := 'activation:' || p_user_id;
  v_end_key text;
  v_generation integer;
  v_paid_at timestamptz;
  v_last_generation integer;
  v_last_loss timestamptz;
  v_last_user_id text;
  v_existing public.posthog_paid_lifecycle_evidence%ROWTYPE;
  v_state public.posthog_paid_lifecycle_evidence%ROWTYPE;
  v_row_count integer;
  v_activation_created boolean := false;
  v_churn_created boolean := false;
  v_watermark_advanced boolean := false;
  v_activation_payload jsonb;
  v_churn_payload jsonb;
  v_name text;
  v_hash bytea;
  v_hex text;
  v_uuid uuid;
BEGIN
  IF p_user_id IS NULL
    OR p_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_user_id <> lower(p_user_id)
    OR length(btrim(coalesce(p_subscription_id, ''))) NOT BETWEEN 1 AND 255
    OR length(btrim(coalesce(p_invoice_id, ''))) NOT BETWEEN 1 AND 255
    OR length(btrim(coalesce(p_stripe_event_id, ''))) NOT BETWEEN 1 AND 255
    OR length(btrim(coalesce(p_stripe_event_type, ''))) NOT BETWEEN 1 AND 255
    OR p_source_occurred_at IS NULL
    OR p_currency !~ '^[a-z]{3}$'
    OR p_revenue IS NULL OR p_revenue <= 0
    OR length(coalesce(p_plan, '')) > 128
    OR length(coalesce(p_billing_reason, '')) > 128
  THEN
    RAISE EXCEPTION 'invalid paid invoice lifecycle input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('posthog-paid:' || p_subscription_id, 0));

  SELECT evidence.* INTO v_existing
  FROM public.posthog_paid_lifecycle_evidence AS evidence
  WHERE evidence.business_key = v_invoice_key;
  IF FOUND THEN
    v_generation := v_existing.generation;
    v_paid_key := 'paid:' || v_existing.subscription_id || ':' || v_generation::text;
    v_activation_key := 'activation:' || v_existing.user_id;
    SELECT ended.business_key INTO v_end_key
    FROM public.posthog_paid_lifecycle_evidence AS ended
    WHERE ended.evidence_type = 'end'
      AND ended.subscription_id = v_existing.subscription_id
      AND ended.generation = v_generation;
    RETURN QUERY SELECT
      v_existing.business_key, v_paid_key, v_activation_key, v_end_key,
      v_generation, false, false, false;
    RETURN;
  END IF;

  SELECT evidence.generation, ended.loss_occurred_at, evidence.user_id
  INTO v_last_generation, v_last_loss, v_last_user_id
  FROM public.posthog_paid_lifecycle_evidence AS evidence
  LEFT JOIN public.posthog_paid_lifecycle_evidence AS ended
    ON ended.evidence_type = 'end'
   AND ended.subscription_id = evidence.subscription_id
   AND ended.generation = evidence.generation
  WHERE evidence.evidence_type = 'paid_generation'
    AND evidence.subscription_id = p_subscription_id
  ORDER BY evidence.generation DESC
  LIMIT 1;

  IF v_last_user_id IS NOT NULL AND v_last_user_id <> p_user_id THEN
    RAISE EXCEPTION 'paid subscription belongs to a different canonical user'
      USING ERRCODE = '22023';
  END IF;

  IF v_last_generation IS NULL THEN
    v_generation := 1;
  ELSIF v_last_loss IS NULL OR p_source_occurred_at <= v_last_loss THEN
    v_generation := v_last_generation;
  ELSE
    v_generation := v_last_generation + 1;
  END IF;
  v_paid_key := 'paid:' || p_subscription_id || ':' || v_generation::text;

  INSERT INTO public.posthog_paid_lifecycle_evidence (
    business_key, evidence_type, user_id, subscription_id, generation,
    invoice_id, stripe_event_id, stripe_event_type, source_occurred_at, payload
  ) VALUES (
    v_invoice_key, 'invoice_paid', p_user_id, p_subscription_id, v_generation,
    p_invoice_id, p_stripe_event_id, p_stripe_event_type, p_source_occurred_at,
    jsonb_strip_nulls(jsonb_build_object(
      'currency', p_currency, 'revenue', p_revenue,
      'plan', p_plan, 'billing_reason', p_billing_reason
    ))
  ) ON CONFLICT (business_key) DO NOTHING;

  INSERT INTO public.posthog_paid_lifecycle_watermarks (
    subscription_id, stream, source_occurred_at, stripe_event_id, updated_at
  ) VALUES (
    p_subscription_id, 'invoice_paid', p_source_occurred_at, p_stripe_event_id,
    clock_timestamp()
  )
  ON CONFLICT (subscription_id, stream) DO UPDATE
  SET source_occurred_at = EXCLUDED.source_occurred_at,
      stripe_event_id = EXCLUDED.stripe_event_id,
      updated_at = clock_timestamp()
  WHERE (
    public.posthog_paid_lifecycle_watermarks.source_occurred_at,
    public.posthog_paid_lifecycle_watermarks.stripe_event_id
  ) < (EXCLUDED.source_occurred_at, EXCLUDED.stripe_event_id);
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_watermark_advanced := v_row_count > 0;

  INSERT INTO public.posthog_paid_lifecycle_evidence (
    business_key, evidence_type, user_id, subscription_id, generation,
    invoice_id, stripe_event_id, stripe_event_type, source_occurred_at, payload
  ) VALUES (
    v_paid_key, 'paid_generation', p_user_id, p_subscription_id, v_generation,
    p_invoice_id, p_stripe_event_id, p_stripe_event_type, p_source_occurred_at,
    jsonb_build_object('invoice_id', p_invoice_id, 'paid_at', p_source_occurred_at)
  ) ON CONFLICT DO NOTHING;

  SELECT source_occurred_at INTO STRICT v_paid_at
  FROM public.posthog_paid_lifecycle_evidence
  WHERE business_key = v_paid_key;

  v_activation_payload := jsonb_strip_nulls(jsonb_build_object(
    'distinct_id', p_user_id,
    'timestamp', p_source_occurred_at,
    'properties', jsonb_build_object(
      'invoice_id', p_invoice_id,
      'subscription_id', p_subscription_id,
      'currency', p_currency,
      'revenue', p_revenue
    ) || jsonb_strip_nulls(jsonb_build_object(
      'plan', p_plan, 'billing_reason', p_billing_reason
    ))
  ));
  INSERT INTO public.posthog_paid_lifecycle_evidence (
    business_key, evidence_type, user_id, subscription_id, generation,
    invoice_id, stripe_event_id, stripe_event_type, source_occurred_at, payload
  ) VALUES (
    v_activation_key, 'activation', p_user_id, p_subscription_id, v_generation,
    p_invoice_id, p_stripe_event_id, p_stripe_event_type, p_source_occurred_at,
    v_activation_payload
  ) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_activation_created := v_row_count > 0;

  IF v_activation_created THEN
    v_name := 'subscription_activated:user:' || p_user_id;
    v_hash := public.digest(
      decode(replace('69fbb143-6b0b-42ca-8a9b-7f2c1b41c041', '-', ''), 'hex')
      || convert_to(v_name, 'UTF8'),
      'sha1'
    );
    v_hash := set_byte(v_hash, 6, (get_byte(v_hash, 6) & 15) | 80);
    v_hash := set_byte(v_hash, 8, (get_byte(v_hash, 8) & 63) | 128);
    v_hex := encode(substring(v_hash FROM 1 FOR 16), 'hex');
    v_uuid := (
      substr(v_hex, 1, 8) || '-' || substr(v_hex, 9, 4) || '-' ||
      substr(v_hex, 13, 4) || '-' || substr(v_hex, 17, 4) || '-' ||
      substr(v_hex, 21, 12)
    )::uuid;
    INSERT INTO public.posthog_paid_lifecycle_outbox (
      fact_key, event_name, posthog_uuid, payload
    ) VALUES (
      v_activation_key, 'subscription_activated', v_uuid, v_activation_payload
    ) ON CONFLICT DO NOTHING;
  END IF;

  SELECT state.* INTO v_state
  FROM public.posthog_paid_lifecycle_evidence AS state
  JOIN public.posthog_paid_lifecycle_watermarks AS watermark
    ON watermark.subscription_id = state.subscription_id
   AND watermark.stream = 'subscription_state'
   AND watermark.source_occurred_at = state.source_occurred_at
   AND watermark.stripe_event_id = state.stripe_event_id
  WHERE state.evidence_type = 'subscription_state'
    AND state.subscription_id = p_subscription_id
    AND state.user_id = p_user_id
    AND state.loss_occurred_at IS NOT NULL
    AND state.loss_occurred_at >= v_paid_at
    AND state.source_occurred_at >= v_paid_at
  ORDER BY state.source_occurred_at DESC, state.stripe_event_id DESC
  LIMIT 1;

  IF FOUND AND NOT EXISTS (
    SELECT 1 FROM public.posthog_paid_lifecycle_evidence
    WHERE evidence_type = 'end'
      AND subscription_id = p_subscription_id
      AND generation = v_generation
  ) THEN
    v_end_key := 'end:' || p_subscription_id || ':' || v_generation::text;
    v_churn_payload := jsonb_strip_nulls(jsonb_build_object(
      'distinct_id', p_user_id,
      'timestamp', v_state.loss_occurred_at,
      'properties', jsonb_build_object(
        'subscription_id', p_subscription_id,
        'generation', v_generation,
        'status', v_state.status
      ) || jsonb_strip_nulls(jsonb_build_object('reason', v_state.payload->>'reason'))
    ));
    INSERT INTO public.posthog_paid_lifecycle_evidence (
      business_key, evidence_type, user_id, subscription_id, generation,
      invoice_id, stripe_event_id, stripe_event_type, source_occurred_at,
      loss_occurred_at, status, payload
    ) VALUES (
      v_end_key, 'end', p_user_id, p_subscription_id, v_generation,
      p_invoice_id, v_state.stripe_event_id, v_state.stripe_event_type,
      v_state.source_occurred_at, v_state.loss_occurred_at, v_state.status,
      v_churn_payload
    ) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    v_churn_created := v_row_count > 0;
    IF v_churn_created THEN
      v_name := 'subscription_churned:subscription:' || p_subscription_id
        || ':generation:' || v_generation::text;
      v_hash := public.digest(
        decode(replace('69fbb143-6b0b-42ca-8a9b-7f2c1b41c041', '-', ''), 'hex')
        || convert_to(v_name, 'UTF8'),
        'sha1'
      );
      v_hash := set_byte(v_hash, 6, (get_byte(v_hash, 6) & 15) | 80);
      v_hash := set_byte(v_hash, 8, (get_byte(v_hash, 8) & 63) | 128);
      v_hex := encode(substring(v_hash FROM 1 FOR 16), 'hex');
      v_uuid := (
        substr(v_hex, 1, 8) || '-' || substr(v_hex, 9, 4) || '-' ||
        substr(v_hex, 13, 4) || '-' || substr(v_hex, 17, 4) || '-' ||
        substr(v_hex, 21, 12)
      )::uuid;
      INSERT INTO public.posthog_paid_lifecycle_outbox (
        fact_key, event_name, posthog_uuid, payload
      ) VALUES (
        v_end_key, 'subscription_churned', v_uuid, v_churn_payload
      ) ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_invoice_key, v_paid_key, v_activation_key, v_end_key, v_generation,
    v_watermark_advanced, v_activation_created, v_churn_created;
END
$$;

CREATE OR REPLACE FUNCTION analytics_private.record_posthog_subscription_state(
  p_user_id text,
  p_subscription_id text,
  p_stripe_event_id text,
  p_stripe_event_type text,
  p_source_occurred_at timestamptz,
  p_status text,
  p_loss_occurred_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  state_key text,
  paid_generation_key text,
  churn_key text,
  generation integer,
  watermark_advanced boolean,
  churn_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_state_key text := 'subscription-state:' || p_stripe_event_id;
  v_paid_key text;
  v_end_key text;
  v_generation integer;
  v_paid_at timestamptz;
  v_invoice_id text;
  v_row_count integer;
  v_watermark_advanced boolean := false;
  v_churn_created boolean := false;
  v_churn_payload jsonb;
  v_existing public.posthog_paid_lifecycle_evidence%ROWTYPE;
  v_name text;
  v_hash bytea;
  v_hex text;
  v_uuid uuid;
BEGIN
  IF p_user_id IS NULL
    OR p_user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_user_id <> lower(p_user_id)
    OR length(btrim(coalesce(p_subscription_id, ''))) NOT BETWEEN 1 AND 255
    OR length(btrim(coalesce(p_stripe_event_id, ''))) NOT BETWEEN 1 AND 255
    OR length(btrim(coalesce(p_stripe_event_type, ''))) NOT BETWEEN 1 AND 255
    OR p_source_occurred_at IS NULL
    OR length(btrim(coalesce(p_status, ''))) NOT BETWEEN 1 AND 64
    OR length(coalesce(p_reason, '')) > 128
    OR (
      p_loss_occurred_at IS NOT NULL
      AND (
        p_status NOT IN ('canceled', 'past_due', 'unpaid', 'incomplete_expired', 'paused')
        OR p_loss_occurred_at > clock_timestamp()
      )
    )
  THEN
    RAISE EXCEPTION 'invalid subscription-state lifecycle input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('posthog-paid:' || p_subscription_id, 0));

  SELECT evidence.* INTO v_existing
  FROM public.posthog_paid_lifecycle_evidence AS evidence
  WHERE evidence.business_key = v_state_key;
  IF FOUND THEN
    SELECT paid.business_key, paid.generation INTO v_paid_key, v_generation
    FROM public.posthog_paid_lifecycle_evidence AS paid
    WHERE paid.evidence_type = 'paid_generation'
      AND paid.subscription_id = v_existing.subscription_id
      AND paid.source_occurred_at <= coalesce(
        v_existing.loss_occurred_at, v_existing.source_occurred_at
      )
    ORDER BY paid.generation DESC
    LIMIT 1;
    IF v_generation IS NOT NULL THEN
      SELECT ended.business_key INTO v_end_key
      FROM public.posthog_paid_lifecycle_evidence AS ended
      WHERE ended.evidence_type = 'end'
        AND ended.subscription_id = v_existing.subscription_id
        AND ended.generation = v_generation;
    END IF;
    RETURN QUERY SELECT
      v_existing.business_key, v_paid_key, v_end_key, v_generation, false, false;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.posthog_paid_lifecycle_evidence AS paid
    WHERE paid.evidence_type = 'paid_generation'
      AND paid.subscription_id = p_subscription_id
      AND paid.user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'paid subscription belongs to a different canonical user'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.posthog_paid_lifecycle_evidence (
    business_key, evidence_type, user_id, subscription_id,
    stripe_event_id, stripe_event_type, source_occurred_at,
    loss_occurred_at, status, payload
  ) VALUES (
    v_state_key, 'subscription_state', p_user_id, p_subscription_id,
    p_stripe_event_id, p_stripe_event_type, p_source_occurred_at,
    p_loss_occurred_at, p_status,
    jsonb_strip_nulls(jsonb_build_object('status', p_status, 'reason', p_reason))
  ) ON CONFLICT (business_key) DO NOTHING;

  INSERT INTO public.posthog_paid_lifecycle_watermarks (
    subscription_id, stream, source_occurred_at, stripe_event_id, updated_at
  ) VALUES (
    p_subscription_id, 'subscription_state', p_source_occurred_at,
    p_stripe_event_id, clock_timestamp()
  )
  ON CONFLICT (subscription_id, stream) DO UPDATE
  SET source_occurred_at = EXCLUDED.source_occurred_at,
      stripe_event_id = EXCLUDED.stripe_event_id,
      updated_at = clock_timestamp()
  WHERE (
    public.posthog_paid_lifecycle_watermarks.source_occurred_at,
    public.posthog_paid_lifecycle_watermarks.stripe_event_id
  ) < (EXCLUDED.source_occurred_at, EXCLUDED.stripe_event_id);
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_watermark_advanced := v_row_count > 0;

  IF v_watermark_advanced AND p_loss_occurred_at IS NOT NULL THEN
    SELECT evidence.business_key, evidence.generation,
           evidence.source_occurred_at, evidence.invoice_id
    INTO v_paid_key, v_generation, v_paid_at, v_invoice_id
    FROM public.posthog_paid_lifecycle_evidence AS evidence
    WHERE evidence.evidence_type = 'paid_generation'
      AND evidence.subscription_id = p_subscription_id
      AND evidence.user_id = p_user_id
      AND evidence.source_occurred_at <= p_loss_occurred_at
      AND evidence.source_occurred_at <= p_source_occurred_at
      AND NOT EXISTS (
        SELECT 1 FROM public.posthog_paid_lifecycle_evidence AS ended
        WHERE ended.evidence_type = 'end'
          AND ended.subscription_id = evidence.subscription_id
          AND ended.generation = evidence.generation
      )
    ORDER BY evidence.generation DESC
    LIMIT 1;

    IF FOUND THEN
      v_end_key := 'end:' || p_subscription_id || ':' || v_generation::text;
      v_churn_payload := jsonb_strip_nulls(jsonb_build_object(
        'distinct_id', p_user_id,
        'timestamp', p_loss_occurred_at,
        'properties', jsonb_build_object(
          'subscription_id', p_subscription_id,
          'generation', v_generation,
          'status', p_status
        ) || jsonb_strip_nulls(jsonb_build_object('reason', p_reason))
      ));
      INSERT INTO public.posthog_paid_lifecycle_evidence (
        business_key, evidence_type, user_id, subscription_id, generation,
        invoice_id, stripe_event_id, stripe_event_type, source_occurred_at,
        loss_occurred_at, status, payload
      ) VALUES (
        v_end_key, 'end', p_user_id, p_subscription_id, v_generation,
        v_invoice_id, p_stripe_event_id, p_stripe_event_type,
        p_source_occurred_at, p_loss_occurred_at, p_status, v_churn_payload
      ) ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_churn_created := v_row_count > 0;
      IF v_churn_created THEN
        v_name := 'subscription_churned:subscription:' || p_subscription_id
          || ':generation:' || v_generation::text;
        v_hash := public.digest(
          decode(replace('69fbb143-6b0b-42ca-8a9b-7f2c1b41c041', '-', ''), 'hex')
          || convert_to(v_name, 'UTF8'),
          'sha1'
        );
        v_hash := set_byte(v_hash, 6, (get_byte(v_hash, 6) & 15) | 80);
        v_hash := set_byte(v_hash, 8, (get_byte(v_hash, 8) & 63) | 128);
        v_hex := encode(substring(v_hash FROM 1 FOR 16), 'hex');
        v_uuid := (
          substr(v_hex, 1, 8) || '-' || substr(v_hex, 9, 4) || '-' ||
          substr(v_hex, 13, 4) || '-' || substr(v_hex, 17, 4) || '-' ||
          substr(v_hex, 21, 12)
        )::uuid;
        INSERT INTO public.posthog_paid_lifecycle_outbox (
          fact_key, event_name, posthog_uuid, payload
        ) VALUES (
          v_end_key, 'subscription_churned', v_uuid, v_churn_payload
        ) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_state_key, v_paid_key, v_end_key, v_generation,
    v_watermark_advanced, v_churn_created;
END
$$;

CREATE OR REPLACE FUNCTION analytics_private.claim_posthog_paid_lifecycle_deliveries(
  p_owner text,
  p_limit integer,
  p_lease_seconds integer
)
RETURNS SETOF public.posthog_paid_lifecycle_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF length(btrim(coalesce(p_owner, ''))) NOT BETWEEN 1 AND 128
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 5 AND 3600
  THEN
    RAISE EXCEPTION 'invalid paid lifecycle claim' USING ERRCODE = '22023';
  END IF;

  UPDATE public.posthog_paid_lifecycle_outbox
  SET status = 'retrying',
      next_attempt_at = v_now,
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      last_error_code = 'lease_expired',
      last_error_message = 'delivery lease expired before completion',
      updated_at = v_now
  WHERE status = 'claimed' AND lease_expires_at <= v_now;

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.fact_key
    FROM public.posthog_paid_lifecycle_outbox AS outbox
    WHERE outbox.status IN ('pending', 'retrying')
      AND outbox.next_attempt_at <= v_now
    ORDER BY outbox.next_attempt_at, outbox.created_at, outbox.fact_key
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.posthog_paid_lifecycle_outbox AS outbox
  SET status = 'claimed',
      attempt_count = outbox.attempt_count + 1,
      lease_owner = p_owner,
      lease_token = public.gen_random_uuid(),
      lease_generation = outbox.lease_generation + 1,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = v_now
  FROM candidates
  WHERE outbox.fact_key = candidates.fact_key
  RETURNING outbox.*;
END
$$;

CREATE OR REPLACE FUNCTION analytics_private.mark_posthog_paid_lifecycle_sent(
  p_fact_key text,
  p_owner text,
  p_token uuid,
  p_generation bigint
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH changed AS (
    UPDATE public.posthog_paid_lifecycle_outbox
    SET status = 'sent', sent_at = clock_timestamp(),
        lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
        last_error_code = NULL, last_error_message = NULL,
        updated_at = clock_timestamp()
    WHERE fact_key = p_fact_key AND status = 'claimed'
      AND lease_owner = p_owner AND lease_token = p_token
      AND lease_generation = p_generation
      AND lease_expires_at > clock_timestamp()
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM changed)
$$;

CREATE OR REPLACE FUNCTION analytics_private.retry_posthog_paid_lifecycle_delivery(
  p_fact_key text,
  p_owner text,
  p_token uuid,
  p_generation bigint,
  p_error_code text,
  p_error_message text,
  p_next_attempt_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF length(btrim(coalesce(p_error_code, ''))) NOT BETWEEN 1 AND 64
    OR length(btrim(coalesce(p_error_message, ''))) NOT BETWEEN 1 AND 1000
    OR p_next_attempt_at <= clock_timestamp()
    OR p_next_attempt_at > clock_timestamp() + interval '24 hours'
  THEN
    RAISE EXCEPTION 'invalid paid lifecycle retry' USING ERRCODE = '22023';
  END IF;
  UPDATE public.posthog_paid_lifecycle_outbox
  SET status = 'retrying', next_attempt_at = p_next_attempt_at,
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      last_error_code = p_error_code, last_error_message = p_error_message,
      updated_at = clock_timestamp()
  WHERE fact_key = p_fact_key AND status = 'claimed'
    AND lease_owner = p_owner AND lease_token = p_token
    AND lease_generation = p_generation
    AND lease_expires_at > clock_timestamp();
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION analytics_private.block_posthog_paid_lifecycle_delivery(
  p_fact_key text,
  p_owner text,
  p_token uuid,
  p_generation bigint,
  p_error_code text,
  p_error_message text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF length(btrim(coalesce(p_error_code, ''))) NOT BETWEEN 1 AND 64
    OR length(btrim(coalesce(p_error_message, ''))) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid paid lifecycle block' USING ERRCODE = '22023';
  END IF;
  UPDATE public.posthog_paid_lifecycle_outbox
  SET status = 'blocked',
      lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
      last_error_code = p_error_code, last_error_message = p_error_message,
      updated_at = clock_timestamp()
  WHERE fact_key = p_fact_key AND status = 'claimed'
    AND lease_owner = p_owner AND lease_token = p_token
    AND lease_generation = p_generation
    AND lease_expires_at > clock_timestamp();
  RETURN FOUND;
END
$$;

ALTER TABLE public.posthog_paid_lifecycle_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posthog_paid_lifecycle_watermarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posthog_paid_lifecycle_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.posthog_paid_lifecycle_evidence FROM PUBLIC;
REVOKE ALL ON public.posthog_paid_lifecycle_watermarks FROM PUBLIC;
REVOKE ALL ON public.posthog_paid_lifecycle_outbox FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics_private FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA analytics_private FROM anon;
    REVOKE ALL ON public.posthog_paid_lifecycle_evidence FROM anon;
    REVOKE ALL ON public.posthog_paid_lifecycle_watermarks FROM anon;
    REVOKE ALL ON public.posthog_paid_lifecycle_outbox FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics_private FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA analytics_private FROM authenticated;
    REVOKE ALL ON public.posthog_paid_lifecycle_evidence FROM authenticated;
    REVOKE ALL ON public.posthog_paid_lifecycle_watermarks FROM authenticated;
    REVOKE ALL ON public.posthog_paid_lifecycle_outbox FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA analytics_private FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA analytics_private TO service_role;
    REVOKE ALL ON public.posthog_paid_lifecycle_evidence FROM service_role;
    REVOKE ALL ON public.posthog_paid_lifecycle_watermarks FROM service_role;
    REVOKE ALL ON public.posthog_paid_lifecycle_outbox FROM service_role;
    GRANT EXECUTE ON FUNCTION analytics_private.record_posthog_paid_invoice(
      text, text, text, text, text, timestamptz, text, numeric, text, text
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION analytics_private.record_posthog_subscription_state(
      text, text, text, text, timestamptz, text, timestamptz, text
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION analytics_private.claim_posthog_paid_lifecycle_deliveries(
      text, integer, integer
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION analytics_private.mark_posthog_paid_lifecycle_sent(
      text, text, uuid, bigint
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION analytics_private.retry_posthog_paid_lifecycle_delivery(
      text, text, uuid, bigint, text, text, timestamptz
    ) TO service_role;
    GRANT EXECUTE ON FUNCTION analytics_private.block_posthog_paid_lifecycle_delivery(
      text, text, uuid, bigint, text, text
    ) TO service_role;
  END IF;
END
$$;

COMMIT;
