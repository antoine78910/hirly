/** Corner label for training sub-chapters (e.g. "Top format"). */

export default function TrainingSectionBadge({
  label,
  size = "sm",
  className = "",
  active = false,
}) {
  if (!label) return null;

  const sizeClass =
    size === "xs"
      ? "px-1.5 py-0.5 text-[8px] tracking-[0.12em]"
      : "px-2 py-0.5 text-[9px] tracking-[0.1em] sm:text-[10px]";

  const toneClass = active
    ? "border-white/40 bg-white text-violet-700 shadow-violet-900/20"
    : "border-violet-500 bg-violet-600 text-white shadow-violet-300/30";

  return (
    <span
      className={`pointer-events-none absolute -right-2 -top-2 z-10 inline-flex max-w-[5.5rem] items-center justify-center rounded-full border font-semibold uppercase leading-none shadow-sm ${sizeClass} ${toneClass} ${className}`}
    >
      {label}
    </span>
  );
}
