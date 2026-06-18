import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_AI_SETTINGS,
  readAiSettings,
  saveAiSettings,
} from "../lib/aiSettings";

export function useAiSettings() {
  const [settings, setSettings] = useState(DEFAULT_AI_SETTINGS);

  useEffect(() => {
    setSettings(readAiSettings());
  }, []);

  const updateSetting = (key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveAiSettings(next);
      return next;
    });
    if (key === "demoAccount") {
      toast.success(
        value ? "Demo account enabled — applies stay local" : "Demo account disabled",
        { duration: 2200 },
      );
      return;
    }
    toast.success(value ? "AI feature enabled" : "AI feature disabled", { duration: 1800 });
  };

  return { settings, updateSetting };
}
