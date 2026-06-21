/** Known company name → domain + Simple Icons slug. */
const COMPANIES = {
  linear: { domain: "linear.app", slug: "linear" },
  stripe: { domain: "stripe.com", slug: "stripe" },
  vercel: { domain: "vercel.com", slug: "vercel" },
  anthropic: { domain: "anthropic.com", slug: "anthropic" },
  raycast: { domain: "raycast.com", slug: "raycast" },
  supabase: { domain: "supabase.com", slug: "supabase" },
  notion: { domain: "notion.so", slug: "notion" },
  figma: { domain: "figma.com", slug: "figma" },
  shopify: { domain: "shopify.com", slug: "shopify" },
  framer: { domain: "framer.com", slug: "framer" },
  greenhouse: { domain: "greenhouse.io", slug: "greenhouse" },

  // Finance demo — Paris banking & asset management
  "credit agricole": { domain: "ca-cib.com", display: "Crédit Agricole CIB" },
  bnp: { domain: "group.bnpparibas.com", display: "BNP Paribas" },
  generale: { domain: "societegenerale.com", display: "Société Générale" },
  natixis: { domain: "www.natixis.com", display: "Natixis" },
  hsbc: { domain: "hsbc.fr", slug: "hsbc", display: "HSBC France" },
  boursorama: { domain: "boursorama.com", display: "Boursorama" },
  lazard: { domain: "lazard.com", display: "Lazard" },
  amundi: { domain: "amundi.com", display: "Amundi" },
  rothschild: { domain: "rothschildandco.com", display: "Rothschild & Co" },
  deutsche: { domain: "db.com", slug: "deutschebank", display: "Deutsche Bank" },
  axa: { domain: "axa-im.com", display: "AXA Investment Managers" },
  bpce: { domain: "bpce.fr", display: "BPCE" },
};

const COMPANY_KEYS = Object.keys(COMPANIES).sort((a, b) => b.length - a.length);

function normalizeCompanyLabel(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function getDisplayName(key) {
  const entry = COMPANIES[key];
  if (!entry) return null;
  return entry.display || key.charAt(0).toUpperCase() + key.slice(1);
}

function findCompanyKey(label) {
  if (!label) return null;
  const normalized = normalizeCompanyLabel(label);
  for (const key of COMPANY_KEYS) {
    const needle = normalizeCompanyLabel(key);
    if (normalized === needle || normalized.includes(needle)) return key;
  }
  return null;
}

function companyKey(company) {
  return findCompanyKey(company) || (company ? String(company).trim().toLowerCase() : null);
}

/** Resolve a free-form label ("Linear Recruiting") to a canonical company name. */
export function resolveCompanyName(label) {
  const key = findCompanyKey(label);
  return key ? getDisplayName(key) : null;
}

export function getCompanyDomain(company) {
  const key = companyKey(company);
  return key ? COMPANIES[key]?.domain || null : null;
}

/** Ordered logo sources — Simple Icons first (reliable), then Google favicon. */
export function getCompanyLogoUrls(company) {
  const key = companyKey(company);
  if (!key || !COMPANIES[key]) return [];

  const { slug, domain } = COMPANIES[key];
  const urls = [];
  if (slug) urls.push(`https://cdn.simpleicons.org/${slug}`);
  if (domain) {
    urls.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  }
  return urls;
}

/** @deprecated Use getCompanyLogoUrls */
export function getCompanyLogoUrl(company) {
  return getCompanyLogoUrls(company)[0] || null;
}
