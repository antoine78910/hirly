import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const up = readFileSync(
  new URL("../backend/db/migrations/20260720001900_posthog_migration_ledger.sql", import.meta.url),
  "utf8",
);
const down = readFileSync(
  new URL(
    "../backend/db/migrations/20260720001900_posthog_migration_ledger.down.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("PostHog migration ledger contract", () => {
  test("models accepted separately from observed and all terminal dispositions", () => {
    for (const state of [
      "pending",
      "claimed",
      "accepted",
      "observed",
      "excluded",
      "quarantined",
      "uncertain",
    ]) {
      expect(up).toContain(`'${state}'`);
    }
    expect(up).toMatch(/status = 'accepted'[\s\S]*accepted_at/s);
    expect(up).toMatch(/status = 'observed'[\s\S]*observed_at/s);
  });

  test("reclaims only pre-send leases and quarantines post-send expiry", () => {
    expect(up).toMatch(/lease_expires_at <= v_now[\s\S]*send_started_at IS NOT NULL/s);
    expect(up).toMatch(/status = 'uncertain'[\s\S]*claim_expired_after_send_started/s);
    expect(up).toMatch(/lease_expires_at <= v_now[\s\S]*send_started_at IS NULL/s);
    expect(up).toMatch(/WHERE run_id = p_run_id AND status = 'uncertain'[\s\S]*RETURN;/s);
    expect(up).toContain("FOR UPDATE SKIP LOCKED");
  });

  test("is reversible and does not grant public mutation", () => {
    expect(up).toContain("REVOKE ALL ON public.posthog_migration_ledger FROM PUBLIC");
    expect(down).toContain("DROP TABLE IF EXISTS public.posthog_migration_ledger");
    expect(down).toContain("DROP TABLE IF EXISTS public.posthog_migration_runs");
  });
});
