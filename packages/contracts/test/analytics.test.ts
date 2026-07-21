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

  test("governs first-paid activation and positive-generation churn", () => {
    const activation = analyticsRegistry.events.filter(
      (event) => event.name === "subscription_activated",
    );
    expect(activation).toHaveLength(1);
    expect(resolveAnalyticsEventName("subscription_activated")).toBe(
      "subscription_activated",
    );
    expect(activation[0]).toMatchObject({
      schemaVersion: 1,
      authoritativeSource: "backend",
      identityPolicy: "identified",
      semanticDeduplicationKey: "user_id",
      canonicalTimeQualities: ["exact_business_timestamp"],
      requiredProperties: {
        invoice_id: { type: "string", privacy: "pseudonymous" },
        subscription_id: { type: "string", privacy: "pseudonymous" },
        currency: { type: "string", privacy: "public" },
        revenue: { type: "number", privacy: "public" },
      },
    });

    const churn = analyticsRegistry.events.find(
      (event) => event.name === "subscription_churned",
    );
    expect(churn).toMatchObject({
      authoritativeSource: "backend",
      identityPolicy: "identified",
      semanticDeduplicationKey: "subscription_id:generation",
      requiredProperties: {
        subscription_id: { type: "string", privacy: "pseudonymous" },
        generation: { type: "integer", privacy: "public", minimum: 1 },
        status: { type: "string", privacy: "public" },
      },
    });

    for (const generation of [undefined, null, "1", 0, -1, 1.5]) {
      const sanitized = sanitizeAnalyticsProperties("subscription_churned", {
        subscription_id: "sub_123",
        generation,
        status: "canceled",
      });
      expect(sanitized.missingRequiredProperties).toContain("generation");
    }
    expect(
      sanitizeAnalyticsProperties("subscription_churned", {
        subscription_id: "sub_123",
        generation: 1,
        status: "canceled",
        email: "secret@example.com",
        raw_stripe_payload: {},
      }),
    ).toEqual({
      properties: {
        subscription_id: "sub_123",
        generation: 1,
        status: "canceled",
      },
      rejectedProperties: ["email", "raw_stripe_payload"],
      missingRequiredProperties: [],
    });
  });

  test("does not change existing signup and successful-payment definitions", () => {
    expect(
      analyticsRegistry.events.find((event) => event.name === "user_signed_up"),
    ).toEqual({
      name: "user_signed_up",
      schemaVersion: 1,
      definition: "A durable user account was created by the backend.",
      identityPolicy: "identified",
      authoritativeSource: "backend",
      semanticDeduplicationKey: "user_id",
      canonicalTimeQualities: ["exact_business_timestamp", "server_received_at"],
      requiredProperties: {},
      optionalProperties: {
        auth_source: { type: "string", privacy: "public" },
        has_gmail_provider: { type: "boolean", privacy: "public" },
      },
      legacyAliases: ["signup_completed"],
    });
    expect(
      analyticsRegistry.events.find((event) => event.name === "payment_succeeded"),
    ).toEqual({
      name: "payment_succeeded",
      schemaVersion: 1,
      definition: "A Stripe webhook confirmed a successful payment.",
      identityPolicy: "identified",
      authoritativeSource: "backend",
      semanticDeduplicationKey: "invoice_id",
      canonicalTimeQualities: ["exact_business_timestamp"],
      requiredProperties: {
        invoice_id: { type: "string", privacy: "pseudonymous" },
        currency: { type: "string", privacy: "public" },
        revenue: { type: "number", privacy: "public" },
      },
      optionalProperties: {
        subscription_id: { type: "string", privacy: "pseudonymous" },
        plan: { type: "string", privacy: "public" },
      },
      legacyAliases: [],
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
