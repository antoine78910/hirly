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
};

const DISPLAY_NAMES = Object.fromEntries(
  Object.keys(COMPANIES).map((k) => [k, k.charAt(0).toUpperCase() + k.slice(1)]),
);

function companyKey(company) {
  const resolved = resolveCompanyName(company) || company;
  if (!resolved) return null;
  return String(resolved).trim().toLowerCase();
}

/** Resolve a free-form label ("Linear Recruiting") to a canonical company name. */
export function resolveCompanyName(label) {
  if (!label) return null;
  const lower = String(label).trim().toLowerCase();
  for (const key of Object.keys(COMPANIES)) {
    if (lower === key || lower.includes(key)) return DISPLAY_NAMES[key];
  }
  return null;
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
  const urls = [`https://cdn.simpleicons.org/${slug}`];
  if (domain) {
    urls.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  }
  return urls;
}

/** @deprecated Use getCompanyLogoUrls */
export function getCompanyLogoUrl(company) {
  return getCompanyLogoUrls(company)[0] || null;
}
