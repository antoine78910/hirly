import { getJobOfferDetailRows } from "../../lib/jobDisplayUtils";

export default function JobOfferDetails({
  job,
  t,
  lang = "en",
  theme,
  compact = false,
}) {
  const rows = getJobOfferDetailRows(job, { t, lang });
  if (!rows.length) return null;

  const labelClass = theme?.cardMeta || "text-sprout-muted";
  const valueClass = theme?.cardAboutBody || "text-zinc-100";
  const sectionClass = theme?.cardSection || "rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3";
  const itemGap = compact ? "space-y-2.5" : "space-y-3";

  return (
    <section className={sectionClass} data-testid="job-offer-details">
      <dl className={itemGap}>
        {rows.map((row) => (
          <div key={row.key}>
            <dt className={`text-xs font-semibold uppercase tracking-wide ${labelClass}`}>
              {row.label}
            </dt>
            <dd className={`mt-1 text-sm leading-relaxed ${valueClass}`}>
              {row.items?.length ? (
                <ul className="space-y-1">
                  {row.items.map((item) => (
                    <li key={`${row.key}-${item}`} className="flex items-start gap-2">
                      <span className="mt-1.5 text-[8px] text-sprout-mint">●</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span>{row.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
