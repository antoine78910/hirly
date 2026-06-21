import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setSessionToken } from "../lib/api";
import { devBypassAuth, TUTORIAL_BYPASS_AUTH } from "../lib/dev";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import { isOAuthCallbackInProgress } from "../lib/oauthCallback";
import { bootstrapTutorialSession } from "../lib/tutorialSession";

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
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setDemoAccountFromUser(data.user);
      setHasProfile(data.has_profile);
      setHasPreferences(data.has_preferences);
      setIsTrainingCreator(Boolean(data.is_training_creator));
    } catch (e) {
      setUser(null);
      setIsTrainingCreator(false);
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
          setDemoAccountFromUser(user);
          setHasProfile(Boolean(data?.has_profile));
          setHasPreferences(Boolean(data?.has_preferences));
        } catch (error) {
          console.warn("Tutorial session bootstrap failed; using local demo fallback.", error);
          setUser(TUTORIAL_FALLBACK_USER);
          setDemoAccountFromUser(TUTORIAL_FALLBACK_USER);
          setHasProfile(true);
          setHasPreferences(true);
        } finally {
          setLoading(false);
        }
      })();
      return;
    }
    if (devBypassAuth) {
      setUser(DEV_MOCK_USER);
      setDemoAccountFromUser(DEV_MOCK_USER);
      setHasProfile(true);
      setHasPreferences(true);
      setIsTrainingCreator(false);
      setLoading(false);
      return;
    }
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the OAuth session and establish the app session first.
    if (isOAuthCallbackInProgress()) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) {}
    setSessionToken(null);
    setUser(null);
    setDemoAccountFromUser(null);
    setHasProfile(false);
    setHasPreferences(false);
    setIsTrainingCreator(false);
  };

  return (
    <AuthContext.Provider value={{
      user,
      hasProfile,
      hasPreferences,
      isTrainingCreator,
      setIsTrainingCreator,
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
