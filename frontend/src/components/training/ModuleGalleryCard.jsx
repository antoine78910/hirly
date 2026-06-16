import { CheckCircle2, Lock, Play } from "lucide-react";

function coverLabel(title) {
  if (!title) return "";
  const parts = title.split(/\s*[&:–—]\s*/);
  return parts[0]?.trim() || title;
}

function cardGradient(category) {
  if (category === "reference") return "from-teal-800 to-teal-700";
  return "from-zinc-900 to-zinc-700";
}

export default function ModuleGalleryCard({
  module,
  index,
  active,
  locked,
  onSelect,
  t,
}) {
  const isReference = module.category === "reference";

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={locked}
      className={`group flex flex-col overflow-hidden rounded-md text-left shadow-md transition-all ${
        active
          ? `ring-2 ring-offset-2 ring-offset-white ${isReference ? "ring-teal-500" : "ring-zinc-700"}`
          : "hover:ring-1 hover:ring-zinc-400/40"
      } ${locked ? "cursor-not-allowed opacity-45" : ""}`}
    >
      <div
        className={`relative flex min-h-[120px] items-center justify-center bg-gradient-to-br ${cardGradient(module.category)} px-4 py-5 sm:min-h-[132px]`}
      >
        {isReference && (
          <span className="absolute left-3 top-3 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/70">
            Ref
          </span>
        )}
        <p className="text-center font-display text-xl font-bold leading-tight text-white sm:text-2xl">
          {coverLabel(module.title)}
        </p>
        {module.completed ? (
          <span className="absolute right-3 top-3 rounded-full bg-black/30 p-1">
            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          </span>
        ) : null}
        {locked ? (
          <span className="absolute left-3 top-3 rounded-full bg-black/30 p-1.5">
            <Lock className="h-4 w-4 text-white/80" />
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2 bg-black px-3 py-2.5">
        <Play className="h-3.5 w-3.5 shrink-0 fill-white text-white" />
        <span className="min-w-0 truncate text-xs font-medium text-zinc-200 sm:text-sm">
          {t("moduleLine", { n: index + 1, title: module.title })}
        </span>
      </div>
    </button>
  );
}
