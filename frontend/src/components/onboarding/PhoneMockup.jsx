import { useState } from "react";
import { ImageIcon } from "lucide-react";

/**
 * iPhone-style frame for onboarding showcase screenshots.
 * Drop PNGs into `public/onboarding/` and set paths in onboardingData.js.
 */
export default function PhoneMockup({
  src,
  alt = "App screenshot",
  placeholderLabel = "App screenshot",
  width = 148,
  tilt = 0,
  scale = 1,
  zIndex = 1,
  className = "",
}) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !src || failed;
  const url = src ? `${process.env.PUBLIC_URL || ""}${src}` : null;

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ transform: `rotate(${tilt}deg) scale(${scale})`, zIndex, width }}
    >
      <div className="rounded-[1.6rem] border-[3px] border-zinc-900 bg-zinc-900 p-[5px] shadow-[0_24px_56px_-18px_rgba(124,58,237,0.4)]">
        <div className="relative overflow-hidden rounded-[1.25rem] bg-zinc-950">
          <div className="absolute left-1/2 top-1.5 z-10 h-[10px] w-[28%] min-w-[52px] -translate-x-1/2 rounded-full bg-zinc-900" />

          <div className="aspect-[9/19.5] w-full bg-zinc-100">
            {showPlaceholder ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-violet-50 via-white to-indigo-50 px-3 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-dashed border-violet-300/80 bg-white/80">
                  <ImageIcon className="h-5 w-5 text-violet-400" strokeWidth={1.8} />
                </div>
                <p className="text-[10px] font-semibold leading-snug text-violet-700">{placeholderLabel}</p>
                {src ? (
                  <p className="font-mono text-[8px] text-zinc-400">{src}</p>
                ) : null}
              </div>
            ) : (
              <img
                src={url}
                alt={alt}
                className="h-full w-full object-cover object-top"
                draggable={false}
                onError={() => setFailed(true)}
              />
            )}
          </div>

          <div className="absolute bottom-1 left-1/2 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-zinc-900/35" />
        </div>
      </div>
    </div>
  );
}
