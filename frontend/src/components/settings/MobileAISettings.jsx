import { FileText, ScanSearch, ScrollText, ShieldCheck } from "lucide-react";
import { useAiSettings } from "../../hooks/useAiSettings";
import FinanceDemoSection from "./FinanceDemoSection";
import ViralToggle from "./ViralToggle";
import { useAppLocale } from "../../context/AppLocaleContext";
import { getAiSettingRows } from "../../lib/appUi";

const MOBILE_ICONS = {
  aiCoverLetter: FileText,
  aiResume: ScrollText,
  reviewDocuments: ShieldCheck,
  findResumeGaps: ScanSearch,
};

export default function MobileAISettings() {
  const { settings, updateSetting } = useAiSettings();
  const { t } = useAppLocale();
  const rows = getAiSettingRows(t);

  return (
    <section className="mt-7" data-testid="settings-ai-mobile">
      <h2 className="mb-1 px-1 text-xs uppercase tracking-[0.16em] text-sprout-muted">{t("aiSettings.title")}</h2>
      <p className="mb-3 px-1 text-sm text-sprout-muted">{t("aiSettings.mobileIntro")}</p>
      <div className="divide-y divide-sprout-border overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface">
        {rows.map((row) => {
          const Icon = MOBILE_ICONS[row.id];
          return (
            <div key={row.id} className="flex items-start gap-3 px-4 py-4" data-testid={`ai-setting-row-${row.id}`}>
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-sprout-border bg-sprout-surface-2 text-zinc-300">
                <Icon className="h-4 w-4" strokeWidth={1.9} />
              </div>
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-[15px] font-semibold text-white">{row.title}</p>
                <p className="mt-1 text-sm leading-snug text-sprout-muted">{row.description}</p>
              </div>
              <ViralToggle
                checked={settings[row.id]}
                onChange={(value) => updateSetting(row.id, value)}
                testId={`ai-setting-toggle-${row.id}`}
                offClassName="bg-zinc-600"
              />
            </div>
          );
        })}
      </div>
      <FinanceDemoSection variant="mobile" />
    </section>
  );
}
