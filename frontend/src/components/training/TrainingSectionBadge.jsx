/** Corner label for training sub-chapters (e.g. "Top format"). */

export default function TrainingSectionBadge({ label, size = "md", className = "" }) {
  if (!label) return null;

  const sizeClass =
    size === "sm"
      ? "px-1.5 py-0.5 text-[9px]"
      : "px-2 py-0.5 text-[10px] sm:text-xs";

  return (
    <span
      className={`inline-flex shrink-0 rounded-full bg-amber-400 font-bold uppercase tracking-wide text-amber-950 shadow-sm ${sizeClass} ${className}`}
    >
      {label}
    </span>
  );
}
