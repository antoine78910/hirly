import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Calendar,
  Check,
  DollarSign,
  Heart,
  Info,
  Loader2,
  MapPin,
  X,
} from "lucide-react";
import CompanyLogo from "../CompanyLogo";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { getLandingHeroApplySteps, getLandingHeroDemoJobs } from "../../lib/landingHeroDemoJobs";
import LandingHeroApplyFlow from "./LandingHeroApplyFlow";
import LandingMobileApplyStepToasts from "./LandingMobileApplyStepToasts";
import JobCardHighlights, { JobCardMatchBadge } from "../swipe/JobCardHighlights";
import {
  formatJobSalaryLabel,
  getJobBadgeItems,
  getJobDisplayContent,
  getJobDisplayTitle,
} from "../../lib/jobDisplayUtils";
import { formatPostedDate } from "../../lib/appUi";
import { useAppLocale } from "../../context/AppLocaleContext";

const LP_CARD_THEME = {
  cardMeta: "text-zinc-500",
  cardAboutBody: "text-zinc-800",
  surfaceClass: "rounded-xl border border-zinc-200 bg-zinc-100 px-3 py-2.5",
};

const STACK_MAX_CARDS = 3;
/** Extra space so stacked cards, shadows, and rounded corners are not clipped. */
const STACK_DEPTH_PADDING = (STACK_MAX_CARDS - 1) * 10 + 24;

const HOLD_MS = 1600;
const STAMP_MS = 380;
const EXIT_MS = 520;
const STEP_MS = 1800;
const APPLY_FINISH_MS = 1400;

const EXIT_VARIANTS = {
  skip: { x: -340, rotate: -10, opacity: 0, scale: 0.94 },
  apply: { x: 340, rotate: 10, opacity: 0, scale: 0.94 },
};

const EXIT_VARIANTS_COMPACT = {
  skip: { x: -200, rotate: -12, opacity: 0, scale: 0.95 },
  apply: { x: 200, rotate: 12, opacity: 0, scale: 0.95 },
};

function SwipeActionStamp({ kind, label, variant = "desktop" }) {
  const isMobile = variant === "mobile";
  const isApply = kind === "apply";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.75 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      className={`pointer-events-none absolute z-30 rounded-xl border-[3px] px-4 py-1.5 font-display font-black tracking-wider ${
        isApply
          ? "left-5 border-violet-500 text-violet-500 sm:left-6"
          : "right-5 border-rose-500 text-rose-500 sm:right-6"
      } ${isMobile ? "top-[4.5rem] text-2xl" : "top-20 text-3xl"}`}
      style={{ rotate: isApply ? "-14deg" : "14deg" }}
    >
      {label}
    </motion.div>
  );
}

function LandingJobCardMeta({ location, salaryLabel, postedLabel, compact = false }) {
  const iconClass = "h-3.5 w-3.5 shrink-0 text-violet-600 sm:h-4 sm:w-4";
  const textClass = compact
    ? "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-zinc-500 sm:gap-x-4 sm:text-sm"
    : "flex flex-col items-center gap-1.5 text-sm text-zinc-500";

  return (
    <div className={textClass}>
      <span className="inline-flex min-w-0 max-w-full items-center gap-1">
        <MapPin className={iconClass} strokeWidth={1.9} aria-hidden="true" />
        <span className="truncate">{location}</span>
      </span>
      {salaryLabel ? (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <DollarSign className={iconClass} strokeWidth={1.9} aria-hidden="true" />
          <span className="truncate">{salaryLabel}</span>
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        <Calendar className={iconClass} strokeWidth={1.9} aria-hidden="true" />
        <span className="whitespace-nowrap">{postedLabel}</span>
      </span>
    </div>
  );
}

function LandingJobCardBadges({ badges }) {
  if (!badges.length) return null;

  return (
    <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className="inline-flex shrink-0 items-center rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700 sm:px-3 sm:py-1.5 sm:text-[13px]"
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function DemoJobCard({ job, variant = "desktop" }) {
  const { t, lang } = useAppLocale();
  const isMobile = variant === "mobile";
  const { snippet } = getJobDisplayContent(job);
  const badges = getJobBadgeItems(job, { lang });
  const title = getJobDisplayTitle(job, { lang });
  const location = job.location || t("swipe.locationNotSpecified");
  const salaryLabel = formatJobSalaryLabel(job, { lang });
  const postedLabel = formatPostedDate(t, job.posted_at || job.postedAt) || t("swipe.postedRecently");
  const previewText = snippet || job.summary || "";

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-[28px] border border-zinc-200 bg-white text-left shadow-[0_8px_32px_rgba(0,0,0,0.08)] ${
        isMobile ? "min-h-[500px]" : "min-h-[520px]"
      }`}
    >
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-2 pt-3 sm:px-5 sm:pb-3 sm:pt-4">
        <div className="flex shrink-0 items-start justify-end gap-2">
          <JobCardMatchBadge
            job={job}
            t={t}
            className="!bg-violet-100 !text-violet-700"
          />
        </div>

        <div className="mt-0.5 flex justify-center sm:mt-1">
          <CompanyLogo job={job} size={isMobile ? "md" : "lg"} rounded="2xl" />
        </div>

        <div className="mt-2 text-center sm:mt-3">
          <p className="font-display text-base font-semibold text-zinc-900 sm:text-xl">{job.company}</p>
        </div>

        <div className="mt-2 px-1 sm:mt-3 sm:px-2">
          <h3
            className="text-center font-display text-[clamp(1.15rem,4.8vw,1.75rem)] font-black leading-[1.08] tracking-tight text-zinc-900 sm:text-[1.65rem]"
          >
            {title}
          </h3>
        </div>

        <div className="mt-2 sm:mt-3">
          <LandingJobCardMeta
            location={location}
            salaryLabel={salaryLabel}
            postedLabel={postedLabel}
            compact
          />
        </div>

        {previewText ? (
          <p className="mt-2 line-clamp-2 px-1 text-center text-xs leading-relaxed text-zinc-500 sm:mt-2.5 sm:line-clamp-3 sm:text-sm">
            {previewText}
          </p>
        ) : null}

        <div className="mt-2 sm:mt-3">
          <JobCardHighlights
            job={job}
            t={t}
            lang={lang}
            max={3}
            compact
            theme={LP_CARD_THEME}
          />
        </div>

        <div className="mt-auto pt-2 sm:pt-3">
          <LandingJobCardBadges badges={badges} />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-zinc-200 px-4 py-2.5 sm:px-5 sm:py-3">
        <div className="flex items-center gap-2 font-display text-sm font-bold text-zinc-900 sm:text-base">
          <Logo size={18} className="sm:h-5 sm:w-5" />
          {BRAND.NAME}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 sm:text-xs">
          {t("swipe.tapForDetails")}
          <Info className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function ApplyStepsPanel({ steps, activeStep, title, applyingLabel, lang }) {
  const visible = activeStep >= 0;

  return (
    <motion.aside
      initial={false}
      animate={{
        opacity: visible ? 1 : 0.45,
        y: visible ? 0 : 8,
      }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`hidden w-full rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_40px_-18px_rgba(124,58,237,0.35)] sm:p-5 lg:sticky lg:top-24 lg:block ${
        visible ? "" : "opacity-60"
      }`}
      aria-live="polite"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-violet-600">Apply</p>
          <p className="font-display text-sm font-bold text-zinc-900 sm:text-base">{title}</p>
        </div>
        {visible && activeStep >= steps.length ? (
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          </span>
        ) : visible && activeStep < steps.length ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" aria-hidden />
        ) : null}
      </div>

      <LandingHeroApplyFlow steps={steps} activeStep={activeStep} visible={visible} />

      {!visible ? (
        <p className="mt-3 text-xs text-zinc-400">
          {lang === "fr" ? "Swipez à droite pour lancer une candidature." : "Swipe right to start an application."}
        </p>
      ) : activeStep < steps.length ? (
        <p className="mt-3 text-xs text-zinc-500">{applyingLabel}</p>
      ) : (
        <p className="mt-3 text-xs font-medium text-emerald-600">
          {lang === "fr" ? "Candidature envoyée." : "Application sent."}
        </p>
      )}
    </motion.aside>
  );
}

function SwipeCardStack({
  jobs,
  index,
  job,
  showStamp,
  exiting,
  passStampLabel,
  applyStampLabel,
  variant = "desktop",
}) {
  const isMobile = variant === "mobile";
  const cardHeight = isMobile ? 500 : 520;
  const exitVariants = isMobile ? EXIT_VARIANTS_COMPACT : EXIT_VARIANTS;
  const showApplyStamp = showStamp && job.swipe === "apply";
  const showPassStamp = showStamp && job.swipe === "skip";
  const visibleJobs = jobs.slice(0, STACK_MAX_CARDS);

  return (
    <div
      className="relative z-10 overflow-visible bg-transparent"
      style={{ minHeight: cardHeight + STACK_DEPTH_PADDING }}
    >
      {visibleJobs.map((stackJob, stackIndex) => {
        const offset = (stackIndex - index + visibleJobs.length) % visibleJobs.length;

        return (
          <div
            key={`stack-${stackJob.id}-${index}`}
            className="absolute inset-x-0 top-0"
            style={{
              zIndex: 10 - offset,
              transform: `translateY(${offset * 10}px) scale(${1 - offset * 0.03})`,
              transformOrigin: "top center",
              opacity: 1,
              pointerEvents: offset === 0 ? "auto" : "none",
            }}
          >
            {offset === 0 ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${job.id}-${index}`}
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={exiting ? exitVariants[job.swipe] : { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26 }}
                  className="relative"
                >
                  {showApplyStamp ? <SwipeActionStamp kind="apply" label={applyStampLabel} variant={variant} /> : null}
                  {showPassStamp ? <SwipeActionStamp kind="skip" label={passStampLabel} variant={variant} /> : null}

                  <DemoJobCard job={job} variant={variant} />
                </motion.div>
              </AnimatePresence>
            ) : (
              <DemoJobCard job={stackJob} variant={variant} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SwipeActionButtons({ variant = "desktop" }) {
  const isMobile = variant === "mobile";
  return (
    <div className={`relative z-20 flex items-center justify-center ${isMobile ? "mt-2 gap-4" : "mt-8 gap-4 sm:gap-6"}`}>
      <div
        className={`grid place-items-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm ${
          isMobile ? "h-11 w-11" : "h-12 w-12"
        }`}
      >
        <X className={isMobile ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
      </div>
      <div
        className={`grid place-items-center rounded-full gradient-linkedin text-white shadow-md shadow-violet-500/25 ${
          isMobile ? "h-[3.25rem] w-[3.25rem]" : "h-14 w-14"
        }`}
      >
        <Heart className={isMobile ? "h-5 w-5" : "h-6 w-6"} fill="white" aria-hidden />
      </div>
    </div>
  );
}

export default function LandingHeroSwipeDemo({ lang }) {
  const jobs = useMemo(() => getLandingHeroDemoJobs(lang), [lang]);
  const steps = useMemo(() => getLandingHeroApplySteps(lang), [lang]);
  const rootRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [showStamp, setShowStamp] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [applyStep, setApplyStep] = useState(-1);
  const stepTimersRef = useRef([]);
  const holdTimerRef = useRef(null);
  const flyTimerRef = useRef(null);
  const advanceTimerRef = useRef(null);

  const job = jobs[index];
  const panelTitle = lang === "fr" ? "Candidature en cours" : "Application in progress";
  const applyingLabel = lang === "fr" ? "Hirly prépare votre dossier…" : "Hirly is preparing your application…";
  const passStampLabel = "PASS";
  const applyStampLabel = lang === "fr" ? "POSTULER" : "APPLY";

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.25, rootMargin: "0px 0px -48px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return undefined;

    const clearStepTimers = () => {
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
    };

    const clearCycleTimers = () => {
      clearStepTimers();
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      if (flyTimerRef.current) window.clearTimeout(flyTimerRef.current);
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    };

    const current = jobs[index];
    const applyDuration = steps.length * STEP_MS + APPLY_FINISH_MS;
    const flyDuration = STAMP_MS + EXIT_MS;
    const totalAfterHold =
      current.swipe === "apply"
        ? Math.max(flyDuration, STAMP_MS + applyDuration) + 280
        : flyDuration + 180;

    holdTimerRef.current = window.setTimeout(() => {
      setShowStamp(true);

      if (current.swipe === "apply") {
        setApplyStep(0);
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
          const timer = window.setTimeout(() => {
            setApplyStep(stepIndex + 1);
          }, (stepIndex + 1) * STEP_MS);
          stepTimersRef.current.push(timer);
        }
      }
    }, HOLD_MS);

    flyTimerRef.current = window.setTimeout(() => {
      setExiting(true);
    }, HOLD_MS + STAMP_MS);

    advanceTimerRef.current = window.setTimeout(() => {
      setShowStamp(false);
      setExiting(false);
      setIndex((prev) => (prev + 1) % jobs.length);
      if (current.swipe === "apply") {
        window.setTimeout(() => setApplyStep(-1), 350);
      }
    }, HOLD_MS + totalAfterHold);

    return clearCycleTimers;
  }, [index, isVisible, jobs, steps]);

  const swipeDemoMobile = (
    <div className="relative mx-auto w-full max-w-md overflow-visible bg-transparent pb-2">
      <SwipeCardStack
        jobs={jobs}
        index={index}
        job={job}
        showStamp={showStamp}
        exiting={exiting}
        passStampLabel={passStampLabel}
        applyStampLabel={applyStampLabel}
        variant="mobile"
      />
      <LandingMobileApplyStepToasts steps={steps} activeStep={applyStep} bottomClassName="bottom-[5.75rem]" />
      <div className="relative z-30 -mt-10">
        <SwipeActionButtons variant="mobile" />
      </div>
    </div>
  );

  const swipeDemoDesktop = (
    <div className="relative mx-auto w-full max-w-md overflow-visible bg-transparent pb-2 lg:max-w-none">
      <div className="relative z-10 overflow-visible bg-transparent px-1">
        <SwipeCardStack
          jobs={jobs}
          index={index}
          job={job}
          showStamp={showStamp}
          exiting={exiting}
          passStampLabel={passStampLabel}
          applyStampLabel={applyStampLabel}
          variant="desktop"
        />
      </div>
      <SwipeActionButtons variant="desktop" />
    </div>
  );

  return (
    <div ref={rootRef} className="mt-16 overflow-visible bg-transparent text-left lg:mt-20">
      <div className="grid items-start gap-6 overflow-visible bg-transparent lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-8">
        <div className="w-full overflow-visible bg-transparent lg:hidden">{swipeDemoMobile}</div>
        <div className="hidden w-full overflow-visible bg-transparent lg:block">{swipeDemoDesktop}</div>

        <ApplyStepsPanel
          steps={steps}
          activeStep={applyStep}
          title={panelTitle}
          applyingLabel={applyingLabel}
          lang={lang}
        />
      </div>
    </div>
  );
}
