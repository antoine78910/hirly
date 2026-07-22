import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_AI_SETTINGS, readAiSettings, saveAiSettings } from "../lib/aiSettings";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export function useAiSettings() {
  const [settings, setSettings] = useState(DEFAULT_AI_SETTINGS);
  const { user, setUser } = useAuth() || {};

  useEffect(() => {
    setSettings(readAiSettings());
  }, []);

  // The backend is the source of truth for reviewDocuments (it gates real
  // application submission), so it overrides any stale local cache once
  // the authenticated user is known.
  useEffect(() => {
    if (typeof user?.require_review_before_send !== "boolean") return;
    setSettings((prev) => {
      if (prev.reviewDocuments === user.require_review_before_send) return prev;
      const next = { ...prev, reviewDocuments: user.require_review_before_send };
      saveAiSettings(next);
      return next;
    });
  }, [user?.require_review_before_send]);

  const updateSetting = (key, value) => {
    const previous = settings[key];
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveAiSettings(next);
      return next;
    });
    toast.success(value ? "AI feature enabled" : "AI feature disabled", { duration: 1800 });

    if (key === "reviewDocuments") {
      api
        .put("/account/settings", { require_review_before_send: value })
        .then(() => {
          setUser?.((prev) => (prev ? { ...prev, require_review_before_send: value } : prev));
        })
        .catch(() => {
          setSettings((prev) => {
            const reverted = { ...prev, reviewDocuments: previous };
            saveAiSettings(reverted);
            return reverted;
          });
          toast.error("Could not save this setting. Please try again.");
        });
    }
  };

  return { settings, updateSetting };
}
