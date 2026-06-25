import { useId } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { isQuizPassed } from "../../lib/trainingData";
import { quizIdForModule } from "../../lib/trainingQuizzes";
import { SCORED_MODULE_IDS, moduleProgressFraction } from "../../lib/trainingProgress";

const RING_R = 10;
const RING_C = 2 * Math.PI * RING_R;

function ProgressBadge({ pct, lang, progressTick }) {
  const gradId = useId();
  const offset = RING_C - (pct / 100) * RING_C;
  const label = lang === "fr" ? "Progression" : "Progress";

  return (
    <div
      className="ml-0.5 hidden shrink-0 items-center gap-2.5 border-l border-zinc-200/90 pl-3.5 sm:flex"
      aria-label={`${label}: ${pct}%`}
    >
      <div className="relative flex h-9 w-9 items-center justify-center">
        <svg
          className="absolute inset-0 h-9 w-9 -rotate-90"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <circle
            cx="12"
            cy="12"
            r={RING_R}
            fill="none"
            stroke="#ede9fe"
            strokeWidth="2.5"
          />
          <motion.circle
            key={`${progressTick}-${pct}`}
            cx="12"
            cy="12"
            r={RING_R}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            initial={{ strokeDashoffset: RING_C }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
        </svg>
        <motion.span
          key={`pct-${progressTick}-${pct}`}
          initial={{ scale: 0.85, opacity: 0.5 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 22 }}
          className="relative text-[10px] font-black tabular-nums leading-none text-violet-700"
        >
          {pct}
        </motion.span>
      </div>
      <div className="flex min-w-[2.75rem] flex-col leading-tight">
        <motion.span
          key={`label-pct-${progressTick}-${pct}`}
          initial={{ y: 2, opacity: 0.6 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-sm font-black tabular-nums text-transparent"
        >
          {pct}%
        </motion.span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-violet-400/90">
          {label}
        </span>
      </div>
    </div>
  );
}

/**
 * Compact module stepper for the training header (top-right).
 */
export default function TrainingModuleStepper({
  modules = [],
  activeModuleId,
  courseId,
  enrollment,
  lang,
  progressTick = 0,
  celebrateModuleId = null,
  onModuleSelect,
}) {
  const scored = modules.filter((m) => SCORED_MODULE_IDS.includes(m.module_id));
  if (!scored.length) return null;

  const quizResults = enrollment?.quiz_results || {};
  const fractions = scored.map((m) => moduleProgressFraction(courseId, m, quizResults));
  const overallPct = Math.round(
    (fractions.reduce((a, b) => a + b, 0) / scored.length) * 100,
  );

  const isModuleValidated = (m) =>
    m.completed || isQuizPassed(enrollment, quizIdForModule(m.module_id), courseId);

  const firstIncompleteIdx = scored.findIndex((m) => !isModuleValidated(m));

  const canNavigateTo = (m, index) => {
    if (!onModuleSelect) return false;
    if (isModuleValidated(m)) return true;
    if (index <= firstIncompleteIdx) return true;
    return m.module_id === activeModuleId;
  };

  return (
    <div
      className="flex items-center gap-1 rounded-full border border-zinc-200/80 bg-white/95 px-3 py-2 shadow-sm shadow-violet-100/40 backdrop-blur-sm sm:gap-0 sm:pr-3.5"
      data-testid="training-module-stepper"
    >
      <div className="flex items-center gap-1.5 px-0.5">
        {scored.map((m, i) => {
          const stepNum = m.sort_order ?? i + 1;
          const isActive = m.module_id === activeModuleId;
          const isValidated = isModuleValidated(m);
          const frac = fractions[i] || 0;
          const isLast = i === scored.length - 1;
          const isCelebrating = celebrateModuleId === m.module_id;
          const navigable = canNavigateTo(m, i);

          const dot = (
            <motion.span
              key={m.module_id}
              title={m.title}
              animate={isCelebrating ? { scale: [1, 1.35, 1] } : { scale: 1 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className={[
                "relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums leading-none transition-all duration-300",
                isValidated
                  ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200"
                  : isActive
                    ? "bg-white text-violet-700 ring-2 ring-violet-600"
                    : frac > 0
                      ? "bg-white text-violet-600 ring-2 ring-violet-200"
                      : "bg-white text-zinc-400 ring-2 ring-zinc-200",
                navigable ? "cursor-pointer hover:ring-violet-400" : "cursor-default",
              ].join(" ")}
              onClick={navigable ? () => onModuleSelect(m.module_id) : undefined}
              onKeyDown={navigable ? (e) => {
                if (e.key === "Enter" || e.key === " ") onModuleSelect(m.module_id);
              } : undefined}
              role={navigable ? "button" : undefined}
              tabIndex={navigable ? 0 : undefined}
              aria-label={`${stepNum}. ${m.title}`}
              aria-current={isActive ? "step" : undefined}
            >
              {isCelebrating ? (
                <span
                  className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-emerald-400 ring-offset-1 animate-ping"
                  aria-hidden
                />
              ) : null}
              {isValidated ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
              ) : (
                <span aria-hidden>{stepNum}</span>
              )}
            </motion.span>
          );

          return (
            <span key={m.module_id} className="contents">
              {dot}
              {!isLast ? (
                <span className="relative mx-1 flex h-[2px] w-3.5 shrink-0 overflow-hidden rounded-full bg-zinc-100 sm:w-4">
                  <span
                    className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out ${
                      isValidated ? "bg-emerald-400" : "bg-violet-400"
                    }`}
                    style={{ width: `${isValidated ? 100 : frac * 100}%` }}
                    aria-hidden
                  />
                </span>
              ) : null}
            </span>
          );
        })}
      </div>

      <ProgressBadge pct={overallPct} lang={lang} progressTick={progressTick} />
    </div>
  );
}
