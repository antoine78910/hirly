import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Briefcase,
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

const HOLD_MS = 2600;
const EXIT_MS = 720;
const STEP_MS = 750;

const EXIT_VARIANTS = {
  skip: { x: -340, rotate: -10, opacity: 0, scale: 0.94 },
  apply: { x: 340, rotate: 10, opacity: 0, scale: 0.94 },
};

function DemoJobCard({ job, lang, matchLabel }) {
  const locationLine = job.workModel ? `${job.location} • ${job.workModel}` : job.location;

  return (
    <div className={`flex h-full min-h-[380px] flex-col overflow-hidden rounded-2xl border ${CARD_THEME.card}`}>
      <div className={`relative flex shrink-0 items-center border-b px-5 py-4 pr-28 ${CARD_THEME.cardHeader}`}>
        <CompanyLogo company={job.company} size="lg" rounded="2xl" className="mr-3 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className={`line-clamp-2 font-display text-lg font-bold leading-snug sm:text-xl ${CARD_THEME.cardTitle}`}>
            {job.title}
          </h3>
          <p className={`mt-0.5 truncate text-sm font-medium ${CARD_THEME.cardCompany}`}>{job.company}</p>
        </div>
        <span
          className={`absolute right-4 top-4 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${CARD_THEME.matchBadge}`}
        >
          <Sparkles className="h-3 w-3" aria-hidden />
          {job.matchScore}% {matchLabel}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 py-4 sm:px-6">
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${CARD_THEME.cardMeta}`}>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
            {locationLine}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <DollarSign className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
            {job.salary}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <GraduationCap className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />
            {job.contract}
          </span>
        </div>

        <div className={`mt-4 rounded-xl border px-4 py-3 ${CARD_THEME.cardSection}`}>
          <ul className="space-y-2.5">
            {job.reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-sm leading-snug text-zinc-700">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                </span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-4">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${CARD_THEME.cardBadge}`}>
            <Briefcase className="h-3 w-3" aria-hidden />
            {job.contract}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
            <Logo size={16} />
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
      className={`w-full rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_40px_-18px_rgba(124,58,237,0.35)] sm:p-5 lg:sticky lg:top-24 ${
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

export default function LandingHeroSwipeDemo({ lang }) {
  const jobs = useMemo(() => getLandingHeroDemoJobs(lang), [lang]);
  const steps = useMemo(() => getLandingHeroApplySteps(lang), [lang]);
  const [index, setIndex] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [applyStep, setApplyStep] = useState(-1);
  const stepTimersRef = useRef([]);
  const holdTimerRef = useRef(null);
  const advanceTimerRef = useRef(null);

  const job = jobs[index];
  const matchLabel = lang === "fr" ? "compatibilité" : "match";
  const panelTitle = lang === "fr" ? "Candidature en cours" : "Application in progress";
  const applyingLabel = lang === "fr" ? "Hirly prépare votre dossier…" : "Hirly is preparing your application…";
  const passLabel = lang === "fr" ? "Pass" : "Pass";
  const applyLabel = lang === "fr" ? "Postuler" : "Apply";

  useEffect(() => {
    const clearStepTimers = () => {
      stepTimersRef.current.forEach(clearTimeout);
      stepTimersRef.current = [];
    };

    const runCycle = () => {
      clearStepTimers();
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);

      const current = jobs[index];
      const applyDuration = steps.length * STEP_MS + 900;
      const cycleDuration =
        current.swipe === "apply" ? HOLD_MS + Math.max(EXIT_MS, applyDuration) + 500 : HOLD_MS + EXIT_MS;

      holdTimerRef.current = window.setTimeout(() => {
        setExiting(true);

        if (current.swipe === "apply") {
          setApplyStep(0);
          for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
            const timer = window.setTimeout(() => {
              setApplyStep(stepIndex + 1);
            }, (stepIndex + 1) * STEP_MS);
            stepTimersRef.current.push(timer);
          }
        }

        advanceTimerRef.current = window.setTimeout(() => {
          setExiting(false);
          setIndex((prev) => (prev + 1) % jobs.length);
          if (current.swipe === "apply") {
            window.setTimeout(() => setApplyStep(-1), 500);
          }
        }, cycleDuration - HOLD_MS);
      }, HOLD_MS);
    };

    runCycle();

    return () => {
      clearStepTimers();
      if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
      if (advanceTimerRef.current) window.clearTimeout(advanceTimerRef.current);
    };
  }, [index, jobs, steps]);

  const showApplyStamp = exiting && job.swipe === "apply";
  const showPassStamp = exiting && job.swipe === "skip";

  return (
    <div className="mt-16 lg:mt-20">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-8">
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="relative z-10 h-[380px]">
            {jobs.map((stackJob, stackIndex) => {
              const offset = (stackIndex - index + jobs.length) % jobs.length;
              if (offset === 0 || offset > 2) return null;

              return (
                <div
                  key={`stack-${stackJob.id}`}
                  className={`absolute inset-x-0 top-0 rounded-2xl border ${CARD_THEME.card}`}
                  style={{
                    zIndex: 3 - offset,
                    transform: `translateY(${offset * 10}px) scale(${1 - offset * 0.03})`,
                    opacity: offset === 1 ? 0.55 : 0.3,
                    height: 380,
                  }}
                  aria-hidden
                />
              );
            })}

            <div className="relative z-10 h-full">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${job.id}-${index}`}
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={
                    exiting
                      ? EXIT_VARIANTS[job.swipe]
                      : { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }
                  }
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 280, damping: 28 }}
                  className="absolute inset-0"
                >
                  {showApplyStamp ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="pointer-events-none absolute left-5 top-16 z-20 rounded-xl border-[3px] border-violet-500 px-3 py-1 font-display text-2xl font-black tracking-wider text-violet-500 sm:left-6 sm:top-20 sm:px-4 sm:text-3xl"
                      style={{ rotate: "-12deg" }}
                    >
                      {applyLabel}
                    </motion.div>
                  ) : null}
                  {showPassStamp ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="pointer-events-none absolute right-5 top-16 z-20 rounded-xl border-[3px] border-rose-500 px-3 py-1 font-display text-2xl font-black tracking-wider text-rose-500 sm:right-6 sm:top-20 sm:px-4 sm:text-3xl"
                      style={{ rotate: "12deg" }}
                    >
                      {passLabel}
                    </motion.div>
                  ) : null}

                  <DemoJobCard job={job} lang={lang} matchLabel={matchLabel} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          <div className="relative z-20 mt-8 flex items-center justify-center gap-4 sm:gap-6">
            <div className="grid h-12 w-12 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm">
              <X className="h-5 w-5" aria-hidden />
            </div>
            <div className="grid h-14 w-14 place-items-center rounded-full gradient-linkedin text-white shadow-md shadow-violet-500/25">
              <Heart className="h-6 w-6" fill="white" aria-hidden />
            </div>
          </div>
        </div>

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
