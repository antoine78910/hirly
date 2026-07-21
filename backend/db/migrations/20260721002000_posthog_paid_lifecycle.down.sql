BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON FUNCTION analytics_private.record_posthog_paid_invoice(
      text, text, text, text, text, timestamptz, text, numeric, text, text
    ) FROM service_role;
    REVOKE ALL ON FUNCTION analytics_private.record_posthog_subscription_state(
      text, text, text, text, timestamptz, text, timestamptz, text
    ) FROM service_role;
    REVOKE ALL ON FUNCTION analytics_private.claim_posthog_paid_lifecycle_deliveries(
      text, integer, integer
    ) FROM service_role;
    REVOKE ALL ON FUNCTION analytics_private.mark_posthog_paid_lifecycle_sent(
      text, text, uuid, bigint
    ) FROM service_role;
    REVOKE ALL ON FUNCTION analytics_private.retry_posthog_paid_lifecycle_delivery(
      text, text, uuid, bigint, text, text, timestamptz
    ) FROM service_role;
    REVOKE ALL ON FUNCTION analytics_private.block_posthog_paid_lifecycle_delivery(
      text, text, uuid, bigint, text, text
    ) FROM service_role;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS analytics_private.block_posthog_paid_lifecycle_delivery(
  text, text, uuid, bigint, text, text
);
DROP FUNCTION IF EXISTS analytics_private.retry_posthog_paid_lifecycle_delivery(
  text, text, uuid, bigint, text, text, timestamptz
);
DROP FUNCTION IF EXISTS analytics_private.mark_posthog_paid_lifecycle_sent(
  text, text, uuid, bigint
);
DROP FUNCTION IF EXISTS analytics_private.claim_posthog_paid_lifecycle_deliveries(
  text, integer, integer
);
DROP FUNCTION IF EXISTS analytics_private.record_posthog_subscription_state(
  text, text, text, text, timestamptz, text, timestamptz, text
);
DROP FUNCTION IF EXISTS analytics_private.record_posthog_paid_invoice(
  text, text, text, text, text, timestamptz, text, numeric, text, text
);

DROP TRIGGER IF EXISTS posthog_paid_lifecycle_outbox_identity_immutable
  ON public.posthog_paid_lifecycle_outbox;
DROP FUNCTION IF EXISTS analytics_private.reject_posthog_paid_lifecycle_outbox_identity_mutation();
DROP TRIGGER IF EXISTS posthog_paid_lifecycle_evidence_immutable
  ON public.posthog_paid_lifecycle_evidence;
DROP FUNCTION IF EXISTS analytics_private.reject_posthog_paid_lifecycle_evidence_mutation();

DROP TABLE IF EXISTS public.posthog_paid_lifecycle_outbox;
DROP TABLE IF EXISTS public.posthog_paid_lifecycle_watermarks;
DROP TABLE IF EXISTS public.posthog_paid_lifecycle_evidence;

COMMIT;
