import { motion } from "framer-motion";
import { Linkedin, Mail, MapPin, Phone } from "lucide-react";
import {
  PRO_CV_COLORS_PHOTO,
  PRO_CV_COLORS_PLAIN,
  PRO_CV_HEADER_PATH,
  PRO_CV_HEADER_VIEWBOX,
  getContactPhotoUrl,
  parseLanguageEntry,
  resolveCvDisplayTemplate,
  resolveProfessionalVariant,
  socialLinksFromContact,
  HIRLY_DEFAULT_CV_TEMPLATE,
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

const Section = ({ label, children, theme, style }) => (
  <section className="mt-4 first:mt-0" style={style}>
    <h3
      className={`pb-1 text-[10px] font-bold uppercase tracking-[0.14em] border-b mb-2.5 ${theme.sectionLabel}`}
    >
      {label}
    </h3>
    {children}
  </section>
);

const ProSection = ({ label, children, accentColor, style }) => (
  <section className="mt-5 first:mt-0" style={style}>
    <h3
      className="mb-2.5 border-b pb-1 text-[10px] font-bold uppercase tracking-[0.14em]"
      style={{ color: accentColor, borderColor: accentColor }}
    >
      {label}
    </h3>
    {children}
  </section>
);

function ProfessionalColumns({ contact, resume, accentColor }) {
  const socialLinks = socialLinksFromContact(contact);
  const languages = (resume.languages || []).map(parseLanguageEntry);

  return (
    <div className="mt-6 grid flex-1 grid-cols-[30%_1fr] gap-5 px-8 pb-8">
      <aside className="space-y-5 border-r border-zinc-200 pr-5 text-[12px] leading-relaxed text-zinc-700">
        <ProSection label="Contact" accentColor={accentColor} style={{ marginTop: 0 }}>
          {contact.location ? (
            <div className="mb-3">
              <p
                className="mb-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ color: accentColor }}
              >
                Address
              </p>
              <p>{contact.location}</p>
            </div>
          ) : null}
          {contact.phone ? (
            <div className="mb-3">
              <p
                className="mb-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ color: accentColor }}
              >
                Phone
              </p>
              <p>{contact.phone}</p>
            </div>
          ) : null}
          {contact.email ? (
            <div className="mb-3">
              <p
                className="mb-0.5 text-[9px] font-bold uppercase tracking-wide"
                style={{ color: accentColor }}
              >
                Email
              </p>
              <p className="break-all">{contact.email}</p>
            </div>
          ) : null}
        </ProSection>

        {socialLinks.length ? (
          <ProSection label="Social links" accentColor={accentColor}>
            <ul className="space-y-2">
              {socialLinks.map((link) => (
                <li key={link.label} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0"
                    style={{ backgroundColor: accentColor }}
                  />
                  <span className="break-all">{link.value}</span>
                </li>
              ))}
            </ul>
          </ProSection>
        ) : null}

        {resume.skills?.length ? (
          <ProSection label="Skills" accentColor={accentColor}>
            <ul className="space-y-2">
              {resume.skills.map((skill) => (
                <li key={skill} className="flex items-start gap-2">
                  <span
                    className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0"
                    style={{ backgroundColor: accentColor }}
                  />
                  <span>{skill}</span>
                </li>
              ))}
            </ul>
          </ProSection>
        ) : null}

        {languages.length ? (
          <ProSection label="Languages" accentColor={accentColor}>
            <ul className="space-y-1.5">
              {languages.map((lang) => (
                <li key={`${lang.name}-${lang.level}`} className="flex justify-between gap-2">
                  <span>{lang.name}</span>
                  {lang.level ? <span className="text-zinc-500">{lang.level}</span> : null}
                </li>
              ))}
            </ul>
          </ProSection>
        ) : null}
      </aside>

      <div className="space-y-5 text-[12px] leading-relaxed text-zinc-700">
        {resume.summary ? (
          <ProSection label="Profile" accentColor={accentColor} style={{ marginTop: 0 }}>
            <p className="leading-[1.65]">{resume.summary}</p>
          </ProSection>
        ) : null}

        {resume.education?.length ? (
          <ProSection
            label="Education"
            accentColor={accentColor}
            style={{ marginTop: resume.summary ? undefined : 0 }}
          >
            <ul className="space-y-4">
              {resume.education.map((entry, _index) => (
                <li key={JSON.stringify(entry)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold text-zinc-900">{entry.degree}</p>
                    <p className="shrink-0 text-[11px] text-zinc-500">{entry.year}</p>
                  </div>
                  <p className="text-[11px] text-zinc-500">{entry.school}</p>
                </li>
              ))}
            </ul>
          </ProSection>
        ) : null}

        {resume.experience?.length ? (
          <ProSection label="Employment history" accentColor={accentColor}>
            <ul className="space-y-5">
              {resume.experience.map((entry, _index) => (
                <li key={JSON.stringify(entry)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold text-zinc-900">{entry.role}</p>
                    <p className="shrink-0 text-[11px] text-zinc-500">{entry.duration}</p>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    {[entry.company, entry.location].filter(Boolean).join(" · ")}
                  </p>
                  {entry.highlights?.length ? (
                    <ul className="mt-2 space-y-1.5">
                      {entry.highlights.map((highlight, _hi) => (
                        <li key={JSON.stringify(highlight)} className="flex gap-2">
                          <span className="text-zinc-400">•</span>
                          <span>{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </ProSection>
        ) : null}

        {resume.highlights?.length ? (
          <ProSection label="Extracurricular" accentColor={accentColor}>
            <ul className="space-y-1.5">
              {resume.highlights.map((item, _index) => (
                <li key={JSON.stringify(item)} className="flex gap-2">
                  <span className="text-zinc-400">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </ProSection>
        ) : null}
      </div>
    </div>
  );
}

function ProfessionalPhotoPreview({ contact, resume }) {
  const name = (contact.name || "Your Name").trim();
  const photoUrl = getContactPhotoUrl(contact);
  const accent = PRO_CV_COLORS_PHOTO.accent;

  return (
    <div
      className="relative flex aspect-[210/297] w-full min-h-[680px] flex-col overflow-hidden bg-white text-zinc-900"
      data-testid="cv-preview"
    >
      <div className="relative w-full">
        <svg viewBox={PRO_CV_HEADER_VIEWBOX} className="block h-[96px] w-full" aria-hidden="true">
          <path d={PRO_CV_HEADER_PATH} fill={accent} />
        </svg>
        {photoUrl ? (
          <div className="absolute left-1/2 top-[50px] -translate-x-1/2 -translate-y-1/2">
            <div className="h-[76px] w-[76px] overflow-hidden rounded-full border-[4px] border-white bg-zinc-100">
              <img
                src={photoUrl}
                alt=""
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-10 flex items-start justify-between gap-6 px-8">
        <h2 className="font-display text-[1.5rem] font-bold leading-tight tracking-tight text-zinc-900">
          {name}
        </h2>
        <div className="max-w-[42%] shrink-0 text-right text-[11px] leading-[1.6] text-zinc-500">
          {contact.email ? <p className="break-all">{contact.email}</p> : null}
          {contact.phone ? <p>{contact.phone}</p> : null}
          {contact.location ? <p>{contact.location}</p> : null}
        </div>
      </div>

      <ProfessionalColumns contact={contact} resume={resume} accentColor={accent} />
    </div>
  );
}

function ProfessionalPlainPreview({ contact, resume }) {
  const name = (contact.name || "Your Name").trim();
  const accent = PRO_CV_COLORS_PLAIN.accent;
  const contactLine = [contact.email, contact.phone, contact.location]
    .filter(Boolean)
    .join("   ·   ");

  return (
    <div
      className="relative flex aspect-[210/297] w-full min-h-[680px] flex-col overflow-hidden bg-white text-zinc-900"
      data-testid="cv-preview"
    >
      <div className="px-8 pt-10">
        <h2 className="font-display text-[1.65rem] font-bold leading-tight tracking-tight text-zinc-900">
          {name}
        </h2>
        {contactLine ? (
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">{contactLine}</p>
        ) : null}
        <div className="mt-4 border-t border-zinc-200" />
      </div>

      <ProfessionalColumns contact={contact} resume={resume} accentColor={accent} />
    </div>
  );
}

function ProfessionalCVPreview({ contact, resume }) {
  const variant = resolveProfessionalVariant(contact);
  if (variant === "photo") {
    return <ProfessionalPhotoPreview contact={contact} resume={resume} />;
  }
  return <ProfessionalPlainPreview contact={contact} resume={resume} />;
}

const HirlySection = ({ label, children }) => (
  <section className="mt-5 first:mt-0">
    <h3 className="mb-2.5 border-b border-dashed border-zinc-300 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-900">
      {label}
    </h3>
    {children}
  </section>
);

function HirlyDefaultCVPreview({ contact, resume, job }) {
  const name = (contact.name || "Your Name").trim();
  const photoUrl = getContactPhotoUrl(contact);
  const languages = (resume.languages || []).map(parseLanguageEntry).filter((lang) => lang.name);
  const half = Math.ceil(languages.length / 2);
  const languageColumns = [languages.slice(0, half), languages.slice(half)];

  return (
    <div
      className="flex aspect-[210/297] w-full min-h-[680px] flex-col overflow-hidden bg-white px-8 py-8 text-zinc-900"
      data-testid="cv-preview"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <div>
            <h2 className="font-display text-[1.5rem] font-bold leading-tight tracking-tight text-zinc-900">
              {name}
            </h2>
            {job?.title ? <p className="mt-0.5 text-sm italic text-zinc-500">{job.title}</p> : null}
          </div>
        </div>
        <div className="shrink-0 space-y-1 text-right text-[11px] leading-relaxed text-zinc-600">
          {contact.phone ? (
            <p className="flex items-center justify-end gap-1.5">
              <Phone className="h-3 w-3" />
              {contact.phone}
            </p>
          ) : null}
          {contact.email ? (
            <p className="flex items-center justify-end gap-1.5 break-all">
              <Mail className="h-3 w-3 shrink-0" />
              {contact.email}
            </p>
          ) : null}
          {contact.linkedin ? (
            <p className="flex items-center justify-end gap-1.5 break-all">
              <Linkedin className="h-3 w-3 shrink-0" />
              {contact.linkedin}
            </p>
          ) : null}
          {contact.location ? (
            <p className="flex items-center justify-end gap-1.5">
              <MapPin className="h-3 w-3" />
              {contact.location}
            </p>
          ) : null}
        </div>
      </div>

      {resume.experience?.length > 0 && (
        <HirlySection label="Experience">
          <ul className="space-y-4">
            {resume.experience.map((entry, _index) => (
              <li key={JSON.stringify(entry)}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold text-[13px] text-zinc-900">{entry.role}</p>
                  <p className="shrink-0 text-[11px] text-zinc-500">{entry.duration}</p>
                </div>
                <p className="text-[11px] text-zinc-500">
                  {[entry.company, entry.location].filter(Boolean).join(" — ")}
                </p>
                {entry.highlights?.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {entry.highlights.map((highlight, _hi) => (
                      <li
                        key={JSON.stringify(highlight)}
                        className="flex gap-2 text-[12px] leading-relaxed text-zinc-700"
                      >
                        <span className="text-zinc-400">•</span>
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </HirlySection>
      )}

      {resume.education?.length > 0 && (
        <HirlySection label="Education">
          <ul className="space-y-3">
            {resume.education.map((entry, _index) => (
              <li key={JSON.stringify(entry)}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold text-[13px] text-zinc-900">{entry.degree}</p>
                  <p className="shrink-0 text-[11px] text-zinc-500">{entry.year}</p>
                </div>
                <p className="text-[11px] text-zinc-500">{entry.school}</p>
              </li>
            ))}
          </ul>
        </HirlySection>
      )}

      {languages.length > 0 && (
        <HirlySection label="Languages">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
            {languageColumns.map((column, _colIndex) => (
              <div key={JSON.stringify(column)} className="space-y-1.5">
                {column.map((lang) => (
                  <p key={lang.name}>
                    <span className="font-semibold text-zinc-900">{lang.name}</span>
                    {lang.level ? <span className="ml-2 text-zinc-500">{lang.level}</span> : null}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </HirlySection>
      )}
    </div>
  );
}

export default function CVPreview({
  contact = {},
  resume = {},
  job,
  template = "modern",
  theme = "dark",
}) {
  const resolvedTemplate = resolveCvDisplayTemplate(template);
  const palette = PREVIEW_THEMES[theme] || PREVIEW_THEMES.dark;
  const name = (contact.name || "Your Name").trim();
  const contactLine = [
    contact.email,
    contact.phone,
    contact.location,
    contact.linkedin,
    contact.website,
  ]
    .filter(Boolean)
    .join("  •  ");

  if (resolvedTemplate === HIRLY_DEFAULT_CV_TEMPLATE) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`overflow-hidden rounded-2xl border ${palette.container}`}
      >
        <HirlyDefaultCVPreview contact={contact} resume={resume} job={job} />
      </motion.div>
    );
  }

  if (resolvedTemplate === PROFESSIONAL_CV_TEMPLATE) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={`overflow-hidden rounded-2xl border ${palette.container}`}
      >
        <ProfessionalCVPreview contact={contact} resume={resume} />
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
          <h2
            className={`font-display font-bold text-3xl tracking-tight ${palette.titleClassic}`}
            style={{ fontFamily: "Georgia, serif" }}
          >
            {name}
          </h2>
          <p className={`text-xs mt-1 ${palette.muted}`}>{contactLine}</p>
          <div className={`mt-4 border-t ${palette.dividerClassic}`} />
        </div>
      ) : (
        <div className="px-6 pt-6">
          <h2 className={`font-display font-black text-2xl tracking-tight ${palette.title}`}>
            {name}
          </h2>
          <p className={`text-xs mt-1 ${palette.muted}`}>{contactLine}</p>
          {template !== "minimal" && <div className={`mt-3 border-t ${palette.divider}`} />}
        </div>
      )}

      <div className="px-6 pb-6 pt-2">
        {resume.summary && (
          <Section label="Summary" theme={palette}>
            <p className={`text-sm leading-relaxed ${palette.body}`}>{resume.summary}</p>
          </Section>
        )}

        {resume.skills?.length > 0 && (
          <Section label="Skills" theme={palette}>
            <p className={`text-sm leading-relaxed ${palette.body}`}>
              {resume.skills.join("  ·  ")}
            </p>
          </Section>
        )}

        {resume.highlights?.length > 0 && (
          <Section
            label={resume.experience?.length ? "Key highlights" : "Highlights"}
            theme={palette}
          >
            <ul className="space-y-1.5">
              {resume.highlights.map((item, _index) => (
                <li
                  key={JSON.stringify(item)}
                  className={`text-sm leading-relaxed flex gap-2 ${palette.body}`}
                >
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
              {resume.experience.map((e, _i) => (
                <li key={JSON.stringify(e)}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={`font-semibold text-[15px] ${palette.role}`}>{e.role}</p>
                    <p className={`text-xs shrink-0 ${palette.muted}`}>{e.duration}</p>
                  </div>
                  <p className={`text-xs ${palette.muted}`}>
                    {[e.company, e.location].filter(Boolean).join(" — ")}
                  </p>
                  {e.highlights?.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {e.highlights.map((h, _j) => (
                        <li
                          key={JSON.stringify(h)}
                          className={`text-sm leading-relaxed flex gap-2 ${palette.body}`}
                        >
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
              {resume.education.map((e, _i) => (
                <li key={JSON.stringify(e)} className="flex items-baseline justify-between gap-3">
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
