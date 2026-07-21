import {
  isMissingPhoneFeedError,
  isMissingResumeFeedError,
  profileHasPhone,
  profileHasResume,
} from "./profileReadiness";

describe("profileReadiness", () => {
  it("detects resume presence", () => {
    expect(profileHasResume({ cv_text: "hello" })).toBe(true);
    expect(profileHasResume({})).toBe(false);
  });

  it("detects phone presence", () => {
    expect(profileHasPhone({ contact: { phone: "+33 6 12 34 56 78" } })).toBe(true);
    expect(profileHasPhone({ contact: { phone: "123" } })).toBe(false);
  });

  it("detects feed setup errors", () => {
    expect(isMissingResumeFeedError("Upload CV first")).toBe(true);
    expect(isMissingPhoneFeedError("Add your phone number to apply")).toBe(true);
  });
});
