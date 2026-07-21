import { canonicalPlanTier, formatPlanTier, planTierLabel } from "./billingPlan";

describe("billingPlan", () => {
  test("maps onboarding and app plan ids to tier labels", () => {
    expect(planTierLabel("monthly")).toBe("Pro");
    expect(planTierLabel("quarterly")).toBe("Ultra");
    expect(planTierLabel("pro")).toBe("Pro");
    expect(planTierLabel("basic")).toBe("Basic");
    expect(planTierLabel("ultra")).toBe("Ultra");
  });

  test("canonicalPlanTier normalizes aliases", () => {
    expect(canonicalPlanTier("monthly")).toBe("pro");
    expect(canonicalPlanTier("quarterly")).toBe("ultra");
    expect(formatPlanTier("monthly")).toBe("Pro");
  });
});
