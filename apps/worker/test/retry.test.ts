import { describe, expect, test } from "bun:test";
import { retryDelayMs, safeErrorMessage } from "../src/runtime/retry";

describe("retry policy", () => {
  test("grows exponentially, adds bounded jitter, and caps at one minute", () => {
    expect(retryDelayMs(1, () => 0)).toBe(800);
    expect(retryDelayMs(2, () => 1)).toBe(2_400);
    expect(retryDelayMs(20, () => 0.5)).toBe(60_000);
  });

  test("bounds persisted error messages", () => {
    expect(safeErrorMessage(new Error("x".repeat(1_000)))).toHaveLength(512);
  });

  test("sanitizes arbitrary thrown values and secret-bearing error text", () => {
    const text = safeErrorMessage({
      message:
        "Authorization: Basic private-auth\nCookie: session=private-cookie\nX-Refresh-Token: private-refresh https://api.example/jobs?session=private-session",
      accessToken: "private-access",
    });
    expect(text).not.toContain("private-auth");
    expect(text).not.toContain("private-cookie");
    expect(text).not.toContain("private-refresh");
    expect(text).not.toContain("private-session");
    expect(text).not.toContain("private-access");
    expect(text).toContain("[REDACTED]");
  });
});
