import { motion } from "framer-motion";
import { FileText, ScanSearch, ScrollText, ShieldCheck } from "lucide-react";
import { useAiSettings } from "../../hooks/useAiSettings";
import { useAppLocale } from "../../context/AppLocaleContext";
import { getAiSettingRows } from "../../lib/appUi";

const MOBILE_ICONS = {
  aiCoverLetter: FileText,
  aiResume: ScrollText,
  reviewDocuments: ShieldCheck,
  findResumeGaps: ScanSearch,
};

function MobileToggle({ checked, onChange, testId }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        checked ? "gradient-linkedin" : "bg-zinc-600"
      }`}
    >
      <motion.span
        layout
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow ${checked ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

export default function MobileAISettings() {
  const { settings, updateSetting } = useAiSettings();
  const { t } = useAppLocale();
  const rows = getAiSettingRows(t);

  return (
    <section className="mt-7" data-testid="settings-ai-mobile">
      <h2 className="mb-2 px-1 text-xs uppercase tracking-[0.16em] text-sprout-muted">{t("aiSettings.subtitle")}</h2>
      <p className="mb-3 px-1 text-sm text-sprout-muted">{t("aiSettings.mobileIntro")}</p>
      <div className="overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface divide-y divide-sprout-border">
        {rows.map((row) => {
          const Icon = MOBILE_ICONS[row.id];
          return (
            <div key={row.id} className="flex items-start gap-3 px-4 py-4" data-testid={`ai-setting-row-${row.id}`}>
              <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sprout-mint-soft">
                <Icon className="h-4 w-4 text-sprout-mint" />
              </div>
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-[15px] font-semibold text-white">{row.title}</p>
                <p className="mt-1 text-sm leading-snug text-sprout-muted">{row.description}</p>
              </div>
              <MobileToggle
                checked={settings[row.id]}
                onChange={(value) => updateSetting(row.id, value)}
                testId={`ai-setting-toggle-${row.id}`}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
