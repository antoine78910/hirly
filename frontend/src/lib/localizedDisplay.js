import { ONBOARDING_ROLE_LABELS_FR } from "./onboardingJobLabelsFr";

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
  "Cloud Engineer": "Ingenieur cloud",
  "Cybersecurity Analyst": "Analyste cybersecurite",
  "Systems Administrator": "Administrateur systemes",
  "BI Analyst": "Analyste BI",
  "Data Engineer": "Data engineer",
  "Research Analyst": "Charge d'etudes",
  "Marketing Assistant": "Assistant marketing",
  "Marketing Coordinator": "Charge de marketing",
  "Product Manager": "Chef de produit",
  "Product Owner": "Product owner",
  "Project Manager": "Chef de projet",
  "Graphic Designer": "Graphiste",
  "UX/UI Designer": "Designer UX/UI",
  "Product Designer": "Designer produit",
  "Content Designer": "Designer contenu",
  Researcher: "Chargé de recherche",
  "Market Analyst": "Analyste marché",
  "Marketing Manager": "Responsable marketing",
  "Digital Marketing Specialist": "Specialiste marketing digital",
  "Growth Marketing Manager": "Growth marketing manager",
  "Content Marketing Manager": "Responsable content marketing",
  "Social Media Manager": "Social media manager",
  "SEO Specialist": "Specialiste SEO",
  "Communications Officer": "Charge de communication",
  "Community Manager": "Community manager",
  "Brand Manager": "Chef de marque",
  "Sales Representative": "Commercial",
  "Business Developer": "Business developer",
  "Account Executive": "Account executive",
  "Account Manager": "Account manager",
  "Customer Support": "Support client",
  "Customer Success Manager": "Customer success manager",
  "Call Center Agent": "Conseiller telephonique",
  "Operations Manager": "Responsable des opérations",
  "HR Assistant": "Assistant RH",
  "HR Coordinator": "Charge RH",
  "HR Manager": "Responsable RH",
  Recruiter: "Recruteur",
  "Talent Acquisition Specialist": "Charge de recrutement",
  "Training Coordinator": "Coordinateur formation",
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
  Controller: "Controleur financier",
  Auditor: "Auditeur",
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
  "Order Picker": "Preparateur de commandes",
  "Forklift Operator": "Cariste",
  "Logistics Assistant": "Assistant logistique",
  "Logistics Coordinator": "Coordinateur logistique",
  "Supply Chain Assistant": "Assistant supply chain",
  ...ONBOARDING_ROLE_LABELS_FR,
};

const FRENCH_GROUP_LABELS = {
  Technology: "Technologie",
  "Product & Design": "Produit et design",
  Business: "Business",
  Finance: "Finance",
  "Healthcare & Education": "Santé et éducation",
  "Service & Operations": "Service et opérations",
};

FRENCH_GROUP_LABELS["Data & Analytics"] = "Data et analyse";
FRENCH_GROUP_LABELS["Marketing & Communications"] = "Marketing et communication";
FRENCH_GROUP_LABELS["Sales & Customer"] = "Vente et relation client";
FRENCH_GROUP_LABELS["Human Resources"] = "Ressources humaines";
FRENCH_GROUP_LABELS["Administration & Operations"] = "Administration et operations";
FRENCH_GROUP_LABELS["Finance & Accounting"] = "Finance et comptabilite";
FRENCH_GROUP_LABELS["Service & Hospitality"] = "Service et hotellerie";
FRENCH_GROUP_LABELS["Transport & Warehouse"] = "Transport et logistique";

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

// Reverse lookup (canonical English key AND its French label -> canonical
// key) so a value already stored/displayed in either language can be
// re-translated correctly after the user switches UI language -- without
// this, a role saved as "Cuisinier" while browsing in French would have no
// way back to "Chef" when the UI is switched to English, since
// FRENCH_ROLE_LABELS only maps one direction.
const CANONICAL_ROLE_BY_LABEL = new Map();
for (const [canonicalKey, frenchLabel] of Object.entries(FRENCH_ROLE_LABELS)) {
  CANONICAL_ROLE_BY_LABEL.set(canonicalKey.toLowerCase(), canonicalKey);
  CANONICAL_ROLE_BY_LABEL.set(frenchLabel.toLowerCase(), canonicalKey);
}

function resolveCanonicalRole(value) {
  return CANONICAL_ROLE_BY_LABEL.get(String(value || "").toLowerCase()) || null;
}

export function isFrench(lang) {
  return String(lang || "").toLowerCase().startsWith("fr");
}

export function translateRoleLabel(value, lang) {
  if (!value) return "";
  const canonical = resolveCanonicalRole(value);
  if (!isFrench(lang)) return canonical || value;
  if (canonical) return FRENCH_ROLE_LABELS[canonical] || value;
  return translateJobTitle(value, lang);
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
