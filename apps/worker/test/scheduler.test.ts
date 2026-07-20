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

  test("bounds catch-up using persisted occurrences rather than wall-clock keys", async () => {
    const successors: Date[] = [];
    const count = await runSchedulerTick(
      {
        async assertProviderRunnable() {},
        async dueSchedules() {
          return [
            {
              id: "hourly",
              cronExpression: "0 * * * *",
              timezone: "UTC",
              nextDueAt: new Date("2026-07-20T08:00:00Z"),
              maxCatchUp: 2,
              databaseNow: new Date("2026-07-20T12:30:00Z"),
            },
          ];
        },
        async enqueueDueSchedule(_id, successor) {
          successors.push(successor);
          return crypto.randomUUID();
        },
        async getRun() {
          return null;
        },
      },
      { now: new Date("2026-07-20T12:30:00Z") },
    );
    expect(count).toBe(2);
    expect(successors.map((value) => value.toISOString())).toEqual([
      "2026-07-20T09:00:00.000Z",
      "2026-07-20T10:00:00.000Z",
    ]);
  });
});
