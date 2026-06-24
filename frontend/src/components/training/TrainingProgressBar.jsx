import { Check } from "lucide-react";
import { SCORED_MODULE_IDS, moduleProgressFraction } from "../../lib/trainingProgress";

/**
 * Inline module progress stepper — shows inside the page content area
 * (below the module title, above the section nav).
 *
 * Props:
 *   modules       – full modules array from course data
 *   activeModuleId
 *   courseId
 *   enrollment    – used to read quiz_results
 *   lang
 *   progressTick  – increment externally to force a localStorage re-read
 */
export default function TrainingProgressBar({
  modules = [],
  activeModuleId,
  courseId,
  enrollment,
  lang,
  progressTick = 0,
}) {
  void progressTick;
  const scored = modules.filter((m) => SCORED_MODULE_IDS.includes(m.module_id));
  if (!scored.length) return null;

  const quizResults = enrollment?.quiz_results || {};
  const fractions = scored.map((m) => {
    void progressTick;
    return moduleProgressFraction(courseId, m, quizResults);
  });
  const overallPct = Math.round(
    (fractions.reduce((a, b) => a + b, 0) / scored.length) * 100,
  );
  const completedCount = scored.filter((m) => m.completed).length;

  const doneLabel =
    lang === "fr"
      ? `${completedCount}/${scored.length} complétés`
      : `${completedCount}/${scored.length} done`;

  return (
    <div className="flex items-center gap-3 py-1">
      {/* Step dots + connectors */}
      <div className="flex flex-1 items-center">
        {scored.map((m, i) => {
          const isActive = m.module_id === activeModuleId;
          const isDone = m.completed;
          const frac = fractions[i] || 0;
          const isLast = i === scored.length - 1;

          return (
            <span key={m.module_id} className="contents">
              {/* Dot */}
              <span
                title={m.title}
                className={[
                  "relative flex h-5 w-5 shrink-0 cursor-default items-center justify-center rounded-full text-[9px] font-bold transition-all duration-300",
                  isDone
                    ? "bg-violet-600 text-white shadow-sm shadow-violet-300"
                    : isActive
                      ? "bg-white text-violet-700 ring-2 ring-violet-600"
                      : frac > 0
                        ? "bg-white text-zinc-400 ring-2 ring-violet-200"
                        : "bg-white text-zinc-300 ring-2 ring-zinc-200",
                ].join(" ")}
              >
                {isDone ? (
                  <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                ) : (
                  <span aria-hidden>{i + 1}</span>
                )}
                {/* Tooltip (desktop) */}
                <span
                  className="pointer-events-none absolute bottom-7 left-1/2 hidden w-max max-w-[140px] -translate-x-1/2 whitespace-normal break-words rounded-md bg-zinc-900 px-2 py-1 text-[10px] font-normal leading-tight text-white group-hover:block sm:block"
                  role="tooltip"
                >
                  {m.title}
                </span>
              </span>

              {/* Connector bar */}
              {!isLast && (
                <span className="relative mx-1 flex h-[2px] w-6 shrink-0 overflow-hidden rounded-full bg-zinc-100 sm:w-10">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-violet-400 transition-[width] duration-700 ease-out"
                    style={{ width: `${frac * 100}%` }}
                    aria-hidden
                  />
                </span>
              )}
            </span>
          );
        })}
      </div>

      {/* Right: percentage + label */}
      <div className="flex shrink-0 flex-col items-end leading-none">
        <span className="text-sm font-bold tabular-nums text-violet-600">
          {overallPct}%
        </span>
        <span className="mt-0.5 text-[10px] text-zinc-400">{doneLabel}</span>
      </div>
    </div>
  );
}
