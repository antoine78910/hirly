import { motion } from "framer-motion";
import { normalizeCoverLetter } from "../lib/applicationDocuments";

const PREVIEW_THEMES = {
  dark: {
    container: "bg-sprout-surface-2 border-sprout-border",
    title: "text-sprout-mint",
    muted: "text-sprout-muted",
    body: "text-zinc-200",
    company: "text-zinc-100",
    name: "text-white",
    divider: "border-sprout-border",
  },
  light: {
    container: "bg-white border-zinc-200 shadow-sm",
    title: "text-linkedin",
    muted: "text-zinc-500",
    body: "text-zinc-700",
    company: "text-zinc-900",
    name: "text-zinc-900",
    divider: "border-zinc-200",
  },
};

export default function CoverLetterPreview({ contact = {}, letter = {}, job, theme = "dark" }) {
  const palette = PREVIEW_THEMES[theme] || PREVIEW_THEMES.dark;
  const normalized = normalizeCoverLetter(letter);
  const name = (contact.name || "Your Name").trim();
  const signatureName = normalized.signature_name || name;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`border rounded-2xl overflow-hidden ${palette.container}`}
      data-testid="cover-letter-preview"
    >
      <div className="px-6 pt-6">
        <h2 className={`font-display font-black text-2xl tracking-tight ${palette.title}`}>{name}</h2>
        <p className={`text-xs mt-1 ${palette.muted}`}>
          {[contact.email, contact.phone, contact.location].filter(Boolean).join("   •   ")}
        </p>
        <div className={`mt-3 border-t ${palette.divider}`} />
      </div>
      <div className={`px-6 py-6 text-sm leading-relaxed ${palette.body}`}>
        <p className={`text-xs ${palette.muted}`}>{today}</p>
        {job?.company && (
          <p className={`mt-3 ${palette.company}`}>
            Hiring Team — {job.company}
            <br />
            <span className={`text-xs ${palette.muted}`}>{job.location}</span>
          </p>
        )}
        <p className="mt-5">{normalized.greeting || `Dear ${job?.company || "Hiring"} team,`}</p>
        <div className="mt-3 space-y-3">
          {(normalized.paragraphs || []).map((p, i) => (<p key={i}>{p}</p>))}
        </div>
        <p className="mt-5">{normalized.sign_off}</p>
        <p className={`mt-3 font-semibold ${palette.name}`}>{signatureName}</p>
      </div>
    </motion.div>
  );
}
