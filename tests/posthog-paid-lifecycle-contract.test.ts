import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const up = readFileSync(
  new URL(
    "../backend/db/migrations/20260721002000_posthog_paid_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
);
const down = readFileSync(
  new URL(
    "../backend/db/migrations/20260721002000_posthog_paid_lifecycle.down.sql",
    import.meta.url,
  ),
  "utf8",
);
const generationQualification = readFileSync(
  new URL(
    "../backend/db/migrations/20260721002800_posthog_paid_lifecycle_generation_qualification.sql",
    import.meta.url,
  ),
  "utf8",
);
const generationQualificationDown = readFileSync(
  new URL(
    "../backend/db/migrations/20260721002800_posthog_paid_lifecycle_generation_qualification.down.sql",
    import.meta.url,
  ),
  "utf8",
);
const compact = (sql: string): string =>
  sql.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().toLowerCase();

describe("governed paid-lifecycle migration contract", () => {
  test("qualifies generation in the paid invoice replay guard", () => {
    const sql = compact(up);
    expect(sql).toContain(
      "from public.posthog_paid_lifecycle_evidence as ended where ended.evidence_type = 'end'",
    );
    expect(sql).toContain("and ended.generation = v_generation");
    expect(compact(generationQualification)).toContain(
      "execute replace(v_definition, v_broken, v_fixed)",
    );
    expect(compact(generationQualificationDown)).toContain(
      "execute replace(v_definition, v_fixed, v_broken)",
    );
  });

  test("owns immutable evidence, independent watermarks, and fenced outbox state", () => {
    const sql = compact(up);
    for (const table of [
      "posthog_paid_lifecycle_evidence",
      "posthog_paid_lifecycle_watermarks",
      "posthog_paid_lifecycle_outbox",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain("evidence_type = 'paid_generation'");
    expect(sql).toContain("evidence_type = 'end'");
    expect(sql).toContain("evidence_type = 'activation'");
    expect(sql).toContain("before update or delete on public.posthog_paid_lifecycle_evidence");
    expect(sql).toContain("before update on public.posthog_paid_lifecycle_outbox");
    expect(sql).toContain("on delete restrict");
    expect(sql).toContain("posthog_paid_lifecycle_outbox_due_idx");
    expect(sql).toContain("posthog_paid_lifecycle_outbox_expired_lease_idx");
    expect(sql).toContain("posthog_paid_lifecycle_outbox_observability_idx");
  });

  test("implements six private service functions with CAS, locking, and lease fencing", () => {
    const sql = compact(up);
    const functions = [
      "record_posthog_paid_invoice",
      "record_posthog_subscription_state",
      "claim_posthog_paid_lifecycle_deliveries",
      "mark_posthog_paid_lifecycle_sent",
      "retry_posthog_paid_lifecycle_delivery",
      "block_posthog_paid_lifecycle_delivery",
    ];
    for (const name of functions) {
      expect(sql).toContain(`function analytics_private.${name}(`);
      expect(sql).toContain(`grant execute on function analytics_private.${name}(`);
      expect(down.toLowerCase()).toContain(`analytics_private.${name}(`);
    }
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
    expect(sql.match(/on conflict \(subscription_id, stream\) do update/g)).toHaveLength(2);
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("lease_generation = outbox.lease_generation + 1");
    expect(sql).toContain("and lease_generation = p_generation");
    expect(sql).toContain("and lease_expires_at > clock_timestamp()");
    expect(sql).toContain("revoke all on all functions in schema analytics_private from public");
    expect(sql.match(/security definer/g)).toHaveLength(8);
    expect(sql.match(/set search_path = pg_catalog/g)).toHaveLength(8);
    expect(sql).not.toContain("set search_path = pg_catalog,");
    expect(sql.match(/public\.digest\(/g)).toHaveLength(3);
    expect(sql).toContain("public.gen_random_uuid()");
    expect(sql.match(/where evidence\.business_key = v_(?:invoice|state)_key/g)).toHaveLength(2);
    expect(sql.match(/return query select/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("uses one positive generation in end keys, payloads, and deterministic UUID names", () => {
    const sql = compact(up);
    expect(sql).toContain("generation integer check (generation is null or generation > 0)");
    expect(sql).toContain("'end:' || p_subscription_id || ':' || v_generation::text");
    expect(sql).toContain("'generation', v_generation");
    expect(sql).toContain(
      "'subscription_churned:subscription:' || p_subscription_id || ':generation:' || v_generation::text",
    );
    expect(sql).toContain("69fbb143-6b0b-42ca-8a9b-7f2c1b41c041");
    expect(sql).toContain("'sha1'");
    expect(sql).not.toContain("collection.update_one");
    expect(sql).not.toContain("collection.create_index");
  });

  test("treats past_due as validated loss evidence", () => {
    const sql = compact(up);
    expect(sql).toContain(
      "p_status not in ('canceled', 'past_due', 'unpaid', 'incomplete_expired', 'paused')",
    );
  });

  test("down migration removes only the lifecycle surface in dependency order", () => {
    const sql = compact(down);
    expect(sql.indexOf("drop function if exists analytics_private.block_posthog"))
      .toBeLessThan(sql.indexOf("drop table if exists public.posthog_paid_lifecycle_outbox"));
    expect(sql.indexOf("drop table if exists public.posthog_paid_lifecycle_outbox"))
      .toBeLessThan(sql.indexOf("drop table if exists public.posthog_paid_lifecycle_evidence"));
    for (const unrelated of ["public.users", "public.stripe_events", "public.analytics_events"])
      expect(sql).not.toContain(`drop table if exists ${unrelated}`);
    expect(sql).not.toContain("drop schema analytics_private");
  });
});
