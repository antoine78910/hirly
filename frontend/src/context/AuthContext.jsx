import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setSessionToken, getSessionToken } from "../lib/api";
import { devBypassAuth, TUTORIAL_BYPASS_AUTH } from "../lib/dev";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import { isOAuthCallbackInProgress } from "../lib/oauthCallback";
import { bootstrapTutorialSession } from "../lib/tutorialSession";
import { goToMarketing } from "../lib/appDomains";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { syncBillingStatus, resumePendingCheckoutSync } from "../lib/billingSync";
import { captureCheckoutSessionFromSearch, peekCheckoutSessionId } from "../lib/pendingCheckout";
import { resetPostHog } from "../lib/posthogClient";

const AuthContext = createContext(null);

const DEV_MOCK_USER = {
  user_id: "dev-local",
  email: "dev@localhost",
  name: "Dev User",
  demo_account: false,
};

const TUTORIAL_FALLBACK_USER = {
  user_id: "tutorial_filming",
  email: "tutorial@hirly.app",
  name: "Alex Martin",
  demo_account: true,
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasPreferences, setHasPreferences] = useState(false);
  const [isTrainingCreator, setIsTrainingCreator] = useState(false);
  const [hasTrainingAccess, setHasTrainingAccess] = useState(devBypassAuth);
  const [isAdmin, setIsAdmin] = useState(devBypassAuth);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setDemoAccountFromUser(data.user, Boolean(data.is_admin));
      setHasProfile(data.has_profile);
      setHasPreferences(data.has_preferences);
      setIsTrainingCreator(Boolean(data.is_training_creator));
      setHasTrainingAccess(Boolean(data.has_training_access));
      setIsAdmin(Boolean(data.is_admin));
      // Only sync billing after a Stripe checkout redirect — not on every login.
      const isRealUser = data.user && !data.user.demo_account && !Boolean(data.is_admin);
      if (isRealUser && peekCheckoutSessionId()) {
        resumePendingCheckoutSync({ maxAttempts: 15, delayMs: 1500 })
          .catch(() => syncBillingStatus().catch(() => {}));
      }
    } catch (e) {
      setUser(null);
      setIsTrainingCreator(false);
      setHasTrainingAccess(false);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (TUTORIAL_BYPASS_AUTH) {
      (async () => {
        try {
          const data = await bootstrapTutorialSession();
          const user = { ...(data?.user || TUTORIAL_FALLBACK_USER), demo_account: true };
          setUser(user);
          setDemoAccountFromUser(user, Boolean(data?.is_admin));
          setHasProfile(Boolean(data?.has_profile));
          setHasPreferences(Boolean(data?.has_preferences));
          setHasTrainingAccess(true);
          setIsAdmin(Boolean(data?.is_admin));
        } catch (error) {
          console.warn("Tutorial session bootstrap failed; trying stored session.", error);
          const existingToken = getSessionToken();
          if (existingToken) {
            try {
              const { data } = await api.get("/auth/me");
              const user = { ...(data?.user || TUTORIAL_FALLBACK_USER), demo_account: true };
              setUser(user);
              setDemoAccountFromUser(user, Boolean(data?.is_admin));
              setHasProfile(Boolean(data?.has_profile));
              setHasPreferences(Boolean(data?.has_preferences));
              setHasTrainingAccess(Boolean(data?.has_training_access));
              setIsAdmin(Boolean(data?.is_admin));
              setLoading(false);
              return;
            } catch (storedError) {
              console.warn("Stored tutorial session invalid.", storedError);
            }
          }
          setUser(TUTORIAL_FALLBACK_USER);
          setDemoAccountFromUser(TUTORIAL_FALLBACK_USER, false);
          setHasProfile(true);
          setHasPreferences(true);
          setIsAdmin(false);
        } finally {
          setLoading(false);
        }
      })();
      return;
    }
    if (devBypassAuth) {
      const existingToken = getSessionToken();
      if (existingToken) {
        checkAuth();
        return;
      }
      setUser(DEV_MOCK_USER);
      setDemoAccountFromUser(DEV_MOCK_USER, true);
      setHasProfile(true);
      setHasPreferences(true);
      setIsTrainingCreator(false);
      setHasTrainingAccess(true);
      setIsAdmin(true);
      setLoading(false);
      return;
    }
    const existingToken = getSessionToken();
    if (existingToken?.startsWith("tutorial_session_")) {
      setSessionToken(null);
    }
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the OAuth session and establish the app session first.
    if (isOAuthCallbackInProgress()) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    captureCheckoutSessionFromSearch(window.location.search);
  }, []);

  const logout = async () => {
    // Clear the vendor identity synchronously. Waiting for auth requests here
    // creates a race with the full-page cross-domain navigation below.
    resetPostHog();
    const token = getSessionToken();
    try {
      if (token) await api.post("/auth/logout");
    } catch (_) {}

    try {
      if (supabaseConfigured && supabase) {
        await supabase.auth.signOut({ scope: "local" });
      }
    } catch (_) {}

    setSessionToken(null);
    setUser(null);
    setDemoAccountFromUser(null, false);
    setHasProfile(false);
    setHasPreferences(false);
    setIsTrainingCreator(false);
    setHasTrainingAccess(false);
    setIsAdmin(false);

    goToMarketing("/signin");
  };

  return (
    <AuthContext.Provider value={{
      user,
      hasProfile,
      hasPreferences,
      isTrainingCreator,
      setIsTrainingCreator,
      hasTrainingAccess,
      setHasTrainingAccess,
      isAdmin,
      setIsAdmin,
      loading,
      checkAuth,
      setUser,
      setHasProfile,
      setHasPreferences,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
