const SECTION_ROWS = [
  {
    groupKey: "workProjects",
    rows: [
      { key: "experience", iconName: "Briefcase" },
      { key: "volunteer", iconName: "Heart" },
      { key: "projects", iconName: "Folder" },
    ],
  },
  {
    groupKey: "studiesExpertise",
    rows: [
      { key: "education", iconName: "GraduationCap" },
      { key: "skills", iconName: "Code2" },
      { key: "certifications", iconName: "Award" },
    ],
  },
  {
    groupKey: "extrasPersonal",
    rows: [
      { key: "awards", iconName: "Trophy" },
      { key: "publications", iconName: "Newspaper" },
      { key: "recognition", iconName: "Star" },
      { key: "languages", iconName: "LangIcon" },
      { key: "interests", iconName: "Heart" },
      { key: "references", iconName: "Users2" },
      { key: "key_highlights", iconName: "Lightbulb" },
      { key: "custom", iconName: "Cog" },
    ],
  },
];

const SCHEMA_DEFS = {
  overview: {
    aiBacked: false,
    simple: false,
    fields: [
      { key: "role", fieldKey: "role" },
      { key: "summary", fieldKey: "summary", textarea: true },
    ],
  },
  experience: {
    aiBacked: true,
    simple: false,
    fields: [
      { key: "role", fieldKey: "role" },
      { key: "company", fieldKey: "company" },
      { key: "duration", fieldKey: "duration" },
      { key: "location", fieldKey: "location" },
      { key: "highlights", fieldKey: "highlights", textarea: true },
    ],
  },
  volunteer: {
    fields: [
      { key: "role", fieldKey: "role" },
      { key: "organization", fieldKey: "organization" },
      { key: "duration", fieldKey: "duration" },
      { key: "details", fieldKey: "details", textarea: true },
    ],
  },
  projects: {
    fields: [
      { key: "name", fieldKey: "projectName" },
      { key: "url", fieldKey: "url" },
      { key: "stack", fieldKey: "stack" },
      { key: "description", fieldKey: "description", textarea: true },
    ],
  },
  education: {
    aiBacked: true,
    fields: [
      { key: "degree", fieldKey: "degree" },
      { key: "school", fieldKey: "school" },
      { key: "year", fieldKey: "year" },
    ],
  },
  skills: {
    aiBacked: true,
    simple: true,
    fields: [{ key: "name", fieldKey: "skill" }],
  },
  certifications: {
    fields: [
      { key: "name", fieldKey: "certification" },
      { key: "issuer", fieldKey: "issuer" },
      { key: "year", fieldKey: "year" },
      { key: "credential_url", fieldKey: "credentialUrl" },
    ],
  },
  awards: {
    fields: [
      { key: "title", fieldKey: "award" },
      { key: "issuer", fieldKey: "issuer" },
      { key: "year", fieldKey: "year" },
      { key: "details", fieldKey: "details", textarea: true },
    ],
  },
  publications: {
    fields: [
      { key: "title", fieldKey: "title" },
      { key: "venue", fieldKey: "venue" },
      { key: "year", fieldKey: "year" },
      { key: "url", fieldKey: "url" },
    ],
  },
  recognition: {
    fields: [
      { key: "title", fieldKey: "recognition" },
      { key: "issuer", fieldKey: "issuer" },
      { key: "year", fieldKey: "year" },
    ],
  },
  languages: {
    fields: [
      { key: "name", fieldKey: "language" },
      { key: "proficiency", fieldKey: "proficiency" },
    ],
  },
  interests: {
    simple: true,
    fields: [{ key: "name", fieldKey: "interest" }],
  },
  references: {
    fields: [
      { key: "name", fieldKey: "referenceName" },
      { key: "title", fieldKey: "referenceTitle" },
      { key: "email", fieldKey: "email" },
      { key: "phone", fieldKey: "phone" },
    ],
  },
  key_highlights: {
    simple: true,
    fields: [{ key: "text", fieldKey: "highlight" }],
  },
  custom: {
    fields: [
      { key: "label", fieldKey: "label" },
      { key: "value", fieldKey: "value", textarea: true },
    ],
  },
};

function fieldLabel(t, sectionKey, fieldKey) {
  return t(`professionalProfile.schema.${sectionKey}.fields.${fieldKey}.label`);
}

function fieldPlaceholder(t, sectionKey, fieldKey) {
  const text = t(`professionalProfile.schema.${sectionKey}.fields.${fieldKey}.placeholder`);
  return text.startsWith("professionalProfile.") ? undefined : text;
}

export function getFieldSchema(sectionKey, t) {
  const def = SCHEMA_DEFS[sectionKey];
  if (!def) return null;
  return {
    singular: t(`professionalProfile.schema.${sectionKey}.singular`),
    aiBacked: Boolean(def.aiBacked),
    simple: Boolean(def.simple),
    fields: def.fields.map((field) => ({
      key: field.key,
      label: fieldLabel(t, sectionKey, field.fieldKey),
      placeholder: fieldPlaceholder(t, sectionKey, field.fieldKey),
      textarea: Boolean(field.textarea),
    })),
  };
}

export function getProfessionalProfileSections(t, icons) {
  return SECTION_ROWS.map((group) => ({
    groupKey: group.groupKey,
    group: t(`professionalProfile.groups.${group.groupKey}`),
    rows: group.rows.map((row) => ({
      key: row.key,
      icon: icons[row.iconName],
      label: t(`professionalProfile.sections.${row.key}`),
    })),
  }));
}

export { SCHEMA_DEFS as PROFESSIONAL_PROFILE_SECTION_KEYS };
