import { motion } from "framer-motion";
import {
  PRO_CV_COLORS,
  PRO_CV_HEADER_PATH,
  contactInitials,
  computeVerticalFillScale,
  estimateProfessionalContentHeight,
  getContactPhotoUrl,
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

const Section = ({ label, children, theme, accent = false, style }) => (
  <section className="mt-4 first:mt-0" style={style}>
    <h3
      className={`pb-1 text-[10px] font-bold uppercase tracking-[0.14em] border-b mb-2.5 ${
        accent ? "text-[#1B4F8A] border-[#1B4F8A]" : theme.sectionLabel
      }`}
    >
      {label}
    </h3>
    {children}
  </section>
);

function ProfessionalCVPreview({ contact, resume, job }) {
  const name = (contact.name || "Your Name").trim();
  const initials = contactInitials(name);
  const photoUrl = getContactPhotoUrl(contact);
  const socialLinks = socialLinksFromContact(contact);
  const languages = (resume.languages || []).map(parseLanguageEntry);
  const vScale = computeVerticalFillScale(estimateProfessionalContentHeight({ contact, resume }));
  const sectionGap = `${Math.round(16 * vScale)}px`;
  const entryGap = `${Math.round(12 * vScale)}px`;

  return (
    <div
      className="relative flex aspect-[210/297] w-full min-h-[680px] flex-col overflow-hidden bg-white text-zinc-900"
      data-testid="cv-preview"
    >
      <div className="relative shrink-0">
        <svg viewBox="0 0 794 130" className="block h-auto w-full" aria-hidden="true">
          <path d={PRO_CV_HEADER_PATH} fill={PRO_CV_COLORS.accent} />
        </svg>
        <div className="absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2">
          <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-full border-[5px] border-white bg-zinc-200 shadow-sm">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-xl font-bold text-zinc-600">{initials}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-1">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-[1.75rem] font-black leading-tight tracking-tight text-zinc-900">
            {name}
          </h2>
          <div className="max-w-[45%] shrink-0 text-right text-[11px] leading-relaxed text-zinc-500">
            {contact.email ? <p>{contact.email}</p> : null}
            {contact.phone ? <p>{contact.phone}</p> : null}
            {contact.location ? <p>{contact.location}</p> : null}
          </div>
        </div>

        <div className="mt-4 grid min-h-0 flex-1 grid-cols-[32%_1fr] gap-6 border-t border-zinc-100 pt-4">
          <aside className="space-y-1 border-r border-zinc-100 pr-4 text-[13px] leading-relaxed text-zinc-700">
            <Section label="Contact" accent style={{ marginTop: 0 }}>
              {contact.location ? (
                <div className="mb-2" style={{ marginBottom: entryGap }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#1B4F8A]">Address</p>
                  <p>{contact.location}</p>
                </div>
              ) : null}
              {contact.phone ? (
                <div className="mb-2" style={{ marginBottom: entryGap }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#1B4F8A]">Phone number</p>
                  <p>{contact.phone}</p>
                </div>
              ) : null}
              {contact.email ? (
                <div className="mb-2" style={{ marginBottom: entryGap }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#1B4F8A]">Email address</p>
                  <p className="break-all">{contact.email}</p>
                </div>
              ) : null}
            </Section>

            {socialLinks.length ? (
              <Section label="Social links" accent style={{ marginTop: sectionGap }}>
                <ul className="space-y-1.5" style={{ gap: entryGap }}>
                  {socialLinks.map((link) => (
                    <li key={link.label} className="flex items-start gap-2">
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 bg-[#1B4F8A]" />
                      <span className="break-all">{link.value}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {resume.skills?.length ? (
              <Section label="Skills" accent style={{ marginTop: sectionGap }}>
                <ul className="space-y-1.5">
                  {resume.skills.map((skill) => (
                    <li key={skill} className="flex items-start gap-2">
                      <span className="mt-1.5 inline-block h-2 w-2 shrink-0 bg-[#1B4F8A]" />
                      <span>{skill}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {languages.length ? (
              <Section label="Languages" accent style={{ marginTop: sectionGap }}>
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

          <div className="flex flex-col text-[13px] leading-relaxed text-zinc-700">
            {resume.summary ? (
              <Section label="Profile" accent style={{ marginTop: 0 }}>
                <p>{resume.summary}</p>
              </Section>
            ) : null}

            {resume.education?.length ? (
              <Section label="Education" accent style={{ marginTop: resume.summary ? sectionGap : 0 }}>
                <ul className="space-y-3" style={{ gap: entryGap }}>
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
              <Section
                label="Employment history"
                accent
                style={{ marginTop: resume.summary || resume.education?.length ? sectionGap : 0 }}
              >
                <ul className="space-y-4" style={{ gap: entryGap }}>
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
              <Section
                label="Extracurricular"
                accent
                style={{
                  marginTop:
                    resume.summary || resume.education?.length || resume.experience?.length
                      ? sectionGap
                      : 0,
                }}
              >
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

        {job?.title ? (
          <p className="mt-auto pt-3 text-center text-[10px] italic text-zinc-400">
            Tailored for {job.title} @ {job.company}
          </p>
        ) : null}
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
        <ProfessionalCVPreview contact={contact} resume={resume} job={job} />
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
