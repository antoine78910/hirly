import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Briefcase,
  Calendar,
  Check,
  DollarSign,
  GraduationCap,
  Heart,
  Loader2,
  MapPin,
  Sparkles,
  X,
} from "lucide-react";
import CompanyLogo from "../CompanyLogo";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { getLandingHeroApplySteps, getLandingHeroDemoJobs } from "../../lib/landingHeroDemoJobs";
import LandingHeroApplyFlow from "./LandingHeroApplyFlow";
import LandingMobileApplyStepToasts from "./LandingMobileApplyStepToasts";

const CARD_THEME = {
  card: "border-zinc-200 bg-white shadow-lg shadow-zinc-200/60",
  cardHeader: "border-zinc-200",
  cardTitle: "text-zinc-900",
  cardCompany: "text-zinc-600",
  cardMeta: "text-zinc-500",
  cardSection: "border-zinc-200 bg-zinc-50/80",
  cardBadge: "bg-zinc-100 text-zinc-700",
  matchBadge: "bg-violet-100 text-violet-700",
};

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
      className={`pointer-events-none absolute z-30 rounded-xl border-[3px] px-4 py-1.5 font-display font-black tracking-wider backdrop-blur-sm ${
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

function DemoJobCard({ job, lang, matchLabel, variant = "desktop" }) {
  const locationLine = job.workModel ? `${job.location} • ${job.workModel}` : job.location;
  const isMobile = variant === "mobile";
  const matchTitle = lang === "fr" ? "Pourquoi ce poste vous correspond" : "Why you're a match";

  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-2xl border text-left ${CARD_THEME.card} ${
        isMobile ? "min-h-[500px]" : "min-h-[440px]"
      }`}
    >
      <div
        className={`flex shrink-0 items-start gap-2.5 border-b ${
          isMobile ? "px-4 py-3.5" : "px-5 py-4 sm:gap-3"
        } ${CARD_THEME.cardHeader}`}
      >
        <CompanyLogo
          company={job.company}
          size={isMobile ? "lg" : "lg"}
          rounded="2xl"
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h3
            className={`line-clamp-2 font-display font-bold leading-snug ${CARD_THEME.cardTitle} ${
              isMobile ? "text-[1.05rem]" : "text-lg sm:text-xl"
            }`}
          >
            {job.title}
          </h3>
          <p className={`mt-0.5 truncate font-medium ${CARD_THEME.cardCompany} ${isMobile ? "text-sm" : "text-sm"}`}>
            {job.company}
          </p>
        </div>
        <span
          className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap ${CARD_THEME.matchBadge} ${
            isMobile ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
          }`}
        >
          <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
          {job.matchScore}% {matchLabel}
        </span>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col text-left ${isMobile ? "px-4 py-3.5" : "px-5 py-4 sm:px-6"}`}>
        <div
          className={`flex flex-wrap items-center justify-start gap-x-3 gap-y-1.5 text-left ${CARD_THEME.cardMeta} ${
            isMobile ? "text-xs" : "text-sm"
          }`}
        >
          <span className="inline-flex items-center gap-1">
            <MapPin className={`shrink-0 text-violet-600 ${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"}`} aria-hidden />
            {locationLine}
          </span>
          <span className="inline-flex items-center gap-1">
            <DollarSign className={`shrink-0 text-violet-600 ${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"}`} aria-hidden />
            {job.salary}
          </span>
          <span className="inline-flex items-center gap-1">
            <GraduationCap className={`shrink-0 text-violet-600 ${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"}`} aria-hidden />
            {job.contract}
          </span>
          {job.postedLabel ? (
            <span className="inline-flex items-center gap-1">
              <Calendar className={`shrink-0 text-violet-600 ${isMobile ? "h-3.5 w-3.5" : "h-4 w-4"}`} aria-hidden />
              {job.postedLabel}
            </span>
          ) : null}
        </div>

        {(job.department || job.experience) && (
          <div className={`mt-2.5 space-y-0.5 text-left ${isMobile ? "text-[11px]" : "text-xs"} ${CARD_THEME.cardMeta}`}>
            {job.department ? <p className="font-medium text-zinc-600">{job.department}</p> : null}
            {job.experience ? <p>{job.experience}</p> : null}
          </div>
        )}

        {job.summary ? (
          <p className={`mt-2.5 text-left leading-snug text-zinc-600 ${isMobile ? "text-[11px]" : "text-xs"}`}>
            {job.summary}
          </p>
        ) : null}

        {job.skills?.length ? (
          <div className="mt-2.5 flex flex-wrap justify-start gap-1.5">
            {job.skills.map((skill) => (
              <span
                key={skill}
                className={`rounded-full border border-violet-200/80 bg-violet-50 font-medium text-violet-700 ${
                  isMobile ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-[11px]"
                }`}
              >
                {skill}
              </span>
            ))}
          </div>
        ) : null}

        <div className={`mt-3.5 rounded-xl border text-left ${isMobile ? "px-3.5 py-3" : "px-4 py-3"} ${CARD_THEME.cardSection}`}>
          <p className={`mb-2.5 text-left font-semibold text-zinc-800 ${isMobile ? "text-[11px]" : "text-xs"}`}>
            {matchTitle}
          </p>
          <ul className="list-none space-y-2 text-left">
            {job.reasons.map((reason) => (
              <li
                key={reason}
                className={`flex items-start justify-start gap-2 text-left leading-snug text-zinc-700 ${
                  isMobile ? "text-[11px]" : "text-sm"
                }`}
              >
                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Check className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-left">{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`mt-auto flex items-center justify-between border-t border-zinc-100 ${isMobile ? "pt-3.5" : "pt-4"}`}>
          <span
            className={`inline-flex items-center gap-1 rounded-full font-medium ${CARD_THEME.cardBadge} ${
              isMobile ? "px-2.5 py-1 text-[11px]" : "px-2.5 py-1 text-xs"
            }`}
          >
            <Briefcase className={isMobile ? "h-3 w-3" : "h-3 w-3"} aria-hidden />
            {job.contract}
          </span>
          <span className={`flex items-center gap-1 font-semibold text-zinc-500 ${isMobile ? "text-[11px]" : "text-xs"}`}>
            <Logo size={isMobile ? 15 : 16} />
            {BRAND.NAME}
          </span>
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
  lang,
  matchLabel,
  passStampLabel,
  applyStampLabel,
  variant = "desktop",
}) {
  const isMobile = variant === "mobile";
  const cardHeight = isMobile ? 500 : 440;
  const exitVariants = isMobile ? EXIT_VARIANTS_COMPACT : EXIT_VARIANTS;
  const showApplyStamp = showStamp && job.swipe === "apply";
  const showPassStamp = showStamp && job.swipe === "skip";

  return (
    <div className="relative z-10" style={{ height: cardHeight + (isMobile ? 28 : 0) }}>
      {jobs.map((stackJob, stackIndex) => {
        const offset = (stackIndex - index + jobs.length) % jobs.length;

        return (
          <div
            key={`stack-${stackJob.id}-${index}`}
            className="absolute inset-x-0 top-0"
            style={{
              zIndex: 3 - offset,
              transform: `translateY(${offset * 14}px) scale(${1 - offset * 0.028})`,
              opacity: offset === 0 ? 1 : offset === 1 ? 0.9 : 0.78,
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

                  <DemoJobCard job={job} lang={lang} matchLabel={matchLabel} variant={variant} />
                </motion.div>
              </AnimatePresence>
            ) : (
              <DemoJobCard job={stackJob} lang={lang} matchLabel={matchLabel} variant={variant} />
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
    <div className={`relative z-20 flex items-center justify-center ${isMobile ? "mt-6 gap-4" : "mt-8 gap-4 sm:gap-6"}`}>
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
  const matchLabel = lang === "fr" ? "compatibilité" : "match";
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
    <div className="relative mx-auto w-full max-w-md">
      <SwipeCardStack
        jobs={jobs}
        index={index}
        job={job}
        showStamp={showStamp}
        exiting={exiting}
        lang={lang}
        matchLabel={matchLabel}
        passStampLabel={passStampLabel}
        applyStampLabel={applyStampLabel}
        variant="mobile"
      />
      <LandingMobileApplyStepToasts steps={steps} activeStep={applyStep} />
      <div className="relative z-30 mt-6">
        <SwipeActionButtons variant="mobile" />
      </div>
    </div>
  );

  const swipeDemoDesktop = (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="relative z-10 px-1">
        <SwipeCardStack
          jobs={jobs}
          index={index}
          job={job}
          showStamp={showStamp}
          exiting={exiting}
          lang={lang}
          matchLabel={matchLabel}
          passStampLabel={passStampLabel}
          applyStampLabel={applyStampLabel}
          variant="desktop"
        />
      </div>
      <SwipeActionButtons variant="desktop" />
    </div>
  );

  return (
    <div ref={rootRef} className="mt-16 text-left lg:mt-20">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-8">
        <div className="w-full lg:hidden">{swipeDemoMobile}</div>
        <div className="hidden w-full lg:block">{swipeDemoDesktop}</div>

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
