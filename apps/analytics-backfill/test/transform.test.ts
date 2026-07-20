import { describe, expect, test } from "bun:test";
import {
  afterCheckpoint,
  transformLegacyAnalyticsRow,
  type LegacyAnalyticsRow,
} from "../src/transform";
import { buildBackfillManifest, runBackfill } from "../src/runner";

const exactRow: LegacyAnalyticsRow = {
  eventId: "event-1",
  eventName: "signup_completed",
  createdAt: "2025-01-02T00:00:00.000Z",
  exactBusinessTimestamp: "2025-01-01T12:00:00.000Z",
  userId: "11111111-1111-4111-8111-111111111111",
  properties: {},
};

describe("analytics historical transform", () => {
  test("imports only defensible exact chronology with deterministic payloads", () => {
    const first = transformLegacyAnalyticsRow(exactRow);
    const second = transformLegacyAnalyticsRow({
      ...exactRow,
      properties: { ...exactRow.properties },
    });
    expect(first).toMatchObject({
      status: "pending",
      timestampQuality: "exact_business_timestamp",
      identityQuality: "identified_at_ingest",
    });
    expect(first.payload).toMatchObject({
      event: "user_signed_up",
      distinct_id: exactRow.userId,
      timestamp: exactRow.exactBusinessTimestamp,
      properties: {
        historical_migration: true,
        event_source: "historical-only",
      },
    });
    expect(first.payload?.properties).not.toHaveProperty("$set");
    expect(first.payloadHash).toBe(second.payloadHash);
    expect(first.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("keeps receipt-time legacy behavior out of canonical import", () => {
    expect(
      transformLegacyAnalyticsRow({
        ...exactRow,
        exactBusinessTimestamp: null,
      }),
    ).toMatchObject({
      status: "excluded",
      timestampQuality: "server_received_at",
      reason: "noncanonical_timestamp_quality",
    });
  });

  test("never retrospectively merges anonymous mappings", () => {
    for (const anonymousAttribution of [
      "unlinked",
      "one_to_one",
      "ambiguous",
    ] as const) {
      const transformed = transformLegacyAnalyticsRow({
        ...exactRow,
        userId: null,
        anonymousId: "shared-browser-id",
        anonymousAttribution,
      });
      expect(transformed.payload?.distinct_id).toMatch(/^legacy-anonymous:/);
      expect(transformed.payload?.properties).toMatchObject({
        $process_person_profile: false,
      });
      expect(transformed.identityQuality).toBe(
        `legacy_anonymous_${anonymousAttribution}`,
      );
    }
  });

  test("quarantines denylisted, malformed, and unknown rows", () => {
    expect(
      transformLegacyAnalyticsRow({
        ...exactRow,
        properties: { email: "private@example.com" },
      }),
    ).toMatchObject({ status: "quarantined", reason: "denylisted_property" });
    expect(
      transformLegacyAnalyticsRow({ ...exactRow, eventName: "not_registered" }),
    ).toMatchObject({ status: "quarantined", reason: "unknown_event" });
    expect(
      transformLegacyAnalyticsRow({ ...exactRow, createdAt: "not-a-time" }),
    ).toMatchObject({
      status: "quarantined",
      reason: "invalid_source_created_at",
    });
  });

  test("resumes keyset ordering without gaps and dry-run has no side effects", async () => {
    const rows = [
      { ...exactRow, eventId: "b" },
      { ...exactRow, eventId: "a" },
      {
        ...exactRow,
        eventId: "c",
        createdAt: "2025-01-03T00:00:00.000Z",
      },
    ];
    expect(
      rows.filter((row) =>
        afterCheckpoint(row, {
          createdAt: "2025-01-02T00:00:00.000Z",
          eventId: "a",
        }),
      ).map((row) => row.eventId),
    ).toEqual(["b", "c"]);
    let sideEffects = 0;
    const manifest = await runBackfill({
      rows,
      sourceCutoffAt: "2025-01-03T00:00:00.000Z",
      dryRun: true,
      repository: {
        seed: async () => {
          sideEffects += 1;
        },
      } as never,
      transport: {
        send: async () => {
          sideEffects += 1;
          return { outcome: "accepted", metadata: {} };
        },
      },
    });
    expect(sideEffects).toBe(0);
    expect(manifest.counts.pending).toBe(3);
    expect(manifest.checkpoint).toEqual({
      createdAt: "2025-01-03T00:00:00.000Z",
      eventId: "c",
    });
    expect(
      buildBackfillManifest(
        rows.map(transformLegacyAnalyticsRow),
        "2025-01-03T00:00:00.000Z",
      ).digest,
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  test("separates transport acceptance from read-side observation", async () => {
    const calls: string[] = [];
    const claim = {
      runId: "11111111-1111-4111-8111-111111111111",
      sourceEventId: "event-1",
      sourceCreatedAt: new Date(exactRow.createdAt),
      canonicalEventName: "user_signed_up",
      payloadHash: "a".repeat(64),
      transformedPayload: {},
      leaseOwner: "operator",
      leaseToken: "22222222-2222-4222-8222-222222222222",
      leaseExpiresAt: new Date("2025-01-01T00:05:00.000Z"),
      attemptCount: 1,
    };
    let claimed = false;
    const repository = {
      seed: async () => {
        calls.push("seed");
      },
      claim: async () => {
        if (claimed) return [];
        claimed = true;
        calls.push("claim");
        return [claim];
      },
      markSendStarted: async () => {
        calls.push("send_started");
        return true;
      },
      markAccepted: async () => {
        calls.push("accepted");
        return true;
      },
      markUncertain: async () => {
        calls.push("uncertain");
        return true;
      },
    };
    await runBackfill({
      rows: [exactRow],
      sourceCutoffAt: "2025-01-03T00:00:00.000Z",
      dryRun: false,
      runId: claim.runId,
      leaseOwner: "operator",
      repository: repository as never,
      transport: {
        send: async () => {
          calls.push("transport");
          return { outcome: "accepted", metadata: { status: 200 } };
        },
      },
      rateLimitPerSecond: Number.POSITIVE_INFINITY,
    });
    expect(calls).toEqual([
      "seed",
      "claim",
      "send_started",
      "transport",
      "accepted",
    ]);
    expect(calls).not.toContain("observed");
  });

  test("stops without replay when delivery outcome is uncertain", async () => {
    const calls: string[] = [];
    const claim = {
      runId: "11111111-1111-4111-8111-111111111111",
      sourceEventId: "event-1",
      sourceCreatedAt: new Date(exactRow.createdAt),
      canonicalEventName: "user_signed_up",
      payloadHash: "a".repeat(64),
      transformedPayload: {},
      leaseOwner: "operator",
      leaseToken: "22222222-2222-4222-8222-222222222222",
      leaseExpiresAt: new Date("2025-01-01T00:05:00.000Z"),
      attemptCount: 1,
    };
    const repository = {
      seed: async () => {},
      claim: async () => {
        calls.push("claim");
        return [claim];
      },
      markSendStarted: async () => true,
      markAccepted: async () => true,
      markUncertain: async () => {
        calls.push("uncertain");
        return true;
      },
    };
    await runBackfill({
      rows: [exactRow],
      sourceCutoffAt: "2025-01-03T00:00:00.000Z",
      dryRun: false,
      runId: claim.runId,
      leaseOwner: "operator",
      repository: repository as never,
      transport: {
        send: async () => ({
          outcome: "uncertain",
          metadata: { timeout: true },
        }),
      },
      rateLimitPerSecond: Number.POSITIVE_INFINITY,
    });
    expect(calls).toEqual(["claim", "uncertain"]);
  });
});
