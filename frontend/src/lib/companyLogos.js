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

const GENERIC_DOMAIN_NOISE = new Set([
  "recruiting",
  "france",
  "international",
  "group",
  "holdings",
  "services",
  "solutions",
  "technologies",
  "technology",
  "tech",
  "global",
  "consulting",
  "partners",
  "bank",
  "banque",
  "inc",
  "ltd",
  "sa",
  "sas",
  "sarl",
  "gmbh",
]);

/** Normalize provider logo URLs (absolute, France Travail relative paths, etc.). */
export function normalizeCompanyLogoUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://www.francetravail.fr${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

export function getJobCompanyLogoUrl(job) {
  if (!job) return null;
  const nested = job.data && typeof job.data === "object" ? job.data.company_logo : null;
  return normalizeCompanyLogoUrl(job.company_logo || nested);
}

function guessCompanyDomain(company) {
  const key = findCompanyKey(company);
  if (key && COMPANIES[key]?.domain) return COMPANIES[key].domain;

  const normalized = normalizeCompanyLabel(company);
  if (!normalized) return null;
  const words = normalized.split(/\s+/).filter((word) => word && !GENERIC_DOMAIN_NOISE.has(word));
  const slug = words.join("").replace(/[^a-z0-9]+/g, "");
  if (slug.length < 2) return null;
  return `${slug}.com`;
}

function pushUnique(urls, seen, url) {
  if (!url || seen.has(url)) return;
  seen.add(url);
  urls.push(url);
}

/** Ordered logo sources — provider URL first, then known brands, then Clearbit/favicon fallbacks. */
export function getCompanyLogoUrls(company, directLogoUrl = null) {
  const urls = [];
  const seen = new Set();
  pushUnique(urls, seen, normalizeCompanyLogoUrl(directLogoUrl));

  const key = companyKey(company);
  const known = key ? COMPANIES[key] : null;
  const domain = known?.domain || guessCompanyDomain(company);

  if (known?.slug) pushUnique(urls, seen, `https://cdn.simpleicons.org/${known.slug}`);
  if (domain) {
    pushUnique(urls, seen, `https://logo.clearbit.com/${domain}?size=128`);
    pushUnique(urls, seen, `https://icons.duckduckgo.com/ip3/${domain}.ico`);
    pushUnique(urls, seen, `https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  }

  return urls;
}

/** @deprecated Use getCompanyLogoUrls */
export function getCompanyLogoUrl(company, directLogoUrl = null) {
  return getCompanyLogoUrls(company, directLogoUrl)[0] || null;
}

/** Warm browser cache for upcoming swipe cards. */
export function preloadCompanyLogos(jobs, limit = 6) {
  if (typeof window === "undefined" || !Array.isArray(jobs)) return;
  jobs.slice(0, limit).forEach((job) => {
    const company = resolveCompanyName(job?.company) || job?.company;
    const urls = getCompanyLogoUrls(company, getJobCompanyLogoUrl(job));
    const src = urls[0];
    if (!src) return;
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.src = src;
  });
}
