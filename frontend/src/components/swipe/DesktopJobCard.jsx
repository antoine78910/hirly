import {
  BarChart3,
  Briefcase,
  Calendar,
  Factory,
  FileText,
  GraduationCap,
  Laptop,
  MapPin,
  Star,
  Zap,
} from "lucide-react";
import Logo from "../Logo";
import {
  getJobBadgeItems,
  getJobDisplayContent,
} from "../../lib/jobDisplayUtils";

function formatPosted(iso) {
  if (!iso) return "Posted recently";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return "Posted today";
  if (diff === 1) return "Posted 1 day ago";
  return `Posted ${diff} days ago`;
}

const BADGE_ICONS = {
  contract: Briefcase,
  graduation: GraduationCap,
  chart: BarChart3,
  laptop: Laptop,
  factory: Factory,
};

function JobBadge({ label, icon, theme }) {
  const Icon = BADGE_ICONS[icon] || Briefcase;
  return (
    <span
      className={`inline-flex max-w-48 shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap ${theme.cardBadge}`}
    >
      {icon !== "contract" ? <Icon className="size-3 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

function sectionMeta(title) {
  const normalized = (title || "").toLowerCase();
  if (/desired|nice to have|preferred|souhait|plus|atout/i.test(normalized)) {
    return { Icon: Star, iconClass: "text-amber-500" };
  }
  if (/required|requirement|requis|profil recherch/i.test(normalized)) {
    return { Icon: Briefcase, iconClass: "text-violet-600 dark:text-violet-400" };
  }
  if (/about/i.test(normalized)) {
    return { Icon: FileText, iconClass: "text-violet-600 dark:text-violet-400" };
  }
  return { Icon: FileText, iconClass: "text-violet-600 dark:text-violet-400" };
}

function DetailSection({ title, bullets, body, theme, expanded }) {
  const { Icon, iconClass } = sectionMeta(title);
  const isAbout = /about/i.test(title || "");

  return (
    <section className={`rounded-md border px-4 py-3 ${theme.cardSection}`}>
      <h3 className={`mb-2 flex items-center gap-2 text-sm font-medium ${theme.cardAboutTitle}`}>
        <Icon className={`size-4 shrink-0 ${iconClass}`} aria-hidden="true" />
        {isAbout ? "About This Role" : title}
        {!isAbout && bullets?.length ? (
          <span className={`font-normal ${theme.cardMeta}`}>({bullets.length})</span>
        ) : null}
      </h3>
      {body ? (
        <p className={`text-sm whitespace-pre-wrap ${theme.cardAboutBody} ${expanded ? "" : "line-clamp-6"}`}>
          {body}
        </p>
      ) : null}
      {bullets?.length ? (
        <ul className={`space-y-2 text-sm ${theme.cardAboutBody}`}>
          {bullets.map((bullet, index) => (
            <li key={`${title}-${index}`} className="flex items-start gap-2">
              <span className="mt-1.5 text-[8px] text-violet-600 dark:text-violet-400">●</span>
              <span className={expanded ? "" : "line-clamp-2"}>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function DesktopJobCard({ job, collapsed, theme, isDark }) {
  const { snippet, about, detailSections } = getJobDisplayContent(job);
  const badges = getJobBadgeItems(job);
  const expanded = !collapsed;

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${collapsed ? "max-h-52" : "h-full"}`}>
      <div className={`shrink-0 border-b p-5 pr-24 ${theme.cardHeader}`}>
        <div className="flex min-w-0 gap-4">
          <div className="min-w-0 flex-1">
            <h1
              className={`font-display text-xl font-bold leading-snug lg:text-2xl ${theme.cardTitle}`}
              data-testid="job-title"
            >
              {job.title}
            </h1>
            <p className={`mt-1 text-base font-medium ${theme.cardCompany}`}>{job.company}</p>
          </div>
          <span className={`inline-flex h-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${theme.matchBadge}`}>
            <Zap className="h-3.5 w-3.5" fill="currentColor" />
            {job.match_score ?? 1}
          </span>
        </div>
      </div>

      <div
        className={`min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4 outline-none ${collapsed ? "overflow-hidden" : ""}`}
        tabIndex={0}
      >
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${theme.cardMeta}`}>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{job.location || "Location not specified"}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="size-4 shrink-0" aria-hidden="true" />
            {formatPosted(job.posted_at)}
          </span>
        </div>

        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <JobBadge key={badge.label} label={badge.label} icon={badge.icon} theme={theme} />
            ))}
          </div>
        ) : null}

        {snippet ? (
          <p className={`line-clamp-3 text-sm ${theme.cardAboutBody}`}>
            {snippet}
          </p>
        ) : null}

        {expanded ? (
          <div className="space-y-4">
            {about ? (
              <DetailSection
                title="About This Role"
                body={about}
                theme={theme}
                expanded={expanded}
              />
            ) : null}

            {detailSections.map((section) => (
              <DetailSection
                key={section.title}
                title={section.title}
                bullets={section.bullets}
                theme={theme}
                expanded={expanded}
              />
            ))}

            {job.match_reasons?.length > 0 ? (
              <DetailSection
                title="Why this fits you"
                bullets={job.match_reasons}
                theme={theme}
                expanded={expanded}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center justify-center pt-2 pb-1">
          <Logo size={isDark ? 28 : 32} />
        </div>
      </div>
    </div>
  );
}
