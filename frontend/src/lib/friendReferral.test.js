import {
  buildFriendReferralShareMessage,
  buildFriendReferralSharePayload,
  buildFriendReferralShareUrl,
  isFriendReferralCode,
  normalizeReferralCodeInput,
} from "./friendReferral";

describe("friendReferral share helpers", () => {
  it("builds onboarding link with referral code", () => {
    expect(buildFriendReferralShareUrl("123456")).toBe(
      "https://tryhirly.com/onboarding?referral=123456",
    );
  });

  it("builds localized share payload with site link and code", () => {
    const en = buildFriendReferralSharePayload("123456", "en");
    expect(en.url).toContain("/onboarding?referral=123456");
    expect(en.text).toContain("123456");
    expect(en.title).toContain("Hirly");

    const fr = buildFriendReferralSharePayload("123456", "fr");
    expect(fr.text).toContain("code de parrainage 123456");
  });

  it("builds full clipboard message with url on its own line", () => {
    const message = buildFriendReferralShareMessage("123456", "en");
    expect(message).toContain("referral code 123456");
    expect(message).toContain("https://tryhirly.com/onboarding?referral=123456");
    expect(message.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });

  it("normalizes referral code input to 6 digits", () => {
    expect(normalizeReferralCodeInput("1234567890")).toBe("123456");
    expect(normalizeReferralCodeInput("12a34b56")).toBe("123456");
    expect(normalizeReferralCodeInput("")).toBe("");
  });

  it("validates friend referral codes", () => {
    expect(isFriendReferralCode("123456")).toBe(true);
    expect(isFriendReferralCode("A153B3")).toBe(false);
    expect(isFriendReferralCode("12345")).toBe(false);
  });
});
