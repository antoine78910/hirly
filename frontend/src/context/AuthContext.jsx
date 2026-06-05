import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setSessionToken } from "../lib/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [hasPreferences, setHasPreferences] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setHasProfile(data.has_profile);
      setHasPreferences(data.has_preferences);
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip the /me check.
    // AuthCallback will exchange the session_id and establish the session first.
    if (window.location.hash?.includes("session_id=") || window.location.hash?.includes("session_token=")) {
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
  };

  return (
    <AuthContext.Provider value={{ user, hasProfile, hasPreferences, loading, checkAuth, setUser, setHasProfile, setHasPreferences, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
