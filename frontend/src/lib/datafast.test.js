import {
  DATAFAST_GOAL_CATALOG,
  ONBOARDING_CONTINUE_GOAL,
  ONBOARDING_DATAFAST_FUNNEL,
  ONBOARDING_SKIP_GOAL,
  buildOnboardingDatafastFunnel,
  onboardingContinueGoalName,
  onboardingIntroGoalName,
  onboardingSkipGoalName,
  onboardingStepNumber,
} from "./datafast";
import fs from "node:fs";
import path from "node:path";

describe("datafast onboarding funnel", () => {
  it("maps step ids to stable step numbers for goal params", () => {
    expect(onboardingStepNumber("jobSearch")).toBe(3);
    expect(onboardingStepNumber("jobGoal")).toBe(4);
    expect(onboardingStepNumber("compare2x")).toBe(5);
    expect(onboardingStepNumber("contactPhone")).toBe(12);
  });

  it("uses consolidated goal names instead of per-step goals", () => {
    expect(onboardingContinueGoalName("jobGoal")).toBe(ONBOARDING_CONTINUE_GOAL);
    expect(onboardingContinueGoalName("contactPhone")).toBe(ONBOARDING_CONTINUE_GOAL);
    expect(onboardingIntroGoalName(3)).toBe(ONBOARDING_CONTINUE_GOAL);
    expect(onboardingSkipGoalName("referralCode")).toBe(ONBOARDING_SKIP_GOAL);
  });

  it("lists a small consolidated funnel catalog", () => {
    const funnel = buildOnboardingDatafastFunnel();
    expect(funnel.map((row) => row.goal)).toEqual([
      "lp_view",
      "lp_cta",
      "onboarding_started",
      "onboarding_continue",
      "onboarding_skip",
      "onboarding_signup",
      "onboarding_completed",
      "onboarding_checkout_started",
    ]);
    expect(ONBOARDING_DATAFAST_FUNNEL.length).toBe(8);
  });

  it("keeps the full app goal catalog under a safe limit", () => {
    expect(new Set(DATAFAST_GOAL_CATALOG).size).toBe(DATAFAST_GOAL_CATALOG.length);
    expect(DATAFAST_GOAL_CATALOG.length).toBeLessThanOrEqual(12);
  });

  it("keeps the DataFast bootstrap while removing the raw PostHog snippet", () => {
    const html = fs.readFileSync(path.join(process.cwd(), "public/index.html"), "utf8");
    expect(html).toContain('id="datafast-queue"');
    expect(html).toContain('data-website-id="dfid_bXTlZtOnIRPFlYqkgsEvm"');
    expect(html).toContain('data-domain="tryhirly.com"');
    expect(html).toContain('src="https://datafa.st/js/script.js"');
    expect(html).not.toContain("phc_xAvL2Iq4tFmANRE7kzbKwaSqp1HJjN7x48s3vr0CMjs");
    expect(html).not.toContain("posthog.init(");
  });
});
