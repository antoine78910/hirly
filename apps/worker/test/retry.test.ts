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
});
