/** Stable 6-char referral code from user id (demo-friendly). */
export function referralCodeFromUserId(userId) {
  const seed = String(userId || "guest");
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(6, "0").slice(-6);
}

const FOLLOWED_KEY = "swiipr_social_followed";

export function getFollowedSocials() {
  try {
    const raw = localStorage.getItem(FOLLOWED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function markSocialFollowed(platform) {
  const current = getFollowedSocials();
  if (current.includes(platform)) return current;
  const next = [...current, platform];
  localStorage.setItem(FOLLOWED_KEY, JSON.stringify(next));
  return next;
}
