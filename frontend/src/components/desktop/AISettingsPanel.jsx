import { motion } from "framer-motion";
import {
  FileText,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { useAiSettings } from "../../hooks/useAiSettings";
import { useDesktopTheme } from "./DesktopAppShell";
import DemoAccountBadge from "../settings/DemoAccountBadge";
import FinanceDemoSection from "../settings/FinanceDemoSection";
import LanguageSettingSection from "../settings/LanguageSettingSection";
import { useAppLocale } from "../../context/AppLocaleContext";
import { getAiSettingRows } from "../../lib/appUi";

const AI_FEATURE_IDS = ["aiCoverLetter", "aiResume", "reviewDocuments", "findResumeGaps"];

const AI_ROW_META = {
  aiCoverLetter: { icon: FileText, accent: "from-violet-500 to-indigo-500" },
  aiResume: { icon: ScrollText, accent: "from-blue-500 to-violet-500" },
  reviewDocuments: { icon: ShieldCheck, accent: "from-emerald-500 to-teal-500" },
  findResumeGaps: { icon: ScanSearch, accent: "from-fuchsia-500 to-violet-500" },
};

function ViralToggle({ checked, onChange, testId }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 ${
        checked
          ? "bg-gradient-to-r from-violet-500 to-blue-500 shadow-[0_0_20px_rgba(139,92,246,0.45)]"
          : "bg-zinc-300 dark:bg-zinc-700"
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

function SettingRow({ row, checked, onChange, index, isDark }) {
  const Icon = row.icon;
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.35 }}
      className={`group flex items-center gap-4 px-5 py-5 transition-colors sm:px-6 sm:py-6 ${
        isDark ? "hover:bg-white/[0.03]" : "hover:bg-violet-50/50"
      }`}
      data-testid={`ai-setting-row-${row.id}`}
    >
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${row.accent} shadow-lg`}>
        <Icon className="h-5 w-5 text-white" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className={`text-base font-semibold ${isDark ? "text-white" : "text-zinc-900"}`}>
            {row.title}
          </h3>
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-500">
            {row.stat}
          </span>
        </div>
        <p className={`mt-1 text-sm leading-relaxed ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
          {row.description}
        </p>
      </div>
      <ViralToggle
        checked={checked}
        onChange={onChange}
        testId={`ai-setting-toggle-${row.id}`}
      />
    </motion.div>
  );
}

export default function AISettingsPanel() {
  const { settings, updateSetting } = useAiSettings();
  const { isDark } = useDesktopTheme();
  const { t } = useAppLocale();
  const settingRows = getAiSettingRows(t).map((row) => ({
    ...row,
    ...AI_ROW_META[row.id],
  }));

  const activeCount = AI_FEATURE_IDS.filter((id) => settings[id]).length;

  return (
    <div className="relative mx-auto max-w-5xl px-6 py-10 lg:px-10 lg:py-14">
      <div className="relative mb-6 max-w-3xl space-y-4">
        <DemoAccountBadge />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 top-32 h-64 w-64 rounded-full bg-blue-500/15 blur-3xl"
      />

      <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-14">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-600 dark:text-violet-300">
            <Sparkles className="h-3.5 w-3.5" />
            {t("aiSettings.poweredBy", { brand: BRAND.NAME })}
          </div>

          <h1 className="mt-5 font-display text-4xl font-black tracking-tight lg:text-5xl">
            <span className="bg-gradient-to-r from-violet-600 via-blue-600 to-violet-500 bg-clip-text text-transparent">
              {t("aiSettings.title")}
            </span>
          </h1>

          <p className={`mt-3 text-lg font-semibold ${isDark ? "text-white" : "text-zinc-900"}`}>
            {t("aiSettings.subtitle")}
          </p>
          <p className={`mt-2 max-w-md text-base leading-relaxed ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
            {t("aiSettings.description")}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {[
              { icon: Zap, label: t("aiSettings.featuresOn", { n: activeCount }) },
              { icon: Wand2, label: t("aiSettings.swipeReady") },
            ].map(({ icon: Icon, label }) => (
              <span
                key={label}
                className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium ${
                  isDark
                    ? "border-zinc-800 bg-zinc-900/80 text-zinc-200"
                    : "border-zinc-200 bg-white text-zinc-700 shadow-sm"
                }`}
              >
                <Icon className="h-4 w-4 text-violet-500" />
                {label}
              </span>
            ))}
          </div>

          <div
            className={`mt-10 hidden rounded-3xl border p-5 lg:block ${
              isDark ? "border-zinc-800 bg-zinc-900/50" : "border-zinc-200 bg-white shadow-lg shadow-violet-100/50"
            }`}
          >
            <div className="flex items-center gap-3">
              <Logo size={32} />
              <div>
                <p className={`text-sm font-bold ${isDark ? "text-white" : "text-zinc-900"}`}>
                  {t("aiSettings.promoTitle")}
                </p>
                <p className={`text-xs ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>
                  {t("aiSettings.promoBody")}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="relative"
        >
          <div
            aria-hidden
            className="absolute -inset-px rounded-[28px] bg-gradient-to-br from-violet-500 via-blue-500 to-fuchsia-500 opacity-60 blur-sm"
          />
          <div
            className={`relative overflow-hidden rounded-[27px] border ${
              isDark
                ? "border-zinc-800 bg-zinc-900/95 backdrop-blur-xl"
                : "border-white/80 bg-white/95 shadow-2xl shadow-violet-200/40 backdrop-blur-xl"
            }`}
            data-testid="ai-settings-card"
          >
            <div className="border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800 sm:px-6">
              <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
                {t("aiSettings.automation")}
              </p>
            </div>

            <div className={`divide-y ${isDark ? "divide-zinc-800" : "divide-zinc-100"}`}>
              {settingRows.map((row, index) => (
                <SettingRow
                  key={row.id}
                  row={row}
                  index={index}
                  isDark={isDark}
                  checked={settings[row.id]}
                  onChange={(value) => updateSetting(row.id, value)}
                />
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      <FinanceDemoSection variant="desktop" />
      <LanguageSettingSection variant="desktop" />
    </div>
  );
}
