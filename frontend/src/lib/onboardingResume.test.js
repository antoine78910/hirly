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
    expect(normalizeResumeStep("signup", { user: { user_id: "u1" }, profile: null })).toBe(
      "jobSearch",
    );
    expect(
      normalizeResumeStep("upload", { user: { user_id: "u1" }, profile: { cv_text: "resume" } }),
    ).toBe("profileSetup");
  });

  it("forces contact phone only before the user has moved past that step", () => {
    expect(
      normalizeResumeStep("salary", {
        user: { user_id: "u1" },
        profile: { cv_text: "resume", target_role: "Engineer" },
        onboarding: {},
      }),
    ).toBe("contactPhone");
    expect(
      normalizeResumeStep("salary", {
        user: { user_id: "u1" },
        profile: { cv_text: "resume", target_role: "Engineer" },
        onboarding: { last_step: "salary" },
      }),
    ).toBe("salary");
  });

  it("keeps paywall step on reload even when phone was skipped", () => {
    expect(
      normalizeResumeStep("showcasePricing", {
        user: { user_id: "u1" },
        profile: { cv_text: "resume", target_role: "Engineer" },
        onboarding: { last_step: "showcasePricing" },
      }),
    ).toBe("showcasePricing");

    const step = resolveOnboardingResumeStep({
      stepParam: "showcasePricing",
      onboarding: { last_step: "showcasePricing", job_search_status: "active", job_goal: "asap" },
      profile: { cv_text: "cv", target_role: "Engineer" },
      user: { user_id: "u1" },
    });
    expect(step).toBe("showcasePricing");
  });

  it("infers paywall when cv is uploaded even without a saved phone", () => {
    const step = inferOnboardingStepFromProgress({
      onboarding: {
        job_search_status: "active",
        job_goal: "asap",
        contract_type: "permanent",
        tried_other_apps: false,
        categories: ["tech"],
        experience: "mid",
        onboarding_location: "Paris",
        acquisition_source: "google",
      },
      profile: { cv_text: "cv", target_role: "Engineer" },
      user: { user_id: "u1" },
    });
    expect(step).toBe("showcasePricing");
  });

  it("infers referral code step after attribution when cv is missing", () => {
    const step = inferOnboardingStepFromProgress({
      onboarding: {
        job_search_status: "active",
        job_goal: "asap",
        contract_type: "permanent",
        tried_other_apps: false,
        categories: ["tech"],
        experience: "mid",
        onboarding_location: "Paris",
        acquisition_source: "google",
      },
      profile: { contact: { phone: "+33612345678" } },
      user: { user_id: "u1" },
    });
    expect(step).toBe("referralCode");
  });

  it("resumes referral code step from saved last_step on reload", () => {
    const step = resolveOnboardingResumeStep({
      onboarding: {
        last_step: "referralCode",
        job_search_status: "active",
        job_goal: "asap",
        acquisition_source: "friend",
      },
      profile: { contact: { phone: "+33612345678" } },
      user: { user_id: "u1" },
    });
    expect(step).toBe("referralCode");
  });

  it("infers upload after referral when cv is still missing and last_step is upload", () => {
    const step = resolveOnboardingResumeStep({
      onboarding: {
        last_step: "upload",
        job_search_status: "active",
        job_goal: "asap",
        acquisition_source: "friend",
      },
      profile: { contact: { phone: "+33612345678" } },
      user: { user_id: "u1" },
    });
    expect(step).toBe("upload");
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
