import { act } from "react";
import { createRoot } from "react-dom/client";

import { AuthProvider, useAuth } from "./AuthContext";
import { goToMarketing } from "../lib/appDomains";
import { resetPostHog } from "../lib/posthogClient";

(globalThis).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  getSessionToken: jest.fn(() => null),
  setSessionToken: jest.fn(),
}));
jest.mock("../lib/dev", () => ({
  devBypassAuth: true,
  TUTORIAL_BYPASS_AUTH: false,
}));
jest.mock("../lib/demoAccount", () => ({ setDemoAccountFromUser: jest.fn() }));
jest.mock("../lib/oauthCallback", () => ({ isOAuthCallbackInProgress: jest.fn(() => false) }));
jest.mock("../lib/tutorialSession", () => ({ bootstrapTutorialSession: jest.fn() }));
jest.mock("../lib/appDomains", () => ({ goToMarketing: jest.fn() }));
jest.mock("../lib/supabase", () => ({ supabase: null, supabaseConfigured: false }));
jest.mock("../lib/billingSync", () => ({
  syncBillingStatus: jest.fn(),
  resumePendingCheckoutSync: jest.fn(),
}));
jest.mock("../lib/pendingCheckout", () => ({
  captureCheckoutSessionFromSearch: jest.fn(),
  peekCheckoutSessionId: jest.fn(() => null),
}));
jest.mock("../lib/posthogClient", () => ({ resetPostHog: jest.fn() }));

function LogoutProbe() {
  const { logout } = useAuth();
  return <button onClick={logout}>Log out</button>;
}

describe("AuthProvider logout navigation", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("resets PostHog synchronously before navigating to the marketing domain", async () => {
    await act(async () => {
      root.render(
        <AuthProvider>
          <LogoutProbe />
        </AuthProvider>,
      );
    });

    await act(async () => {
      container.querySelector("button").click();
    });

    expect(resetPostHog).toHaveBeenCalledTimes(1);
    expect(goToMarketing).toHaveBeenCalledWith("/signin");
    expect(resetPostHog.mock.invocationCallOrder[0]).toBeLessThan(
      goToMarketing.mock.invocationCallOrder[0],
    );
  });
});
