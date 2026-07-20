import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const migration = readFileSync(
  join(
    root,
    "backend/db/migrations/20260720001800_posthog_warehouse_containment.sql",
  ),
  "utf8",
);
const rollback = readFileSync(
  join(
    root,
    "backend/db/migrations/20260720001800_posthog_warehouse_containment.down.sql",
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
    expect(migration).toContain(
      "REVOKE ALL ON ALL TABLES IN SCHEMA analytics_public FROM PUBLIC",
    );
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
    expect(viewDefinitions).not.toMatch(/\b(?:users|applications|swipes|analytics_events)\.data\b/i);
  });

  test("labels legacy event time as receipt-time quality", () => {
    expect(migration).toContain(
      "'server_received_at'::text AS timestamp_quality",
    );
    expect(migration).toContain(
      "analytics_events.created_at AS received_at",
    );
  });

  test("provides an explicit rollback", () => {
    expect(rollback).toContain("DROP SCHEMA IF EXISTS analytics_public CASCADE");
    expect(rollback).toContain("DROP ROLE posthog_warehouse_reader");
  });
});
