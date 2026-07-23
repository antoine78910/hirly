import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Check } from "lucide-react";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";

const TOAST_SPRING = { type: "spring", stiffness: 220, damping: 30, mass: 0.9 };
const LAYOUT_SPRING = { type: "spring", stiffness: 260, damping: 32, mass: 0.85 };

function ShimmerStatus({ children }) {
  return (
    <span className="inline-block bg-[length:200%_100%] bg-gradient-to-r from-zinc-400 via-zinc-900 to-zinc-400 bg-clip-text text-xs font-semibold tracking-tight text-transparent animate-[landing-shimmer_1.5s_linear_infinite]">
      {children}
    </span>
  );
}

function StepToast({ step, state }) {
  const done = state === "done";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 36, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.96 }}
      transition={{
        layout: LAYOUT_SPRING,
        opacity: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
        y: TOAST_SPRING,
        scale: TOAST_SPRING,
      }}
      className="w-full max-w-[280px] rounded-2xl border border-zinc-200/90 bg-white/95 px-3 py-2.5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.2)] backdrop-blur-sm"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-zinc-100">
          <Logo size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">
            {BRAND.NAME}
          </p>
          {state === "active" ? (
            <ShimmerStatus>{step.status}</ShimmerStatus>
          ) : (
            <p
              className={`mt-0.5 flex items-center gap-1.5 text-xs font-semibold leading-snug ${done ? "text-zinc-900" : "text-zinc-500"}`}
            >
              {done ? (
                <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
                  <Check className="h-2 w-2" strokeWidth={2.5} aria-hidden />
                </span>
              ) : null}
              <span>{step.label}</span>
            </p>
          )}
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{step.hint}</p>
        </div>
      </div>
    </motion.div>
  );
}

function resolveToastState(index, activeStep, stepsLength) {
  if (activeStep < 0) return "hidden";
  if (index < activeStep) return "done";
  if (index === activeStep && activeStep < stepsLength) return "active";
  if (activeStep >= stepsLength) return "done";
  return "hidden";
}

export default function LandingMobileApplyStepToasts({
  steps,
  activeStep,
  bottomClassName = "bottom-14",
}) {
  if (activeStep < 0) return null;

  const visibleSteps = steps
    .map((step, index) => ({
      step,
      index,
      state: resolveToastState(index, activeStep, steps.length),
    }))
    .filter(({ state }) => state !== "hidden");

  if (visibleSteps.length === 0) return null;

  return (
    <LayoutGroup>
      <motion.div
        layout
        className={`pointer-events-none absolute inset-x-0 ${bottomClassName} z-20 flex flex-col-reverse items-end gap-3 px-1`}
        aria-live="polite"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {[...visibleSteps].reverse().map(({ step, state }) => (
            <StepToast key={step.id} step={step} state={state} />
          ))}
        </AnimatePresence>
      </motion.div>
    </LayoutGroup>
  );
}
