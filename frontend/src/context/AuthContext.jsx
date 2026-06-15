import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setSessionToken } from "../lib/api";
import { devBypassAuth } from "../lib/dev";

const AuthContext = createContext(null);

const DEV_MOCK_USER = {
  user_id: "dev-local",
  email: "dev@localhost",
  name: "Dev User",
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
    if (devBypassAuth) {
      setUser(DEV_MOCK_USER);
      setHasProfile(true);
      setHasPreferences(true);
      setIsTrainingCreator(false);
      setLoading(false);
      return;
    }
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the OAuth session and establish the app session first.
    if (window.location.pathname === "/auth/callback") {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch (_) {}
    setSessionToken(null);
    setUser(null);
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
