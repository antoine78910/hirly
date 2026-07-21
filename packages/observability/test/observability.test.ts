import { describe, expect, test } from "bun:test";
import { redact, serializeEvent } from "../src";

describe("structured observability", () => {
  test("redacts nested credentials, evidence bodies, PII, and bearer tokens", () => {
    const value = redact({
      databaseUrl: "postgresql://worker:secret@db.example/inventory",
      nested: {
        email: "person@example.com",
        authorizationEvidenceBody: "private-contract",
        message: "Bearer abc.def",
      },
    });
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("private-contract");
    expect(serialized).not.toContain("abc.def");
  });

  test("redacts auth and cookie headers plus secret-bearing URLs", () => {
    const serialized = JSON.stringify(redact({
      message:
        "Authorization: Basic private-auth\nCookie: session=private-cookie\nX-Refresh-Token: private-refresh https://api.example/jobs?session=private-session",
    }));
    expect(serialized).not.toContain("private-auth");
    expect(serialized).not.toContain("private-cookie");
    expect(serialized).not.toContain("private-refresh");
    expect(serialized).not.toContain("private-session");
  });

  test("emits schema-valid correlated JSON", () => {
    const line = serializeEvent({
      service: "worker",
      version: "1",
      environment: "test",
      event: "task.completed",
      severity: "info",
      runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      attempt: 1,
      maxAttempts: 5,
      durationsMs: {
        queueWait: 2,
        fetch: 3,
        normalization: 4,
        validation: 5,
        database: 6,
        total: 20,
      },
      counts: {
        fetched: 3,
        accepted: 2,
        rejected: 1,
        deduplicated: 0,
        upserted: 2,
      },
      outcome: "succeeded",
    });
    expect(JSON.parse(line).event).toBe("task.completed");
  });
});
