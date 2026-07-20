# PostHog warehouse containment

This runbook is an operator gate. Applying the local migration does **not** change
the production PostHog source, purge copied data, rotate credentials, or authorize
a historical import.

## Allowed production projection

The PostgreSQL source must synchronize only these views in `analytics_public`:

- `user_identity_v1`
- `application_facts_v1`
- `swipe_facts_v1`
- `legacy_event_history_v1`
- `object_manifest_v1`

The connection login must inherit the `posthog_warehouse_reader` NOLOGIN role. It
must not have direct privileges on `public`, `auth`, storage, realtime, vault, or
extension schemas.

The identity join is:

```sql
analytics_public.user_identity_v1.user_id = PostHog distinct_id
```

Never join to PostHog's internal `persons.id`.

## Hard privacy gate

Before live ingestion, backfill, or admin cutover:

1. Export the configured PostHog warehouse objects and source permissions without
   recording credentials.
2. Confirm the synchronized object set exactly matches the allowlist above.
3. Confirm the warehouse login cannot select any base table.
4. Confirm the views expose no email, name, phone, CV content, onboarding free
   text, auth identity, session, refresh/access token, one-time token, flow state,
   payment instrument, or secret.
5. Prove previously synchronized sensitive objects are purged or inaccessible.
6. Attach the PostHog membership/query-access audit.
7. Record incident-owner decisions for database credential rotation and for
   revocation of any exposed session, refresh, or one-time credentials.

Any failed item blocks the rollout. Do not compensate by hiding a sensitive column
in a dashboard: containment is enforced at the source projection.

## Database audit

Run as the PostHog connection login:

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type IN ('BASE TABLE', 'VIEW')
  AND has_table_privilege(current_user, quote_ident(table_schema) || '.' || quote_ident(table_name), 'SELECT')
ORDER BY 1, 2;
```

Expected selectable relations are the five `analytics_public` views only.

Run as a migration/audit role:

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'analytics_public'
  AND lower(column_name) ~
    '(email|name|phone|cv|resume|token|secret|password|session|cookie|authorization|free.?text)';
```

Expected result: zero rows.

Verify the manifest:

```sql
SELECT *
FROM analytics_public.object_manifest_v1
ORDER BY object_name;
```

## Rollback and incident response

1. Disable the PostHog warehouse source before changing grants or views.
2. Revoke the external login's membership in `posthog_warehouse_reader`.
3. Preserve a non-sensitive audit record of the source configuration and object
   inventory.
4. Follow the credential/session rotation decision recorded at the privacy gate.
5. Purge or restrict copied sensitive warehouse objects in PostHog using the
   credentialed incident procedure.
6. Re-run the database and PostHog access audits before enabling the source.

The SQL down migration removes the projection and NOLOGIN role. It is a local
rollback validation tool, not a substitute for removing data already copied to
PostHog.
