/** Parse TikTok / Instagram / Facebook URLs for embed previews. */

export function parseSocialUrl(url) {
  if (!url) return null;

  let match = url.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (match) {
    return {
      platform: "tiktok",
      id: match[1],
      embedUrl: `https://www.tiktok.com/player/v1/${match[1]}`,
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
    const params = new URLSearchParams({
      controls: "0",
      progress_bar: "0",
      play_button: "0",
      volume_control: "0",
      fullscreen_button: "0",
      timestamp: "0",
      music_info: "0",
      description: "0",
      rel: "0",
      native_context_menu: "0",
      closed_caption: "0",
      // muted=1 locks volume on TikTok's player (unMute postMessage won't work until muted=0).
      muted: muted ? "1" : "0",
      loop: "1",
    });
    if (autoplay) params.set("autoplay", "1");
    return `${parsed.embedUrl}?${params.toString()}`;
  }
  return parsed.embedUrl;
}

/** Crop official embed chrome so the preview focuses on the video area. */
export function embedFrameClassName(platform) {
  if (platform === "instagram") return "social-embed-frame social-embed-frame--instagram";
  if (platform === "tiktok") return "social-embed-frame social-embed-frame--tiktok";
  return "social-embed-frame";
}

/** TikTok player v1 — host → iframe commands (play, pause, mute, unMute). */
export function postTikTokPlayerMessage(iframe, type, value) {
  if (!iframe?.contentWindow) return;
  const message = { type, "x-tiktok-player": true };
  if (value !== undefined) message.value = value;
  iframe.contentWindow.postMessage(message, "*");
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
    soundOn: "Sound on",
    soundOff: "Sound off",
    pause: "Pause",
    play: "Play",
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
    soundOn: "Son activé",
    soundOff: "Son coupé",
    pause: "Pause",
    play: "Lecture",
    openOn: "Ouvrir sur",
    previewUnavailable: "Aperçu indisponible — ouvre le lien",
  },
};

export function platformLabels(lang = "en") {
  return PLATFORM_LABELS[lang] || PLATFORM_LABELS.en;
}
