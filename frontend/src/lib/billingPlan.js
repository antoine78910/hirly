/** Map stored billing plan ids to user-facing tier labels. */

const PLAN_TIER_LABELS = {
  basic: "Basic",
  pro: "Pro",
  ultra: "Ultra",
  monthly: "Pro",
  quarterly: "Ultra",
};

const PLAN_ALIASES = {
  monthly: "pro",
  quarterly: "ultra",
};

export function canonicalPlanTier(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (!normalized) return null;
  return PLAN_ALIASES[normalized] || normalized;
}

export function planTierLabel(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (!normalized) return null;
  return PLAN_TIER_LABELS[normalized] || null;
}

export function formatPlanTier(plan, { fallback = null } = {}) {
  return planTierLabel(plan) || fallback;
}
