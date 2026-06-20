import { useCallback, useMemo, useRef, useState } from "react";
import { ExternalLink, Instagram, Pause, Play, Volume2, VolumeX } from "lucide-react";
import {
  embedFrameClassName,
  embedSrcFor,
  parseSocialUrl,
  platformLabels,
  postTikTokPlayerMessage,
} from "../../lib/socialExampleUtils";

function TikTokIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.75a8.18 8.18 0 0 0 4.77 1.52V6.82a4.85 4.85 0 0 1-1-.13z" />
    </svg>
  );
}

function PlatformIcon({ platform, className }) {
  if (platform === "tiktok") return <TikTokIcon className={className} />;
  if (platform === "instagram") return <Instagram className={className} />;
  return <ExternalLink className={className} />;
}

function platformAccent(platform) {
  if (platform === "tiktok") return "from-zinc-900 via-zinc-800 to-zinc-950";
  if (platform === "instagram") return "from-fuchsia-600 via-purple-600 to-orange-500";
  if (platform === "facebook") return "from-blue-600 to-blue-800";
  return "from-violet-600 to-indigo-700";
}

export default function SocialExampleCard({ label, url, lang = "en" }) {
  const labels = platformLabels(lang);
  const parsed = useMemo(() => parseSocialUrl(url), [url]);
  const iframeRef = useRef(null);
  const instagramSrcRef = useRef(null);

  const [hovered, setHovered] = useState(false);
  const [withSound, setWithSound] = useState(false);
  const [paused, setPaused] = useState(false);

  const showEmbed = Boolean(parsed?.embedUrl && (hovered || withSound || paused));
  const embedSrc = useMemo(
    () => embedSrcFor(parsed, { muted: true, autoplay: true }),
    [parsed],
  );

  const keepPreviewOpen = withSound || paused;

  const togglePause = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const iframe = iframeRef.current;
      if (!iframe || !parsed?.embedUrl) return;

      const nextPaused = !paused;
      if (parsed.platform === "tiktok") {
        postTikTokPlayerMessage(iframe, nextPaused ? "pause" : "play");
      } else if (parsed.platform === "instagram") {
        if (nextPaused) {
          instagramSrcRef.current = iframe.src;
          iframe.src = "about:blank";
        } else {
          iframe.src = instagramSrcRef.current || embedSrc;
        }
      }
      setPaused(nextPaused);
    },
    [parsed, paused, embedSrc],
  );

  const toggleSound = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const iframe = iframeRef.current;
      if (!iframe || !parsed?.embedUrl) return;

      const nextWithSound = !withSound;
      if (parsed.platform === "tiktok") {
        if (nextWithSound) {
          iframe.src = embedSrcFor(parsed, { muted: false, autoplay: true });
          setPaused(false);
        } else {
          postTikTokPlayerMessage(iframe, "mute");
        }
      } else if (parsed.platform === "instagram") {
        const src = instagramSrcRef.current || embedSrc;
        instagramSrcRef.current = src;
        iframe.src = "about:blank";
        iframe.src = src;
        if (paused) setPaused(false);
      }
      setWithSound(nextWithSound);
    },
    [parsed, withSound, paused, embedSrc],
  );

  const activatePreview = useCallback(() => {
    if (!parsed?.embedUrl) return;
    setHovered(true);
  }, [parsed?.embedUrl]);

  const handlePreviewTap = useCallback(
    (event) => {
      if (!parsed?.embedUrl) return;
      if (!showEmbed) {
        activatePreview();
        return;
      }
      togglePause(event);
    },
    [parsed?.embedUrl, showEmbed, activatePreview, togglePause],
  );

  const platformName = labels[parsed?.platform] || labels.link;

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow ${
        keepPreviewOpen
          ? "border-violet-400 ring-2 ring-violet-200"
          : "border-zinc-200 hover:border-violet-300 hover:shadow-md"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        if (!keepPreviewOpen) setHovered(false);
      }}
    >
      <div
        role="button"
        tabIndex={0}
        className="relative aspect-[9/16] w-full cursor-pointer overflow-hidden bg-zinc-100 text-left"
        onClick={handlePreviewTap}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handlePreviewTap(event);
          }
        }}
        aria-label={`${label} — ${parsed?.embedUrl ? labels.tapPreview : labels.previewUnavailable}`}
      >
        {showEmbed && embedSrc ? (
          <div className="absolute inset-0 overflow-hidden bg-black">
            <iframe
              ref={iframeRef}
              title={label}
              src={embedSrc}
              className={embedFrameClassName(parsed?.platform)}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-10">
              <button
                type="button"
                onClick={togglePause}
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/85"
                aria-label={paused ? labels.play : labels.pause}
              >
                {paused ? (
                  <Play className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Pause className="h-3.5 w-3.5" aria-hidden />
                )}
                {paused ? labels.play : labels.pause}
              </button>

              <button
                type="button"
                onClick={toggleSound}
                className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/85"
                aria-label={withSound ? labels.soundOff : labels.soundOn}
              >
                {withSound ? (
                  <Volume2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" aria-hidden />
                )}
                {withSound ? labels.soundOn : labels.clickSound}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br ${platformAccent(parsed?.platform)} px-4 text-center text-white`}
          >
            <PlatformIcon platform={parsed?.platform} className="mb-3 h-10 w-10 opacity-90" />
            <p className="text-xs font-medium uppercase tracking-wider opacity-80">
              {platformName}
            </p>
            <p className="mt-2 text-sm font-semibold leading-snug">{label}</p>
            <p className="mt-3 text-xs opacity-75">
              {parsed?.embedUrl ? labels.hoverPreview : labels.previewUnavailable}
            </p>
          </div>
        )}

        {showEmbed && paused ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
            <span className="rounded-full bg-black/60 p-3 text-white">
              <Play className="h-8 w-8" aria-hidden />
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-3 py-2.5">
        <p className="min-w-0 truncate text-sm font-medium text-zinc-800" title={label}>
          {label}
        </p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
          onClick={(event) => event.stopPropagation()}
        >
          {labels.openOn} {platformName}
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>
    </article>
  );
}
