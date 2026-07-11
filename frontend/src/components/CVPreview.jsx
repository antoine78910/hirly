import { motion } from "framer-motion";

const PREVIEW_THEMES = {
  dark: {
    container: "bg-sprout-surface-2 border-sprout-border",
    sectionLabel: "text-sprout-mint border-sprout-border",
    title: "text-sprout-mint",
    titleClassic: "text-white",
    body: "text-zinc-200",
    muted: "text-sprout-muted",
    role: "text-white",
    divider: "border-sprout-border",
    dividerClassic: "border-sprout-mint/60",
    bullet: "text-sprout-mint",
    headerBand: "bg-sprout-mint text-white",
  },
  light: {
    container: "bg-white border-zinc-200 shadow-sm",
    sectionLabel: "text-linkedin border-zinc-200",
    title: "text-linkedin",
    titleClassic: "text-zinc-900",
    body: "text-zinc-700",
    muted: "text-zinc-500",
    role: "text-zinc-900",
    divider: "border-zinc-200",
    dividerClassic: "border-linkedin/40",
    bullet: "text-linkedin",
    headerBand: "bg-linkedin text-white",
  },
};

const Section = ({ label, children, theme }) => (
  <section className="mt-5">
    <h3 className={`text-[10px] font-bold tracking-[0.18em] uppercase pb-1 border-b mb-3 ${theme.sectionLabel}`}>
      {label}
    </h3>
    {children}
  </section>
);

export default function CVPreview({ contact = {}, resume = {}, job, template = "modern", theme = "dark" }) {
  const palette = PREVIEW_THEMES[theme] || PREVIEW_THEMES.dark;
  const name = (contact.name || "Your Name").trim();
  const contactLine = [contact.email, contact.phone, contact.location, contact.linkedin, contact.website]
    .filter(Boolean).join("  •  ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`border rounded-2xl overflow-hidden ${palette.container}`}
      data-testid="cv-preview"
    >
      {template === "two_column" ? (
        <div className={`px-6 py-5 ${palette.headerBand}`}>
          <h2 className="font-display font-black text-2xl tracking-tight">{name}</h2>
          <p className="text-xs opacity-80 mt-1">{contactLine}</p>
        </div>
      ) : template === "classic" ? (
        <div className="px-8 pt-7 text-center">
          <h2 className={`font-display font-bold text-3xl tracking-tight ${palette.titleClassic}`} style={{ fontFamily: "Georgia, serif" }}>{name}</h2>
          <p className={`text-xs mt-1 ${palette.muted}`}>{contactLine}</p>
          <div className={`mt-4 border-t ${palette.dividerClassic}`} />
        </div>
      ) : (
        <div className="px-6 pt-6">
          <h2 className={`font-display font-black text-2xl tracking-tight ${palette.title}`}>{name}</h2>
          <p className={`text-xs mt-1 ${palette.muted}`}>{contactLine}</p>
          {template !== "minimal" && <div className={`mt-3 border-t ${palette.divider}`} />}
        </div>
      )}

      <div className="px-6 pb-6 pt-2">
        {job?.title && (
          <p className={`text-xs italic mt-2 ${palette.muted}`}>Tailored for {job.title} @ {job.company}</p>
        )}

        {resume.summary && (
          <Section label="Summary" theme={palette}>
            <p className={`text-sm leading-relaxed ${palette.body}`}>{resume.summary}</p>
          </Section>
        )}

        {resume.skills?.length > 0 && (
          <Section label="Skills" theme={palette}>
            <p className={`text-sm leading-relaxed ${palette.body}`}>{resume.skills.join("  ·  ")}</p>
          </Section>
        )}

        {resume.highlights?.length > 0 && (
          <Section label={resume.experience?.length ? "Key highlights" : "Highlights"} theme={palette}>
            <ul className="space-y-1.5">
              {resume.highlights.map((item, index) => (
                <li key={index} className={`text-sm leading-relaxed flex gap-2 ${palette.body}`}>
                  <span className={palette.bullet}>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {resume.experience?.length > 0 && (
          <Section label="Experience" theme={palette}>
            <ul className="space-y-4">
              {resume.experience.map((e, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={`font-semibold text-[15px] ${palette.role}`}>{e.role}</p>
                    <p className={`text-xs shrink-0 ${palette.muted}`}>{e.duration}</p>
                  </div>
                  <p className={`text-xs ${palette.muted}`}>{[e.company, e.location].filter(Boolean).join(" — ")}</p>
                  {e.highlights?.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {e.highlights.map((h, j) => (
                        <li key={j} className={`text-sm leading-relaxed flex gap-2 ${palette.body}`}>
                          <span className={palette.bullet}>•</span> <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {resume.education?.length > 0 && (
          <Section label="Education" theme={palette}>
            <ul className="space-y-2">
              {resume.education.map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <div>
                    <p className={`font-semibold text-sm ${palette.role}`}>{e.degree}</p>
                    <p className={`text-xs ${palette.muted}`}>{e.school}</p>
                  </div>
                  <p className={`text-xs shrink-0 ${palette.muted}`}>{e.year}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </motion.div>
  );
}
