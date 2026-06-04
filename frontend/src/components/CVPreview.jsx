import { motion } from "framer-motion";

const Section = ({ label, children }) => (
  <section className="mt-5">
    <h3 className="text-[10px] font-bold tracking-[0.18em] uppercase text-sprout-mint pb-1 border-b border-sprout-border mb-3">
      {label}
    </h3>
    {children}
  </section>
);

export default function CVPreview({ contact = {}, resume = {}, job, template = "modern" }) {
  const name = (contact.name || "Your Name").trim();
  const contactLine = [contact.email, contact.phone, contact.location, contact.linkedin, contact.website]
    .filter(Boolean).join("  •  ");

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-sprout-surface-2 border border-sprout-border rounded-2xl overflow-hidden"
      data-testid="cv-preview"
    >
      {template === "two_column" ? (
        <div className="bg-sprout-mint text-white px-6 py-5">
          <h2 className="font-display font-black text-2xl tracking-tight">{name}</h2>
          <p className="text-xs opacity-80 mt-1">{contactLine}</p>
        </div>
      ) : template === "classic" ? (
        <div className="px-8 pt-7 text-center">
          <h2 className="font-display font-bold text-3xl tracking-tight text-white" style={{ fontFamily: "Georgia, serif" }}>{name}</h2>
          <p className="text-xs text-sprout-muted mt-1">{contactLine}</p>
          <div className="mt-4 border-t border-sprout-mint/60" />
        </div>
      ) : (
        <div className="px-6 pt-6">
          <h2 className="font-display font-black text-2xl tracking-tight text-sprout-mint">{name}</h2>
          <p className="text-xs text-sprout-muted mt-1">{contactLine}</p>
          {template !== "minimal" && <div className="mt-3 border-t border-sprout-border" />}
        </div>
      )}

      <div className="px-6 pb-6 pt-2">
        {job?.title && (
          <p className="text-xs italic text-sprout-muted mt-2">Tailored for {job.title} @ {job.company}</p>
        )}

        {resume.summary && (
          <Section label="Summary">
            <p className="text-sm text-zinc-200 leading-relaxed">{resume.summary}</p>
          </Section>
        )}

        {resume.skills?.length > 0 && (
          <Section label="Skills">
            <p className="text-sm text-zinc-200 leading-relaxed">{resume.skills.join("  ·  ")}</p>
          </Section>
        )}

        {resume.experience?.length > 0 && (
          <Section label="Experience">
            <ul className="space-y-4">
              {resume.experience.map((e, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold text-white text-[15px]">{e.role}</p>
                    <p className="text-xs text-sprout-muted shrink-0">{e.duration}</p>
                  </div>
                  <p className="text-xs text-sprout-muted">{[e.company, e.location].filter(Boolean).join(" — ")}</p>
                  {e.highlights?.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {e.highlights.map((h, j) => (
                        <li key={j} className="text-sm text-zinc-200 leading-relaxed flex gap-2">
                          <span className="text-sprout-mint">•</span> <span>{h}</span>
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
          <Section label="Education">
            <ul className="space-y-2">
              {resume.education.map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white text-sm">{e.degree}</p>
                    <p className="text-xs text-sprout-muted">{e.school}</p>
                  </div>
                  <p className="text-xs text-sprout-muted shrink-0">{e.year}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </motion.div>
  );
}
