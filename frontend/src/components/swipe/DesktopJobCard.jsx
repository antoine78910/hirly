import {
  BarChart3,
  Briefcase,
  Calendar,
  DollarSign,
  Factory,
  FileText,
  GraduationCap,
  Laptop,
  MapPin,
  Star,
} from "lucide-react";
import Logo from "../Logo";
import CompanyLogo from "../CompanyLogo";
import { BRAND } from "../../lib/brand";
import {
  getJobBadgeItems,
  getJobDisplayContent,
  formatJobSalaryLabel,
} from "../../lib/jobDisplayUtils";
import JobRomeProfile from "./JobRomeProfile";
import { translateJobTitle, translateLocationLabel } from "../../lib/localizedDisplay";

function formatPosted(iso, t) {
  if (!iso) return t("swipe.postedRecently");
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diff <= 0) return t("swipe.postedToday");
  if (diff === 1) return t("swipe.postedOneDay");
  return t("swipe.postedDays", { n: diff });
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

function DetailSection({ title, bullets, body, theme, expanded = false, t }) {
  const { Icon, iconClass } = sectionMeta(title);
  const isAbout = /about/i.test(title || "");

  return (
    <section className={`rounded-md border px-4 py-3 ${theme.cardSection}`}>
      <h3 className={`mb-2 flex items-center gap-2 text-sm font-medium ${theme.cardAboutTitle}`}>
        <Icon className={`size-4 shrink-0 ${iconClass}`} aria-hidden="true" />
        {isAbout ? t("swipe.aboutRole") : title}
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

export default function DesktopJobCard({ job, theme, t, lang }) {
  const { about, detailSections } = getJobDisplayContent(job);
  const badges = getJobBadgeItems(job, { lang });
  const title = translateJobTitle(job.title, lang);
  const location = translateLocationLabel(job.location, lang) || t("swipe.locationNotSpecified");
  const salaryLabel = formatJobSalaryLabel(job, { lang });

  return (
    <div className="flex min-h-0 h-full flex-1 flex-col">
      <div className={`flex h-1/4 min-h-0 shrink-0 items-center border-b px-5 py-3 pr-24 lg:px-6 lg:pr-28 ${theme.cardHeader}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <CompanyLogo job={job} size="lg" rounded="2xl" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h1
              className={`line-clamp-2 font-display text-lg font-bold leading-snug sm:text-xl lg:text-2xl ${theme.cardTitle}`}
              data-testid="job-title"
            >
              {title}
            </h1>
            <p className={`mt-0.5 truncate text-sm font-medium sm:text-base ${theme.cardCompany}`}>{job.company}</p>
          </div>
        </div>
      </div>

      <div className="flex h-3/4 min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-4 pb-24 outline-none lg:px-8 lg:py-5 lg:pb-28">
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${theme.cardMeta}`}>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPin className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{location}</span>
          </span>
          {salaryLabel ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <DollarSign className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{salaryLabel}</span>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="size-4 shrink-0" aria-hidden="true" />
            {formatPosted(job.posted_at, t)}
          </span>
        </div>

        {badges.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <JobBadge key={badge.label} label={badge.label} icon={badge.icon} theme={theme} />
            ))}
          </div>
        ) : null}

        <div className="space-y-4">
          {about ? (
            <DetailSection
              title="About This Role"
              body={about}
              theme={theme}
              t={t}
            />
          ) : null}

          {detailSections.map((section) => (
            <DetailSection
              key={section.title}
              title={section.title}
              bullets={section.bullets}
              theme={theme}
              t={t}
            />
          ))}
          <JobRomeProfile job={job} t={t} enabled />
        </div>

        <div className="flex flex-col items-center justify-center gap-2 pt-2 pb-1">
          <Logo size={44} className="h-11 w-11" />
          <p className={`text-center text-sm font-semibold font-display ${theme.cardCompany}`}>{BRAND.NAME}</p>
        </div>
      </div>
      </div>
    </div>
  );
}
