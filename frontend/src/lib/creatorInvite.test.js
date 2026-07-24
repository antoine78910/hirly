import {
  buildInviteUrl,
  inviteDestination,
  inviteLandingPath,
  inviteLocaleFromPath,
} from "./creatorInvite";

describe("creator invitation URLs", () => {
  it("carries the selected recipient language in the invite link", () => {
    expect(inviteLandingPath("123456", "de-DE")).toBe("/invite/123456?lang=de");
    expect(buildInviteUrl("123456", "es")).toBe("https://tryhirly.com/invite/123456?lang=es");
    expect(inviteLocaleFromPath("/invite/123456?lang=it")).toBe("it");
    expect(inviteLocaleFromPath("/invite/123456?lang=pt")).toBe("fr");
  });

  it("keeps English training invite recipients on the English training route", () => {
    expect(inviteDestination({ training_access: true }, null, "en")).toBe("/en/training");
    expect(inviteDestination({ training_access: true }, null, "de")).toBe("/fr/training");
    expect(inviteDestination({ invite_type: "demo" }, null, "it")).toBe("/swipe");
  });
});
