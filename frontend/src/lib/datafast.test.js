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
});
