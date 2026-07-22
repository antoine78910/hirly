import { useEffect, useState } from "react";
import {
  Bell,
  Briefcase,
  Calendar,
  Mail,
  Send,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import Sheet from "../Sheet";
import ViralToggle from "./ViralToggle";
import { useAppLocale } from "../../context/AppLocaleContext";
import { BRAND } from "../../lib/brand";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_TOGGLES,
  readNotificationSettings,
  saveNotificationSettings,
} from "../../lib/notificationSettings";

const ROW_META = {
  verificationRequired: { icon: ShieldCheck },
  applicationSubmitted: { icon: Send },
  applicationStatus: { icon: Briefcase },
  companyReply: { icon: Mail },
  interviewInvite: { icon: Calendar },
  rejectionUpdate: { icon: XCircle },
  offerUpdate: { icon: Sparkles },
};

export default function NotificationSettingsSheet({ open, onClose }) {
  const { t } = useAppLocale();
  const [settings, setSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);

  useEffect(() => {
    if (!open) return undefined;
    setSettings(readNotificationSettings());
    return undefined;
  }, [open]);

  const updateSetting = (key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveNotificationSettings(next);
      return next;
    });
  };

  return (
    <Sheet
      open={open}
      title={t("settings.notifications")}
      onClose={onClose}
      testId="notification-settings-sheet"
    >
      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-sprout-border bg-sprout-surface-2/60 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
          <Bell className="h-4 w-4" />
        </span>
        <p className="text-sm leading-relaxed text-sprout-muted">
          {t("notificationSettings.intro", { brand: BRAND.NAME, email: BRAND.NOTIFICATIONS_EMAIL })}
        </p>
      </div>

      <div className="divide-y divide-sprout-border overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface">
        {NOTIFICATION_TOGGLES.map((key) => {
          const Icon = ROW_META[key]?.icon || Bell;
          return (
            <div key={key} className="px-4 py-4" data-testid={`notification-row-${key}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-sprout-border bg-sprout-surface-2 text-zinc-300">
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                </div>
                <div className="min-w-0 flex-1 pr-2">
                  <p className="text-[15px] font-semibold text-white">
                    {t(`notificationSettings.${key}.title`)}
                  </p>
                  <p className="mt-1 text-sm leading-snug text-sprout-muted">
                    {t(`notificationSettings.${key}.description`)}
                  </p>
                </div>
                <ViralToggle
                  checked={settings[key]}
                  onChange={(value) => updateSetting(key, value)}
                  testId={`notification-toggle-${key}`}
                  offClassName="bg-zinc-600"
                />
              </div>
              <div
                className="mt-3 rounded-xl border border-sprout-border bg-sprout-bg px-3 py-2.5"
                aria-hidden="true"
              >
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-violet-500/15 text-violet-300">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-white">
                      {t(`notificationSettings.${key}.exampleTitle`)}
                    </p>
                    <p className="truncate text-[10px] text-sprout-dim">
                      {t("notificationSettings.exampleSender", {
                        brand: BRAND.NAME,
                        email: BRAND.NOTIFICATIONS_EMAIL,
                      })}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-sprout-dim">
                    {t("notificationSettings.exampleTime")}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-sprout-muted">
                  {t(`notificationSettings.${key}.exampleBody`)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
