import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const migration = readFileSync(
  join(root, "backend/db/migrations/20260720001800_posthog_warehouse_containment.sql"),
  "utf8",
);
const rollback = readFileSync(
  join(root, "backend/db/migrations/20260720001800_posthog_warehouse_containment.down.sql"),
  "utf8",
);
const canonicalIdentityRepair = readFileSync(
  join(root, "backend/db/migrations/20260721002100_posthog_warehouse_canonical_identity.sql"),
  "utf8",
);
const canonicalIdentityRollback = readFileSync(
  join(root, "backend/db/migrations/20260721002100_posthog_warehouse_canonical_identity.down.sql"),
  "utf8",
);
const canonicalIdentityCompletion = readFileSync(
  join(root, "backend/db/migrations/20260721002200_posthog_warehouse_identity_completion.sql"),
  "utf8",
);
const canonicalIdentityCompletionRollback = readFileSync(
  join(root, "backend/db/migrations/20260721002200_posthog_warehouse_identity_completion.down.sql"),
  "utf8",
);
const backfillIdentityProvenance = readFileSync(
  join(
    root,
    "backend/db/migrations/20260721002300_posthog_warehouse_backfill_identity_provenance.sql",
  ),
  "utf8",
);
const backfillIdentityProvenanceRollback = readFileSync(
  join(
    root,
    "backend/db/migrations/20260721002300_posthog_warehouse_backfill_identity_provenance.down.sql",
  ),
  "utf8",
);

describe("PostHog warehouse containment migration", () => {
  test("exposes only explicit analytical views through a dedicated role", () => {
    expect(migration).toContain("CREATE SCHEMA IF NOT EXISTS analytics_public");
    expect(migration).toContain("posthog_warehouse_reader NOLOGIN");
    expect(migration).toContain(
      "GRANT SELECT ON ALL TABLES IN SCHEMA analytics_public TO posthog_warehouse_reader",
    );
    expect(migration).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA analytics_public FROM PUBLIC");
    expect(migration).not.toMatch(
      /GRANT\s+SELECT\s+ON\s+(?:ALL\s+TABLES\s+IN\s+SCHEMA\s+)?(?:public|auth)\b/i,
    );
  });

  test("keeps known sensitive columns and source documents out of views", () => {
    const viewDefinitions = migration
      .split("REVOKE ALL ON ALL TABLES")[0]
      ?.replace(/COMMENT ON VIEW[\s\S]*/g, "");
    expect(viewDefinitions).not.toMatch(
      /\b(email|name|phone|cv_text|resume|access_token|refresh_token|session_token|password|secret)\b/i,
    );
    expect(viewDefinitions).not.toMatch(/\bSELECT\s+\*/i);
    expect(viewDefinitions).not.toMatch(
      /\b(?:users|applications|swipes|analytics_events)\.data\s+(?:AS\b|,|FROM\b)/i,
    );
  });

  test("labels legacy event time as receipt-time quality", () => {
    expect(migration).toContain("'server_received_at'::text AS timestamp_quality");
    expect(migration).toContain("analytics_events.created_at AS received_at");
  });

  test("provides an explicit rollback", () => {
    expect(rollback).toContain("DROP SCHEMA IF EXISTS analytics_public CASCADE");
    expect(rollback).toContain("DROP ROLE posthog_warehouse_reader");
    expect(rollback).toContain("managed-by-hirly-migration-20260720001800");
    expect(rollback).not.toContain("DROP OWNED BY posthog_warehouse_reader");
  });

  test("maps warehouse identities through unique canonical auth UUIDs", () => {
    expect(canonicalIdentityRepair).toContain("users.data ->> 'supabase_user_id'");
    expect(canonicalIdentityRepair).toContain("users.canonical_mapping_count = 1");
    expect(canonicalIdentityRepair).toContain("canonical_mapping_count = 1");
    expect(canonicalIdentityRepair).toMatch(/canonical_user_id\s+~\s+'\^\[0-9a-f\]/);
    expect(canonicalIdentityRepair).toContain("canonical_users.canonical_user_id AS user_id");
    expect(canonicalIdentityRepair).not.toContain("analytics_events.user_id::text AS user_id");
    expect(canonicalIdentityRepair).toContain(
      "REVOKE ALL ON analytics_public.user_identity_v1 FROM PUBLIC",
    );
    expect(canonicalIdentityRollback).toContain("analytics_events.user_id::text AS user_id");
  });

  test("completes UUID mapping for application and swipe facts", () => {
    expect(canonicalIdentityCompletion).toContain("canonical_users.canonical_user_id AS user_id");
    expect(canonicalIdentityCompletion).toContain("FROM public.applications");
    expect(canonicalIdentityCompletion).toContain("FROM public.swipes");
    expect(canonicalIdentityCompletion).toContain(
      "WHEN analytics_events.user_id IS NULL THEN analytics_events.anonymous_id::text",
    );
    expect(canonicalIdentityCompletion).toContain("ELSE NULL\n  END AS anonymous_id");
    expect(canonicalIdentityCompletionRollback).toContain(
      "CREATE OR REPLACE VIEW analytics_public.application_facts_v1",
    );
    expect(canonicalIdentityCompletionRollback).toContain(
      "CREATE OR REPLACE VIEW analytics_public.swipe_facts_v1",
    );
  });

  test("exposes importer identity provenance without anonymous fallback", () => {
    expect(backfillIdentityProvenance).toContain("AS identity_resolution");
    expect(backfillIdentityProvenance).toContain("'canonical_uuid'");
    expect(backfillIdentityProvenance).toContain("'known_user_unresolved'");
    expect(backfillIdentityProvenance).toContain("'known_user_ambiguous'");
    expect(backfillIdentityProvenance).toContain("'anonymous_unlinked'");
    expect(backfillIdentityProvenance).toContain("'no_identity'");
    expect(backfillIdentityProvenance).toContain(
      "WHEN analytics_events.user_id IS NULL THEN analytics_events.anonymous_id::text",
    );
    expect(backfillIdentityProvenance).toContain("'server_received_at'::text AS timestamp_quality");
    expect(backfillIdentityProvenance).toContain(
      "'receipt-time legacy history with identity provenance', 9",
    );
    expect(backfillIdentityProvenanceRollback).toContain(
      "'receipt-time legacy history without property payloads', 8",
    );
    expect(backfillIdentityProvenanceRollback).not.toContain("AS identity_resolution");
  });
});
