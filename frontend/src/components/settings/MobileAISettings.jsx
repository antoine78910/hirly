import { motion } from "framer-motion";
import { FileText, ScanSearch, ScrollText, ShieldCheck, FlaskConical } from "lucide-react";
import { useAiSettings } from "../../hooks/useAiSettings";

const MOBILE_ROWS = [
  {
    id: "aiCoverLetter",
    icon: FileText,
    title: "AI Cover Letter",
    description: "Generate a tailored cover letter for each job application",
  },
  {
    id: "aiResume",
    icon: ScrollText,
    title: "AI Resume",
    description: "Generate a tailored resume for each job application",
  },
  {
    id: "reviewDocuments",
    icon: ShieldCheck,
    title: "Review Documents",
    description: "Review and approve AI-generated documents before they are used in applications",
  },
  {
    id: "findResumeGaps",
    icon: ScanSearch,
    title: "Find Gaps in Resume",
    description: "Answer questions addressing job requirements to improve AI resume and cover letter generation",
  },
];

const DEMO_ROW = {
  id: "demoAccount",
  icon: FlaskConical,
  title: "Demo account",
  description: "Apply locally without sending to employers. Unlimited swipes with a 600-credit display cycle.",
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

  return (
    <section className="mt-7" data-testid="settings-ai-mobile">
      <h2 className="mb-2 px-1 text-xs uppercase tracking-[0.16em] text-sprout-muted">AI Application Settings</h2>
      <p className="mb-3 px-1 text-sm text-sprout-muted">Choose how AI assists with your job applications.</p>
      <div className="overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface divide-y divide-sprout-border">
        {MOBILE_ROWS.map((row) => {
          const Icon = row.icon;
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

      <h2 className="mb-2 mt-7 px-1 text-xs uppercase tracking-[0.16em] text-sprout-muted">Demo</h2>
      <div className="overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface">
        <div className="flex items-start gap-3 px-4 py-4" data-testid="ai-setting-row-demoAccount">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-500/15">
            <FlaskConical className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0 flex-1 pr-2">
            <p className="text-[15px] font-semibold text-white">{DEMO_ROW.title}</p>
            <p className="mt-1 text-sm leading-snug text-sprout-muted">{DEMO_ROW.description}</p>
          </div>
          <MobileToggle
            checked={settings.demoAccount}
            onChange={(value) => updateSetting("demoAccount", value)}
            testId="ai-setting-toggle-demoAccount"
          />
        </div>
      </div>
    </section>
  );
}
