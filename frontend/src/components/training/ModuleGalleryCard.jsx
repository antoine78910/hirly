import { CheckCircle2, Lock, Play } from "lucide-react";

function coverLabel(title) {
  if (!title) return "";
  const parts = title.split(/\s*[&:–—]\s*/);
  return parts[0]?.trim() || title;
}

const SIZE_STYLES = {
  default: {
    shell: "rounded-lg",
    cover: "min-h-[120px] px-4 py-5 sm:min-h-[132px]",
    title: "text-xl sm:text-2xl",
    refBadge: "px-2 py-0.5 text-[10px]",
    iconWrap: "p-1",
    checkIcon: "h-5 w-5",
    lockIcon: "h-4 w-4",
    lockWrap: "p-1.5",
    footer: "px-3 py-2.5",
    footerIcon: "h-3.5 w-3.5",
    footerText: "text-xs sm:text-sm",
  },
  hub: {
    shell: "h-full min-h-0 rounded-lg",
    cover: "min-h-0 flex-1 px-3 py-2 sm:px-4",
    title: "text-base font-bold leading-tight sm:text-lg",
    refBadge: "px-1.5 py-px text-[8px] sm:text-[9px]",
    iconWrap: "p-0.5",
    checkIcon: "h-4 w-4",
    lockIcon: "h-3.5 w-3.5",
    lockWrap: "p-1",
    footer: "shrink-0 px-2.5 py-1.5 sm:px-3",
    footerIcon: "h-3 w-3",
    footerText: "text-[11px] sm:text-xs",
  },
  compact: {
    shell: "rounded-md",
    cover: "min-h-[4.5rem] px-3 py-3",
    title: "text-sm sm:text-base",
    refBadge: "px-1.5 py-px text-[8px]",
    iconWrap: "p-0.5",
    checkIcon: "h-3.5 w-3.5",
    lockIcon: "h-3 w-3",
    lockWrap: "p-1",
    footer: "px-2 py-1.5",
    footerIcon: "h-3 w-3",
    footerText: "text-[10px] sm:text-xs",
  },
};

export default function ModuleGalleryCard({
  module,
  index,
  active,
  locked,
  onSelect,
  t,
  compact = false,
  size,
}) {
  const isReference = module.category === "reference";
  const variant = size || (compact ? "compact" : "default");
  const s = SIZE_STYLES[variant] || SIZE_STYLES.default;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={locked}
      className={`group flex w-full flex-col overflow-hidden text-left shadow-md transition-all ${s.shell} ${
        active
          ? "ring-2 ring-violet-500 ring-offset-1 ring-offset-white"
          : "hover:ring-1 hover:ring-violet-400/40"
      } ${locked ? "cursor-not-allowed opacity-45" : ""}`}
    >
      <div
        className={`relative flex flex-1 items-center justify-center ${s.cover} ${
          isReference
            ? "bg-gradient-to-br from-indigo-600 via-violet-700 to-purple-800"
            : "gradient-linkedin"
        }`}
      >
        {isReference && (
          <span className={`absolute left-2.5 top-2.5 rounded-full bg-white/15 font-semibold uppercase tracking-wider text-white/80 sm:left-3 sm:top-3 ${s.refBadge}`}>
            {t("refBadge")}
          </span>
        )}
        <p className={`text-center font-display font-bold leading-snug text-white ${s.title}`}>
          {coverLabel(module.title)}
        </p>
        {module.completed ? (
          <span className={`absolute right-2.5 top-2.5 rounded-full bg-black/30 sm:right-3 sm:top-3 ${s.iconWrap}`}>
            <CheckCircle2 className={`text-emerald-300 ${s.checkIcon}`} />
          </span>
        ) : null}
        {locked ? (
          <span className={`absolute left-2.5 top-2.5 rounded-full bg-black/30 sm:left-3 sm:top-3 ${s.lockWrap}`}>
            <Lock className={`text-white/80 ${s.lockIcon}`} />
          </span>
        ) : null}
      </div>
      <div className={`flex min-h-0 shrink-0 items-center gap-1.5 bg-black ${s.footer}`}>
        <Play className={`shrink-0 fill-white text-white ${s.footerIcon}`} />
        <span className={`min-w-0 truncate font-medium text-zinc-200 ${s.footerText}`}>
          {module.title}
        </span>
      </div>
    </button>
  );
}
