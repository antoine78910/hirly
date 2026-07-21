import { translateRoleGroupLabel, translateRoleLabel } from "./localizedDisplay";

export const ROLE_GROUPS = [
  {
    group: "Technology",
    roles: [
      "Software Engineer",
      "Frontend Developer",
      "Backend Developer",
      "Full Stack Developer",
      "Mobile Developer",
      "DevOps Engineer",
      "Cloud Engineer",
      "QA Engineer",
      "IT Support Specialist",
      "Cybersecurity Analyst",
      "Systems Administrator",
    ],
  },
  {
    group: "Data & Analytics",
    roles: [
      "Data Analyst",
      "Data Scientist",
      "Business Analyst",
      "BI Analyst",
      "Data Engineer",
      "Market Analyst",
      "Research Analyst",
    ],
  },
  {
    group: "Marketing & Communications",
    roles: [
      "Marketing Assistant",
      "Marketing Coordinator",
      "Marketing Manager",
      "Digital Marketing Specialist",
      "Growth Marketing Manager",
      "Content Marketing Manager",
      "Social Media Manager",
      "SEO Specialist",
      "Communications Officer",
      "Community Manager",
      "Brand Manager",
    ],
  },
  {
    group: "Sales & Customer",
    roles: [
      "Sales Representative",
      "Business Developer",
      "Account Executive",
      "Account Manager",
      "Customer Support",
      "Customer Success Manager",
      "Call Center Agent",
      "Retail Assistant",
      "Store Manager",
    ],
  },
  {
    group: "Human Resources",
    roles: [
      "HR Assistant",
      "HR Coordinator",
      "HR Manager",
      "Recruiter",
      "Talent Acquisition Specialist",
      "Payroll Specialist",
      "Training Coordinator",
    ],
  },
  {
    group: "Administration & Operations",
    roles: [
      "Administrative Assistant",
      "Executive Assistant",
      "Office Manager",
      "Receptionist",
      "Operations Assistant",
      "Operations Manager",
      "Project Manager",
      "Logistics Coordinator",
      "Supply Chain Assistant",
    ],
  },
  {
    group: "Product & Design",
    roles: [
      "Product Manager",
      "Product Owner",
      "Project Manager",
      "Graphic Designer",
      "UX/UI Designer",
      "Product Designer",
      "Content Designer",
      "Researcher",
    ],
  },
  {
    group: "Finance & Accounting",
    roles: [
      "Finance Analyst",
      "Accountant",
      "Bookkeeper",
      "Financial Advisor",
      "Accounts Assistant",
      "Controller",
      "Auditor",
    ],
  },
  {
    group: "Healthcare & Education",
    roles: [
      "Nurse",
      "Teacher",
      "Teaching Assistant",
      "Care Assistant",
      "Medical Receptionist",
      "Pharmacy Assistant",
      "Trainer",
    ],
  },
  {
    group: "Service & Hospitality",
    roles: [
      "Waiter",
      "Barista",
      "Chef",
      "Kitchen Assistant",
      "Cleaner",
      "Security Guard",
      "Hotel Receptionist",
    ],
  },
  {
    group: "Transport & Warehouse",
    roles: [
      "Warehouse Worker",
      "Order Picker",
      "Forklift Operator",
      "Driver",
      "Delivery Driver",
      "Logistics Assistant",
    ],
  },
];

const ROLE_ALIASES = {
  "HR Assistant": ["rh", "assistant rh", "assistant ressources humaines", "human resources assistant", "ressources humaines"],
  "HR Coordinator": ["coordinateur rh", "charge rh", "charge ressources humaines"],
  "HR Manager": ["responsable rh", "manager rh", "responsable ressources humaines"],
  Recruiter: ["recruteur", "charge de recrutement", "talent acquisition"],
  "Talent Acquisition Specialist": ["charge de recrutement", "recrutement", "talent acquisition"],
  "Marketing Assistant": ["assistant marketing", "assistante marketing"],
  "Marketing Coordinator": ["coordinateur marketing", "charge marketing", "charge de marketing"],
  "Marketing Manager": ["responsable marketing", "manager marketing"],
  "Digital Marketing Specialist": ["marketing digital", "specialiste marketing digital", "charge marketing digital"],
  "Social Media Manager": ["community manager", "social media", "reseaux sociaux"],
  "SEO Specialist": ["seo", "referencement", "specialiste seo"],
  "Communications Officer": ["communication", "charge de communication", "assistant communication"],
  "Community Manager": ["community", "community manager", "reseaux sociaux"],
  "Business Developer": ["business development", "commercial", "developpement commercial"],
  "Sales Representative": ["commercial", "vendeur", "conseiller commercial"],
  "Customer Support": ["support client", "service client", "charge de clientele"],
  "Customer Success Manager": ["customer success", "success client", "charge de clientele"],
  "Administrative Assistant": ["assistant administratif", "assistante administrative", "admin assistant"],
  "Executive Assistant": ["assistant de direction", "assistante de direction"],
  "Operations Assistant": ["assistant operations", "assistant exploitation"],
  "Operations Manager": ["responsable operations", "responsable exploitation"],
  "Logistics Coordinator": ["coordinateur logistique", "logistique"],
  "Supply Chain Assistant": ["supply chain", "assistant supply chain"],
  "Product Manager": ["chef de produit", "product owner"],
  "Project Manager": ["chef de projet", "gestion de projet"],
  Researcher: ["recherche", "charge de recherche", "charge d'etudes"],
  "Research Analyst": ["charge d'etudes", "analyste recherche", "analyste etudes"],
  "Data Analyst": ["analyste data", "analyste donnees", "data"],
  "Business Analyst": ["business analyst", "analyste fonctionnel"],
  "Market Analyst": ["analyste marche", "charge d'etudes marketing"],
  Accountant: ["comptable"],
  "Accounts Assistant": ["assistant comptable", "aide comptable"],
  "Payroll Specialist": ["gestionnaire paie", "paie"],
  "Retail Assistant": ["vendeur", "conseiller de vente"],
  "Store Manager": ["responsable magasin", "responsable de magasin"],
  "Warehouse Worker": ["magasinier", "preparateur commande"],
  "Order Picker": ["preparateur de commandes", "preparateur commande"],
  Driver: ["chauffeur"],
  "Delivery Driver": ["livreur", "chauffeur livreur"],
};

const ROLE_INDEX = ROLE_GROUPS.flatMap(({ group, roles }) =>
  roles.map((role) => ({ role, group })),
);

const GROUP_BY_ROLE = new Map(ROLE_INDEX.map(({ role, group }) => [role, group]));

export const POPULAR_ROLES = [
  "Marketing Assistant",
  "HR Assistant",
  "Sales Representative",
  "Administrative Assistant",
  "Customer Support",
  "Data Analyst",
  "Software Engineer",
  "Business Developer",
  "Project Manager",
  "Retail Assistant",
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roleSearchText(role, group, lang) {
  return [
    role,
    translateRoleLabel(role, lang),
    group,
    translateRoleGroupLabel(group, lang),
    ...(ROLE_ALIASES[role] || []),
  ].map(normalize).filter(Boolean);
}

function scoreRole(role, query, relatedRole, lang = "en", group = "") {
  const normalizedQuery = normalize(query);
  let score = 0;

  if (!normalizedQuery) {
    if (POPULAR_ROLES.includes(role)) score += 12;
    if (relatedRole) {
      const relatedGroup = GROUP_BY_ROLE.get(relatedRole);
      if (relatedGroup && relatedGroup === GROUP_BY_ROLE.get(role)) score += 24;
    }
    return score;
  }

  const haystacks = roleSearchText(role, group, lang);
  if (haystacks.some((text) => text === normalizedQuery)) score += 140;
  else if (haystacks.some((text) => text.startsWith(normalizedQuery))) score += 100;
  else if (haystacks.some((text) => text.split(/\s+/).some((word) => word.startsWith(normalizedQuery)))) score += 75;
  else if (haystacks.some((text) => text.includes(normalizedQuery))) score += 45;

  if (relatedRole) {
    const relatedGroup = GROUP_BY_ROLE.get(relatedRole);
    if (relatedGroup && relatedGroup === GROUP_BY_ROLE.get(role)) score += 8;
  }

  return score;
}

/** Ranked role suggestions for autocomplete and role picker. */
export function searchRoleSuggestions(query, { limit = 8, relatedRole, lang = "en" } = {}) {
  const normalizedQuery = normalize(query);

  const ranked = ROLE_INDEX
    .map(({ role, group }) => ({
      role,
      group,
      score: scoreRole(role, normalizedQuery, relatedRole, lang, group),
    }))
    .filter((entry) => (normalizedQuery ? entry.score > 0 : entry.score >= 0))
    .sort((a, b) => b.score - a.score || a.role.localeCompare(b.role));

  const seen = new Set();
  const unique = [];
  for (const entry of ranked) {
    if (seen.has(entry.role)) continue;
    seen.add(entry.role);
    unique.push(entry);
    if (unique.length >= limit) break;
  }

  return unique;
}
