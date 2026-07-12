import {
  buildFriendReferralShareMessage,
  buildFriendReferralSharePayload,
  buildFriendReferralShareUrl,
  isFriendReferralCode,
} from "./friendReferral";

describe("friendReferral share helpers", () => {
  it("builds onboarding link with referral code", () => {
    expect(buildFriendReferralShareUrl("a153b3")).toBe(
      "https://tryhirly.com/onboarding?referral=A153B3",
    );
  });

  it("builds localized share payload with site link and code", () => {
    const en = buildFriendReferralSharePayload("A153B3", "en");
    expect(en.url).toContain("/onboarding?referral=A153B3");
    expect(en.text).toContain("A153B3");
    expect(en.title).toContain("Hirly");

    const fr = buildFriendReferralSharePayload("A153B3", "fr");
    expect(fr.text).toContain("code de parrainage A153B3");
  });

  it("builds full clipboard message with url on its own line", () => {
    const message = buildFriendReferralShareMessage("A153B3", "en");
    expect(message).toContain("referral code A153B3");
    expect(message).toContain("https://tryhirly.com/onboarding?referral=A153B3");
    expect(message.split("\n\n").length).toBeGreaterThanOrEqual(2);
  });

  it("validates friend referral codes", () => {
    expect(isFriendReferralCode("A153B3")).toBe(true);
    expect(isFriendReferralCode("123456")).toBe(true);
    expect(isFriendReferralCode("AB")).toBe(false);
  });
});
