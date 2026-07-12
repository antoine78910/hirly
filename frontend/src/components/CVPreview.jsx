import { motion } from "framer-motion";
import {
  PRO_CV_COLORS,
  contactInitials,
  parseLanguageEntry,
  resolveCvDisplayTemplate,
  socialLinksFromContact,
  PROFESSIONAL_CV_TEMPLATE,
} from "../lib/cvTemplate";

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

const Section = ({ label, children, theme, accent = false }) => (
  <section className="mt-4 first:mt-0">
    <h3
      className={`pb-1 text-[10px] font-bold uppercase tracking-[0.14em] border-b mb-2.5 ${
        accent ? "text-[#16467A] border-[#16467A]" : theme.sectionLabel
      }`}
    >
      {label}
    </h3>
    {children}
  </section>
);

function ProfessionalCVPreview({ contact, resume, job, theme }) {
  const name = (contact.name || "Your Name").trim();
  const initials = contactInitials(name);
  const socialLinks = socialLinksFromContact(contact);
  const languages = (resume.languages || []).map(parseLanguageEntry);

  return (
    <div className="overflow-hidden bg-white text-zinc-900" data-testid="cv-preview">
      <div className="relative bg-[#16467A] pb-10 pt-0">
        <div className="h-5 w-full bg-[#16467A]" />
        <div
          className="mx-auto h-0 w-0 border-x-[140px] border-x-transparent border-t-[52px] border-t-[#16467A]"
          aria-hidden="true"
        />
        <div className="absolute left-1/2 top-5 flex h-[72px] w-[72px] -translate-x-1/2 items-center justify-center rounded-full border-4 border-white bg-zinc-200 text-lg font-bold text-zinc-600 shadow-sm">
          {initials}
        </div>
      </div>

      <div className="relative px-6 pb-6">
        <div className="flex items-start justify-between gap-4 -mt-1">
          <h2 className="font-display text-[1.65rem] font-black leading-tight tracking-tight text-zinc-900">
            {name}
          </h2>
          <div className="max-w-[45%] shrink-0 text-right text-[11px] leading-relaxed text-zinc-500">
            {contact.email ? <p>{contact.email}</p> : null}
            {contact.phone ? <p>{contact.phone}</p> : null}
            {contact.location ? <p>{contact.location}</p> : null}
          </div>
        </div>

        {job?.title ? (
          <p className="mt-2 text-xs italic text-zinc-500">
            Tailored for {job.title} @ {job.company}
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-[32%_1fr] gap-6">
          <aside className="space-y-1 text-[13px] leading-relaxed text-zinc-700">
            <Section label="Contact" accent>
              {contact.location ? (
                <div className="mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#16467A]">Address</p>
                  <p>{contact.location}</p>
                </div>
              ) : null}
              {contact.phone ? (
                <div className="mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#16467A]">Phone</p>
                  <p>{contact.phone}</p>
                </div>
              ) : null}
              {contact.email ? (
                <div className="mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#16467A]">Email</p>
                  <p className="break-all">{contact.email}</p>
                </div>
              ) : null}
            </Section>

            {socialLinks.length ? (
              <Section label="Social links" accent>
                <ul className="space-y-1.5">
                  {socialLinks.map((link) => (
                    <li key={link.label} className="flex items-start gap-2">
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 bg-[#16467A]" />
                      <span className="break-all">{link.value}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {resume.skills?.length ? (
              <Section label="Skills" accent>
                <ul className="space-y-1.5">
                  {resume.skills.map((skill) => (
                    <li key={skill} className="flex items-start gap-2">
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 bg-[#16467A]" />
                      <span>{skill}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {languages.length ? (
              <Section label="Languages" accent>
                <ul className="space-y-1">
                  {languages.map((lang) => (
                    <li key={`${lang.name}-${lang.level}`} className="flex justify-between gap-2">
                      <span>{lang.name}</span>
                      {lang.level ? <span className="text-zinc-500">{lang.level}</span> : null}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </aside>

          <div className="text-[13px] leading-relaxed text-zinc-700">
            {resume.summary ? (
              <Section label="Profile" accent>
                <p>{resume.summary}</p>
              </Section>
            ) : null}

            {resume.education?.length ? (
              <Section label="Education" accent>
                <ul className="space-y-3">
                  {resume.education.map((entry, index) => (
                    <li key={`${entry.degree}-${index}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-semibold text-zinc-900">{entry.degree}</p>
                        <p className="shrink-0 text-xs text-zinc-500">{entry.year}</p>
                      </div>
                      <p className="text-xs text-zinc-500">{entry.school}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {resume.experience?.length ? (
              <Section label="Employment history" accent>
                <ul className="space-y-4">
                  {resume.experience.map((entry, index) => (
                    <li key={`${entry.role}-${index}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-semibold text-zinc-900">{entry.role}</p>
                        <p className="shrink-0 text-xs text-zinc-500">{entry.duration}</p>
                      </div>
                      <p className="text-xs text-zinc-500">
                        {[entry.company, entry.location].filter(Boolean).join(" · ")}
                      </p>
                      {entry.highlights?.length ? (
                        <ul className="mt-2 space-y-1">
                          {entry.highlights.map((highlight, hi) => (
                            <li key={hi} className="flex gap-2">
                              <span className="text-zinc-400">•</span>
                              <span>{highlight}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {resume.highlights?.length ? (
              <Section label="Extracurricular" accent>
                <ul className="space-y-1">
                  {resume.highlights.map((item, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="text-zinc-400">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CVPreview({ contact = {}, resume = {}, job, template = "modern", theme = "dark" }) {
  const resolvedTemplate = resolveCvDisplayTemplate(template);
  const palette = PREVIEW_THEMES[theme] || PREVIEW_THEMES.dark;
  const name = (contact.name || "Your Name").trim();
  const contactLine = [contact.email, contact.phone, contact.location, contact.linkedin, contact.website]
    .filter(Boolean).join("  •  ");

  if (resolvedTemplate === PROFESSIONAL_CV_TEMPLATE) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`overflow-hidden rounded-2xl border ${palette.container}`}
      >
        <ProfessionalCVPreview contact={contact} resume={resume} job={job} theme={palette} />
      </motion.div>
    );
  }

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
