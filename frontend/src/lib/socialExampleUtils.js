/** Parse TikTok / Instagram / Facebook URLs for embed previews. */

export function parseSocialUrl(url) {
  if (!url) return null;

  let match = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (match) {
    return {
      platform: "tiktok",
      id: match[1],
      embedUrl: `https://www.tiktok.com/embed/v2/${match[1]}`,
      openUrl: url,
    };
  }

  match = url.match(/instagram\.com\/(?:reel|reels|p)\/([^/?#]+)/i);
  if (match) {
    const id = match[1];
    const path = url.includes("/p/") ? "p" : "reel";
    return {
      platform: "instagram",
      id,
      embedUrl: `https://www.instagram.com/${path}/${id}/embed`,
      openUrl: url,
    };
  }

  match = url.match(/facebook\.com\/reel\/(\d+)/i);
  if (match) {
    return {
      platform: "facebook",
      id: match[1],
      embedUrl: null,
      openUrl: url,
    };
  }

  if (/tiktok\.com\/t\//i.test(url)) {
    return {
      platform: "tiktok",
      id: null,
      embedUrl: null,
      openUrl: url,
    };
  }

  return {
    platform: "link",
    id: null,
    embedUrl: null,
    openUrl: url,
  };
}

export function embedSrcFor(parsed, { muted = true, autoplay = false } = {}) {
  if (!parsed?.embedUrl) return null;
  if (parsed.platform === "tiktok") {
    const params = new URLSearchParams();
    if (autoplay) params.set("autoplay", "1");
    if (muted) params.set("mute", "1");
    const qs = params.toString();
    return qs ? `${parsed.embedUrl}?${qs}` : parsed.embedUrl;
  }
  return parsed.embedUrl;
}

export const PLATFORM_LABELS = {
  en: {
    tiktok: "TikTok",
    instagram: "Instagram",
    facebook: "Facebook",
    link: "Open link",
    hoverPreview: "Hover to preview",
    tapPreview: "Tap to preview",
    clickSound: "Click for sound",
    openOn: "Open on",
    previewUnavailable: "Preview unavailable — open the link",
  },
  fr: {
    tiktok: "TikTok",
    instagram: "Instagram",
    facebook: "Facebook",
    link: "Ouvrir le lien",
    hoverPreview: "Survole pour prévisualiser",
    tapPreview: "Appuie pour prévisualiser",
    clickSound: "Clique pour le son",
    openOn: "Ouvrir sur",
    previewUnavailable: "Aperçu indisponible — ouvre le lien",
  },
};

export function platformLabels(lang = "en") {
  return PLATFORM_LABELS[lang] || PLATFORM_LABELS.en;
}
