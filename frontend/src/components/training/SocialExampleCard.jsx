import { useCallback, useMemo, useState } from "react";
import { ExternalLink, Instagram, Music2, Volume2 } from "lucide-react";
import {
  embedSrcFor,
  parseSocialUrl,
  platformLabels,
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
  const [hovered, setHovered] = useState(false);
  const [withSound, setWithSound] = useState(false);
  const [embedKey, setEmbedKey] = useState(0);

  const showEmbed = Boolean(parsed?.embedUrl && (hovered || withSound));
  const embedSrc = useMemo(
    () => embedSrcFor(parsed, { muted: !withSound, autoplay: showEmbed }),
    [parsed, withSound, showEmbed],
  );

  const enableSound = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!parsed?.embedUrl) return;
    setWithSound(true);
    setEmbedKey((k) => k + 1);
  }, [parsed?.embedUrl]);

  const handlePreviewTap = useCallback(() => {
    if (!parsed?.embedUrl) return;
    if (!hovered) {
      setHovered(true);
      return;
    }
    if (!withSound) {
      setWithSound(true);
      setEmbedKey((k) => k + 1);
    }
  }, [parsed?.embedUrl, hovered, withSound]);

  const platformName = labels[parsed?.platform] || labels.link;

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-shadow ${
        withSound ? "border-violet-400 ring-2 ring-violet-200" : "border-zinc-200 hover:border-violet-300 hover:shadow-md"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        if (!withSound) setHovered(false);
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
            handlePreviewTap();
          }
        }}
        aria-label={`${label} — ${parsed?.embedUrl ? labels.tapPreview : labels.previewUnavailable}`}
      >
        {showEmbed && embedSrc ? (
          <iframe
            key={embedKey}
            title={label}
            src={embedSrc}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
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

        {showEmbed && parsed?.embedUrl && !withSound ? (
          <button
            type="button"
            onClick={enableSound}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/85"
          >
            <Volume2 className="h-3.5 w-3.5" aria-hidden />
            {labels.clickSound}
          </button>
        ) : null}

        {withSound ? (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-violet-600/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
            <Music2 className="h-3 w-3" aria-hidden />
            ON
          </span>
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
