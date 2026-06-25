const FRENCH_ROLE_LABELS = {
  "Software Engineer": "Ingénieur logiciel",
  "Frontend Developer": "Développeur front-end",
  "Backend Developer": "Développeur back-end",
  "Full Stack Developer": "Développeur full stack",
  "Mobile Developer": "Développeur mobile",
  "Data Analyst": "Analyste data",
  "Data Scientist": "Data scientist",
  "Business Analyst": "Business analyst",
  "QA Engineer": "Ingénieur QA",
  "DevOps Engineer": "Ingénieur DevOps",
  "IT Support Specialist": "Technicien support IT",
  "Product Manager": "Chef de produit",
  "Project Manager": "Chef de projet",
  "Graphic Designer": "Graphiste",
  "UX/UI Designer": "Designer UX/UI",
  "Product Designer": "Designer produit",
  "Content Designer": "Designer contenu",
  Researcher: "Chargé de recherche",
  "Market Analyst": "Analyste marché",
  "Marketing Manager": "Responsable marketing",
  "Sales Representative": "Commercial",
  "Customer Support": "Support client",
  "Operations Manager": "Responsable des opérations",
  "HR Assistant": "Assistant RH",
  "Administrative Assistant": "Assistant administratif",
  Receptionist: "Réceptionniste",
  "Office Manager": "Office manager",
  "Executive Assistant": "Assistant de direction",
  "Finance Analyst": "Analyste financier",
  Accountant: "Comptable",
  Bookkeeper: "Aide-comptable",
  "Financial Advisor": "Conseiller financier",
  "Payroll Specialist": "Gestionnaire paie",
  "Accounts Assistant": "Assistant comptable",
  Nurse: "Infirmier",
  Teacher: "Enseignant",
  "Teaching Assistant": "Assistant pédagogique",
  "Care Assistant": "Aide-soignant",
  "Medical Receptionist": "Secrétaire médical",
  "Pharmacy Assistant": "Préparateur en pharmacie",
  Waiter: "Serveur",
  Barista: "Barista",
  "Warehouse Worker": "Magasinier",
  Driver: "Chauffeur",
  "Delivery Driver": "Livreur",
  "Retail Assistant": "Vendeur",
  "Store Manager": "Responsable de magasin",
  Cleaner: "Agent d'entretien",
  "Security Guard": "Agent de sécurité",
  Chef: "Cuisinier",
  "Kitchen Assistant": "Commis de cuisine",
};

const FRENCH_GROUP_LABELS = {
  Technology: "Technologie",
  "Product & Design": "Produit et design",
  Business: "Business",
  Finance: "Finance",
  "Healthcare & Education": "Santé et éducation",
  "Service & Operations": "Service et opérations",
};

const FRENCH_LOCATION_REPLACEMENTS = [
  [/\bUnited States of America\b/gi, "États-Unis"],
  [/\bUnited States\b/gi, "États-Unis"],
  [/\bUSA\b/g, "États-Unis"],
  [/\bUnited Kingdom\b/gi, "Royaume-Uni"],
  [/\bUK\b/g, "Royaume-Uni"],
  [/\bLondon\b/g, "Londres"],
  [/\bGermany\b/gi, "Allemagne"],
  [/\bSpain\b/gi, "Espagne"],
  [/\bMorocco\b/gi, "Maroc"],
  [/\bNetherlands\b/gi, "Pays-Bas"],
  [/\bSwitzerland\b/gi, "Suisse"],
  [/\bBelgium\b/gi, "Belgique"],
  [/\bItaly\b/gi, "Italie"],
  [/\bRemote\b/gi, "Télétravail"],
  [/\bHybrid\b/gi, "Hybride"],
  [/\bIn Person\b/gi, "Présentiel"],
  [/\bOnsite\b/gi, "Présentiel"],
  [/\bAnywhere\b/gi, "Partout"],
];

const TITLE_REPLACEMENTS = [
  [/\bFull[-\s]?Stack\b/gi, "full stack"],
  [/\bFront[-\s]?End\b/gi, "front-end"],
  [/\bBack[-\s]?End\b/gi, "back-end"],
  [/\bSoftware Engineer\b/gi, "Ingénieur logiciel"],
  [/\bSoftware Developer\b/gi, "Développeur logiciel"],
  [/\bDeveloper\b/gi, "Développeur"],
  [/\bEngineer\b/gi, "Ingénieur"],
  [/\bData Analyst\b/gi, "Analyste data"],
  [/\bData Scientist\b/gi, "Data scientist"],
  [/\bBusiness Analyst\b/gi, "Business analyst"],
  [/\bProduct Manager\b/gi, "Chef de produit"],
  [/\bProject Manager\b/gi, "Chef de projet"],
  [/\bMarketing Manager\b/gi, "Responsable marketing"],
  [/\bOperations Manager\b/gi, "Responsable des opérations"],
  [/\bSales Representative\b/gi, "Commercial"],
  [/\bCustomer Support\b/gi, "Support client"],
  [/\bDesigner\b/gi, "Designer"],
  [/\bInternship\b/gi, "Stage"],
  [/\bIntern\b/gi, "Stagiaire"],
  [/\bEntry[-\s]?Level\b/gi, "Junior"],
];

export function isFrench(lang) {
  return String(lang || "").toLowerCase().startsWith("fr");
}

export function translateRoleLabel(value, lang) {
  if (!value || !isFrench(lang)) return value || "";
  return FRENCH_ROLE_LABELS[value] || translateJobTitle(value, lang);
}

export function translateRoleGroupLabel(value, lang) {
  if (!value || !isFrench(lang)) return value || "";
  return FRENCH_GROUP_LABELS[value] || value;
}

export function translateJobTitle(value, lang) {
  if (!value || !isFrench(lang)) return value || "";
  const exact = FRENCH_ROLE_LABELS[value];
  if (exact) return exact;
  return TITLE_REPLACEMENTS.reduce(
    (title, [pattern, replacement]) => title.replace(pattern, replacement),
    String(value),
  );
}

export function translateLocationLabel(value, lang) {
  if (!value || !isFrench(lang)) return value || "";
  return FRENCH_LOCATION_REPLACEMENTS.reduce(
    (label, [pattern, replacement]) => label.replace(pattern, replacement),
    String(value),
  );
}
