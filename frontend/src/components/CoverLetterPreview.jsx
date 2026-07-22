import { motion } from "framer-motion";
import { isFrenchFormalCoverLetter, normalizeCoverLetter } from "../lib/applicationDocuments";

const PREVIEW_THEMES = {
  dark: {
    container: "bg-sprout-surface-2 border-sprout-border",
    title: "text-sprout-mint",
    muted: "text-sprout-muted",
    body: "text-zinc-200",
    company: "text-zinc-100",
    name: "text-white",
    divider: "border-sprout-border",
    subject: "text-white",
  },
  light: {
    container: "bg-white border-zinc-200 shadow-sm",
    title: "text-linkedin",
    muted: "text-zinc-500",
    body: "text-zinc-700",
    company: "text-zinc-900",
    name: "text-zinc-900",
    divider: "border-zinc-200",
    subject: "text-zinc-900",
  },
};

export default function CoverLetterPreview({ contact = {}, letter = {}, job, theme = "dark" }) {
  const palette = PREVIEW_THEMES[theme] || PREVIEW_THEMES.dark;
  const normalized = normalizeCoverLetter(letter);
  const french = isFrenchFormalCoverLetter(normalized);
  const name = (contact.name || normalized.sender_name || "Your Name").trim();
  const signatureName = normalized.signature_name || name;
  const company = normalized.recipient_company || job?.company || "";
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  if (french) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`overflow-hidden rounded-2xl border ${palette.container}`}
        data-testid="cover-letter-preview"
      >
        <div className={`px-6 py-6 text-sm leading-relaxed ${palette.body}`}>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-1">
              <p className={`font-semibold ${palette.name}`}>{normalized.sender_name || name}</p>
              {normalized.sender_address || contact.location ? (
                <p className={palette.muted}>{normalized.sender_address || contact.location}</p>
              ) : null}
              {normalized.sender_phone || contact.phone ? (
                <p className={palette.muted}>{normalized.sender_phone || contact.phone}</p>
              ) : null}
              {normalized.sender_email || contact.email ? (
                <p className={palette.muted}>{normalized.sender_email || contact.email}</p>
              ) : null}
            </div>
            <div className="space-y-1 md:text-right">
              {normalized.recipient_attention ? (
                <p className={palette.company}>{normalized.recipient_attention}</p>
              ) : null}
              {company ? <p className={`font-semibold ${palette.company}`}>{company}</p> : null}
              {normalized.recipient_address || job?.location ? (
                <p className={palette.muted}>{normalized.recipient_address || job?.location}</p>
              ) : null}
            </div>
          </div>

          <p className={`mt-6 ${palette.muted}`}>
            {normalized.date_line || `À ${contact.location || "France"}, le ${today}`}
          </p>
          <p className={`mt-4 font-display text-base font-bold ${palette.subject}`}>
            Objet :{" "}
            {normalized.subject ||
              `Candidature pour le poste de ${job?.title || "ce poste"}${company ? ` - ${company}` : ""}`}
          </p>
          {normalized.greeting ? <p className="mt-5">{normalized.greeting}</p> : null}
          <div className="mt-3 space-y-3">
            {(normalized.paragraphs || []).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {normalized.sign_off ? <p className="mt-5">{normalized.sign_off}</p> : null}
          {signatureName ? (
            <p className={`mt-3 font-semibold ${palette.name}`}>{signatureName}</p>
          ) : null}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`overflow-hidden rounded-2xl border ${palette.container}`}
      data-testid="cover-letter-preview"
    >
      <div className="px-6 pt-6">
        <h2 className={`font-display text-2xl font-black tracking-tight ${palette.title}`}>
          {name}
        </h2>
        <p className={`mt-1 text-xs ${palette.muted}`}>
          {[contact.email, contact.phone, contact.location].filter(Boolean).join("   •   ")}
        </p>
        <div className={`mt-3 border-t ${palette.divider}`} />
      </div>
      <div className={`px-6 py-6 text-sm leading-relaxed ${palette.body}`}>
        <p className={`text-xs ${palette.muted}`}>{today}</p>
        {company ? (
          <p className={`mt-3 ${palette.company}`}>
            Hiring Team — {company}
            <br />
            <span className={`text-xs ${palette.muted}`}>{job?.location}</span>
          </p>
        ) : null}
        {normalized.greeting || !normalized.cover_letter_edited ? (
          <p className="mt-5">{normalized.greeting || `Dear ${company || "Hiring"} team,`}</p>
        ) : null}
        <div className="mt-3 space-y-3">
          {(normalized.paragraphs || []).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {normalized.sign_off ? <p className="mt-5">{normalized.sign_off}</p> : null}
        {signatureName ? (
          <p className={`mt-3 font-semibold ${palette.name}`}>{signatureName}</p>
        ) : null}
      </div>
    </motion.div>
  );
}
