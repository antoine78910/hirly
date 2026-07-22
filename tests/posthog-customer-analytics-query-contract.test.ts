import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import manifest from "../packages/contracts/src/posthog-customer-analytics.v1.json";

const repositoryRoot = resolve(import.meta.dir, "..");
const timezone = manifest.project.timezone;

type HorizonName = keyof typeof manifest.horizons;
type LocalDate = { year: number; month: number; day: number };

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(instant: Date) {
  return Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

function addCalendarDays(date: LocalDate, days: number): LocalDate {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function localMidnight(date: LocalDate): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const observed = localParts(new Date(candidate));
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    candidate -= observedAsUtc - target;
  }
  return new Date(candidate);
}

function windowFor(anchor: Date, name: HorizonName) {
  const horizon = manifest.horizons[name];
  const anchorParts = localParts(anchor);
  const cohortDate = {
    year: anchorParts.year,
    month: anchorParts.month,
    day: anchorParts.day,
  };
  return {
    start: horizon.j0StartAtSignup
      ? anchor
      : localMidnight(addCalendarDays(cohortDate, horizon.startDay)),
    end: localMidnight(addCalendarDays(cohortDate, horizon.endDay)),
  };
}

function queryText(key: keyof typeof manifest.queries): string {
  return readFileSync(resolve(repositoryRoot, manifest.queries[key].path), "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("PostHog Customer Analytics local contract", () => {
  test("keeps backend and frontend rollout gates default-off", () => {
    expect(manifest.runtime.backendFlag).toMatchObject({
      name: "POSTHOG_PAID_LIFECYCLE_ENABLED",
      default: false,
      livePostgreSQLGateRequired: true,
    });
    expect(manifest.runtime.frontendFlag).toMatchObject({
      name: "REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED",
      default: false,
      externalAccessAndParityGatesRequired: true,
    });
    expect(manifest.runtime.dashboardUrl).toMatchObject({
      environmentVariable: "REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL",
      immutableUrl: "https://eu.posthog.com/project/228425/dashboard/836530",
      status: "private_dashboard_verified",
      publicShareUrlAllowed: false,
    });

    const backendEnvironment = readFileSync(
      resolve(repositoryRoot, "backend/.env.example"),
      "utf8",
    );
    const frontendEnvironment = readFileSync(
      resolve(repositoryRoot, "frontend/.env.example"),
      "utf8",
    );
    expect(backendEnvironment).toContain("POSTHOG_PAID_LIFECYCLE_ENABLED=false");
    expect(frontendEnvironment).toContain("REACT_APP_ADMIN_POSTHOG_ANALYTICS_ENABLED=false");
    expect(frontendEnvironment).toMatch(/^REACT_APP_POSTHOG_ADMIN_DASHBOARD_URL=$/m);
  });

  test("defines explicit non-cumulative half-open J0/J1/W1/M1 windows", () => {
    expect(manifest.horizons).toEqual({
      J0: {
        startDay: 0,
        endDay: 1,
        j0StartAtSignup: true,
        definition: "[anchor timestamp, local midnight D+1)",
      },
      J1: {
        startDay: 1,
        endDay: 2,
        j0StartAtSignup: false,
        definition: "[local midnight D+1, local midnight D+2)",
      },
      W1: {
        startDay: 7,
        endDay: 14,
        j0StartAtSignup: false,
        definition: "[local midnight D+7, local midnight D+14), days 7-13",
      },
      M1: {
        startDay: 28,
        endDay: 35,
        j0StartAtSignup: false,
        definition: "[local midnight D+28, local midnight D+35), days 28-34",
      },
    });

    const anchor = new Date("2026-02-10T10:30:00.000Z");
    const j0 = windowFor(anchor, "J0");
    const j1 = windowFor(anchor, "J1");
    const w1 = windowFor(anchor, "W1");
    const m1 = windowFor(anchor, "M1");
    expect(j0.start).toEqual(anchor);
    expect(j0.end).toEqual(j1.start);
    expect(j1.end.getTime()).toBeLessThan(w1.start.getTime());
    expect(w1.end.getTime()).toBeLessThan(m1.start.getTime());

    const atEnd = j1.end.getTime();
    expect(atEnd >= j1.start.getTime() && atEnd < j1.end.getTime()).toBe(false);
    expect(atEnd >= w1.start.getTime() && atEnd < w1.end.getTime()).toBe(false);
  });

  test("uses Europe/Paris calendar boundaries across 23-hour and 25-hour days", () => {
    const spring = windowFor(new Date("2026-03-28T23:30:00.000Z"), "J0");
    expect(spring.end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(22.5);

    const autumn = windowFor(new Date("2026-10-24T22:30:00.000Z"), "J0");
    expect(autumn.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect((autumn.end.getTime() - autumn.start.getTime()) / 3_600_000).toBe(24.5);
  });

  test("governs deliberate activity without passive impressions", () => {
    expect(manifest.selectors.deliberateActivity).toEqual([
      "job_dismissed",
      "application_intent_started",
      "job_application_created",
      "cv_uploaded",
      "onboarding_completed",
    ]);
    expect(manifest.selectors.passiveActivityExcluded).toEqual(["$pageview", "job_card_viewed"]);
    expect(manifest.selectors.warehouseActivityFacts).toEqual([
      "public__swipes.created_at",
      "public__applications.created_at",
      "public__analytics_events.created_at",
    ]);

    const deliberate = new Set(manifest.selectors.deliberateActivity);
    const passiveOnly = ["job_card_viewed", "$pageview"];
    const manyAllowed = [...manifest.selectors.deliberateActivity];
    expect(new Set(passiveOnly.filter((event) => deliberate.has(event))).size).toBe(0);
    expect(new Set(manyAllowed.filter((event) => deliberate.has(event))).size).toBe(5);
    expect(Number(manyAllowed.some((event) => deliberate.has(event)))).toBe(1);
  });

  test("pins one engagement query shape and a separate paid-churn query", () => {
    const engagement = queryText("engagement");
    const paid = queryText("paidSubscriptionChurn");
    expect(sha256(engagement)).toBe(manifest.queries.engagement.sha256);
    expect(sha256(paid)).toBe(manifest.queries.paidSubscriptionChurn.sha256);

    for (const cte of ["signup", "bounds", "eligible", "activity", "result"]) {
      expect(engagement).toMatch(new RegExp(`(?:WITH|,)\\s*${cte}\\s+AS`, "i"));
    }
    for (const event of manifest.selectors.deliberateActivity) {
      expect(engagement).toContain(`'${event}'`);
    }
    for (const forbidden of ["$pageview", "job_card_viewed", "persons.id", "email"]) {
      expect(engagement).not.toContain(forbidden);
      expect(paid).not.toContain(forbidden);
    }
    expect(engagement).toContain("engagement_churn_count");
    expect(engagement).toContain("eligible_count - active_count");
    expect(engagement).toContain("data.supabase_user_id");
    expect(engagement).toContain("public__swipes");
    expect(engagement).toContain("public__applications");
    expect(paid).toContain("event = 'subscription_activated'");
    expect(paid).toContain("event = 'subscription_churned'");
    expect(paid).toContain("paid_churn.distinct_id = eligible.distinct_id");
    expect(paid).not.toContain("engagement_churn");
    expect(manifest.queries.paidSubscriptionChurn.title).toBe("First-paid activation-cohort loss");
  });

  test("renders every horizon from the governed window and paid-source parameters", () => {
    for (const [key, query] of [
      ["engagement", queryText("engagement")],
      ["paidSubscriptionChurn", queryText("paidSubscriptionChurn")],
    ] as const) {
      const placeholders = [...query.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].map((match) => match[1]);
      const expected = ["start_day", "end_day", "j0_start_at_signup"];
      if (key === "paidSubscriptionChurn") expected.push("paid_source_start_at");
      expect(new Set(placeholders)).toEqual(new Set(expected));
      for (const horizon of Object.values(manifest.horizons)) {
        const rendered = query
          .replaceAll("{{start_day}}", String(horizon.startDay))
          .replaceAll("{{end_day}}", String(horizon.endDay))
          .replaceAll("{{j0_start_at_signup}}", horizon.j0StartAtSignup ? "1" : "0")
          .replaceAll(
            "{{paid_source_start_at}}",
            manifest.queries.paidSubscriptionChurn.paidSourceStartAt,
          );
        expect(rendered).not.toContain("{{");
      }
    }
  });
});
