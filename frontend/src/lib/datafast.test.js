import { ONBOARDING_STEP_ORDER } from "../components/onboarding/onboardingData";
import {
  ONBOARDING_DATAFAST_FUNNEL,
  buildOnboardingDatafastFunnel,
  onboardingContinueGoalName,
  onboardingIntroGoalName,
  onboardingSkipGoalName,
  onboardingStepNumber,
} from "./datafast";

describe("datafast onboarding funnel", () => {
  it("maps step ids to stable numbered goal names", () => {
    expect(onboardingStepNumber("jobSearch")).toBe(3);
    expect(onboardingStepNumber("jobGoal")).toBe(4);
    expect(onboardingStepNumber("compare2x")).toBe(5);
    expect(onboardingStepNumber("contactPhone")).toBe(12);
    expect(onboardingContinueGoalName("jobGoal")).toBe("onboarding_step_04_job_goal");
    expect(onboardingContinueGoalName("contactPhone")).toBe("onboarding_step_12_contact_phone");
    expect(onboardingIntroGoalName(3)).toBe("onboarding_step_01_intro_3");
    expect(onboardingSkipGoalName("referralCode")).toBe("onboarding_skip_21_referral_code");
  });

  it("lists funnel goals in onboarding step order", () => {
    const funnel = buildOnboardingDatafastFunnel();
    const stepGoals = funnel
      .filter((row) => row.goal.startsWith("onboarding_step_"))
      .map((row) => row.goal);

    expect(stepGoals[0]).toBe("onboarding_step_01_intro_1");
    expect(stepGoals[4]).toBe("onboarding_step_01_intro_5");
    expect(stepGoals[5]).toBe("onboarding_step_02_signup");
    expect(stepGoals[6]).toBe("onboarding_step_03_job_search");
    expect(stepGoals[7]).toBe("onboarding_step_04_job_goal");
    expect(stepGoals[8]).toBe("onboarding_step_05_compare2x");
    expect(stepGoals[15]).toBe("onboarding_step_12_contact_phone");
    expect(stepGoals.at(-1)).toBe("onboarding_step_27_showcase_pricing");
    expect(funnel.at(-2)?.goal).toBe("onboarding_completed");
    expect(funnel.at(-1)?.goal).toBe("onboarding_checkout_started");
  });

  it("keeps ONBOARDING_DATAFAST_FUNNEL aligned with step order length", () => {
    expect(ONBOARDING_DATAFAST_FUNNEL.length).toBeGreaterThan(ONBOARDING_STEP_ORDER.length);
    const numberedSteps = ONBOARDING_DATAFAST_FUNNEL.filter((row) => row.step_number != null);
    expect(numberedSteps.map((row) => row.step_id)).toEqual(
      ONBOARDING_STEP_ORDER.flatMap((stepId) => (stepId === "intro"
        ? Array.from({ length: 5 }, () => "intro")
        : stepId === "signup"
          ? ["signup", "signup", "signup"]
          : [stepId])),
    );
  });
});
