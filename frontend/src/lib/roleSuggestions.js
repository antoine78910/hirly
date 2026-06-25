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
      "Data Analyst",
      "Data Scientist",
      "Business Analyst",
      "QA Engineer",
      "DevOps Engineer",
      "IT Support Specialist",
    ],
  },
  {
    group: "Product & Design",
    roles: [
      "Product Manager",
      "Project Manager",
      "Graphic Designer",
      "UX/UI Designer",
      "Product Designer",
      "Content Designer",
      "Researcher",
    ],
  },
  {
    group: "Business",
    roles: [
      "Market Analyst",
      "Marketing Manager",
      "Sales Representative",
      "Customer Support",
      "Operations Manager",
      "HR Assistant",
      "Administrative Assistant",
      "Receptionist",
      "Office Manager",
      "Executive Assistant",
    ],
  },
  {
    group: "Finance",
    roles: [
      "Finance Analyst",
      "Accountant",
      "Bookkeeper",
      "Financial Advisor",
      "Payroll Specialist",
      "Accounts Assistant",
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
    ],
  },
  {
    group: "Service & Operations",
    roles: [
      "Waiter",
      "Barista",
      "Warehouse Worker",
      "Driver",
      "Delivery Driver",
      "Retail Assistant",
      "Store Manager",
      "Cleaner",
      "Security Guard",
      "Chef",
      "Kitchen Assistant",
    ],
  },
];

const ROLE_INDEX = ROLE_GROUPS.flatMap(({ group, roles }) =>
  roles.map((role) => ({ role, group })),
);

const GROUP_BY_ROLE = new Map(ROLE_INDEX.map(({ role, group }) => [role, group]));

export const POPULAR_ROLES = [
  "Software Engineer",
  "Product Manager",
  "Data Analyst",
  "Marketing Manager",
  "Sales Representative",
  "UX/UI Designer",
  "Project Manager",
  "Customer Support",
  "Full Stack Developer",
  "Operations Manager",
];

function scoreRole(role, query, relatedRole, lang = "en", group = "") {
  const normalizedRole = role.toLowerCase();
  const normalizedDisplayRole = translateRoleLabel(role, lang).toLowerCase();
  const normalizedDisplayGroup = translateRoleGroupLabel(group, lang).toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  let score = 0;

  if (!normalizedQuery) {
    if (POPULAR_ROLES.includes(role)) score += 12;
    if (relatedRole) {
      const relatedGroup = GROUP_BY_ROLE.get(relatedRole);
      if (relatedGroup && relatedGroup === GROUP_BY_ROLE.get(role)) score += 24;
    }
    return score;
  }

  if (normalizedRole === normalizedQuery || normalizedDisplayRole === normalizedQuery) score += 120;
  else if (normalizedRole.startsWith(normalizedQuery) || normalizedDisplayRole.startsWith(normalizedQuery)) score += 90;
  else if (
    normalizedRole.split(/\s+/).some((word) => word.startsWith(normalizedQuery))
    || normalizedDisplayRole.split(/\s+/).some((word) => word.startsWith(normalizedQuery))
  ) score += 70;
  else if (
    normalizedRole.includes(normalizedQuery)
    || normalizedDisplayRole.includes(normalizedQuery)
    || normalizedDisplayGroup.includes(normalizedQuery)
  ) score += 45;

  if (relatedRole) {
    const relatedGroup = GROUP_BY_ROLE.get(relatedRole);
    if (relatedGroup && relatedGroup === GROUP_BY_ROLE.get(role)) score += 8;
  }

  return score;
}

/** Ranked role suggestions for autocomplete (empty query → popular / related roles). */
export function searchRoleSuggestions(query, { limit = 8, relatedRole, lang = "en" } = {}) {
  const normalizedQuery = query.trim().toLowerCase();

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
