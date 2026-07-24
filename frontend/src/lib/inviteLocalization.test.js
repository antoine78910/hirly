import { APP_LANGUAGES } from "./appUi";
import {
  INVITE_COPY,
  INVITE_LANGUAGE_OPTIONS,
  inviteT,
  isInviteLocale,
  normalizeInviteLocale,
} from "./inviteLocalization";

describe("creator invitation localization", () => {
  it("provides complete copy and selector options for every app locale", () => {
    expect(INVITE_LANGUAGE_OPTIONS.map(({ code }) => code)).toEqual(APP_LANGUAGES);
    const englishKeys = Object.keys(INVITE_COPY.en).sort();

    for (const locale of APP_LANGUAGES) {
      expect(Object.keys(INVITE_COPY[locale]).sort()).toEqual(englishKeys);
      expect(inviteT(locale, "createAccount")).not.toBe("createAccount");
    }
  });

  it("accepts locale tags from invite URLs without falling back across languages", () => {
    expect(normalizeInviteLocale("de-DE")).toBe("de");
    expect(normalizeInviteLocale("es_ES")).toBe("es");
    expect(normalizeInviteLocale("it")).toBe("it");
    expect(normalizeInviteLocale("pt", "en")).toBe("en");
    expect(isInviteLocale("fr-FR")).toBe(true);
    expect(isInviteLocale("pt-BR")).toBe(false);
  });
});
