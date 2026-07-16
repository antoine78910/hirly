import { resolveDisplayStatus } from "./applicationReview";

describe("resolveDisplayStatus", () => {
  test("expired submission overrides stale pending status", () => {
    expect(resolveDisplayStatus({
      status: "pending",
      submission_status: "expired",
      user_facing_submission_status: "expired",
    })).toBe("expired");
  });

  test("offer expired admin status overrides stale pending fields", () => {
    expect(resolveDisplayStatus({
      status: "pending",
      submission_status: "pending",
      manual_status: "offer_expired",
    })).toBe("expired");
  });
});
