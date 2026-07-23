import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";

function ShimmerStatus({ children }) {
  return (
    <span className="inline-block bg-[length:200%_100%] bg-gradient-to-r from-zinc-400 via-zinc-900 to-zinc-400 bg-clip-text text-sm font-semibold tracking-tight text-transparent animate-[landing-shimmer_1.5s_linear_infinite]">
      {children}
    </span>
  );
}

function ApplyChatBubble({ step, state }) {
  const done = state === "done";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl bg-zinc-50 px-3.5 py-3 shadow-[0_0_2px_rgba(0,0,0,0.25)]"
    >
      {state === "active" ? (
        <ShimmerStatus>{step.status}</ShimmerStatus>
      ) : (
        <p
          className={`flex items-center gap-1.5 text-sm font-semibold tracking-tight ${done ? "text-zinc-800" : "text-zinc-500"}`}
        >
          {done ? (
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
              <Check className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
            </span>
          ) : null}
          <span>{step.label}</span>
        </p>
      )}
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">{step.hint}</p>
    </motion.div>
  );
}

function resolveBubbleState(index, activeStep, stepsLength, visible) {
  if (!visible || activeStep < 0) return "hidden";
  if (index < activeStep) return "done";
  if (index === activeStep && activeStep < stepsLength) return "active";
  if (activeStep >= stepsLength && index < stepsLength) return "done";
  return "hidden";
}

export default function LandingHeroApplyFlow({ steps, activeStep, visible }) {
  const listRef = useRef(null);
  const visibleCount =
    !visible || activeStep < 0
      ? 0
      : Math.min(steps.length, activeStep >= steps.length ? steps.length : activeStep + 1);

  const scrollOffset = Math.max(0, visibleCount - 3) * 76;

  useEffect(() => {
    if (!listRef.current || visibleCount === 0) return;
    listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [visibleCount]);

  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-xl border border-zinc-100 bg-white">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-14 bg-gradient-to-b from-white from-0% via-white via-[38%] to-transparent"
        aria-hidden
      />

      <div
        ref={listRef}
        className="h-full overflow-hidden px-1 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <motion.div
          className="flex flex-col gap-2.5 px-2 pb-2 pt-1"
          animate={{ y: -scrollOffset }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {steps.map((step, index) => {
              const state = resolveBubbleState(index, activeStep, steps.length, visible);
              if (state === "hidden") return null;

              return <ApplyChatBubble key={step.id} step={step} state={state} />;
            })}
          </AnimatePresence>
        </motion.div>
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-white to-transparent"
        aria-hidden
      />
    </div>
  );
}
