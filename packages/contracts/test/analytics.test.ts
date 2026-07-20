import { describe, expect, test } from "bun:test";
import {
  analyticsRegistry,
  canonicalAnalyticsUserIdSchema,
  classifyAnalyticsOccurrence,
  resolveAnalyticsEventName,
  sanitizeAnalyticsProperties,
  systemAnalyticsProperties,
} from "../src";

describe("analytics governance contract", () => {
  test("uses one lowercase UUID identity across runtimes", () => {
    const userId = "018f02d8-a8b8-7f1d-a419-bf38eaf22a90";
    expect(canonicalAnalyticsUserIdSchema.parse(userId)).toBe(userId);
    for (const invalid of [
      "",
      "123",
      "anonymous",
      "guest",
      "system",
      "backend",
      "cron",
      userId.toUpperCase(),
    ]) {
      expect(() => canonicalAnalyticsUserIdSchema.parse(invalid)).toThrow();
    }
  });

  test("has one authoritative owner and deterministic legacy mapping", () => {
    expect(new Set(analyticsRegistry.events.map((event) => event.name)).size).toBe(
      analyticsRegistry.events.length,
    );
    expect(resolveAnalyticsEventName("auth_success")).toBe("auth_ui_succeeded");
    expect(resolveAnalyticsEventName("job_swiped_right")).toBe(
      "job_application_created",
    );
    expect(resolveAnalyticsEventName("not_registered")).toBeNull();
  });

  test("strips unknown, mistyped, and sensitive properties", () => {
    expect(
      sanitizeAnalyticsProperties("payment_succeeded", {
        invoice_id: "in_123",
        currency: "eur",
        revenue: 19.99,
        email: "sensitive@example.com",
        plan: 42,
      }),
    ).toEqual({
      properties: {
        invoice_id: "in_123",
        currency: "eur",
        revenue: 19.99,
      },
      rejectedProperties: ["email", "plan"],
      missingRequiredProperties: [],
    });
  });

  test("rejects missing canonical required properties", () => {
    expect(
      sanitizeAnalyticsProperties("payment_refunded", {
        refund_id: "re_123",
        currency: "eur",
        revenue: -19.99,
      }).missingRequiredProperties,
    ).toEqual(["invoice_id"]);
  });

  test("classifies client occurrence time without promoting stale history", () => {
    const receivedAt = "2026-07-20T12:00:00+00:00";
    expect(
      classifyAnalyticsOccurrence(
        "2026-07-20T11:59:30+00:00",
        receivedAt,
      ).timestampQuality,
    ).toBe("validated_client_occurrence");
    for (const occurredAt of [
      "2026-07-20T12:05:01+00:00",
      "2026-07-19T11:59:59+00:00",
      "invalid",
      null,
    ]) {
      expect(
        classifyAnalyticsOccurrence(occurredAt, receivedAt).timestampQuality,
      ).toBe("server_received_at");
    }
  });

  test("system events never create person profiles", () => {
    expect(systemAnalyticsProperties()).toEqual({
      $process_person_profile: false,
    });
  });
});
