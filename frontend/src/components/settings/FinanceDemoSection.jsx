import { Landmark } from "lucide-react";
import { useDemoSettings } from "../../hooks/useDemoSettings";
import { useAppLocale } from "../../context/AppLocaleContext";
import { useDesktopTheme } from "../desktop/DesktopAppShell";
import ViralToggle from "./ViralToggle";

export default function FinanceDemoSection({ variant = "desktop" }) {
  const { settings, updateSetting } = useDemoSettings();
  const { t } = useAppLocale();
  const { isDark } = useDesktopTheme();
  const dark = variant === "desktop" ? isDark : true;

  const onToggle = (value) => {
    updateSetting("financeJobFeed", value, {
      messageOn: t("demoSettings.financeJobFeedOn"),
      messageOff: t("demoSettings.financeJobFeedOff"),
    });
  };

  const row = (
    <>
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${
          dark ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-zinc-50 text-zinc-600"
        }`}
      >
        <Landmark className="h-4 w-4" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className={`text-[15px] font-semibold ${dark ? "text-white" : "text-zinc-900"}`}>
          {t("demoSettings.financeJobFeed")}
        </h3>
        <p className={`mt-1 text-sm leading-relaxed ${dark ? "text-zinc-500" : "text-zinc-500"}`}>
          {t("demoSettings.financeJobFeedDesc")}
        </p>
      </div>
      <ViralToggle
        checked={settings.financeJobFeed}
        onChange={onToggle}
        testId="finance-demo-toggle"
        offClassName={dark ? "bg-zinc-700" : "bg-zinc-200"}
      />
    </>
  );

  if (variant === "mobile") {
    return (
      <section className="mt-7" data-testid="settings-finance-demo-mobile">
        <h2 className="mb-1 px-1 text-xs uppercase tracking-[0.16em] text-sprout-muted">
          {t("demoSettings.sectionTitle")}
        </h2>
        <p className="mb-3 px-1 text-sm text-sprout-muted">{t("demoSettings.sectionIntro")}</p>
        <div className="overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface">
          <div className="flex items-start gap-3 px-4 py-4">{row}</div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10" data-testid="settings-finance-demo-desktop">
      <div className="mb-4">
        <h2 className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${dark ? "text-zinc-500" : "text-zinc-400"}`}>
          {t("demoSettings.sectionTitle")}
        </h2>
        <p className={`mt-2 text-sm leading-relaxed ${dark ? "text-zinc-500" : "text-zinc-500"}`}>
          {t("demoSettings.sectionIntro")}
        </p>
      </div>
      <div
        className={`overflow-hidden rounded-2xl border ${
          dark ? "border-zinc-800 bg-zinc-950" : "border-zinc-200 bg-white"
        }`}
      >
        <div className={`flex items-center gap-4 px-5 py-5 sm:px-6 ${dark ? "hover:bg-white/[0.02]" : "hover:bg-zinc-50/80"}`}>
          {row}
        </div>
      </div>
    </section>
  );
}
