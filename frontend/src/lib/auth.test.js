import {
  authCallbackBaseUrl,
  authCallbackRedirectUrl,
  normalizeEmailOtpType,
  readAuthUrlParams,
  resolveSupabaseAuthSession,
} from "./auth";

describe("auth callback helpers", () => {
  it("builds a bare auth callback URL without query params", () => {
    expect(authCallbackBaseUrl("https://tryhirly.com")).toBe("https://tryhirly.com/auth/callback");
  });

  it("stores return path and returns bare redirect URL for email verification", () => {
    const url = authCallbackRedirectUrl("/onboarding?step=jobSearch");
    expect(url).toMatch(/\/auth\/callback$/);
    expect(url).not.toContain("next=");
  });

  it("reads auth params from search and hash", () => {
    const { searchParams, hashParams } = readAuthUrlParams(
      "?token_hash=abc&type=signup",
      "#access_token=at&refresh_token=rt",
    );
    expect(searchParams.get("token_hash")).toBe("abc");
    expect(searchParams.get("type")).toBe("signup");
    expect(hashParams.get("access_token")).toBe("at");
    expect(hashParams.get("refresh_token")).toBe("rt");
  });

  it("normalizes email OTP types", () => {
    expect(normalizeEmailOtpType("signup")).toBe("signup");
    expect(normalizeEmailOtpType("unknown")).toBe("email");
  });
});

describe("resolveSupabaseAuthSession", () => {
  it("verifies email token_hash from the callback URL", async () => {
    const client = {
      auth: {
        verifyOtp: jest.fn().mockResolvedValue({
          data: { session: { access_token: "token" } },
          error: null,
        }),
        getSession: jest.fn(),
      },
    };

    const session = await resolveSupabaseAuthSession(client, {
      search: "?token_hash=hash123&type=signup",
      hash: "",
    });

    expect(session?.access_token).toBe("token");
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({
      token_hash: "hash123",
      type: "signup",
    });
  });

  it("sets session from implicit hash tokens", async () => {
    const client = {
      auth: {
        verifyOtp: jest.fn(),
        setSession: jest.fn().mockResolvedValue({
          data: { session: { access_token: "hash-token" } },
          error: null,
        }),
        getSession: jest.fn(),
      },
    };

    const session = await resolveSupabaseAuthSession(client, {
      search: "",
      hash: "#access_token=at&refresh_token=rt&type=signup",
    });

    expect(session?.access_token).toBe("hash-token");
    expect(client.auth.setSession).toHaveBeenCalledWith({
      access_token: "at",
      refresh_token: "rt",
    });
  });
});
