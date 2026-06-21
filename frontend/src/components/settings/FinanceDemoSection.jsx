import { motion } from "framer-motion";
import { Briefcase, Landmark } from "lucide-react";
import { useDemoSettings } from "../../hooks/useDemoSettings";
import { useAppLocale } from "../../context/AppLocaleContext";
import { useDesktopTheme } from "../desktop/DesktopAppShell";

function DemoToggle({ checked, onChange, testId, isDark }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
        checked
          ? "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-[0_0_20px_rgba(16,185,129,0.35)]"
          : isDark ? "bg-zinc-700" : "bg-zinc-300"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

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

  if (variant === "mobile") {
    return (
      <section className="mt-7" data-testid="settings-finance-demo-mobile">
        <h2 className="mb-2 px-1 text-xs uppercase tracking-[0.16em] text-sprout-muted">
          {t("demoSettings.sectionTitle")}
        </h2>
        <p className="mb-3 px-1 text-sm text-sprout-muted">{t("demoSettings.sectionIntro")}</p>
        <div className="overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface">
          <div className="flex items-start gap-3 px-4 py-4">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/15">
              <Landmark className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1 pr-2">
              <p className="text-[15px] font-semibold text-white">{t("demoSettings.financeJobFeed")}</p>
              <p className="mt-1 text-sm leading-snug text-sprout-muted">{t("demoSettings.financeJobFeedDesc")}</p>
            </div>
            <DemoToggle
              checked={settings.financeJobFeed}
              onChange={onToggle}
              testId="finance-demo-toggle"
              isDark
            />
          </div>
        </div>
      </section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="relative mt-10"
      data-testid="settings-finance-demo-desktop"
    >
      <div className="mb-4 max-w-2xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300">
          <Briefcase className="h-3.5 w-3.5" />
          {t("demoSettings.sectionTitle")}
        </div>
        <p className={`mt-3 text-base leading-relaxed ${dark ? "text-zinc-400" : "text-zinc-500"}`}>
          {t("demoSettings.sectionIntro")}
        </p>
      </div>

      <div
        className={`overflow-hidden rounded-[27px] border ${
          dark
            ? "border-zinc-800 bg-zinc-900/95 backdrop-blur-xl"
            : "border-white/80 bg-white/95 shadow-xl shadow-emerald-100/30 backdrop-blur-xl"
        }`}
      >
        <div className={`flex items-center gap-4 px-5 py-5 sm:px-6 sm:py-6 ${dark ? "hover:bg-white/[0.03]" : "hover:bg-emerald-50/40"}`}>
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg">
            <Landmark className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className={`text-base font-semibold ${dark ? "text-white" : "text-zinc-900"}`}>
              {t("demoSettings.financeJobFeed")}
            </h3>
            <p className={`mt-1 text-sm leading-relaxed ${dark ? "text-zinc-400" : "text-zinc-500"}`}>
              {t("demoSettings.financeJobFeedDesc")}
            </p>
          </div>
          <DemoToggle
            checked={settings.financeJobFeed}
            onChange={onToggle}
            testId="finance-demo-toggle"
            isDark={dark}
          />
        </div>
      </div>
    </motion.section>
  );
}
