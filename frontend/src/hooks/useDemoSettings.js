import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_DEMO_SETTINGS,
  DEMO_SETTINGS_CHANGED,
  readDemoSettings,
  saveDemoSettings,
} from "../lib/demoSettings";
import { resetFinanceDemoFeed } from "../lib/financeDemoApi";
import { clearSwipeFeedCache } from "../lib/swipeFeedCache";

export function useDemoSettings() {
  const [settings, setSettings] = useState(DEFAULT_DEMO_SETTINGS);

  useEffect(() => {
    setSettings(readDemoSettings());
    const onChange = () => setSettings(readDemoSettings());
    window.addEventListener(DEMO_SETTINGS_CHANGED, onChange);
    return () => window.removeEventListener(DEMO_SETTINGS_CHANGED, onChange);
  }, []);

  const updateSetting = useCallback((key, value, { messageOn, messageOff } = {}) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveDemoSettings(next);
      if (key === "financeJobFeed") {
        if (value) resetFinanceDemoFeed();
        else clearSwipeFeedCache();
      }
      return next;
    });
    const msg = value ? messageOn : messageOff;
    if (msg) toast.success(msg, { duration: 2200 });
  }, []);

  return { settings, updateSetting };
}
