import {
  FileText,
  ScanSearch,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { useAiSettings } from "../../hooks/useAiSettings";
import { useDesktopTheme } from "./DesktopAppShell";
import FinanceDemoSection from "../settings/FinanceDemoSection";
import ViralToggle from "../settings/ViralToggle";
import { useAppLocale } from "../../context/AppLocaleContext";
import { getAiSettingRows } from "../../lib/appUi";

const AI_ROW_ICONS = {
  aiCoverLetter: FileText,
  aiResume: ScrollText,
  reviewDocuments: ShieldCheck,
  findResumeGaps: ScanSearch,
};

function SettingRow({ row, checked, onChange, isDark }) {
  const Icon = row.icon;
  return (
    <div
      className={`flex items-center gap-4 px-5 py-5 sm:px-6 sm:py-5 ${
        isDark ? "hover:bg-white/[0.02]" : "hover:bg-zinc-50/80"
      }`}
      data-testid={`ai-setting-row-${row.id}`}
    >
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${
          isDark ? "border-zinc-800 bg-zinc-900 text-zinc-300" : "border-zinc-200 bg-zinc-50 text-zinc-600"
        }`}
      >
        <Icon className="h-4 w-4" strokeWidth={1.9} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className={`text-[15px] font-semibold ${isDark ? "text-white" : "text-zinc-900"}`}>
          {row.title}
        </h3>
        <p className={`mt-1 text-sm leading-relaxed ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>
          {row.description}
        </p>
      </div>
      <ViralToggle
        checked={checked}
        onChange={onChange}
        testId={`ai-setting-toggle-${row.id}`}
        offClassName={isDark ? "bg-zinc-700" : "bg-zinc-200"}
      />
    </div>
  );
}

export default function AISettingsPanel() {
  const { settings, updateSetting } = useAiSettings();
  const { isDark } = useDesktopTheme();
  const { t } = useAppLocale();
  const settingRows = getAiSettingRows(t).map((row) => ({
    ...row,
    icon: AI_ROW_ICONS[row.id],
  }));

  const activeCount = settingRows.filter((row) => settings[row.id]).length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10 lg:py-14">
      <div className="mb-8 space-y-5">
        <div>
          <h1 className={`font-display text-3xl font-bold tracking-tight lg:text-4xl ${isDark ? "text-white" : "text-zinc-900"}`}>
            {t("aiSettings.title")}
          </h1>
          <p className={`mt-2 text-base ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
            {t("aiSettings.subtitle")}
          </p>
          <p className={`mt-1 max-w-xl text-sm leading-relaxed ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
            {t("aiSettings.description")}
          </p>
          <p className={`mt-4 text-xs font-medium uppercase tracking-[0.14em] ${isDark ? "text-zinc-600" : "text-zinc-400"}`}>
            {t("aiSettings.featuresOn", { n: activeCount })}
          </p>
        </div>
      </div>

      <div
        className={`overflow-hidden rounded-2xl border ${
          isDark ? "border-zinc-800 bg-zinc-950" : "border-zinc-200 bg-white"
        }`}
        data-testid="ai-settings-card"
      >
        <div className={`border-b px-5 py-3.5 sm:px-6 ${isDark ? "border-zinc-800" : "border-zinc-100"}`}>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
            {t("aiSettings.automation")}
          </p>
        </div>
        <div className={`divide-y ${isDark ? "divide-zinc-800" : "divide-zinc-100"}`}>
          {settingRows.map((row) => (
            <SettingRow
              key={row.id}
              row={row}
              isDark={isDark}
              checked={settings[row.id]}
              onChange={(value) => updateSetting(row.id, value)}
            />
          ))}
        </div>
      </div>

      <FinanceDemoSection variant="desktop" />
    </div>
  );
}
