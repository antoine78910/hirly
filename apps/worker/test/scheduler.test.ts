import { describe, expect, test } from "bun:test";
import { nextCronOccurrence } from "../src/runtime/scheduler";

describe("persisted scheduler cron policy", () => {
  test("computes the next UTC occurrence after the persisted identity", () => {
    expect(
      nextCronOccurrence(
        "*/15 * * * *",
        "UTC",
        new Date("2026-07-20T10:07:00Z"),
      ).toISOString(),
    ).toBe("2026-07-20T10:15:00.000Z");
  });

  test("rejects malformed cron and timezone input", () => {
    expect(() =>
      nextCronOccurrence("* * *", "UTC", new Date()),
    ).toThrow("invalid cron expression");
    expect(() =>
      nextCronOccurrence("* * * * *", "Not/AZone", new Date()),
    ).toThrow();
  });
});
