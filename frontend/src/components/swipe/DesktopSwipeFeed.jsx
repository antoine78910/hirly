import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Briefcase,
  ExternalLink,
  FileText,
  Flag,
  Headphones,
  Layers,
  Mail,
  Share2,
  Sparkles,
  Sun,
  User,
  Loader2,
  MapPin,
} from "lucide-react";
import DesktopCreditsPill from "../desktop/DesktopCreditsPill";
import DesktopAccountMenu from "../desktop/DesktopAccountMenu";
import DesktopFiltersMenu from "../desktop/DesktopFiltersMenu";
import DesktopJobCard from "./DesktopJobCard";
import PlacesAutocomplete from "../PlacesAutocomplete";
import RoleAutocomplete from "../RoleAutocomplete";
import { SUGGESTED_ONBOARDING_LOCATIONS } from "../onboarding/onboardingData";
import { rankLocationSuggestions } from "../../lib/locationSearch";
import { jobExternalUrl } from "../../lib/jobDisplayUtils";
import { useAppLocale } from "../../context/AppLocaleContext";
import { getDesktopNavItems } from "../desktop/desktopNav";
import {
  DESKTOP_THEMES,
  readDesktopTheme,
  saveDesktopTheme,
} from "./desktopFeedTheme";

const RADIUS_OPTIONS = ["25km", "50km", "100km", "200km"];

const SWIPE_EXIT = {
  skip: { x: -720, rotate: -10, opacity: 0, scale: 0.92 },
  apply: { x: 720, rotate: 10, opacity: 0, scale: 0.92 },
};

export default function DesktopSwipeFeed({
  job,
  loading,
  feedError,
  feedMeta,
  target,
  filters,
  appliedToday,
  appLoading,
  onFiltersChange,
  onFiltersOpenChange,
  onTargetSave,
  targetLocationData = null,
  targetSaving = false,
  onPass,
  onApply,
  onReport,
  onShare,
  onRefresh,
  onRadiusChange,
  shouldGateApply = false,
  onApplyBlocked,
  interactionBlocked = false,
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useAppLocale();
  const navItems = getDesktopNavItems(t);
  const [themeMode, setThemeMode] = useState(readDesktopTheme);
  const [exitIntent, setExitIntent] = useState(null);
  const [swipeAnimating, setSwipeAnimating] = useState(false);
  const [renderJob, setRenderJob] = useState(job);
  const exitHandledRef = useRef(false);
  const swipedJobIdRef = useRef(null);
  const radius = filters?.searchRadius || "50km";
  const isDark = themeMode === "dark";
  const theme = DESKTOP_THEMES[themeMode];

  const displayLocation = target.location === "Anywhere" ? "" : (target.location || "");
  const [roleDraft, setRoleDraft] = useState(target.role || "");
  const [locationDraft, setLocationDraft] = useState(displayLocation);
  const [locationDataDraft, setLocationDataDraft] = useState(targetLocationData);
  const roleFocusedRef = useRef(false);
  const locationFocusedRef = useRef(false);

  useEffect(() => {
    if (!roleFocusedRef.current) {
      setRoleDraft(target.role || "");
    }
  }, [target.role]);

  useEffect(() => {
    if (!locationFocusedRef.current) {
      setLocationDraft(displayLocation);
      setLocationDataDraft(targetLocationData);
    }
  }, [displayLocation, targetLocationData]);

  const commitRole = useCallback(async () => {
    const trimmed = roleDraft.trim();
    if (!trimmed || trimmed === (target.role || "")) return;
    const ok = await onTargetSave?.({
      role: trimmed,
      location: displayLocation,
      locationData: targetLocationData,
    });
    if (!ok) setRoleDraft(target.role || "");
  }, [displayLocation, onTargetSave, roleDraft, target.role, targetLocationData]);

  const commitLocation = useCallback(async () => {
    const trimmed = locationDraft.trim();
    const hasSameLabel = trimmed === displayLocation;
    const hasValidSelection = !trimmed || locationDataDraft?.location_label === trimmed;
    if (hasSameLabel && hasValidSelection) return;
    const ok = await onTargetSave?.({
      role: target.role || roleDraft.trim(),
      location: trimmed,
      locationData: locationDataDraft,
    });
    if (!ok) {
      setLocationDraft(displayLocation);
      setLocationDataDraft(targetLocationData);
    }
  }, [displayLocation, locationDataDraft, locationDraft, onTargetSave, roleDraft, target.role, targetLocationData]);

  const pickLocation = useCallback(async (loc) => {
    setLocationDataDraft(loc);
    if (!loc?.location_label) return;
    setLocationDraft(loc.location_label);
    locationFocusedRef.current = false;
    const ok = await onTargetSave?.({
      role: target.role || roleDraft.trim(),
      location: loc.location_label,
      locationData: loc,
    });
    if (!ok) {
      setLocationDraft(displayLocation);
      setLocationDataDraft(targetLocationData);
    }
  }, [displayLocation, onTargetSave, roleDraft, target.role, targetLocationData]);

  const locationSuggestions = useMemo(
    () => rankLocationSuggestions(SUGGESTED_ONBOARDING_LOCATIONS, displayLocation || target.location, 12),
    [displayLocation, target.location],
  );

  const pickRole = useCallback(async (role) => {
    setRoleDraft(role);
    roleFocusedRef.current = false;
    if (role === (target.role || "")) return;
    const ok = await onTargetSave?.({
      role,
      location: displayLocation,
      locationData: targetLocationData,
    });
    if (!ok) setRoleDraft(target.role || "");
  }, [displayLocation, onTargetSave, target.role, targetLocationData]);

  useEffect(() => {
    if (!job?.job_id) {
      setRenderJob(null);
      return;
    }

    if (swipedJobIdRef.current) {
      if (job.job_id === swipedJobIdRef.current) return;
      swipedJobIdRef.current = null;
      setRenderJob(job);
      return;
    }

    if (!swipeAnimating && !exitIntent && job.job_id !== renderJob?.job_id) {
      setRenderJob(job);
    }
  }, [job, swipeAnimating, exitIntent, renderJob?.job_id]);

  const toggleTheme = () => {
    setThemeMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      saveDesktopTheme(next);
      return next;
    });
  };

  const displayJob = renderJob;
  const swipeDisabled = !job || appLoading || swipeAnimating || interactionBlocked;

  const runSwipe = useCallback((intent) => {
    if (!renderJob || appLoading || swipeAnimating || interactionBlocked) return;
    if (intent === "apply" && shouldGateApply) {
      onApplyBlocked?.();
      return;
    }
    exitHandledRef.current = false;
    setSwipeAnimating(true);
    setExitIntent(intent);
  }, [appLoading, interactionBlocked, onApplyBlocked, renderJob, shouldGateApply, swipeAnimating]);

  const finishSwipe = useCallback(() => {
    if (!exitIntent || exitHandledRef.current) return;
    exitHandledRef.current = true;

    const intent = exitIntent;
    swipedJobIdRef.current = renderJob?.job_id ?? null;
    setRenderJob(null);
    setExitIntent(null);
    setSwipeAnimating(false);

    if (intent === "apply") onApply?.();
    else if (intent === "skip") onPass?.();
  }, [exitIntent, onApply, onPass]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.target?.isContentEditable) return;
      if (interactionBlocked || swipeAnimating || !job || appLoading) return;
      event.preventDefault();
      runSwipe(event.key === "ArrowRight" ? "apply" : "skip");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appLoading, interactionBlocked, job, runSwipe, swipeAnimating]);

  return (
    <div className={`flex h-dvh ${theme.root}`} data-testid="desktop-swipe-feed" data-theme={themeMode}>
      <aside className={`flex w-56 shrink-0 flex-col border-r px-3 py-4 lg:w-60 ${theme.sidebar}`}>
        <DesktopAccountMenu
          triggerClassName={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${theme.accountBtn}`}
        />

        <p className={`mt-6 px-2 text-[11px] font-semibold uppercase tracking-wider ${theme.sectionLabel}`}>{t("common.platform")}</p>
        <nav className="mt-2 flex flex-col gap-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => {
                const active = isActive || (to === "/swipe" && pathname === "/app");
                return `flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  active ? theme.navActive : theme.navIdle
                }`;
              }}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0 truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3 px-1 pt-6">
          <button
            type="button"
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm ${theme.supportBtn}`}
          >
            <Headphones className="h-4 w-4" />
            {t("common.support")}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex items-center justify-end gap-4 border-b px-6 py-3 ${theme.header}`}>
          <DesktopCreditsPill isDark={isDark} />
          <button
            type="button"
            onClick={toggleTheme}
            className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
              isDark ? theme.iconBtn : `${theme.iconBtn} text-amber-500`
            }`}
            aria-label={isDark ? t("swipe.switchLight") : t("swipe.switchDark")}
            title={isDark ? t("swipe.switchLight") : t("swipe.switchDark")}
            data-testid="desktop-theme-toggle"
          >
            <Sun className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate("/profile")}
            className={`relative grid h-9 w-9 place-items-center rounded-lg ${theme.iconBtn}`}
            aria-label={t("swipe.notifications")}
          >
            <Bell className="h-4 w-4" />
            {appliedToday > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {appliedToday > 99 ? "99+" : appliedToday}
              </span>
            ) : null}
          </button>
        </header>

        <div className={`border-b px-6 py-4 ${theme.searchBar}`}>
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`flex min-w-[200px] flex-1 items-center rounded-xl border px-3 py-2.5 ${theme.field}`}
            >
              <Briefcase className="mr-2 h-4 w-4 shrink-0 text-zinc-400" />
              <RoleAutocomplete
                value={roleDraft}
                onInputChange={setRoleDraft}
                onPick={pickRole}
                relatedRole={target.role || ""}
                variant={isDark ? "dark" : "light"}
                onFieldFocus={() => { roleFocusedRef.current = true; }}
                onFieldBlur={() => {
                  roleFocusedRef.current = false;
                  commitRole();
                }}
                placeholder={t("swipe.jobTitle")}
                disabled={targetSaving}
                testId="desktop-target-role"
              />
            </div>
            <div
              className={`flex min-w-[180px] flex-1 items-center rounded-xl border px-3 py-2.5 ${theme.field}`}
            >
              <MapPin className="mr-2 h-4 w-4 shrink-0 text-zinc-400" />
              <PlacesAutocomplete
                inline
                hideLabel
                variant={isDark ? "dark" : "light"}
                value={locationDraft}
                selectedLocation={locationDataDraft}
                suggestions={locationSuggestions}
                maxSuggestions={12}
                onInputChange={(next) => {
                  setLocationDraft(next);
                  if (next.trim() !== (locationDataDraft?.location_label || "")) {
                    setLocationDataDraft(null);
                  }
                }}
                onSelect={(loc) => {
                  if (loc) pickLocation(loc);
                  else setLocationDataDraft(null);
                }}
                onFieldFocus={() => { locationFocusedRef.current = true; }}
                onFieldBlur={() => {
                  locationFocusedRef.current = false;
                  commitLocation();
                }}
                placeholder={t("swipe.location")}
                testId="desktop-target-location"
              />
            </div>
            <select
              value={radius}
              onChange={(e) => onRadiusChange?.(e.target.value)}
              className={`rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 ${theme.select}`}
            >
              {RADIUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt.replace("km", " km")}
                </option>
              ))}
            </select>
            <DesktopFiltersMenu
              filters={filters}
              onFiltersChange={onFiltersChange}
              themeMode={themeMode}
              onOpenChange={onFiltersOpenChange}
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 px-6 py-4">
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => runSwipe("skip")}
            disabled={swipeDisabled}
            className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-6 text-sm font-medium shadow-sm transition-all disabled:pointer-events-none disabled:opacity-50 ${theme.actionBtn}`}
            aria-label={t("swipe.pass")}
            data-testid="desktop-pass-btn"
          >
            {t("swipe.pass")}
            <kbd className={`pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 font-sans text-xs font-medium ${theme.actionKbd}`}>
              ←
            </kbd>
          </motion.button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => runSwipe("apply")}
            disabled={swipeDisabled}
            className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-6 text-sm font-medium shadow-sm transition-all disabled:pointer-events-none disabled:opacity-50 ${theme.actionBtn}`}
            aria-label={t("swipe.apply")}
            data-testid="desktop-apply-btn"
          >
            {appLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("swipe.apply")}
            <kbd className={`pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1 font-sans text-xs font-medium ${theme.applyKbd}`}>
              →
            </kbd>
          </motion.button>
        </div>

        <div className="relative min-h-0 flex-1 px-6 pb-6">
          {loading && !job ? (
            <div className={`mx-auto max-w-3xl animate-pulse rounded-2xl border p-8 ${theme.skeleton}`}>
              <div className={`h-8 w-2/3 rounded ${theme.skeletonBar}`} />
              <div className={`mt-4 h-4 w-1/3 rounded ${theme.skeletonBar}`} />
              <div className={`mt-8 h-32 rounded-xl ${theme.skeletonBar}`} />
            </div>
          ) : !displayJob ? (
            <div className="mx-auto max-w-lg py-20 text-center">
              <p className={`text-lg font-semibold ${theme.emptyTitle}`}>
                {feedError || feedMeta?.fallback_reason || t("swipe.noJobs")}
              </p>
              <button
                type="button"
                onClick={onRefresh}
                className="mt-4 rounded-full gradient-linkedin px-6 py-2.5 text-sm font-semibold text-white"
              >
                {t("common.refresh")}
              </button>
            </div>
          ) : (
            <div className="relative mx-auto flex h-full max-w-3xl flex-col">
              <AnimatePresence mode="wait" initial={false}>
                {displayJob ? (
                <motion.article
                  key={displayJob.job_id}
                  initial={{ opacity: 0, y: 28, scale: 0.96 }}
                  animate={
                    exitIntent
                      ? SWIPE_EXIT[exitIntent]
                      : { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }
                  }
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 260, damping: 28 }}
                  onAnimationComplete={() => {
                    if (!exitIntent) return;
                    finishSwipe();
                  }}
                  className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border ${theme.card}`}
                  data-testid="desktop-job-card"
                >
                  {exitIntent === "apply" ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="pointer-events-none absolute left-8 top-24 z-10 rounded-xl border-[3px] border-violet-500 px-4 py-1.5 font-display text-3xl font-black tracking-wider text-violet-500 backdrop-blur-sm"
                      style={{ rotate: "-14deg" }}
                      data-testid="desktop-apply-stamp"
                    >
                      {t("swipe.applyStamp")}
                    </motion.div>
                  ) : null}
                  {exitIntent === "skip" ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="pointer-events-none absolute right-8 top-24 z-10 rounded-xl border-[3px] border-rose-500 px-4 py-1.5 font-display text-3xl font-black tracking-wider text-rose-500 backdrop-blur-sm"
                      style={{ rotate: "14deg" }}
                      data-testid="desktop-pass-stamp"
                    >
                      {t("swipe.passStamp")}
                    </motion.div>
                  ) : null}

                  <div className="absolute right-5 top-5 z-20 flex items-center gap-1">
                    <button type="button" onClick={() => onReport?.(displayJob)} className={`grid h-9 w-9 place-items-center rounded-lg ${theme.actionIcon}`} aria-label={t("swipe.reportJob")}>
                      <Flag className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => onShare?.(displayJob)} className={`grid h-9 w-9 place-items-center rounded-lg ${theme.actionIcon}`} aria-label={t("swipe.shareJob")}>
                      <Share2 className="h-4 w-4" />
                    </button>
                    {jobExternalUrl(displayJob) ? (
                      <a href={jobExternalUrl(displayJob)} target="_blank" rel="noopener noreferrer" className={`grid h-9 w-9 place-items-center rounded-lg ${theme.actionIcon}`} aria-label="Open posting">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>

                  <DesktopJobCard job={displayJob} theme={theme} t={t} />
                </motion.article>
                ) : null}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
