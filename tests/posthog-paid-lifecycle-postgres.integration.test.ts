import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDatabase, type Database } from "../packages/db/src";

const databaseUrl = process.env.POSTHOG_PAID_LIFECYCLE_TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const read = (name: string): string =>
  readFileSync(new URL(`../backend/db/migrations/${name}`, import.meta.url), "utf8");
const up = read("20260721002000_posthog_paid_lifecycle.sql");
const down = read("20260721002000_posthog_paid_lifecycle.down.sql");
const userId = "11111111-1111-4111-8111-111111111111";

function uuid5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const bytes = createHash("sha1")
    .update(Buffer.concat([namespaceBytes, Buffer.from(name)]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describePostgres("paid lifecycle migration on disposable PostgreSQL", () => {
  let sql: Database;

  beforeAll(async () => {
    sql = createDatabase(databaseUrl, { max: 24 });
    await sql.unsafe("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await sql.unsafe(up);
  });

  afterAll(async () => {
    await sql.unsafe(down).catch(() => undefined);
    await sql.end({ timeout: 5 });
  });

  test("races first observed activation and preserves one generation", async () => {
    const subscription = `sub_race_${randomUUID()}`;
    const calls = Array.from({ length: 20 }, (_, index) =>
      sql.unsafe(
        `SELECT * FROM analytics_private.record_posthog_paid_invoice(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        )`,
        [
          userId,
          subscription,
          `in_${index}`,
          `evt_${randomUUID()}`,
          "invoice.payment_succeeded",
          new Date(Date.UTC(2026, 5, 1, 0, index)),
          "eur",
          "19.99",
          "pro",
          index === 0 ? "subscription_create" : "subscription_cycle",
        ],
      ),
    );
    await Promise.all(calls);
    const [counts] = await sql<
      {
        paid: number;
        activation: number;
        activation_outbox: number;
      }[]
    >`
      SELECT
        count(*) FILTER (WHERE evidence_type = 'paid_generation')::int AS paid,
        count(*) FILTER (WHERE evidence_type = 'activation')::int AS activation,
        (SELECT count(*)::int FROM public.posthog_paid_lifecycle_outbox
          WHERE event_name = 'subscription_activated') AS activation_outbox
      FROM public.posthog_paid_lifecycle_evidence
      WHERE subscription_id = ${subscription} OR user_id = ${userId}
    `;
    expect(counts).toEqual({ paid: 1, activation: 1, activation_outbox: 1 });
  });

  test("materializes one churn per positive paid generation with exact UUID identity", async () => {
    const subscription = `sub_churn_${randomUUID()}`;
    const invoice = async (event: string, at: string) =>
      sql.unsafe(
        `SELECT * FROM analytics_private.record_posthog_paid_invoice(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        )`,
        [
          userId,
          subscription,
          `in_${event}`,
          event,
          "invoice.payment_succeeded",
          at,
          "eur",
          "29",
          null,
          null,
        ],
      );
    const terminal = async (event: string, sourceAt: string, lossAt: string) =>
      sql.unsafe(
        `SELECT * FROM analytics_private.record_posthog_subscription_state(
          $1,$2,$3,$4,$5,$6,$7,$8
        )`,
        [
          userId,
          subscription,
          event,
          "customer.subscription.deleted",
          sourceAt,
          "canceled",
          lossAt,
          "customer_requested",
        ],
      );

    await invoice(`evt_${randomUUID()}`, "2026-06-01T00:00:00Z");
    await Promise.all(
      Array.from({ length: 10 }, () =>
        terminal(`evt_${randomUUID()}`, "2026-06-20T00:00:00Z", "2026-06-20T00:00:00Z"),
      ),
    );
    await sql.unsafe(
      `SELECT * FROM analytics_private.record_posthog_subscription_state(
        $1,$2,$3,$4,$5,$6,$7,$8
      )`,
      [
        userId,
        subscription,
        `evt_${randomUUID()}`,
        "customer.subscription.updated",
        "2026-06-21T00:00:00Z",
        "active",
        null,
        null,
      ],
    );
    await invoice(`evt_${randomUUID()}`, "2026-06-22T00:00:00Z");
    await terminal(`evt_${randomUUID()}`, "2026-06-30T00:00:00Z", "2026-06-30T00:00:00Z");

    const rows = await sql<
      {
        generation: number;
        posthog_uuid: string;
        payload: { properties: { generation: number } };
      }[]
    >`
      SELECT evidence.generation, outbox.posthog_uuid::text, outbox.payload
      FROM public.posthog_paid_lifecycle_evidence AS evidence
      JOIN public.posthog_paid_lifecycle_outbox AS outbox
        ON outbox.fact_key = evidence.business_key
      WHERE evidence.subscription_id = ${subscription}
        AND evidence.evidence_type = 'end'
      ORDER BY evidence.generation
    `;
    expect(rows.map((row) => row.generation)).toEqual([1, 2]);
    for (const row of rows) {
      expect(row.payload.properties.generation).toBe(row.generation);
      expect(row.posthog_uuid).toBe(
        uuid5(
          "69fbb143-6b0b-42ca-8a9b-7f2c1b41c041",
          `subscription_churned:subscription:${subscription}:generation:${row.generation}`,
        ),
      );
    }
  });

  test("claims disjoint leases, rejects stale fences, and rolls back/reapplies", async () => {
    const first = await sql<
      { fact_key: string; lease_owner: string; lease_token: string; lease_generation: number }[]
    >`
      SELECT fact_key, lease_owner, lease_token::text, lease_generation
      FROM analytics_private.claim_posthog_paid_lifecycle_deliveries('worker-a', 1, 60)
    `;
    const second = await sql<{ fact_key: string }[]>`
      SELECT fact_key
      FROM analytics_private.claim_posthog_paid_lifecycle_deliveries('worker-b', 100, 60)
    `;
    expect(new Set([...first, ...second].map((row) => row.fact_key)).size).toBe(
      first.length + second.length,
    );
    if (first[0]) {
      const [stale] = await sql<{ changed: boolean }[]>`
        SELECT analytics_private.mark_posthog_paid_lifecycle_sent(
          ${first[0].fact_key}, 'wrong-owner', ${first[0].lease_token}::uuid,
          ${first[0].lease_generation}
        ) AS changed
      `;
      expect(stale.changed).toBe(false);
      const [sent] = await sql<{ changed: boolean }[]>`
        SELECT analytics_private.mark_posthog_paid_lifecycle_sent(
          ${first[0].fact_key}, ${first[0].lease_owner}, ${first[0].lease_token}::uuid,
          ${first[0].lease_generation}
        ) AS changed
      `;
      expect(sent.changed).toBe(true);
    }

    await expect(
      sql.unsafe(
        "UPDATE public.posthog_paid_lifecycle_evidence SET status = 'tampered' WHERE evidence_type = 'end'",
      ),
    ).rejects.toThrow("append-only");

    await sql.unsafe(down);
    const [rolledBack] = await sql<{ evidence: string | null; functions: number }[]>`
      SELECT to_regclass('public.posthog_paid_lifecycle_evidence')::text AS evidence,
        (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'analytics_private' AND p.proname LIKE '%posthog_paid_lifecycle%') AS functions
    `;
    expect(rolledBack).toEqual({ evidence: null, functions: 0 });
    await sql.unsafe(up);
    const [reapplied] = await sql<{ evidence: string | null }[]>`
      SELECT to_regclass('public.posthog_paid_lifecycle_evidence')::text AS evidence
    `;
    expect(reapplied.evidence).toBe("posthog_paid_lifecycle_evidence");
  });
});

if (!databaseUrl) {
  test("paid lifecycle disposable PostgreSQL suite is opt-in", () => {
    expect(databaseUrl).toBeUndefined();
  });
}
