import { useEffect, useState, useCallback, useRef } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import {
  Zap, Undo2, History, SlidersHorizontal, Flag, Share2, MapPin, Calendar,
  Heart, X, Loader2, Info,
} from "lucide-react";
import { toast } from "sonner";
import Logo from "../components/Logo";
import CompanyLogo from "../components/CompanyLogo";
import FiltersModal from "../components/FiltersModal";
import TargetSearchSheet from "../components/TargetSearchSheet";
import ReportJobSheet from "../components/ReportJobSheet";
import { BRAND } from "../lib/brand";
import { shareJob } from "../lib/shareJob";
import { trackEvent } from "../lib/analytics";
import { useAuth } from "../context/AuthContext";
import {
  cacheJobForDemo,
  ensureDemoAccountDefaults,
  getDemoAccountSearchTarget,
  isDemoAccountEnabled,
  seedTutorialShowcaseIfEmpty,
} from "../lib/demoAccount";
import { dismissDemoWelcome, shouldOpenDemoWelcome } from "../lib/demoWelcome";
import DemoWelcomeModal from "../components/demo/DemoWelcomeModal";
import { TUTORIAL_BYPASS_AUTH } from "../lib/dev";
import { DEMO_SETTINGS_CHANGED, isFinanceDemoEnabled, isDemoSwipeMode } from "../lib/demoSettings";
import { getFinanceDemoFeedData, performFinanceDemoSwipe, performFinanceDemoUndo } from "../lib/financeDemoApi";
import { getFinanceDemoSearchTarget } from "../lib/financeDemoJobs";
import { ensureTutorialSession } from "../lib/tutorialSession";
import { useUpgradeModal } from "../context/UpgradeModalContext";
import DesktopSwipeFeed from "../components/swipe/DesktopSwipeFeed";
import { saveTargetPreferences, normalizeLocationData } from "../lib/targetPreferences";
import { hasActiveFilters, mergeFilters, clearMenuFilters } from "../lib/jobFilters";
import { buildDefaultFiltersFromProfile, mergeProfileFilterDefaults, reconcileFiltersForUser } from "../lib/contractTypeMapping";
import { useAppLocale } from "../context/AppLocaleContext";
import { BILLING_UPDATED } from "../lib/billingEvents";
import {
  formatPostedDate,
  getSwipeSuccessCopy,
  getSwipeErrorMessage,
} from "../lib/appUi";
import { getJobBadgeItems, getJobDisplayContent } from "../lib/jobDisplayUtils";
import { translateJobTitle, translateLocationLabel, translateRoleLabel } from "../lib/localizedDisplay";

const DEFAULT_SEARCH_RADIUS = "50km";
const FILTERS_STORAGE_KEY = "swiipr.jobs.filters.v1";

const readPersistedFilters = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
};

const savePersistedFilters = (filters) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch (_) {}
};

const clearPersistedFilters = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FILTERS_STORAGE_KEY);
  } catch (_) {}
};

const feedFallbackMessage = (t, feedMeta) => {
  if (!feedMeta?.fallback_reason) return t("swipe.tryWidenSearch");
  if (feedMeta.provider_rate_limited) return t("swipe.providerRateLimited");
  if (feedMeta.fallback_reason === "no_auto_apply_jobs_found") return t("swipe.widenFiltersHint");
  return t("swipe.tryWidenSearch");
};

const normalizeSearchText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isNumericRadius = (value) => /^\d+\s*km$/i.test(String(value || "").trim());

const compactCityLabel = (value) => {
  const first = String(value || "").split(/[,\-/|]/)[0] || "";
  return normalizeSearchText(first);
};

const buildLocalFeedGuard = ({ params, response }) => {
  const radius = params.get("search_radius") || DEFAULT_SEARCH_RADIUS;
  if (!isNumericRadius(radius) || !params.get("locations_json")) return null;
  let selectedLocations = [];
  try {
    const parsed = JSON.parse(params.get("locations_json") || "[]");
    if (Array.isArray(parsed)) selectedLocations = parsed.filter((item) => item && typeof item === "object");
  } catch (_) {
    selectedLocations = [];
  }
  if (!selectedLocations.length) return null;

  const intelligence = response?.filters_applied?.location_intelligence || {};
  const expandedPlaces = Array.isArray(intelligence.expanded_places) ? intelligence.expanded_places : [];
  const cityTerms = new Set();
  const countryCodes = new Set();
  [...expandedPlaces, ...selectedLocations].forEach((place) => {
    [
      place?.name,
      place?.ascii_name,
      place?.normalized_name,
      place?.location_label,
      compactCityLabel(place?.location_label),
    ].forEach((value) => {
      const normalized = normalizeSearchText(value);
      if (normalized) cityTerms.add(normalized);
    });
    const code = String(place?.country_code || "").toLowerCase().trim();
    if (code) countryCodes.add(code);
  });
  const workLocations = params.getAll("work_location").map((item) => String(item || "").toLowerCase());
  const remoteExplicit = workLocations.includes("remote");

  return (job) => {
    const remote = job?.remote === true || normalizeSearchText(job?.location).includes("remote");
    if (remote && remoteExplicit) return true;
    const text = normalizeSearchText([
      job?.city,
      job?.region,
      job?.location,
      job?.country,
      job?.country_code,
    ].filter(Boolean).join(" "));
    const countryCode = String(job?.country_code || "").toLowerCase().trim();
    if (!text && !countryCode) return false;
    if (countryCode && countryCodes.size && !countryCodes.has(countryCode)) return false;
    for (const term of cityTerms) {
      if (term && text.includes(term)) return true;
    }
    return false;
  };
};

/* ============================================================
   Swipe card — tap to flip for full job details (mobile).
============================================================ */

function stopCardTap(e) {
  e.stopPropagation();
}

function MobileDetailSection({ title, bullets, body, t }) {
  const isAbout = /about/i.test(title || "");

  return (
    <section className="rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3">
      <h3 className="font-display text-base font-bold text-white">
        {isAbout ? t("swipe.aboutRole") : title}
      </h3>
      {body ? (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-sprout-muted">{body}</p>
      ) : null}
      {bullets?.length ? (
        <ul className="mt-2 space-y-2">
          {bullets.map((bullet, index) => (
            <li key={`${title}-${index}`} className="flex gap-2 text-sm leading-relaxed text-sprout-muted">
              <span className="text-sprout-mint">•</span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CardFront({ job, onReport, onShare, actionsEnabled, t, lang }) {
  const { snippet } = getJobDisplayContent(job);
  const badges = getJobBadgeItems(job, { lang });
  const title = translateJobTitle(job.title, lang);
  const location = translateLocationLabel(job.location, lang) || t("swipe.locationNotSpecified");

  return (
    <div className="backface-hidden absolute inset-0 flex flex-col overflow-hidden rounded-[28px] border border-sprout-border bg-sprout-surface">
      <div className="flex shrink-0 items-start justify-between p-4 sm:p-5">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onPointerDown={stopCardTap}
            onClick={(e) => {
              stopCardTap(e);
              if (actionsEnabled) onReport?.(job);
            }}
            className="grid h-9 w-9 place-items-center rounded-full text-sprout-mint transition-colors hover:bg-sprout-mint-soft"
            aria-label={t("swipe.reportJob")}
            data-testid="job-report-btn"
          >
            <Flag className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onPointerDown={stopCardTap}
            onClick={(e) => {
              stopCardTap(e);
              if (actionsEnabled) onShare?.(job);
            }}
            className="grid h-9 w-9 place-items-center rounded-full text-sprout-mint transition-colors hover:bg-sprout-mint-soft"
            aria-label={t("swipe.shareJob")}
            data-testid="job-share-btn"
          >
            <Share2 className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sprout-mint px-3 py-1 text-xs font-bold text-white">
          <Zap className="h-3.5 w-3.5" fill="white" />
          1
        </span>
      </div>

      <div className="mt-1 flex justify-center">
        <CompanyLogo company={job.company} size="lg" rounded="2xl" />
      </div>

      <div className="mt-4 px-5 text-center sm:px-7">
        <p className="font-display text-2xl font-semibold text-white">{job.company}</p>
        {snippet ? (
          <p className="mt-3 line-clamp-3 text-[15px] leading-snug text-sprout-muted">{snippet}</p>
        ) : null}
      </div>

      <div className="mt-6 px-5 sm:px-7">
        <h2
          className="text-center font-display text-[clamp(1.65rem,6vw,2.35rem)] font-black leading-[1.05] tracking-tight text-white"
          data-testid="job-title"
        >
          {title}
        </h2>
      </div>

      <div className="mt-5 flex flex-col items-center gap-1.5 text-[15px] text-sprout-muted">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-sprout-mint" strokeWidth={1.9} />
          <span>{location}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-sprout-mint" strokeWidth={1.9} />
          <span>{formatPostedDate(t, job.posted_at) || t("swipe.postedRecently")}</span>
        </div>
      </div>

      {badges.length > 0 ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2 px-5">
          {badges.map((badge) => (
            <span
              key={badge.label}
              className="inline-flex items-center rounded-full bg-sprout-surface-2 px-3 py-1.5 text-[13px] font-medium text-zinc-100"
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex-1" />

      <div className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-display text-lg font-bold text-white">
          <Logo size={22} />
          {BRAND.NAME}
        </div>
        <div className="flex items-center gap-1.5 text-[13px] text-sprout-muted">
          {t("swipe.tapForDetails")}
          <Info className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function CardBack({ job, t, lang }) {
  const { about, detailSections } = getJobDisplayContent(job);
  const title = translateJobTitle(job.title, lang);
  const location = translateLocationLabel(job.location, lang) || t("swipe.locationNotSpecified");

  return (
    <div className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col overflow-hidden rounded-[28px] border border-sprout-border bg-sprout-surface">
      <div
        className="app-scroll no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-6 pb-4 touch-pan-y sm:px-6"
        data-testid="swipe-card-scroll"
      >
        <div>
          <h2 className="font-display text-[clamp(1.5rem,5.5vw,2rem)] font-black leading-tight tracking-tight text-white">
            {title}
          </h2>
          <div className="mt-3 flex items-center gap-3">
            <CompanyLogo company={job.company} size="md" rounded="xl" className="shrink-0" />
            <p className="text-lg font-semibold text-white">{job.company}</p>
          </div>
        </div>

        <div className="space-y-1.5 text-[15px] text-sprout-muted">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-sprout-mint" />
            <span>{location}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-sprout-mint" />
            <span>{formatPostedDate(t, job.posted_at) || t("swipe.postedRecently")}</span>
          </div>
        </div>

        <div className="border-t border-sprout-border" />

        <div className="space-y-3">
          {about ? (
            <MobileDetailSection title="About This Role" body={about} t={t} />
          ) : null}
          {detailSections.map((section) => (
            <MobileDetailSection
              key={section.title}
              title={section.title}
              bullets={section.bullets}
              t={t}
            />
          ))}
          {job.match_reasons?.length > 0 ? (
            <MobileDetailSection title={t("swipe.whyFits")} bullets={job.match_reasons} t={t} />
          ) : null}
          {job.tech_stack?.length > 0 ? (
            <section className="rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3">
              <h3 className="font-display text-base font-bold text-white">{t("swipe.techStack")}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {job.tech_stack.map((tech) => (
                  <span
                    key={tech}
                    className="rounded-full bg-sprout-mint-soft px-2.5 py-1 text-xs font-semibold text-sprout-mint"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-sprout-border px-6 py-4 text-[13px] text-sprout-muted">
        <span className="flex items-center gap-1.5 font-display font-bold text-white">
          <Logo size={18} />
          {BRAND.NAME}
        </span>
        <span className="flex items-center gap-1.5">
          {t("swipe.tapToFlipBack")}
          <Info className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function Card({ job, onSwipe, onReport, onShare, isTop, index, t, lang }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-260, 0, 260], [-14, 0, 14]);
  const opacity = useTransform(x, [-360, -260, 0, 260, 360], [0, 1, 1, 1, 0]);
  const applyOpacity = useTransform(x, [0, 80, 160], [0, 0.5, 1]);
  const skipOpacity = useTransform(x, [-160, -80, 0], [1, 0.5, 0]);
  const [flipped, setFlipped] = useState(false);
  const dragRef = useRef({ distance: 0 });

  useEffect(() => {
    setFlipped(false);
  }, [job.job_id, isTop]);

  return (
    <motion.div
      className="absolute inset-0 h-full select-none"
      style={{
        x: isTop ? x : 0,
        rotate: isTop ? rotate : 0,
        opacity: isTop ? opacity : 1,
        scale: 1 - index * 0.03,
        translateY: index * 10,
        zIndex: 10 - index,
        touchAction: flipped ? "pan-y" : "none",
        pointerEvents: isTop ? "auto" : "none",
      }}
      drag={isTop && !flipped ? "x" : false}
      dragDirectionLock
      dragMomentum={false}
      dragElastic={0.6}
      dragSnapToOrigin
      whileDrag={{ cursor: "grabbing" }}
      onDrag={(_, info) => {
        dragRef.current.distance = Math.abs(info.offset.x);
      }}
      onDragEnd={(_, info) => {
        dragRef.current.distance = 0;
        if (info.offset.x > 140 || info.velocity.x > 700) onSwipe("apply");
        else if (info.offset.x < -140 || info.velocity.x < -700) onSwipe("skip");
      }}
      onTap={() => {
        if (!isTop || dragRef.current.distance > 8) return;
        setFlipped((current) => !current);
      }}
      transition={{ type: "spring", stiffness: 280, damping: 28 }}
      data-testid={isTop ? "swipe-card-top" : `swipe-card-${index}`}
    >
      <motion.div
        className="relative h-full w-full preserve-3d"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 110, damping: 18 }}
      >
        <CardFront
          job={job}
          onReport={onReport}
          onShare={onShare}
          actionsEnabled={isTop}
          t={t}
          lang={lang}
        />
        <CardBack job={job} t={t} lang={lang} />
      </motion.div>

      {isTop && !flipped ? (
        <>
          <motion.div
            style={{ opacity: applyOpacity }}
            className="pointer-events-none absolute top-20 left-6 rotate-[-14deg] rounded-xl border-[3px] border-sprout-mint px-4 py-1.5 font-display text-3xl font-black tracking-wider text-sprout-mint backdrop-blur-sm"
            data-testid="apply-stamp"
          >
            {t("swipe.applyStamp")}
          </motion.div>
          <motion.div
            style={{ opacity: skipOpacity }}
            className="pointer-events-none absolute top-20 right-6 rotate-[14deg] rounded-xl border-[3px] border-rose-500 px-4 py-1.5 font-display text-3xl font-black tracking-wider text-rose-500 backdrop-blur-sm"
            data-testid="skip-stamp"
          >
            {t("swipe.passStamp")}
          </motion.div>
        </>
      ) : null}
    </motion.div>
  );
}

const trackApplicationOutcome = (data, job) => {
  if (!data?.applied) return;
  const base = {
    job_id: job?.job_id,
    company: job?.company,
    ats_provider: job?.ats_provider,
    submission_status: data?.submission_status,
    package_status: data?.package_status || data?.application_status,
  };
  trackEvent("application_generated", base);
  const submission = data?.submission_status;
  if (submission === "prepared" || submission === "ready") trackEvent("application_prepared", base);
  if (submission === "action_required") trackEvent("application_action_required", base);
  if (submission === "blocked" || submission === "blocked_captcha") trackEvent("application_blocked", base);
  if (submission === "prepare_failed" || submission === "failed") trackEvent("application_prepare_failed", base);
  if (submission === "submitted") trackEvent("application_submitted", base);
};

function SkeletonCard() {
  return (
    <div className="absolute inset-0 bg-sprout-surface border border-sprout-border rounded-[28px] p-6 overflow-hidden" data-testid="skeleton-card">
      <div className="flex items-center justify-between">
        <div className="h-5 w-16 shimmer-light rounded-full" />
        <div className="h-6 w-10 shimmer-light rounded-full" />
      </div>
      <div className="mt-6 flex justify-center"><div className="h-16 w-20 shimmer-light rounded-2xl" /></div>
      <div className="mt-5 mx-auto h-6 w-32 shimmer-light rounded" />
      <div className="mt-2 mx-auto h-4 w-3/4 shimmer-light rounded" />
      <div className="mt-1 mx-auto h-4 w-1/2 shimmer-light rounded" />
      <div className="mt-8 mx-auto h-10 w-2/3 shimmer-light rounded" />
      <div className="mt-2 mx-auto h-10 w-1/2 shimmer-light rounded" />
      <div className="mt-8 flex justify-center gap-2">
        <div className="h-7 w-20 shimmer-light rounded-full" />
        <div className="h-7 w-20 shimmer-light rounded-full" />
        <div className="h-7 w-20 shimmer-light rounded-full" />
      </div>
    </div>
  );
}

export default function Swipe() {
  const navigate = useNavigate();
  const { t, lang } = useAppLocale();
  const { loading: authLoading, user } = useAuth();
  const [demoWelcomeOpen, setDemoWelcomeOpen] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appLoading, setAppLoading] = useState(false);
  const [appliedToday, setAppliedToday] = useState(0);
  const [target, setTarget] = useState({ role: "", location: "" });
  const [targetLocationData, setTargetLocationData] = useState(null);
  const [targetSaving, setTargetSaving] = useState(false);
  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [desktopFiltersOpen, setDesktopFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(() => readPersistedFilters());
  const [totalCount, setTotalCount] = useState(null);
  const [feedMeta, setFeedMeta] = useState(null);
  const [feedError, setFeedError] = useState("");
  const [lastFeedDebug, setLastFeedDebug] = useState(null);
  const [reportJob, setReportJob] = useState(null);
  const [billing, setBilling] = useState(null);
  const { upgradeOpen, openUpgrade } = useUpgradeModal();
  const fetchingRef = useRef(false);
  const filtersRef = useRef(filters);
  const profileRef = useRef(null);
  const targetRef = useRef(target);
  const pendingFiltersRef = useRef(undefined);
  const feedAbortRef = useRef(null);
  const feedRequestIdRef = useRef(0);
  const viewedJobIdsRef = useRef(new Set());
  const handleSwipeRef = useRef(null);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    if (authLoading || !user?.user_id) return;
    const forcePreview = new URLSearchParams(window.location.search).get("demoWelcome") === "1";
    if (!forcePreview && !isDemoAccountEnabled()) return;
    if (shouldOpenDemoWelcome(user.user_id)) {
      setDemoWelcomeOpen(true);
    }
  }, [authLoading, user?.user_id]);

  const handleDismissDemoWelcome = () => {
    dismissDemoWelcome(user?.user_id);
    setDemoWelcomeOpen(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("demoWelcome")) {
        url.searchParams.delete("demoWelcome");
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
      }
    }
  };

  const applyFinanceDemoTarget = useCallback(() => {
    const demo = getFinanceDemoSearchTarget();
    const nextTarget = { role: demo.role, location: demo.location };
    setTarget(nextTarget);
    targetRef.current = nextTarget;
    setTargetLocationData(demo.locationData);
    const nextFilters = clearMenuFilters({
      searchRadius: filtersRef.current?.searchRadius || DEFAULT_SEARCH_RADIUS,
    });
    if (demo.locationData) {
      nextFilters.locationsData = [demo.locationData];
    }
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    savePersistedFilters(nextFilters);
    return nextFilters;
  }, []);

  const applyDemoAccountTarget = useCallback(() => {
    const demo = getDemoAccountSearchTarget();
    const nextTarget = { role: demo.role, location: demo.location };
    setTarget(nextTarget);
    targetRef.current = nextTarget;
    setTargetLocationData(demo.locationData);
    const nextFilters = clearMenuFilters({
      searchRadius: filtersRef.current?.searchRadius || DEFAULT_SEARCH_RADIUS,
    });
    if (demo.locationData) {
      nextFilters.locationsData = [demo.locationData];
    }
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    savePersistedFilters(nextFilters);
    return nextFilters;
  }, []);

  const loadProfile = useCallback(async () => {
    if (isFinanceDemoEnabled() && isDemoAccountEnabled()) {
      applyFinanceDemoTarget();
      return null;
    }
    if (isDemoAccountEnabled()) {
      try {
        const { data } = await api.get("/profile");
        profileRef.current = data || null;
        if (data?.target_role || data?.cv_text) {
          const nextTarget = {
            role: data.target_role || "",
            location: data.target_location || "",
          };
          setTarget(nextTarget);
          targetRef.current = nextTarget;
          setTargetLocationData(data.target_location_data || null);
          return data;
        }
      } catch (_) {}
      applyDemoAccountTarget();
      return profileRef.current;
    }
    try {
      const { data } = await api.get("/profile");
      profileRef.current = data || null;
      if (data) {
        const nextTarget = {
          role: data.target_role || "",
          location: data.target_location || "",
        };
        setTarget(nextTarget);
        targetRef.current = nextTarget;
        setTargetLocationData(data.target_location_data || null);
      }
      return data || null;
    } catch (_) {
      return null;
    }
  }, [applyFinanceDemoTarget, applyDemoAccountTarget]);

  const buildFeedParams = (f) => {
    const params = new URLSearchParams({ limit: "5", search_radius: DEFAULT_SEARCH_RADIUS });
    const activeTarget = targetRef.current;
    if (activeTarget?.role?.trim()) {
      params.set("search_role", activeTarget.role.trim());
    }
    if (f == null) return params;
    const merged = mergeFilters(f);
    if (merged.minSalary) params.set("min_salary", String(merged.minSalary));
    if (merged.postedDate && merged.postedDate !== "any") params.set("posted_within", merged.postedDate);
    merged.workLocations?.forEach((v) => params.append("work_location", v));
    merged.jobTypes?.forEach((v) => params.append("job_type", v));
    merged.experience?.forEach((v) => params.append("experience", v));
    if (merged.locationsData?.length) {
      params.set("locations_json", JSON.stringify(merged.locationsData));
    } else if (merged.locationData) {
      params.set("locations_json", JSON.stringify([merged.locationData]));
    } else {
      merged.locations?.forEach((v) => params.append("location", v));
    }
    merged.onlyCompanies?.forEach((v) => params.append("only_company", v));
    merged.hideCompanies?.forEach((v) => params.append("hide_company", v));
    merged.onlyIndustries?.forEach((v) => params.append("only_industry", v));
    merged.hideIndustries?.forEach((v) => params.append("hide_industry", v));
    if (merged.includeUnknownLocation === false) params.set("include_unknown_location", "false");
    if (merged.includeUnknownSalary === false) params.set("include_unknown_salary", "false");
    if (merged.searchRadius) params.set("search_radius", merged.searchRadius);
    if (merged.onlyMyCountry) params.set("only_my_country", "true");
    return params;
  };

  const loadFeed = useCallback(async (replace = false, f = filtersRef.current, reason = "unspecified") => {
    if (feedAbortRef.current) {
      feedAbortRef.current.abort();
      feedAbortRef.current = null;
    }
    const requestId = feedRequestIdRef.current + 1;
    feedRequestIdRef.current = requestId;
    const controller = new AbortController();
    feedAbortRef.current = controller;
    pendingFiltersRef.current = undefined;
    fetchingRef.current = true;
    setLoading(true);
    setFeedError("");
    if (replace) setJobs([]);
    let params = buildFeedParams(f);
    let requestUrl = `/jobs/feed?${params.toString()}`;
    console.group("[FeedDebug] loadFeed");
    console.log("reason", reason);
    console.log("forceRefresh", replace);
    console.log("filters passed to loadFeed", f);
    console.log("filtersRef.current", filtersRef.current);
    console.log("request url", requestUrl);
    console.log("request params", Object.fromEntries(params.entries()));
    console.log("request param entries", Array.from(params.entries()));
    console.groupEnd();
    setLastFeedDebug({
      reason,
      forceRefresh: replace,
      filters: f || null,
      filtersRef: filtersRef.current || null,
      requestUrl,
      requestParams: Object.fromEntries(params.entries()),
      requestParamEntries: Array.from(params.entries()),
      response: null,
    });
    const requestFeed = async (url = requestUrl) => {
      if (isFinanceDemoEnabled()) {
        const demoData = getFinanceDemoFeedData({
          filters: f == null ? null : mergeFilters(f),
          searchRole: targetRef.current?.role?.trim() || "",
          limit: Number(params.get("limit") || 5),
        });
        if (demoData) return demoData;
      }
      const { data } = await api.get(url, {
        timeout: 45000,
        signal: controller.signal,
      });
      return data;
    };
    try {
      console.log("JOB_FEED_PARAMS", {
        params: params.toString(),
        locations: f?.locationsData || (f?.locationData ? [f.locationData] : []),
        search_radius: f?.searchRadius || DEFAULT_SEARCH_RADIUS,
        only_my_country: Boolean(f?.onlyMyCountry),
        role: targetRef.current?.role || "",
      });
      let data;
      try {
        data = await requestFeed();
      } catch (firstError) {
        if (controller.signal.aborted || firstError?.code === "ERR_CANCELED") throw firstError;
        if (!isFinanceDemoEnabled() && TUTORIAL_BYPASS_AUTH && firstError?.response?.status === 401) {
          await ensureTutorialSession();
          data = await requestFeed();
        } else {
          throw firstError;
        }
      }
      if (requestId !== feedRequestIdRef.current) return;
      let localFeedGuard = buildLocalFeedGuard({ params, response: data });
      let responseJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      let safeJobs = localFeedGuard ? responseJobs.filter(localFeedGuard) : responseJobs;
      let outsideLocationHiddenCount = responseJobs.length - safeJobs.length;
      const trace = data?.request_trace || {};
      const shouldForceLocalRetry = Boolean(
        localFeedGuard
        && safeJobs.length === 0
        && !params.get("force_provider_refresh")
        && trace.explicit_local_intent
        && trace.local_jsearch_discovery_attempted !== true
      );
      if (shouldForceLocalRetry) {
        const retryParams = new URLSearchParams(params);
        retryParams.set("force_provider_refresh", "true");
        params = retryParams;
        requestUrl = `/jobs/feed?${retryParams.toString()}`;
        console.log("[FeedDebug] forcing local provider refresh", requestUrl);
        data = await requestFeed(requestUrl);
        if (requestId !== feedRequestIdRef.current) return;
        localFeedGuard = buildLocalFeedGuard({ params: retryParams, response: data });
        responseJobs = Array.isArray(data?.jobs) ? data.jobs : [];
        safeJobs = localFeedGuard ? responseJobs.filter(localFeedGuard) : responseJobs;
        outsideLocationHiddenCount = responseJobs.length - safeJobs.length;
      }
      if (outsideLocationHiddenCount > 0) {
        data = {
          ...(data || {}),
          jobs: safeJobs,
          total: safeJobs.length,
          feed_summary: {
            ...(data?.feed_summary || {}),
            frontend_outside_location_hidden_count:
              Number(data?.feed_summary?.frontend_outside_location_hidden_count || 0) + outsideLocationHiddenCount,
          },
        };
      }
      console.group("[FeedDebug] response");
      console.log("jobs count", safeJobs.length);
      console.log("feed_summary", data?.feed_summary);
      console.log("request_trace", data?.request_trace);
      console.log("first jobs", safeJobs.slice(0, 5));
      console.groupEnd();
      setLastFeedDebug({
        reason,
        forceRefresh: replace,
        filters: f || null,
        filtersRef: filtersRef.current || null,
        requestUrl,
        requestParams: Object.fromEntries(params.entries()),
        requestParamEntries: Array.from(params.entries()),
        response: {
          jobsCount: safeJobs.length,
          feedSummary: data?.feed_summary || null,
          requestTrace: data?.request_trace || null,
          firstJobs: safeJobs.slice(0, 5).map((job) => ({
            title: job.title,
            company: job.company,
            location: job.location,
            application_mode: job.application_mode,
            can_auto_apply: job.can_auto_apply,
            provider: job.provider,
          })),
        },
      });
      setTotalCount(typeof data.total === "number" ? data.total : null);
      setFeedMeta(data || null);
      if (TUTORIAL_BYPASS_AUTH) {
        safeJobs.forEach((job) => cacheJobForDemo(job));
        seedTutorialShowcaseIfEmpty(safeJobs);
      }
      setJobs((prev) => {
        const base = replace ? [] : (localFeedGuard ? prev.filter(localFeedGuard) : prev);
        const seen = new Set(base.map((j) => j.job_id));
        const merged = [...base];
        safeJobs.forEach((j) => { if (!seen.has(j.job_id)) merged.push(j); });
        return merged;
      });
    } catch (e) {
      if (controller.signal.aborted || e?.code === "ERR_CANCELED") return;
      if (requestId !== feedRequestIdRef.current) return;
      if (e?.code === "ECONNABORTED") {
        const retryParams = new URLSearchParams(params);
        if (buildLocalFeedGuard({ params: retryParams, response: { filters_applied: {} } }) && !retryParams.get("force_provider_refresh")) {
          retryParams.set("force_provider_refresh", "true");
          const retryUrl = `/jobs/feed?${retryParams.toString()}`;
          try {
            const retryData = await requestFeed(retryUrl);
            if (requestId !== feedRequestIdRef.current) return;
            const localFeedGuard = buildLocalFeedGuard({ params: retryParams, response: retryData });
            const responseJobs = Array.isArray(retryData?.jobs) ? retryData.jobs : [];
            const safeJobs = localFeedGuard ? responseJobs.filter(localFeedGuard) : responseJobs;
            setLastFeedDebug({
              reason: `${reason}_timeout_retry`,
              forceRefresh: replace,
              filters: f || null,
              filtersRef: filtersRef.current || null,
              requestUrl: retryUrl,
              requestParams: Object.fromEntries(retryParams.entries()),
              requestParamEntries: Array.from(retryParams.entries()),
              response: {
                jobsCount: safeJobs.length,
                feedSummary: retryData?.feed_summary || null,
                requestTrace: retryData?.request_trace || null,
                firstJobs: safeJobs.slice(0, 5).map((job) => ({
                  title: job.title,
                  company: job.company,
                  location: job.location,
                  application_mode: job.application_mode,
                  can_auto_apply: job.can_auto_apply,
                  provider: job.provider,
                })),
              },
            });
            setTotalCount(typeof retryData.total === "number" ? retryData.total : null);
            setFeedMeta(retryData || null);
            setJobs((prev) => {
              const base = replace ? [] : (localFeedGuard ? prev.filter(localFeedGuard) : prev);
              const seen = new Set(base.map((j) => j.job_id));
              const merged = [...base];
              safeJobs.forEach((j) => { if (!seen.has(j.job_id)) merged.push(j); });
              return merged;
            });
            return;
          } catch (_) {
            /* fall through to normal timeout message */
          }
        }
      }
      const rawDetail = e?.response?.data?.detail;
      const detail = e?.code === "ECONNABORTED"
        ? t("swipe.feedTimeout")
        : (typeof rawDetail === "string"
          ? rawDetail
          : rawDetail?.message || rawDetail?.detail || t("toasts.loadJobsError"));
      setFeedError(typeof detail === "string" ? detail : t("toasts.loadJobsError"));
      setFeedMeta((prev) => ({
        ...(prev || {}),
        fallback_reason: typeof detail === "string" ? detail : t("toasts.loadJobsError"),
      }));
      if (replace) setJobs([]);
      toast.error(typeof detail === "string" ? detail : t("toasts.loadJobsError"));
    } finally {
      if (requestId === feedRequestIdRef.current) {
        setLoading(false);
        fetchingRef.current = false;
        if (feedAbortRef.current === controller) feedAbortRef.current = null;
      }
    }
  }, [t]);

  useEffect(() => {
    const onDemoSettings = (event) => {
      if (!isDemoAccountEnabled()) return;
      const financeOn = Boolean(event?.detail?.financeJobFeed ?? isFinanceDemoEnabled());
      const nextFilters = financeOn
        ? applyFinanceDemoTarget()
        : reconcileFiltersForUser(readPersistedFilters(), profileRef.current);
      if (!financeOn) {
        loadProfile();
      }
      loadFeed(true, nextFilters, "demo_settings_changed");
    };
    window.addEventListener(DEMO_SETTINGS_CHANGED, onDemoSettings);
    return () => window.removeEventListener(DEMO_SETTINGS_CHANGED, onDemoSettings);
  }, [loadFeed, loadProfile, applyFinanceDemoTarget]);

  const saveTargetSearch = useCallback(async ({ role, location, locationData }) => {
    const trimmedRole = (role || "").trim();
    if (!trimmedRole) {
      toast.error(t("toasts.searchSaveError"));
      return false;
    }
    setTargetSaving(true);
    try {
      const trimmedLocation = (location || "").trim();
      const normalizedLocationData = normalizeLocationData(trimmedLocation, locationData);
      const locationLabel = normalizedLocationData?.location_label || trimmedLocation || "Anywhere";

      setTarget({ role: trimmedRole, location: locationLabel });
      setTargetLocationData(normalizedLocationData);
      const nextFilters = {
        ...(filtersRef.current || {}),
        searchRadius: filtersRef.current?.searchRadius || DEFAULT_SEARCH_RADIUS,
      };
      if (normalizedLocationData) {
        nextFilters.locationsData = [normalizedLocationData];
        delete nextFilters.locations;
        delete nextFilters.locationData;
      } else if (locationLabel && locationLabel !== "Anywhere") {
        nextFilters.locations = [locationLabel];
        delete nextFilters.locationsData;
        delete nextFilters.locationData;
      }
      filtersRef.current = nextFilters;
      setFilters(nextFilters);
      savePersistedFilters(nextFilters);
      loadFeed(true, nextFilters, "target_search_save");
      toast.success(t("toasts.searchUpdated"));

      saveTargetPreferences({ role: trimmedRole, location: locationLabel, locationData: normalizedLocationData })
        .catch((error) => console.warn("Preferences save failed (feed already refreshed).", error));
      return true;
    } catch (_) {
      toast.error(t("toasts.searchSaveError"));
      return false;
    } finally {
      setTargetSaving(false);
    }
  }, [loadFeed, t]);

  useEffect(() => {
    if (authLoading) return;
    ensureDemoAccountDefaults();
    const bootstrap = async () => {
      await loadProfile();
      api.get("/billing/status")
        .then(({ data }) => setBilling(data))
        .catch(() => setBilling({ is_premium: false }));
      if (isFinanceDemoEnabled() && isDemoAccountEnabled()) {
        const financeFilters = applyFinanceDemoTarget();
        loadFeed(true, financeFilters, "initial_finance_demo");
        return;
      }
      if (isDemoAccountEnabled()) {
        const demoFilters = reconcileFiltersForUser(readPersistedFilters(), profileRef.current);
        filtersRef.current = demoFilters;
        setFilters(demoFilters);
        savePersistedFilters(demoFilters);
        loadFeed(true, demoFilters, "initial_demo_account");
        return;
      }
      const mergedFilters = reconcileFiltersForUser(readPersistedFilters(), profileRef.current);
      filtersRef.current = mergedFilters;
      setFilters(mergedFilters);
      savePersistedFilters(mergedFilters);
      loadFeed(true, mergedFilters, readPersistedFilters() ? "initial_persisted_filters" : "initial_profile_defaults");
    };
    bootstrap();
  }, [authLoading, loadProfile, loadFeed, applyFinanceDemoTarget]);

  useEffect(() => {
    const onBillingUpdated = (event) => {
      if (event?.detail) setBilling(event.detail);
    };
    window.addEventListener(BILLING_UPDATED, onBillingUpdated);
    return () => window.removeEventListener(BILLING_UPDATED, onBillingUpdated);
  }, []);

  const applyFilters = (f) => {
    trackEvent("filters_applied", {
      locations: f?.locations,
      locationsData: f?.locationsData,
      workLocations: f?.workLocations,
      searchRadius: f?.searchRadius,
    });
    filtersRef.current = f;
    setFilters(f);
    savePersistedFilters(f);
    setFiltersOpen(false);
    setJobs([]);
    setLoading(true);
    setTotalCount(null);
    setFeedMeta(null);
    setFeedError("");
    loadFeed(true, f, "filters_apply");
  };

  const resetFilters = () => {
    clearPersistedFilters();
    const defaults = buildDefaultFiltersFromProfile(profileRef.current);
    filtersRef.current = defaults;
    setFilters(defaults);
    setFiltersOpen(false);
    setJobs([]);
    setLoading(true);
    setTotalCount(null);
    setFeedMeta(null);
    setFeedError("");
    loadFeed(true, defaults, "filters_reset");
  };

  const handleRadiusChange = (searchRadius) => {
    const next = { ...(filtersRef.current || {}), searchRadius };
    applyFilters(next);
  };

  const topJob = jobs[0];
  const creditsRemaining = Number(billing?.credits_remaining ?? 0);
  const shouldGateApply = billing !== null && (!billing.is_premium || creditsRemaining <= 0) && !isDemoAccountEnabled();

  const blockApplyForFreePlan = useCallback(() => {
    if (!shouldGateApply) return false;
    openUpgrade();
    return true;
  }, [shouldGateApply, openUpgrade]);

  useEffect(() => {
    trackEvent("swipe_page_view");
  }, []);

  useEffect(() => {
    if (!topJob?.job_id) return;
    if (viewedJobIdsRef.current.has(topJob.job_id)) return;
    viewedJobIdsRef.current.add(topJob.job_id);
    trackEvent("job_card_viewed", {
      job_id: topJob.job_id,
      company: topJob.company,
      ats_provider: topJob.ats_provider,
      location: topJob.location,
    });
  }, [topJob?.job_id, topJob?.company, topJob?.ats_provider, topJob?.location]);

  // intent: "apply" | "skip"
  const handleSwipe = async (intent) => {
    if (intent === "apply" && blockApplyForFreePlan()) return;
    if (!topJob) return;
    const job = topJob;
    const demoSwipe = isDemoSwipeMode() || isDemoAccountEnabled();
    const demoApply = intent === "apply" && demoSwipe;
    cacheJobForDemo(job);
    setJobs((prev) => prev.slice(1));
    const direction = intent === "apply" ? "right" : "left";   // backend semantic
    if (intent === "apply") {
      trackEvent("application_generation_started", {
        job_id: job.job_id,
        company: job.company,
        ats_provider: job.ats_provider,
        demo: demoApply,
      });
      setAppliedToday((n) => n + 1);
    }
    trackEvent(intent === "apply" ? "job_swiped_right" : "job_swiped_left", {
      job_id: job.job_id,
      company: job.company,
      ats_provider: job.ats_provider,
      location: job.location,
    });
    try {
      let data;
      if (isFinanceDemoEnabled()) {
        data = performFinanceDemoSwipe({ job_id: job.job_id, direction });
        if (!data?.ok) throw new Error("Finance demo swipe failed");
      } else {
        ({ data } = await api.post(
          "/swipe",
          { job_id: job.job_id, direction },
          intent === "apply" ? { timeout: demoApply ? 15000 : 180000 } : undefined,
        ));
      }
      if (intent === "apply" && !demoApply) {
        const applied = Boolean(data?.applied || data?.demo_local || data?.demo_account);
        if (applied) {
          if (data?.billing) {
            setBilling((prev) => ({
              ...(prev || {}),
              is_premium: true,
              credits_total: data.billing.credits_total ?? prev?.credits_total,
              credits_remaining: data.billing.credits_remaining ?? prev?.credits_remaining,
            }));
          }
          trackApplicationOutcome(data, job);
          const copy = getSwipeSuccessCopy(t, data, job);
          toast.success(copy.title, {
            description: copy.description,
            duration: 2200,
          });
        }
      }
    } catch (e) {
      if (e?.response?.status === 402) {
        const nextBilling = e?.response?.data?.detail?.billing;
        if (nextBilling) setBilling(nextBilling);
        openUpgrade();
      }
      if (!demoSwipe && intent === "apply") {
        toast.error(getSwipeErrorMessage(t, e));
      }
    }
    if (jobs.length <= 3) loadFeed(false, filtersRef.current, "after_swipe_low_stack");
  };

  const handleUndo = async () => {
    try {
      const data = isFinanceDemoEnabled()
        ? performFinanceDemoUndo()
        : (await api.post("/swipe/undo")).data;
      if (data.ok) { toast(t("toasts.undone")); loadFeed(true, filtersRef.current, "undo_refresh"); }
    } catch (e) { toast.error(t("toasts.nothingToUndo")); }
  };

  const handleShareJob = async (job) => {
    try {
      const result = await shareJob(job);
      if (result.cancelled) return;
      if (result.method === "clipboard") toast.success(t("toasts.linkCopied"));
    } catch {
      toast.error(t("toasts.shareError"));
    }
  };

  const dismissJob = useCallback((jobId) => {
    setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    if (isFinanceDemoEnabled()) {
      performFinanceDemoSwipe({ job_id: jobId, direction: "left" });
    } else {
      api.post("/swipe", { job_id: jobId, direction: "left" }).catch(() => {});
    }
    if (jobs.length <= 3) loadFeed(false, filtersRef.current, "after_dismiss_low_stack");
  }, [jobs.length, loadFeed]);

  const handleReportSubmit = async (reason) => {
    if (!reportJob) return;
    try {
      await api.post("/jobs/report", { job_id: reportJob.job_id, reason });
    } catch (_) {
      /* demo / offline — still acknowledge */
    }
    toast.success(t("toasts.reportThanks"));
    const reportedId = reportJob.job_id;
    setReportJob(null);
    if (topJob?.job_id === reportedId) dismissJob(reportedId);
  };

  handleSwipeRef.current = handleSwipe;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (window.matchMedia("(min-width: 768px)").matches) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target?.isContentEditable) return;
      if (targetSheetOpen || filtersOpen || desktopFiltersOpen || reportJob || upgradeOpen) return;
      if (appLoading || loading || !topJob) return;
      if (event.key === "ArrowRight" && shouldGateApply) {
        event.preventDefault();
        openUpgrade();
        return;
      }
      event.preventDefault();
      handleSwipeRef.current?.(event.key === "ArrowRight" ? "apply" : "skip");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    appLoading,
    filtersOpen,
    desktopFiltersOpen,
    loading,
    reportJob,
    targetSheetOpen,
    topJob,
    shouldGateApply,
    navigate,
    upgradeOpen,
  ]);

  const feedDebugEnabled = typeof window !== "undefined" && window.localStorage.getItem("feed_debug") === "true";
  const feedDebugPanelData = lastFeedDebug
    ? {
        reason: lastFeedDebug.reason,
        forceRefresh: lastFeedDebug.forceRefresh,
        requestUrl: lastFeedDebug.requestUrl,
        requestParams: lastFeedDebug.requestParams,
        requestParamEntries: lastFeedDebug.requestParamEntries,
        jobsCount: lastFeedDebug.response?.jobsCount ?? null,
        feedSummary: lastFeedDebug.response?.feedSummary ?? null,
        requestTrace: lastFeedDebug.response?.requestTrace ?? null,
        firstJobLocations: (lastFeedDebug.response?.firstJobs || []).map((job) => job.location),
        firstJobApplicationModes: (lastFeedDebug.response?.firstJobs || []).map((job) => job.application_mode),
        firstJobs: lastFeedDebug.response?.firstJobs || [],
      }
    : null;

  return (
    <>
      <div className="hidden md:block">
        <DesktopSwipeFeed
          job={topJob}
          loading={loading}
          feedError={feedError}
          feedMeta={feedMeta}
          target={target}
          filters={filters}
          appliedToday={appliedToday}
          appLoading={appLoading}
          onFiltersChange={applyFilters}
          onFiltersOpenChange={setDesktopFiltersOpen}
          onTargetSave={saveTargetSearch}
          targetLocationData={targetLocationData}
          targetSaving={targetSaving}
          onPass={() => handleSwipe("skip")}
          onApply={() => handleSwipe("apply")}
          onReport={setReportJob}
          onShare={handleShareJob}
          onRefresh={() => loadFeed(true, filtersRef.current, "desktop_refresh")}
          onRadiusChange={handleRadiusChange}
          shouldGateApply={shouldGateApply}
          onApplyBlocked={openUpgrade}
          interactionBlocked={targetSheetOpen || filtersOpen || desktopFiltersOpen || Boolean(reportJob) || upgradeOpen}
        />
      </div>

      <div className="sprout flex h-dvh max-h-dvh flex-col overflow-hidden bg-sprout-bg text-zinc-900 md:hidden">
      <header
        className="mx-auto flex w-full max-w-md shrink-0 items-center gap-1 px-safe pb-2 pt-safe sm:gap-2.5 sm:px-4"
        data-testid="swipe-header"
      >
        <div className="flex shrink-0 items-center gap-0.5">
          <div className="flex items-center gap-0.5 px-0.5">
            <Zap className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" strokeWidth={2} fill="rgb(167,139,250)" />
            <span className="text-xs font-semibold text-sprout-mint sm:text-sm" data-testid="applied-today">
              {appliedToday}
            </span>
          </div>
          <button
            onClick={handleUndo}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-sprout-surface sm:h-9 sm:w-9"
            data-testid="undo-btn"
            aria-label={t("swipe.undoSwipe")}
          >
            <Undo2 className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setTargetSheetOpen(true)}
          className="min-w-0 flex-1 rounded-full border border-transparent bg-white px-2 py-1 text-center shadow-sm ring-1 ring-zinc-200/80 transition-colors hover:border-violet-200 hover:bg-violet-50/50 sm:px-4 sm:py-1.5"
          data-testid="target-pill"
          aria-label={t("swipe.editTarget")}
        >
          <p className="truncate text-xs font-semibold leading-tight text-zinc-900 sm:text-sm">
            {translateRoleLabel(target.role, lang) || t("swipe.setTargetRole")}
          </p>
          <p className="truncate text-[9px] leading-tight text-zinc-500 sm:text-[11px]">
            <span className="sm:hidden">{translateLocationLabel(target.location, lang) || t("swipe.anywhere")}</span>
            <span className="hidden sm:inline">{translateLocationLabel(target.location, lang) || t("swipe.anywhere")} · {t("swipe.tapToEdit")}</span>
          </p>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => navigate("/history")}
            className="grid h-8 w-8 place-items-center rounded-full hover:bg-sprout-surface sm:h-9 sm:w-9"
            data-testid="history-btn"
            aria-label={t("swipe.history")}
          >
            <History className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" />
          </button>
          <button
            onClick={() => setFiltersOpen(true)}
            className="relative grid h-8 w-8 place-items-center rounded-full hover:bg-sprout-surface sm:h-9 sm:w-9"
            data-testid="filters-open-btn"
            aria-label={t("swipe.openFilters")}
          >
            <SlidersHorizontal className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" />
            {hasActiveFilters(filters) && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sprout-bg bg-sprout-mint" />
            )}
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden px-4 pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))]">
        <div className="relative mx-auto h-full w-full max-w-md overflow-hidden">
          {loading && jobs.length === 0 && <SkeletonCard />}

          {!loading && jobs.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
              data-testid="feed-empty"
            >
              <div className="w-16 h-16 rounded-2xl bg-sprout-mint-soft grid place-items-center mb-4">
                <Zap className="w-7 h-7 text-sprout-mint" />
              </div>
              <h3 className="font-display font-bold text-2xl text-white">
                {feedError
                  ? t("swipe.couldNotLoad")
                  : feedMeta?.fallback_reason === "no_auto_apply_jobs_found"
                  ? t("swipe.noJobsFilters")
                  : t("swipe.noJobsFiltered")}
              </h3>
              <p className="mt-2 text-sprout-muted text-sm max-w-xs">
                {feedError
                  ? feedError
                  : feedMeta?.provider_rate_limited
                  ? t("swipe.providerRateLimited")
                  : feedFallbackMessage(t, feedMeta)}
              </p>
              <button
                onClick={() => loadFeed(true, filtersRef.current, "empty_refresh")}
                className="mt-6 rounded-full bg-sprout-mint text-white font-semibold h-11 px-6 hover:opacity-90 transition-opacity"
                data-testid="refresh-feed-btn"
              >
                {t("common.refresh")}
              </button>
            </motion.div>
          )}

          <AnimatePresence>
            {jobs.slice(0, 3).reverse().map((j, i, arr) => {
              const idx = arr.length - 1 - i;
              return (
                <Card
                  key={j.job_id}
                  job={j}
                  onSwipe={handleSwipe}
                  onReport={setReportJob}
                  onShare={handleShareJob}
                  isTop={idx === 0}
                  index={idx}
                  t={t}
                  lang={lang}
                />
              );
            })}
          </AnimatePresence>

          {topJob ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center gap-8 sm:gap-14"
              style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => handleSwipe("skip")}
                disabled={!topJob || appLoading}
                className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full border-2 border-rose-500/70 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-colors hover:border-rose-500"
                aria-label={t("swipe.pass")}
                data-testid="skip-btn"
              >
                <X className="h-6 w-6 text-rose-500" strokeWidth={2.5} />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => handleSwipe("apply")}
                disabled={!topJob || appLoading}
                className="pointer-events-auto grid h-16 w-16 place-items-center rounded-full gradient-linkedin shadow-[0_8px_28px_rgba(124,58,237,0.45)] transition-opacity hover:opacity-90"
                aria-label={t("swipe.apply")}
                data-testid="apply-btn"
              >
                {appLoading
                  ? <Loader2 className="h-6 w-6 animate-spin text-white" />
                  : <Heart className="h-6 w-6 fill-white text-white" />
                }
              </motion.button>
            </div>
          ) : null}
        </div>
      </div>
      </div>

      <TargetSearchSheet
        open={targetSheetOpen}
        initialRole={target.role}
        initialLocation={target.location}
        initialLocationData={targetLocationData}
        onClose={() => setTargetSheetOpen(false)}
        onSaved={({ role, location, locationData }) => {
          setTarget({ role, location });
          setTargetLocationData(locationData);
          const nextFilters = {
            ...(filtersRef.current || {}),
            searchRadius: filtersRef.current?.searchRadius || DEFAULT_SEARCH_RADIUS,
          };
          if (locationData) {
            nextFilters.locationsData = [locationData];
            delete nextFilters.locations;
            delete nextFilters.locationData;
          } else if (location && location !== "Anywhere") {
            nextFilters.locations = [location];
            delete nextFilters.locationsData;
            delete nextFilters.locationData;
          }
          filtersRef.current = nextFilters;
          setFilters(nextFilters);
          savePersistedFilters(nextFilters);
          loadFeed(true, nextFilters, "target_sheet_saved");
        }}
      />

      <FiltersModal
        open={filtersOpen}
        initialFilters={filters}
        totalCount={totalCount}
        onApply={applyFilters}
        onReset={resetFilters}
        onClose={() => setFiltersOpen(false)}
      />

      <ReportJobSheet
        open={Boolean(reportJob)}
        job={reportJob}
        onClose={() => setReportJob(null)}
        onSubmit={handleReportSubmit}
      />

      <DemoWelcomeModal
        open={demoWelcomeOpen}
        onOpenChange={(next) => {
          if (next) setDemoWelcomeOpen(true);
        }}
        onDismiss={handleDismissDemoWelcome}
      />

      {feedDebugEnabled && (
        <div className="fixed inset-x-3 bottom-3 z-[100] max-h-[45vh] overflow-auto rounded-xl border border-zinc-300 bg-white p-3 text-xs text-zinc-900 shadow-2xl md:left-auto md:right-4 md:w-[560px]">
          <details open>
            <summary className="cursor-pointer font-semibold">Feed debug</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">
              {JSON.stringify(feedDebugPanelData || { message: "No feed request captured yet." }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </>
  );
}
