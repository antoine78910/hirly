import {
  inferOnboardingStepFromProgress,
  normalizeResumeStep,
  resolveOnboardingResumeStep,
} from "./onboardingResume";

describe("onboardingResume", () => {
  it("prefers saved last_step over an earlier step param", () => {
    const step = resolveOnboardingResumeStep({
      stepParam: "jobSearch",
      onboarding: { last_step: "showcasePricing", job_search_status: "active", job_goal: "asap" },
      profile: { cv_text: "cv", target_role: "Engineer", contact: { phone: "+33 6 12 34 56 78" } },
      user: { user_id: "u1" },
    });
    expect(step).toBe("showcasePricing");
  });

  it("uses step param for new users without saved progress", () => {
    const step = resolveOnboardingResumeStep({
      stepParam: "jobSearch",
      onboarding: {},
      profile: null,
      user: { user_id: "u1" },
    });
    expect(step).toBe("jobSearch");
  });

  it("infers job goal right after job search", () => {
    const step = inferOnboardingStepFromProgress({
      onboarding: { job_search_status: "yes" },
      profile: null,
      user: { user_id: "u1" },
    });
    expect(step).toBe("jobGoal");
  });

  it("infers the next incomplete step from saved answers", () => {
    const step = inferOnboardingStepFromProgress({
      onboarding: {
        job_search_status: "active",
        job_goal: "asap",
        contract_type: "permanent",
        tried_other_apps: false,
        categories: ["tech"],
      },
      profile: null,
      user: { user_id: "u1" },
    });
    expect(step).toBe("experience");
  });

  it("skips transient steps for logged-in users", () => {
    expect(normalizeResumeStep("signup", { user: { user_id: "u1" }, profile: null })).toBe("jobSearch");
    expect(normalizeResumeStep("upload", { user: { user_id: "u1" }, profile: { cv_text: "resume" } })).toBe("profileSetup");
  });

  it("forces contact phone when resuming later without a saved number", () => {
    expect(
      normalizeResumeStep("showcasePricing", {
        user: { user_id: "u1" },
        profile: { cv_text: "resume", target_role: "Engineer" },
      }),
    ).toBe("contactPhone");
  });

  it("skips contact phone when already saved", () => {
    expect(
      normalizeResumeStep("contactPhone", {
        user: { user_id: "u1" },
        profile: { contact: { phone: "+33 6 12 34 56 78" } },
      }),
    ).toBe("salary");
  });
});
