import { Zap } from "lucide-react";
import { getJobCardHighlightRows, getJobMatchScore } from "../../lib/jobDisplayUtils";

export function JobCardMatchBadge({ job, t, className = "" }) {
  const score = getJobMatchScore(job);
  if (!score) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-sprout-mint/15 px-2.5 py-1 text-[11px] font-bold text-sprout-mint sm:text-xs ${className}`}
      data-testid="job-match-badge"
    >
      <Zap className="h-3 w-3 shrink-0" aria-hidden="true" />
      {score}% {t("swipe.matchLabel")}
    </span>
  );
}

export default function JobCardHighlights({
  job,
  t,
  lang,
  max = 3,
  theme,
  compact = false,
}) {
  const rows = getJobCardHighlightRows(job, { t, lang, max });
  if (!rows.length) return null;

  const labelClass = theme?.cardMeta || "text-sprout-muted";
  const valueClass = theme?.cardAboutBody || "text-zinc-100";
  const wrapClass = compact
    ? "rounded-xl border border-sprout-border/70 bg-sprout-surface-2/35 px-3 py-2.5"
    : "rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3";

  return (
    <div className={wrapClass} data-testid="job-card-highlights">
      <dl className={compact ? "space-y-1.5" : "space-y-2"}>
        {rows.map((row) => (
          <div key={row.key} className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-2 gap-y-0.5 text-left sm:grid-cols-[minmax(0,34%)_1fr]">
            <dt className={`text-[10px] font-semibold uppercase tracking-wide sm:text-[11px] ${labelClass}`}>
              {row.label}
            </dt>
            <dd className={`text-[11px] leading-snug sm:text-xs ${valueClass}`}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
