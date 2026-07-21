import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, useMotionValue, useTransform, AnimatePresence, animate } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import {
  Zap, Undo2, History, SlidersHorizontal, Flag, Share2, MapPin, Calendar,
  Heart, X, Loader2, Info, DollarSign, Briefcase, FileText, Star, Bell,
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
  seedTutorialShowcaseIfEmpty,
} from "../lib/demoAccount";
import { dismissDemoWelcome, shouldOpenDemoWelcome } from "../lib/demoWelcome";
import DemoWelcomeModal from "../components/demo/DemoWelcomeModal";
import { TUTORIAL_BYPASS_AUTH } from "../lib/dev";
import { DEMO_SETTINGS_CHANGED, isFinanceDemoEnabled } from "../lib/demoSettings";
import { getFinanceDemoFeedData, performFinanceDemoSwipe, performFinanceDemoUndo } from "../lib/financeDemoApi";
import { getFinanceDemoSearchTarget } from "../lib/financeDemoJobs";
import { shouldShowSwipeAdminAtsBadge, filterPersonalSwipeFeedJobs } from "../lib/adminSwipeUi";
import { ensureTutorialSession } from "../lib/tutorialSession";
import { useUpgradeModal } from "../context/UpgradeModalContext";
import DesktopSwipeFeed from "../components/swipe/DesktopSwipeFeed";
import SwipeFeedTerminalState from "../components/swipe/SwipeFeedTerminalState";
import NotificationsPanel from "../components/notifications/NotificationsPanel";
import ResumeSheet from "../components/ResumeSheet";
import PhoneSheet from "../components/PhoneSheet";
import { saveTargetPreferences, normalizeLocationData } from "../lib/targetPreferences";
import { resolveProfileSearchPreferences } from "../lib/profileSearchPreferences";
import { enrichLocationData } from "../lib/locationSearch";
import { hasActiveFilters, mergeFilters, clearMenuFilters } from "../lib/jobFilters";
import { reconcileFiltersForUser } from "../lib/contractTypeMapping";
import { useAppLocale } from "../context/AppLocaleContext";
import DesktopCreditsPill from "../components/desktop/DesktopCreditsPill";
import { BILLING_UPDATED, notifyBillingPatch } from "../lib/billingEvents";
import { claimFriendReferralReward } from "../lib/friendReferral";
import {
  formatPostedDate,
  getSwipeSuccessCopy,
  getSwipeErrorMessage,
} from "../lib/appUi";
import {
  isMissingPhoneFeedError,
  isMissingResumeFeedError,
  profileHasPhone,
  profileHasResume,
} from "../lib/profileReadiness";
import { getJobBadgeItems, getJobDisplayContent, getJobDisplayTitle, formatJobSalaryLabel } from "../lib/jobDisplayUtils";
import JobRomeProfile from "../components/swipe/JobRomeProfile";
import JobOfferDetails from "../components/swipe/JobOfferDetails";
import JobCardHighlights, { JobCardMatchBadge } from "../components/swipe/JobCardHighlights";
import { translateLocationLabel, translateRoleLabel } from "../lib/localizedDisplay";
import { useFeedV2RolloutObservation } from "../components/swipe/FeedV2RolloutObservation";
import { canStartSwipe } from "../lib/swipeInteractionPolicy";

import { preloadCompanyLogos } from "../lib/companyLogos";
import {
  buildSwipeFeedCacheKey,
  clearSwipeFeedCache,
  clearSwipedJobIdsByPrefix,
  filterOutSwipedJobs,
  getSwipeFeedCacheSnapshot,
  readSwipeFeedCache,
  recordSwipedJobId,
  seedSwipedJobIds,
  unrecordSwipedJobId,
  writeSwipeFeedCache,
} from "../lib/swipeFeedCache";
import {
  createInitialSwipeFeedRequestGate,
  createSwipeFeedRequestFence,
  deriveFinalCursorActionedReason,
  resolveSwipeFeedViewState,
  sanitizeSwipeFeedParams,
} from "../lib/swipeFeedRequestPolicy";

const DEFAULT_SEARCH_RADIUS = "50km";
const FEED_BATCH_SIZE = 12;
const FEED_PREFETCH_THRESHOLD = 7;
const FILTERS_STORAGE_KEY = "swiipr.jobs.filters.v2";

const isFinanceDemoFeedResponse = (data) => (
  Boolean(data?.finance_demo || data?.feed_mode === "finance_demo")
);

const readPersistedFilters = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
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

/** Target pill search wins over location filters saved in the filters modal. */
const filtersForTargetSearch = (f) => {
  const merged = mergeFilters(f);
  return {
    ...merged,
    locations: [],
    locationsData: [],
    locationData: null,
  };
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
  if (response?.filters_applied?.explicit_local_intent || response?.request_trace?.explicit_local_intent) {
    return null;
  }
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
  const backendCityTerms = (response?.filters_applied?.selected_city_terms || [])
    .map((term) => normalizeSearchText(term))
    .filter(Boolean);
  const cityTerms = new Set(backendCityTerms);
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
    const data = job?.data && typeof job.data === "object" ? job.data : {};
    const text = normalizeSearchText([
      job?.city,
      job?.region,
      job?.location,
      job?.country,
      job?.country_code,
      // Some providers store location pieces under `data.*` rather than top-level fields.
      data?.location,
      data?.job_city,
      data?.job_state,
      data?.job_country,
      data?.job_location,
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

const CARD_TAP_SUPPRESS_MS = 320;
let cardTapSuppressUntil = 0;

function suppressCardTap(ms = CARD_TAP_SUPPRESS_MS) {
  cardTapSuppressUntil = Date.now() + ms;
}

function isCardTapSuppressed() {
  return Date.now() < cardTapSuppressUntil;
}

function stopCardTap(e) {
  suppressCardTap();
  e.stopPropagation();
}

function mobileSectionMeta(title) {
  const normalized = (title || "").toLowerCase();
  if (/desired|nice to have|preferred|souhait|plus|atout/i.test(normalized)) {
    return { Icon: Star, iconClass: "text-amber-500" };
  }
  if (/required|requirement|requis|profil recherch/i.test(normalized)) {
    return { Icon: Briefcase, iconClass: "text-sprout-mint" };
  }
  if (/about/i.test(normalized)) {
    return { Icon: FileText, iconClass: "text-sprout-mint" };
  }
  return { Icon: FileText, iconClass: "text-sprout-mint" };
}

function JobCardMeta({ location, salaryLabel, postedLabel, compact = false }) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-sprout-muted sm:gap-x-4 sm:text-sm">
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-sprout-mint" strokeWidth={1.9} />
          <span className="truncate">{location}</span>
        </span>
        {salaryLabel ? (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <DollarSign className="h-3.5 w-3.5 shrink-0 text-sprout-mint" strokeWidth={1.9} />
            <span className="truncate">{salaryLabel}</span>
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5 shrink-0 text-sprout-mint" strokeWidth={1.9} />
          <span className="whitespace-nowrap">{postedLabel}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5 text-sm text-sprout-muted sm:text-[15px]">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-sprout-mint" strokeWidth={1.9} />
        <span>{location}</span>
      </div>
      {salaryLabel ? (
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-sprout-mint" strokeWidth={1.9} />
          <span className="text-center">{salaryLabel}</span>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-sprout-mint" strokeWidth={1.9} />
        <span>{postedLabel}</span>
      </div>
    </div>
  );
}

function JobCardBadges({ badges, compact = false }) {
  if (!badges.length) return null;

  return (
    <div
      className={
        compact
          ? "no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0"
          : "flex flex-wrap justify-center gap-2"
      }
    >
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={`inline-flex shrink-0 items-center rounded-full bg-sprout-surface-2 font-medium text-zinc-100 ${
            compact ? "px-2.5 py-1 text-[11px] sm:px-3 sm:py-1.5 sm:text-[13px]" : "px-3 py-1.5 text-[13px]"
          }`}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function MobileDetailSection({ title, bullets, body, t }) {
  const isAbout = /about/i.test(title || "");
  const { Icon, iconClass } = mobileSectionMeta(title);

  return (
    <section className="rounded-2xl border border-sprout-border bg-sprout-surface-2/40 px-4 py-3">
      <h3 className="mb-2 flex items-center gap-2 font-display text-base font-bold text-white">
        <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
        {isAbout ? t("swipe.aboutRole") : title}
        {!isAbout && bullets?.length ? (
          <span className="font-normal text-sprout-muted">({bullets.length})</span>
        ) : null}
      </h3>
      {body ? (
        <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed text-sprout-muted">{body}</p>
      ) : null}
      {bullets?.length ? (
        <ul className="space-y-2">
          {bullets.map((bullet, index) => (
            <li key={`${title}-${index}`} className="flex items-start gap-2 text-sm leading-relaxed text-sprout-muted">
              <span className="mt-1.5 text-[8px] text-sprout-mint">●</span>
              <span className="line-clamp-2">{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CardFront({ job, onReport, onShare, actionsEnabled, t, lang, pointerEventsDisabled = false }) {
  const { snippet, about } = getJobDisplayContent(job);
  const badges = getJobBadgeItems(job, { lang });
  const title = getJobDisplayTitle(job, { lang });
  const location = translateLocationLabel(job.location, lang) || t("swipe.locationNotSpecified");
  const salaryLabel = formatJobSalaryLabel(job, { lang });
  const postedLabel = formatPostedDate(t, job.posted_at) || t("swipe.postedRecently");
  const previewText = snippet || (about ? about.split(/\n+/).find(Boolean) : "");

  return (
    <div className={`backface-hidden absolute inset-0 flex flex-col overflow-hidden rounded-[28px] border border-sprout-border bg-sprout-surface ${pointerEventsDisabled ? "pointer-events-none" : ""}`}>
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-5">
        <div className="flex shrink-0 items-start justify-between gap-2">
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
          <JobCardMatchBadge job={job} t={t} />
        </div>

        <div className="mt-0.5 flex justify-center sm:mt-1">
          <CompanyLogo job={job} size="md" rounded="2xl" className="sm:hidden" />
          <CompanyLogo job={job} size="lg" rounded="2xl" className="hidden sm:block" />
        </div>

        <div className="mt-2 text-center sm:mt-4">
          <p className="font-display text-lg font-semibold text-white sm:text-2xl">{job.company}</p>
        </div>

        <div className="mt-2 px-1 sm:mt-4 sm:px-3">
          <h2
            className="text-center font-display text-[clamp(1.2rem,5vw,2.35rem)] font-black leading-[1.08] tracking-tight text-white"
            data-testid="job-title"
          >
            {title}
          </h2>
        </div>

        <div className="mt-2 sm:mt-4">
          <JobCardMeta
            location={location}
            salaryLabel={salaryLabel}
            postedLabel={postedLabel}
            compact
          />
        </div>

        {previewText ? (
          <p className="mt-2 line-clamp-2 px-1 text-center text-xs leading-relaxed text-sprout-muted sm:mt-3 sm:line-clamp-3 sm:px-3 sm:text-sm">
            {previewText}
          </p>
        ) : null}

        <div className="mt-2 sm:mt-3">
          <JobCardHighlights job={job} t={t} lang={lang} max={3} compact />
        </div>

        <div className="mt-auto pt-2 sm:mt-3 sm:pt-0">
          <JobCardBadges badges={badges} compact />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-sprout-border/60 px-4 py-2.5 sm:px-6 sm:py-5">
        <div className="flex items-center gap-2 font-display text-base font-bold text-white sm:text-lg">
          <Logo size={20} className="sm:h-[22px] sm:w-[22px]" />
          {BRAND.NAME}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-sprout-muted sm:text-[13px]">
          {t("swipe.tapForDetails")}
          <Info className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </div>
      </div>
    </div>
  );
}

function CardBack({ job, t, lang, onFlipBack }) {
  const { about, detailSections } = getJobDisplayContent(job);
  const badges = getJobBadgeItems(job, { lang });
  const title = getJobDisplayTitle(job, { lang });
  const location = translateLocationLabel(job.location, lang) || t("swipe.locationNotSpecified");
  const salaryLabel = formatJobSalaryLabel(job, { lang });

  return (
    <div className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col overflow-hidden rounded-[28px] border border-sprout-border bg-sprout-surface">
      <div
        className="flex min-h-[5.5rem] max-h-[30%] shrink-0 items-center border-b border-sprout-border px-4 py-3 text-left sm:px-6"
        aria-label={t("swipe.tapToFlipBack")}
      >
        <CompanyLogo job={job} size="md" rounded="xl" className="mr-3 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2
            className="line-clamp-2 font-display text-lg font-black leading-tight tracking-tight text-white sm:text-xl"
            data-testid="job-title-back"
          >
            {title}
          </h2>
          <p className="mt-0.5 truncate text-sm font-semibold text-white sm:text-base">{job.company}</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="app-scroll no-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3 pb-2 touch-pan-y sm:px-6 sm:py-4"
        data-testid="swipe-card-scroll"
      >
        <JobCardMeta
          location={location}
          salaryLabel={salaryLabel}
          postedLabel={formatPostedDate(t, job.posted_at) || t("swipe.postedRecently")}
          compact
        />

        <JobCardBadges badges={badges} compact />

        <div className="border-t border-sprout-border" />

        <div className="hidden sm:block">
          <JobOfferDetails job={job} t={t} lang={lang} compact />
        </div>
        <div className="sm:hidden">
          <JobCardHighlights job={job} t={t} lang={lang} max={4} compact />
        </div>

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
          <JobRomeProfile job={job} t={t} enabled />
        </div>
      </div>

      <button
        type="button"
        className="flex w-full shrink-0 items-center justify-between border-t border-sprout-border px-6 py-3 text-[13px] text-sprout-muted"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          suppressCardTap();
          onFlipBack?.();
        }}
        aria-label={t("swipe.tapToFlipBack")}
      >
        <span className="flex items-center gap-1.5 font-display font-bold text-white">
          <Logo size={18} />
          {BRAND.NAME}
        </span>
        <span className="flex items-center gap-1.5">
          {t("swipe.tapToFlipBack")}
          <Info className="h-4 w-4" />
        </span>
      </button>
      </div>
    </div>
  );
}

function AdminAtsBadge({ job }) {
  const tier = String(job?.applyability_tier || "").toUpperCase();
  const provider = job?.ats_provider || job?.provider || "unknown";
  if (!tier && !provider) return null;
  return (
    <div
      className="pointer-events-none absolute left-2 top-2 z-20 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-lime-300"
      data-testid="admin-ats-tier-badge"
    >
      {provider} · {tier || "?"}
    </div>
  );
}

const CARD_BUTTON_SWIPE_X = 520;

function Card({ job, onSwipe, onReport, onShare, isTop, index, t, lang, showAdminAtsBadge, pendingSwipe, onSwipeRequestComplete }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-260, 0, 260], [-14, 0, 14]);
  const opacity = useTransform(x, [-360, -260, 0, 260, 360], [0, 1, 1, 1, 0]);
  const applyOpacity = useTransform(x, [0, 80, 160], [0, 0.5, 1]);
  const skipOpacity = useTransform(x, [-160, -80, 0], [1, 0.5, 0]);
  const [flipped, setFlipped] = useState(false);
  const [showBack, setShowBack] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const interactionRef = useRef({
    dragDistance: 0,
    suppressTap: false,
  });

  useEffect(() => {
    setFlipped(false);
    setShowBack(false);
    setIsDragging(false);
    setIsAnimatingOut(false);
    interactionRef.current.dragDistance = 0;
    interactionRef.current.suppressTap = false;
  }, [job.job_id, isTop]);

  const resetInteractionState = useCallback(() => {
    window.setTimeout(() => {
      interactionRef.current.dragDistance = 0;
      interactionRef.current.suppressTap = false;
    }, CARD_TAP_SUPPRESS_MS);
  }, []);

  const flipToFront = useCallback(() => {
    setFlipped(false);
  }, []);

  const handleFlipTap = useCallback(() => {
    if (!isTop) return;
    if (isCardTapSuppressed()) return;
    if (interactionRef.current.suppressTap || interactionRef.current.dragDistance > 8) return;
    if (flipped) {
      flipToFront();
      return;
    }
    setShowBack(true);
    setFlipped(true);
  }, [isTop, flipped, flipToFront]);

  useEffect(() => {
    if (!isTop || !pendingSwipe) return undefined;
    let cancelled = false;
    setIsAnimatingOut(true);
    setIsDragging(true);
    setFlipped(false);
    interactionRef.current.suppressTap = true;
    suppressCardTap(400);

    const targetX = pendingSwipe === "apply" ? CARD_BUTTON_SWIPE_X : -CARD_BUTTON_SWIPE_X;
    const controls = animate(x, targetX, {
      type: "spring",
      stiffness: 280,
      damping: 32,
      onComplete: () => {
        if (cancelled) return;
        setIsDragging(false);
        setIsAnimatingOut(false);
        x.set(0);
        y.set(0);
        onSwipe(pendingSwipe);
        onSwipeRequestComplete?.();
      },
    });

    return () => {
      cancelled = true;
      controls.stop();
    };
  }, [pendingSwipe, isTop, job.job_id, onSwipe, onSwipeRequestComplete, x, y]);

  return (
    <motion.div
      className="absolute inset-0 h-full select-none"
      style={{
        x: isTop ? x : 0,
        y: isTop ? y : 0,
        rotate: isTop ? rotate : 0,
        opacity: isTop ? opacity : 1,
        scale: 1 - index * 0.03,
        translateY: index * 10,
        zIndex: 10 - index,
        // Flipped: hand touch fully back to the description's own vertical
        // scroll container. Not flipped: let Framer own the gesture outright
        // (it needs both axes now) rather than racing the browser for it.
        touchAction: flipped ? "pan-y" : "none",
        pointerEvents: isTop && !isAnimatingOut ? "auto" : "none",
      }}
      // Disabled entirely while flipped -- this is what actually fixes
      // scroll-vs-swipe contention. Card front vs. reading the flipped-back
      // description are mutually exclusive interactions, so there is no
      // gesture for Framer to capture (and therefore nothing that can
      // mis-fire) while the description is open; the only way back to the
      // front is a tap (handleFlipTap) or the explicit button in CardBack.
      drag={isTop && !isAnimatingOut && !flipped}
      dragMomentum={false}
      dragElastic={0.6}
      dragSnapToOrigin
      whileDrag={{ cursor: "grabbing" }}
      onDragStart={() => {
        setIsDragging(true);
        interactionRef.current.suppressTap = false;
      }}
      onDrag={(_, info) => {
        const distance = Math.hypot(info.offset.x, info.offset.y);
        interactionRef.current.dragDistance = distance;
        if (distance > 5) {
          interactionRef.current.suppressTap = true;
          suppressCardTap();
        }
      }}
      onDragEnd={(_, info) => {
        setIsDragging(false);
        const distance = Math.hypot(info.offset.x, info.offset.y);
        interactionRef.current.dragDistance = distance;
        if (distance > 8) {
          interactionRef.current.suppressTap = true;
          suppressCardTap();
        }
        if (info.offset.x > 140 || info.velocity.x > 700) {
          interactionRef.current.suppressTap = true;
          suppressCardTap();
          onSwipe("apply");
        } else if (info.offset.x < -140 || info.velocity.x < -700) {
          interactionRef.current.suppressTap = true;
          suppressCardTap();
          onSwipe("skip");
        }
        resetInteractionState();
      }}
      onTapCancel={() => {
        // Scrolling the flipped description moves the pointer enough that
        // Framer's own tap-vs-press disambiguation cancels the tap here too
        // (bubbles up from the nested scroll container regardless of the
        // `drag` prop). This used to self-clear on the next onDragStart, but
        // drag is now disabled outright while flipped, so nothing ever reset
        // suppressTap back to false -- permanently blocking the deliberate
        // tap-to-flip-back afterwards. Schedule the same timed reset the
        // drag handlers already use instead.
        interactionRef.current.suppressTap = true;
        suppressCardTap();
        resetInteractionState();
      }}
      onTap={handleFlipTap}
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
          pointerEventsDisabled={flipped}
        />
        {showBack ? (
          <CardBack
            job={job}
            t={t}
            lang={lang}
            onFlipBack={flipToFront}
          />
        ) : (
          <div className="backface-hidden rotate-y-180 absolute inset-0 rounded-[28px] border border-sprout-border bg-sprout-surface" aria-hidden="true" />
        )}
      </motion.div>
      {showAdminAtsBadge ? <AdminAtsBadge job={job} /> : null}
      {isTop && (!flipped || isDragging) ? (
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
  const location = useLocation();
  const { t, lang } = useAppLocale();
  const { loading: authLoading, user, isAdmin } = useAuth();
  const feedV2RolloutObserved = useFeedV2RolloutObservation(user?.analytics_user_id);
  const showAdminAtsBadge = shouldShowSwipeAdminAtsBadge(isAdmin, user?.email);
  const isDemoAccount = Boolean(user?.demo_account);
  const isFinanceDemo = isDemoAccount && isFinanceDemoEnabled();
  const [demoWelcomeOpen, setDemoWelcomeOpen] = useState(false);
  const [jobs, setJobs] = useState(() => getSwipeFeedCacheSnapshot().jobs);
  const [loading, setLoading] = useState(() => !getSwipeFeedCacheSnapshot().jobs.length);
  const [nextPageLoading, setNextPageLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [appLoading, setAppLoading] = useState(false);
  const [appliedToday, setAppliedToday] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [target, setTarget] = useState(() => getSwipeFeedCacheSnapshot().target || { role: "", location: "" });
  const [targetLocationData, setTargetLocationData] = useState(() => getSwipeFeedCacheSnapshot().targetLocationData);
  const [targetSaving, setTargetSaving] = useState(false);
  const [targetSheetOpen, setTargetSheetOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [desktopFiltersOpen, setDesktopFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(() => (
    getSwipeFeedCacheSnapshot().filters
      ? mergeFilters(getSwipeFeedCacheSnapshot().filters)
      : mergeFilters(readPersistedFilters())
  ));
  const [totalCount, setTotalCount] = useState(null);
  const [feedMeta, setFeedMeta] = useState(() => getSwipeFeedCacheSnapshot().meta);
  const [feedError, setFeedError] = useState("");
  const [lastFeedDebug, setLastFeedDebug] = useState(null);
  const [reportJob, setReportJob] = useState(null);
  const [billing, setBilling] = useState(null);
  const [profile, setProfile] = useState(null);
  const [resumeSheetOpen, setResumeSheetOpen] = useState(false);
  const [phoneSheetOpen, setPhoneSheetOpen] = useState(false);
  const [pendingCardSwipe, setPendingCardSwipe] = useState(null);
  const { upgradeOpen, openUpgrade } = useUpgradeModal();
  const fetchingRef = useRef(false);
  const filtersRef = useRef(filters);
  const profileRef = useRef(null);
  const targetRef = useRef(getSwipeFeedCacheSnapshot().target || { role: "", location: "" });
  const targetLocationDataRef = useRef(getSwipeFeedCacheSnapshot().targetLocationData);
  const pendingFiltersRef = useRef(undefined);
  const feedAbortRef = useRef(null);
  const feedRequestFenceRef = useRef(createSwipeFeedRequestFence());
  const initialFeedRequestGateRef = useRef(createInitialSwipeFeedRequestGate());
  const jobsRef = useRef(getSwipeFeedCacheSnapshot().jobs);
  const viewedJobIdsRef = useRef(new Set());
  const handleSwipeRef = useRef(null);
  const requestSwipeRef = useRef(null);
  const nextCursorRef = useRef(null);
  const terminalImpressionsRef = useRef(new Set());

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    if (authLoading || isDemoAccount) return;
    if (!jobs.length) return;
    writeSwipeFeedCache({
      jobs,
      meta: feedMeta,
      target: targetRef.current,
      targetLocationData: targetLocationDataRef.current,
      filters: filtersRef.current,
      cacheKey: buildSwipeFeedCacheKey({
        userId: user?.user_id,
        target: targetRef.current,
        targetLocationData: targetLocationDataRef.current,
        filters: filtersRef.current,
      }),
      userId: user?.user_id,
    });
  }, [authLoading, jobs, feedMeta, user?.user_id]);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    targetLocationDataRef.current = targetLocationData;
  }, [targetLocationData]);

  useEffect(() => {
    if (authLoading || !user?.user_id) return;
    const forcePreview = new URLSearchParams(window.location.search).get("demoWelcome") === "1";
    if (!forcePreview && !isDemoAccount) return;
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
    targetLocationDataRef.current = demo.locationData;
    const nextFilters = clearMenuFilters({
      searchRadius: filtersRef.current?.searchRadius || DEFAULT_SEARCH_RADIUS,
    });
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
    targetLocationDataRef.current = demo.locationData;
    const nextFilters = clearMenuFilters({
      searchRadius: filtersRef.current?.searchRadius || DEFAULT_SEARCH_RADIUS,
    });
    filtersRef.current = nextFilters;
    setFilters(nextFilters);
    savePersistedFilters(nextFilters);
    return nextFilters;
  }, []);

  const loadProfile = useCallback(async () => {
    if (isFinanceDemo) {
      applyFinanceDemoTarget();
      return null;
    }
    if (isDemoAccount) {
      try {
        const { data } = await api.get("/profile");
        profileRef.current = data || null;
        setProfile(data || null);
        if (data?.target_role || data?.cv_text) {
          const prefs = resolveProfileSearchPreferences(data);
          const nextTarget = {
            role: prefs.role,
            location: prefs.location,
          };
          setTarget(nextTarget);
          targetRef.current = nextTarget;
          setTargetLocationData(prefs.locationData);
          targetLocationDataRef.current = prefs.locationData;
          return data;
        }
      } catch (_) {}
      applyDemoAccountTarget();
      return profileRef.current;
    }
    try {
      const { data } = await api.get("/profile");
      profileRef.current = data || null;
      setProfile(data || null);
      if (data) {
        const prefs = resolveProfileSearchPreferences(data);
        const nextTarget = {
          role: prefs.role,
          location: prefs.location,
        };
        setTarget(nextTarget);
        targetRef.current = nextTarget;
        setTargetLocationData(prefs.locationData);
        targetLocationDataRef.current = prefs.locationData;
      }
      return data || null;
    } catch (_) {
      return null;
    }
  }, [applyFinanceDemoTarget, applyDemoAccountTarget, isDemoAccount, isFinanceDemo]);

  const syncSwipedJobsFromServer = useCallback(async (userId) => {
    if (!userId || isDemoAccount) return;
    try {
      const [leftRes, rightRes] = await Promise.all([
        api.get("/swipes/history?direction=left&limit=500"),
        api.get("/swipes/history?direction=right&limit=500"),
      ]);
      const ids = [
        ...(leftRes.data?.swipes || []),
        ...(rightRes.data?.swipes || []),
      ].map((row) => row?.job_id).filter(Boolean);
      seedSwipedJobIds(ids, userId);
    } catch (_) {
      /* offline / demo */
    }
  }, []);

  const buildFeedParams = (f) => {
    const params = new URLSearchParams({ limit: String(FEED_BATCH_SIZE), search_radius: DEFAULT_SEARCH_RADIUS });
    const activeTarget = targetRef.current;
    if (activeTarget) {
      const role = (activeTarget.role || "").trim();
      if (role) params.set("search_role", role);
    }
    if (f == null) return params;
    const merged = mergeFilters(f);
    if (merged.minSalary) params.set("min_salary", String(merged.minSalary));
    if (merged.postedDate && merged.postedDate !== "any") params.set("posted_within", merged.postedDate);
    merged.workLocations?.forEach((v) => params.append("work_location", v));
    merged.jobTypes?.forEach((v) => params.append("job_type", v));
    merged.experience?.forEach((v) => params.append("experience", v));
    const filterLocationsData = merged.locationsData?.length
      ? merged.locationsData
      : merged.locationData
        ? [merged.locationData]
        : [];
    if (filterLocationsData.length) {
      params.set("locations_json", JSON.stringify(filterLocationsData));
    } else if (targetLocationDataRef.current) {
      params.set("locations_json", JSON.stringify([targetLocationDataRef.current]));
    } else {
      merged.locations?.forEach((v) => params.append("location", v));
      const targetLocation = activeTarget?.location?.trim();
      if (!merged.locations?.length && targetLocation && targetLocation !== "Anywhere") {
        params.append("location", targetLocation);
      }
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
    // Low-stack prefetches consume the committed Feed V2 cursor. Never repeat
    // the first page after the server has declared this query terminal.
    if (!replace && nextCursorRef.current === null) return;
    if (feedAbortRef.current) {
      feedAbortRef.current.abort();
      feedAbortRef.current = null;
    }
    const requestFence = feedRequestFenceRef.current.next();
    const controller = new AbortController();
    feedAbortRef.current = controller;
    pendingFiltersRef.current = undefined;
    // Keep `stackPrefetch` (UI) limited to restoring-from-stack only: it controls
    // whether we show/clear the loading skeleton.
    const stackPrefetch = !replace && jobsRef.current.length > 0;
    // Only restore-from-navigation should skip the loading skeleton. Any explicit
    // target/filter change must clear the stack and show a fresh search.
    const silentRefresh = replace && jobsRef.current.length > 0 && reason === "initial_navigation";
    const isUserSearchChange = (
      reason.startsWith("target_")
      || reason.startsWith("filters_")
      || reason === "demo_settings_changed"
      || reason === "initial_finance_demo"
    );
    fetchingRef.current = true;
    if (isUserSearchChange && replace) {
      clearSwipeFeedCache();
      jobsRef.current = [];
    }
    if (!stackPrefetch && !silentRefresh) {
      setLoading(true);
      if (replace) setJobs([]);
    }
    if (!replace) setNextPageLoading(true);
    setFeedError("");
    const params = sanitizeSwipeFeedParams(buildFeedParams(f));
    if (!replace && nextCursorRef.current) params.set("cursor", nextCursorRef.current);
    let requestUrl = `/jobs/feed?${params.toString()}`;
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
      if (!requestFence.isCurrent()) return;
      const financeFeed = isFinanceDemoFeedResponse(data);
      const receivedNextCursor = data?.nextCursor ?? data?.next_cursor ?? null;
      nextCursorRef.current = receivedNextCursor;
      setNextCursor(receivedNextCursor);
      let localFeedGuard = financeFeed ? null : buildLocalFeedGuard({ params, response: data });
      let responseJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const jobsAfterLocalGuard = localFeedGuard ? responseJobs.filter(localFeedGuard) : responseJobs;
      const jobsAfterActionFilter = financeFeed ? jobsAfterLocalGuard : filterOutSwipedJobs(jobsAfterLocalGuard);
      let safeJobs = filterPersonalSwipeFeedJobs(user?.email, jobsAfterActionFilter);
      let outsideLocationHiddenCount = responseJobs.length - safeJobs.length;
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
      const upstreamEmptyReason = data?.emptyReason ?? data?.empty_reason?.code ?? data?.empty_reason;
      const derivedEmptyReason = deriveFinalCursorActionedReason({
        nextCursor: receivedNextCursor,
        upstreamEmptyReason,
        jobsBeforeActionFilter: jobsAfterLocalGuard.length,
        jobsAfterActionFilter: jobsAfterActionFilter.length,
      });
      if (derivedEmptyReason) {
        data = {
          ...(data || {}),
          emptyReason: derivedEmptyReason,
          empty_reason: derivedEmptyReason,
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
        const base = replace ? [] : (financeFeed ? prev : filterOutSwipedJobs(localFeedGuard ? prev.filter(localFeedGuard) : prev));
        const seen = new Set(base.map((j) => j.job_id));
        const merged = [...base];
        safeJobs.forEach((j) => { if (!seen.has(j.job_id)) merged.push(j); });
        const visible = financeFeed ? merged : filterOutSwipedJobs(merged);
        const filtered = filterPersonalSwipeFeedJobs(user?.email, visible);
        preloadCompanyLogos(filtered.slice(0, 6));
        writeSwipeFeedCache({
          jobs: filtered,
          meta: data,
          target: targetRef.current,
          targetLocationData: targetLocationDataRef.current,
          filters: filtersRef.current,
          cacheKey: buildSwipeFeedCacheKey({
            userId: user?.user_id,
            target: targetRef.current,
            targetLocationData: targetLocationDataRef.current,
            filters: filtersRef.current,
          }),
          userId: user?.user_id,
        });
        return filtered;
      });
      // Client-side swipe filtering can consume a complete server page. Keep
      // advancing through committed cursors before allowing a terminal state.
      if (!safeJobs.length && receivedNextCursor) {
        window.setTimeout(() => loadFeed(false, f, "filtered_page_continue"), 0);
      }
    } catch (e) {
      if (controller.signal.aborted || e?.code === "ERR_CANCELED") return;
      if (!requestFence.isCurrent()) return;
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
      if (requestFence.isCurrent()) {
        // A prefetch can begin while a card is still visible, then become the
        // only request after the user swipes that final card. In that case the
        // empty stack must remain a loading state, not an empty-feed state.
        if ((!stackPrefetch && !silentRefresh) || jobsRef.current.length === 0) setLoading(false);
        fetchingRef.current = false;
        setNextPageLoading(false);
        if (feedAbortRef.current === controller) feedAbortRef.current = null;
      }
    }
  }, [t, user?.user_id, user?.email]);

  useEffect(() => {
    const onDemoSettings = (event) => {
      const financeOn = Boolean(event?.detail?.financeJobFeed ?? isFinanceDemoEnabled());
      clearSwipeFeedCache();
      jobsRef.current = [];
      setJobs([]);
      setTotalCount(null);
      setFeedMeta(null);
      nextCursorRef.current = null;
      setNextCursor(null);
      setFeedError("");
      if (financeOn) {
        clearSwipedJobIdsByPrefix("finance_demo_");
        const nextFilters = applyFinanceDemoTarget();
        loadFeed(true, nextFilters, "demo_settings_changed");
        return;
      }
      const nextFilters = reconcileFiltersForUser(readPersistedFilters(), profileRef.current);
      loadProfile();
      loadFeed(true, nextFilters, "demo_settings_changed");
    };
    window.addEventListener(DEMO_SETTINGS_CHANGED, onDemoSettings);
    return () => window.removeEventListener(DEMO_SETTINGS_CHANGED, onDemoSettings);
  }, [loadFeed, loadProfile, applyFinanceDemoTarget]);

  const saveTargetSearch = useCallback(async ({ role, roles, sectorIds, industryIds, location, locationData }) => {
    const selectedRoles = [...new Set([
      ...(Array.isArray(roles) ? roles : []),
      role,
    ].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 3);
    const trimmedRole = selectedRoles[0] || "";
    if (!trimmedRole) {
      toast.error(t("toasts.enterJobTitle") || (lang === "fr" ? "Saisissez un métier" : "Enter a job title"));
      return false;
    }
    setTargetSaving(true);
    try {
      const trimmedLocation = (location || "").trim();
      const normalizedLocationData = normalizeLocationData(trimmedLocation, locationData);
      const locationLabel = normalizedLocationData?.location_label || trimmedLocation || "Anywhere";

      await saveTargetPreferences({
        role: trimmedRole,
        roles: selectedRoles,
        sectorIds,
        industryIds,
        location: locationLabel,
        locationData: normalizedLocationData,
      });

      const nextTarget = { role: trimmedRole, location: locationLabel };
      setTarget(nextTarget);
      targetRef.current = nextTarget;
      setTargetLocationData(normalizedLocationData);
      targetLocationDataRef.current = normalizedLocationData;
      setProfile((current) => current ? {
        ...current,
        target_role: trimmedRole,
        target_roles: selectedRoles,
        ...(Array.isArray(sectorIds) ? { sector_ids: sectorIds } : {}),
        ...(Array.isArray(industryIds) ? { industry_ids: industryIds } : {}),
        target_location: locationLabel,
        target_location_data: normalizedLocationData,
      } : current);
      profileRef.current = profileRef.current ? {
        ...profileRef.current,
        target_role: trimmedRole,
        target_roles: selectedRoles,
        ...(Array.isArray(sectorIds) ? { sector_ids: sectorIds } : {}),
        ...(Array.isArray(industryIds) ? { industry_ids: industryIds } : {}),
        target_location: locationLabel,
        target_location_data: normalizedLocationData,
      } : profileRef.current;

      const nextFilters = filtersForTargetSearch(filtersRef.current);
      filtersRef.current = nextFilters;
      setFilters(nextFilters);
      savePersistedFilters(nextFilters);

      setJobs([]);
      setTotalCount(null);
      setFeedMeta(null);
      nextCursorRef.current = null;
      setNextCursor(null);
      setFeedError("");
      jobsRef.current = [];
      await loadFeed(true, nextFilters, "target_search_save");
      toast.success(t("toasts.searchUpdated"));
      return true;
    } catch (_) {
      toast.error(t("toasts.searchSaveError"));
      return false;
    } finally {
      setTargetSaving(false);
    }
  }, [lang, loadFeed, t]);

  useEffect(() => {
    if (authLoading || !user?.user_id) return;
    const navigationIdentity = `${user.user_id}:${isFinanceDemo ? "finance" : isDemoAccount ? "demo" : "live"}`;
    if (!initialFeedRequestGateRef.current.claim(navigationIdentity)) return;
    if (isDemoAccount) ensureDemoAccountDefaults();
    const bootstrap = async () => {
      const isDemo = isDemoAccount;

      api.get("/billing/status")
        .then(({ data }) => setBilling(data))
        .catch(() => setBilling({ is_premium: false }));

      await loadProfile();

      if (isFinanceDemo) {
        const financeFilters = applyFinanceDemoTarget();
        loadFeed(true, financeFilters, "initial_finance_demo");
        return;
      }
      if (isDemo) {
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

      const cacheKey = buildSwipeFeedCacheKey({
        userId: user?.user_id,
        target: targetRef.current,
        targetLocationData: targetLocationDataRef.current,
        filters: mergedFilters,
      });
      const cached = readSwipeFeedCache({ userId: user?.user_id, cacheKey });

      if (cached?.jobs?.length) {
        const cachedJobs = filterPersonalSwipeFeedJobs(user?.email, cached.jobs);
        setJobs(cachedJobs);
        jobsRef.current = cachedJobs;
        setFeedMeta(cached.meta);
        setLoading(false);
        preloadCompanyLogos(cachedJobs.slice(0, 6));
        await syncSwipedJobsFromServer(user.user_id);
        setJobs((prev) => {
          const visible = filterPersonalSwipeFeedJobs(user?.email, filterOutSwipedJobs(prev));
          jobsRef.current = visible;
          return visible;
        });
        loadFeed(true, mergedFilters, "initial_navigation");
        return;
      }

      await syncSwipedJobsFromServer(user?.user_id);

      if (jobsRef.current.length) {
        clearSwipeFeedCache();
        setJobs([]);
        jobsRef.current = [];
      }

      loadFeed(true, mergedFilters, "initial_navigation");
    };
    bootstrap();
  }, [authLoading, loadProfile, loadFeed, applyFinanceDemoTarget, syncSwipedJobsFromServer, user?.user_id, user?.email, isDemoAccount, isFinanceDemo]);

  useEffect(() => {
    const onBillingUpdated = (event) => {
      if (event?.detail) setBilling(event.detail);
    };
    window.addEventListener(BILLING_UPDATED, onBillingUpdated);
    return () => window.removeEventListener(BILLING_UPDATED, onBillingUpdated);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("friendReferral") !== "unlocked") return;
    const token = params.get("token");
    let cancelled = false;
    (async () => {
      try {
        const data = await claimFriendReferralReward(token);
        if (cancelled) return;
        if (data?.billing) {
          setBilling(data.billing);
          notifyBillingPatch(data.billing);
        }
        toast.success(
          lang === "fr"
            ? "Votre mois gratuit est actif — 40 candidatures disponibles."
            : "Your free month is active — 40 applications available.",
        );
      } catch (err) {
        if (!cancelled) {
          toast.error(err?.response?.data?.detail || (lang === "fr" ? "Lien de récompense invalide" : "Invalid reward link"));
        }
      } finally {
        if (!cancelled) {
          params.delete("friendReferral");
          params.delete("token");
          const nextSearch = params.toString();
          navigate({ pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : "" }, { replace: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.search, location.pathname, navigate, lang]);

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
    nextCursorRef.current = null;
    setNextCursor(null);
    setFeedError("");
    loadFeed(true, f, "filters_apply");
  };

  const resetFilters = () => {
    clearPersistedFilters();
    const defaults = clearMenuFilters(filtersRef.current);
    filtersRef.current = defaults;
    setFilters(defaults);
    setFiltersOpen(false);
    setJobs([]);
    setLoading(true);
    setTotalCount(null);
    setFeedMeta(null);
    nextCursorRef.current = null;
    setNextCursor(null);
    setFeedError("");
    loadFeed(true, defaults, "filters_reset");
  };

  const handleRadiusChange = (searchRadius) => {
    const next = { ...(filtersRef.current || {}), searchRadius };
    applyFilters(next);
  };

  const topJob = jobs[0];
  const creditsRemaining = Number(billing?.credits_remaining ?? 0);
  const isDemoUser = isDemoAccount;
  const shouldGateApply = billing !== null && (!billing.is_premium || creditsRemaining <= 0) && !isDemoUser;
  const requiresProfileForApply = !isDemoUser && !isFinanceDemo;

  const resolveApplyGate = useCallback(() => {
    if (shouldGateApply) {
      return { blocked: true, action: () => openUpgrade() };
    }
    if (!requiresProfileForApply) {
      return { blocked: false };
    }
    const currentProfile = profileRef.current;
    if (!profileHasResume(currentProfile)) {
      return { blocked: true, action: () => setResumeSheetOpen(true) };
    }
    if (!profileHasPhone(currentProfile)) {
      return { blocked: true, action: () => setPhoneSheetOpen(true) };
    }
    return { blocked: false };
  }, [openUpgrade, requiresProfileForApply, shouldGateApply]);

  const shouldBlockApply = useCallback(() => resolveApplyGate().blocked, [resolveApplyGate]);

  const handleApplyBlocked = useCallback(() => {
    resolveApplyGate().action?.();
  }, [resolveApplyGate]);

  const handleProfileReadinessUpdated = useCallback(async (nextProfile) => {
    profileRef.current = nextProfile;
    setProfile(nextProfile);
    setFeedError("");
    await loadFeed(true, filtersRef.current, "profile_readiness_updated");
  }, [loadFeed]);

  const feedSetupGate = useMemo(() => {
    if (isMissingResumeFeedError(feedError)) {
      return {
        body: t("swipe.missingResumeBody"),
        label: t("swipe.uploadResumeToSwipe"),
        action: () => setResumeSheetOpen(true),
      };
    }
    if (isMissingPhoneFeedError(feedError)) {
      return {
        body: t("swipe.missingPhoneBody"),
        label: t("swipe.addPhoneToApply"),
        action: () => setPhoneSheetOpen(true),
      };
    }
    return null;
  }, [feedError, t]);
  const feedView = resolveSwipeFeedViewState({
    loadingInitial: loading,
    loadingNextPage: nextPageLoading,
    jobCount: jobs.length,
    nextCursor,
    feedMeta,
    feedError,
  });
  const projectionLagCopy = lang === "fr"
    ? {
        title: "Mise à jour de votre feed",
        body: "Vos offres sont en cours de projection. Elles apparaîtront automatiquement, sans actualisation.",
      }
    : {
        title: "Updating your feed",
        body: "Your jobs are being projected and will appear automatically without a manual refresh.",
      };

  useEffect(() => {
    if (!feedError || loading) return;
    if (isMissingResumeFeedError(feedError)) setResumeSheetOpen(true);
    else if (isMissingPhoneFeedError(feedError)) setPhoneSheetOpen(true);
  }, [feedError, loading]);

  useEffect(() => {
    trackEvent("swipe_page_view");
  }, []);

  useEffect(() => {
    if (!["exhausted", "policy_hidden", "blocked", "no_inventory", "profile_not_ready", "legacy_empty"].includes(feedView.kind)) return;
    // Cache keys encode candidate search criteria and are never analytics data.
    const impressionKey = feedView.kind;
    if (terminalImpressionsRef.current.has(impressionKey)) return;
    terminalImpressionsRef.current.add(impressionKey);
    trackEvent("swipe_feed_terminal_state_viewed", {
      presentation_state: feedView.kind,
      empty_reason: feedView.emptyReason,
      surface: typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches ? "desktop" : "mobile",
    });
  }, [feedView, user?.user_id]);

  useEffect(() => {
    if (!topJob?.job_id) return;
    if (viewedJobIdsRef.current.has(topJob.job_id)) return;
    viewedJobIdsRef.current.add(topJob.job_id);
    preloadCompanyLogos(jobs.slice(0, 4));
    trackEvent("job_card_viewed", {
      job_id: topJob.job_id,
      company: topJob.company,
      ats_provider: topJob.ats_provider,
      location: topJob.location,
    });
  }, [topJob?.job_id, topJob?.company, topJob?.ats_provider, topJob?.location]);

  // intent: "apply" | "skip"
  const handleSwipe = async (intent) => {
    if (intent === "apply") {
      const gate = resolveApplyGate();
      if (gate.blocked) {
        gate.action?.();
        return;
      }
    }
    if (!topJob) return;
    const job = topJob;
    cacheJobForDemo(job);
    recordSwipedJobId(job.job_id, user?.user_id);
    const remainingAfterSwipe = jobs.length - 1;
    jobsRef.current = jobs.slice(1);
    setJobs((prev) => prev.slice(1));
    if (remainingAfterSwipe <= FEED_PREFETCH_THRESHOLD && !fetchingRef.current) {
      loadFeed(false, filtersRef.current, "after_swipe_low_stack");
    }
    const direction = intent === "apply" ? "right" : "left";   // backend semantic
    if (intent === "apply") {
      trackEvent("application_generation_started", {
        job_id: job.job_id,
        company: job.company,
        ats_provider: job.ats_provider,
        demo: isDemoUser,
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
          intent === "apply" ? { timeout: isDemoUser ? 15000 : 180000 } : undefined,
        ));
      }
      if (intent === "apply") {
        const isDemoOutcome = isDemoUser || Boolean(data?.demo_local || data?.demo_account);
        const applied = Boolean(data?.applied);
        if (applied && !isDemoOutcome) {
          if (data?.billing) {
            setBilling((prev) => notifyBillingPatch(prev, data.billing));
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
        if (nextBilling) setBilling((prev) => notifyBillingPatch(prev, nextBilling));
        openUpgrade();
      }
      if (!isDemoUser && intent === "apply") {
        const detail = e?.response?.data?.detail;
        const message = typeof detail === "string" ? detail : detail?.message;
        if (isMissingPhoneFeedError(message)) {
          setPhoneSheetOpen(true);
        } else if (isMissingResumeFeedError(message)) {
          setResumeSheetOpen(true);
        }
        toast.error(getSwipeErrorMessage(t, e));
      }
    }
  };

  const requestSwipe = useCallback((intent) => {
    if (intent === "apply") {
      const gate = resolveApplyGate();
      if (gate.blocked) {
        gate.action?.();
        return;
      }
    }
    if (!canStartSwipe({ hasJob: topJob, appLoading, pendingCardSwipe })) return;
    suppressCardTap(400);
    setPendingCardSwipe(intent);
  }, [topJob, appLoading, pendingCardSwipe, resolveApplyGate]);

  const handleUndo = async () => {
    try {
      const data = isFinanceDemoEnabled()
        ? performFinanceDemoUndo()
        : (await api.post("/swipe/undo")).data;
      if (data.ok) {
        if (data.job_id) unrecordSwipedJobId(data.job_id);
        toast(t("toasts.undone"));
        loadFeed(true, filtersRef.current, "undo_refresh");
      }
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
    recordSwipedJobId(jobId, user?.user_id);
    const remainingAfterDismiss = jobs.length - 1;
    jobsRef.current = jobs.filter((job) => job.job_id !== jobId);
    setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    if (isFinanceDemoEnabled()) {
      performFinanceDemoSwipe({ job_id: jobId, direction: "left" });
    } else {
      api.post("/swipe", { job_id: jobId, direction: "left" }).catch(() => {});
    }
    if (remainingAfterDismiss <= FEED_PREFETCH_THRESHOLD && !fetchingRef.current) {
      loadFeed(false, filtersRef.current, "after_dismiss_low_stack");
    }
  }, [jobs.length, loadFeed, user?.user_id]);

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
  requestSwipeRef.current = requestSwipe;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (window.matchMedia("(min-width: 768px)").matches) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      const target = event.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (target?.isContentEditable) return;
      if (targetSheetOpen || filtersOpen || desktopFiltersOpen || reportJob || upgradeOpen) return;
      if (!canStartSwipe({ hasJob: topJob, appLoading, pendingCardSwipe })) return;
      if (event.key === "ArrowRight" && shouldBlockApply()) {
        event.preventDefault();
        handleApplyBlocked();
        return;
      }
      event.preventDefault();
      requestSwipeRef.current?.(event.key === "ArrowRight" ? "apply" : "skip");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    appLoading,
    filtersOpen,
    desktopFiltersOpen,
    pendingCardSwipe,
    reportJob,
    targetSheetOpen,
    topJob,
    shouldBlockApply,
    handleApplyBlocked,
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
      <div
        className="hidden md:block"
        data-feed-v2-rollout={feedV2RolloutObserved ? "on" : "off"}
      >
        <DesktopSwipeFeed
          job={topJob}
          loading={loading}
          nextPageLoading={nextPageLoading}
          feedError={feedError}
          feedMeta={feedMeta}
          target={target}
          filters={filters}
          appliedToday={appliedToday}
          appLoading={appLoading}
          onFiltersChange={applyFilters}
          onFiltersOpenChange={setDesktopFiltersOpen}
          onTargetSave={saveTargetSearch}
          onTargetPreferencesOpen={() => setTargetSheetOpen(true)}
          onTargetLocationOpen={() => setTargetSheetOpen(true)}
          onTerminalSuggestionClick={(actionId, presentationState) => trackEvent("swipe_feed_suggestion_clicked", { action_id: actionId, presentation_state: presentationState })}
          targetLocationData={targetLocationData}
          targetSaving={targetSaving}
          onPass={() => handleSwipe("skip")}
          onApply={() => handleSwipe("apply")}
          onReport={setReportJob}
          onShare={handleShareJob}
          onRadiusChange={handleRadiusChange}
          shouldGateApply={shouldBlockApply()}
          onApplyBlocked={handleApplyBlocked}
          interactionBlocked={targetSheetOpen || filtersOpen || desktopFiltersOpen || Boolean(reportJob) || upgradeOpen || resumeSheetOpen || phoneSheetOpen}
          showAdminAtsBadge={showAdminAtsBadge}
        />
      </div>

      <div
        className="sprout flex h-dvh max-h-dvh flex-col overflow-hidden bg-sprout-bg pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] text-sprout-text md:hidden"
        data-feed-v2-rollout={feedV2RolloutObserved ? "on" : "off"}
      >
        <header
          className="mx-auto flex w-full max-w-md shrink-0 items-center gap-1 px-safe pb-2 pt-safe sm:gap-2 sm:px-4"
          data-testid="swipe-header"
        >
        <div className="flex shrink-0 items-center">
          <DesktopCreditsPill compact forceOpenUpgrade />
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
          className="min-w-0 flex-1 rounded-full border border-sprout-border bg-sprout-surface px-3 py-1.5 text-center shadow-sm transition-colors hover:border-violet-400/40 hover:bg-sprout-surface-2 sm:px-4 sm:py-2"
          data-testid="target-pill"
          aria-label={t("swipe.editTarget")}
        >
          <p className="truncate text-xs font-semibold leading-tight text-sprout-text sm:text-sm">
            {translateRoleLabel(target.role, lang) || t("swipe.setTargetRole")}
          </p>
          <p className="truncate text-[9px] leading-tight text-sprout-muted sm:text-[11px]">
            <span className="sm:hidden">{translateLocationLabel(target.location, lang) || t("swipe.anywhere")}</span>
            <span className="hidden sm:inline">
              {translateLocationLabel(target.location, lang) || t("swipe.anywhere")} · {t("swipe.tapToEdit")}
            </span>
          </p>
        </button>

        <div className="flex shrink-0 items-center">
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
          <button
            onClick={() => setNotificationsOpen(true)}
            className="relative grid h-8 w-8 place-items-center rounded-full hover:bg-sprout-surface sm:h-9 sm:w-9"
            data-testid="mobile-notifications-bell"
            aria-label={t("swipe.notifications")}
          >
            <Bell className="h-4 w-4 text-sprout-mint sm:h-5 sm:w-5" />
            {unreadNotifications > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </button>
        </div>
        </header>

      <NotificationsPanel
        variant="sheet"
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        onUnreadCountChange={setUnreadNotifications}
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 pt-1">
        <div className="relative mx-auto min-h-0 w-full max-w-md flex-1 overflow-hidden">
          {["loading_initial", "loading_next_page"].includes(feedView.kind) && jobs.length === 0 && <SkeletonCard />}

          {feedView.kind === "projection_lag" && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
              data-testid="feed-empty"
            >
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-sprout-mint-soft">
                <Zap className="h-7 w-7 text-sprout-mint" />
              </div>
              <h3 className="font-display text-2xl font-bold text-white">
                {feedView.kind === "projection_lag"
                  ? projectionLagCopy.title
                  : t("swipe.couldNotLoad")}
              </h3>
              <p className="mt-2 max-w-xs text-sm text-sprout-muted">
                {feedSetupGate?.body
                  || (feedView.kind === "projection_lag"
                    ? projectionLagCopy.body
                    : feedFallbackMessage(t, feedMeta))}
              </p>
              {feedSetupGate?.action && (
                <button
                  onClick={feedSetupGate.action}
                  className="mt-6 h-11 rounded-full bg-sprout-mint px-6 font-semibold text-white transition-opacity hover:opacity-90"
                >
                  {feedSetupGate.label}
                </button>
              )}
            </motion.div>
          )}

          {["exhausted", "policy_hidden", "blocked", "no_inventory", "profile_not_ready", "legacy_empty"].includes(feedView.kind) && (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <SwipeFeedTerminalState
                state={feedView.kind}
                targetLocationData={targetLocationData}
                targetLocation={target.location}
                filters={filters}
                t={t}
                onPreferences={() => setTargetSheetOpen(true)}
                onLocation={() => setTargetSheetOpen(true)}
                onRadius={() => setFiltersOpen(true)}
                onFilters={() => setFiltersOpen(true)}
                onSuggestionClick={(actionId) => trackEvent("swipe_feed_suggestion_clicked", { action_id: actionId, presentation_state: feedView.kind })}
              />
            </div>
          )}

          {feedView.kind === "error" && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center" role="status">
              <h2 className="font-display text-2xl font-bold text-white">{t("swipe.couldNotLoad")}</h2>
              <p className="mt-2 max-w-xs text-sm text-sprout-muted">{feedError || feedFallbackMessage(t, feedMeta)}</p>
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
                  showAdminAtsBadge={showAdminAtsBadge}
                  pendingSwipe={idx === 0 ? pendingCardSwipe : null}
                  onSwipeRequestComplete={() => setPendingCardSwipe(null)}
                />
              );
            })}
          </AnimatePresence>
        </div>

        {topJob ? (
          <div className="mx-auto flex w-full max-w-md shrink-0 items-center justify-center gap-10 py-3 sm:gap-14 sm:py-4">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onPointerDown={() => suppressCardTap()}
              onClick={() => requestSwipe("skip")}
              disabled={!topJob || appLoading || Boolean(pendingCardSwipe)}
              className="grid h-14 w-14 place-items-center rounded-full border-2 border-rose-500/70 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-colors hover:border-rose-500"
              aria-label={t("swipe.pass")}
              data-testid="skip-btn"
            >
              <X className="h-6 w-6 text-rose-500" strokeWidth={2.5} />
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              onPointerDown={() => suppressCardTap()}
              onClick={() => requestSwipe("apply")}
              disabled={!topJob || appLoading || Boolean(pendingCardSwipe)}
              className="grid h-16 w-16 place-items-center rounded-full gradient-linkedin shadow-[0_8px_28px_rgba(124,58,237,0.45)] transition-opacity hover:opacity-90"
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

      <TargetSearchSheet
        open={targetSheetOpen}
        initialRole={target.role}
        initialRoles={profile?.target_roles || [target.role]}
        initialSectorIds={profile?.sector_ids || []}
        initialIndustryIds={profile?.industry_ids || []}
        initialLocation={target.location}
        initialLocationData={targetLocationData}
        onClose={() => setTargetSheetOpen(false)}
        onSave={async (payload) => {
          const ok = await saveTargetSearch(payload);
          if (ok) setTargetSheetOpen(false);
          return ok;
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

      <ResumeSheet
        open={resumeSheetOpen}
        profile={profile}
        onClose={() => setResumeSheetOpen(false)}
        onUploaded={async () => {
          const data = await loadProfile();
          if (data) await handleProfileReadinessUpdated(data);
        }}
      />

      <PhoneSheet
        open={phoneSheetOpen}
        profile={profile}
        onClose={() => setPhoneSheetOpen(false)}
        onSaved={handleProfileReadinessUpdated}
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
