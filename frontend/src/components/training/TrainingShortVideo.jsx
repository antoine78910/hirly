import { useState } from "react";
import { Video } from "lucide-react";
import { resolveApiAssetUrl } from "../../lib/api";

export default function TrainingShortVideo({ block, lang = "fr" }) {
  const [failed, setFailed] = useState(false);
  const resolvedUrl = resolveApiAssetUrl(block.video_url || "");
  const aspect = block.aspect === "9:16" ? "aspect-[9/16]" : "aspect-video";
  const slotLabel = block.upload_label || block.upload_slot || "";

  if (resolvedUrl && !failed) {
    return (
      <div
        className="mx-auto w-full max-w-[280px] overflow-hidden rounded-2xl bg-zinc-900 shadow-lg ring-1 ring-zinc-200"
        data-testid={`short-video-${block.upload_slot || "inline"}`}
      >
        <video
          src={resolvedUrl}
          controls
          playsInline
          className={`${aspect} w-full bg-black object-cover`}
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`mx-auto flex w-full max-w-[280px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center ${aspect}`}
      data-testid={`short-video-placeholder-${block.upload_slot || "inline"}`}
    >
      <Video className="h-8 w-8 text-zinc-300" aria-hidden />
      <p className="text-sm font-medium text-zinc-600">
        {lang === "fr" ? "Short 9:16 à venir" : "9:16 short coming soon"}
      </p>
      {slotLabel ? (
        <p className="text-xs text-zinc-400">{slotLabel}</p>
      ) : null}
      {block.upload_slot && lang === "fr" ? (
        <p className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-zinc-400">
          Upload : Admin → Formation →
          {" "}
          {slotLabel || block.upload_slot}
        </p>
      ) : null}
    </div>
  );
}
