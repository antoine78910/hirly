/**
 * Real performance data pulled from Hirly's own UGC creator accounts
 * (@eloworks0 and @hirlyjob on TikTok). Views/likes/etc. are snapshots
 * taken 2026-07-18 — they only grow from here, never re-scraped live.
 */

export const CPM_RATE = 1; // $ per 1,000 views

// Only show the earnings badge on videos viral enough that the payout is
// actually impressive — smaller clips just show the view count.
export const VIRAL_VIEWS_THRESHOLD = 30000;

export const creatorVideos = [
  {
    id: "7661332402953915680",
    creator: "eloworks",
    handle: "@eloworks0",
    platform: "TikTok",
    url: "https://www.tiktok.com/@eloworks0/video/7661332402953915680",
    thumbnail: "/creators/taff-en-deux-jours.jpg",
    caption: "J'ai rencontré un mec qui a trouvé un taff en deux jours et il m'a montré ça, je suis choquée",
    views: 235700,
    likes: 8529,
    comments: 30,
    shares: 910,
    saves: 6712,
  },
  {
    id: "7660866158328876320",
    creator: "eloworks",
    handle: "@eloworks0",
    platform: "TikTok",
    url: "https://www.tiktok.com/@eloworks0/video/7660866158328876320",
    thumbnail: "/creators/embrasser-la-meuf.jpg",
    caption: "Je pourrais littéralement embrasser la meuf qui m'a montré ça",
    views: 95100,
    likes: 1986,
    comments: 16,
    shares: 373,
    saves: 2445,
  },
  {
    id: "7663172127675174176",
    creator: "eloworks",
    handle: "@eloworks0",
    platform: "TikTok",
    url: "https://www.tiktok.com/@eloworks0/video/7663172127675174176",
    thumbnail: "/creators/mec-ou-taff.jpg",
    caption: "Pourquoi ça fait 6 mois je cherche un taff et c'est que maintenant que je découvre ce site ?",
    views: 54400,
    likes: 1399,
    comments: 5,
    shares: 277,
    saves: 1801,
  },
  {
    id: "7663562868763151648",
    creator: "eloworks",
    handle: "@eloworks0",
    platform: "TikTok",
    url: "https://www.tiktok.com/@eloworks0/video/7663562868763151648",
    thumbnail: "/creators/environnement-toxique.jpg",
    caption: "Environnement de travail toxique ? Démission. Ici on est comme une famille ? Démission.",
    views: 49800,
    likes: 3457,
    comments: 9,
    shares: 544,
    saves: 3500,
  },
  {
    id: "7660252569985387809",
    creator: "eloworks",
    handle: "@eloworks0",
    platform: "TikTok",
    url: "https://www.tiktok.com/@eloworks0/video/7660252569985387809",
    thumbnail: "/creators/edition-candidature.jpg",
    caption: "Bien, mieux, le top : édition candidature !",
    views: 9541,
    likes: 416,
    comments: 10,
    shares: 142,
    saves: 504,
  },
  {
    id: "7660618009211358496",
    creator: "eloworks",
    handle: "@eloworks0",
    platform: "TikTok",
    url: "https://www.tiktok.com/@eloworks0/video/7660618009211358496",
    thumbnail: "/creators/moyens-secrets-2026.jpg",
    caption: "Moyens secrets de trouver un job en 2026",
    views: 7374,
    likes: 245,
    comments: 6,
    shares: 48,
    saves: 330,
  },
  {
    id: "7659115983663058209",
    creator: "Eva",
    handle: "@hirlyjob",
    platform: "TikTok",
    url: "https://www.tiktok.com/@hirlyjob/video/7659115983663058209",
    thumbnail: "/creators/potes-diplomes.jpg",
    caption: "Mes potes diplômés, deux stages en big tech, qui n'ont toujours pas trouvé d'emploi...",
    views: 3942,
    likes: 88,
    comments: 6,
    shares: 13,
    saves: 5,
  },
];

// Sorted views-desc, most viral first.
export const topCreatorVideos = [...creatorVideos].sort((a, b) => b.views - a.views);

export const totalViews = creatorVideos.reduce((sum, v) => sum + v.views, 0);
export const totalEarnings = Math.round((totalViews / 1000) * CPM_RATE);
export const creatorCount = new Set(creatorVideos.map((v) => v.handle)).size;

export const formatViews = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
};

export const formatEarnings = (views) => `$${((views / 1000) * CPM_RATE).toFixed(2)}`;
