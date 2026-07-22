import { useEffect, useRef } from "react";

function loadPlayerJs() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.playerjs?.Player) return Promise.resolve(window.playerjs.Player);

  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-bunny-playerjs="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.playerjs?.Player || null), {
        once: true,
      });
      existing.addEventListener("error", () => resolve(null), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js";
    script.dataset.bunnyPlayerjs = "true";
    script.async = true;
    script.onload = () => resolve(window.playerjs?.Player || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

export default function BunnyVideoIframe({ embedUrl, title, onVideoEnded }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!onVideoEnded) return undefined;

    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    let player = null;
    let cancelled = false;

    const attach = async () => {
      const Player = await loadPlayerJs();
      if (cancelled || !iframeRef.current || !Player) return;

      try {
        player = new Player(iframeRef.current);
        player.on("ready", () => {
          if (!cancelled && onVideoEnded) {
            player.on("ended", onVideoEnded);
          }
        });
      } catch {
        /* Bunny iframe may block playerjs — playback still works without ended hook */
      }
    };

    const onLoad = () => {
      attach();
    };

    iframe.addEventListener("load", onLoad);

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
      try {
        player?.off?.("ended", onVideoEnded);
      } catch {
        /* ignore */
      }
    };
  }, [embedUrl, onVideoEnded]);

  return (
    <div className="overflow-hidden rounded-lg bg-zinc-900 shadow-lg ring-1 ring-zinc-700/50">
      <div className="relative aspect-video">
        <iframe
          ref={iframeRef}
          title={title}
          src={embedUrl}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    </div>
  );
}
