import { ChevronLeft } from "lucide-react";
import { motion } from "framer-motion";

export default function OnboardingShell({
  progress,
  onBack,
  showBack = true,
  showProgress = true,
  children,
  footer,
}) {
  return (
    <div className="min-h-dvh bg-white text-zinc-900 flex flex-col">
      <div className="relative flex-1 flex flex-col items-center gradient-linkedin-soft overflow-hidden">
        <div className="absolute inset-0 bg-grid mask-radial pointer-events-none" />

        <div className="relative w-full max-w-[430px] sm:max-w-lg lg:max-w-xl flex-1 flex flex-col px-5 sm:px-8 lg:px-10 pt-4 sm:pt-6 pb-4 sm:pb-6 min-h-0">
          {showProgress ? (
            <div className="flex items-center gap-3 mb-4 sm:mb-5 shrink-0">
              {showBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-linkedin hover:bg-white/80 border border-zinc-200/80 bg-white/70 transition-colors shrink-0 shadow-sm"
                  aria-label="Back"
                  data-testid="onboarding-back"
                >
                  <ChevronLeft className="w-6 h-6" strokeWidth={2} />
                </button>
              ) : (
                <div className="w-10 shrink-0" />
              )}
              <div className="flex-1 h-1.5 rounded-full bg-zinc-200 overflow-hidden">
                <motion.div
                  className="h-full rounded-full gradient-linkedin"
                  initial={false}
                  animate={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              </div>
            </div>
          ) : showBack ? (
            <div className="mb-2 sm:mb-3 shrink-0">
              <button
                type="button"
                onClick={onBack}
                className="w-10 h-10 rounded-full flex items-center justify-center text-linkedin hover:bg-white/80 border border-zinc-200/80 bg-white/70 transition-colors shrink-0 shadow-sm"
                aria-label="Back"
                data-testid="onboarding-back"
              >
                <ChevronLeft className="w-6 h-6" strokeWidth={2} />
              </button>
            </div>
          ) : null}

          <div className="flex-1 min-h-0 flex flex-col">{children}</div>

          {footer ? <div className="pt-4 sm:pt-5 shrink-0">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ContinueButton({ children, disabled, onClick, testId = "onboarding-continue" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="w-full h-14 sm:h-[3.75rem] rounded-full gradient-linkedin text-white font-bold text-base sm:text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shadow-[0_12px_40px_-12px_rgba(124,58,237,0.45)]"
    >
      {children}
    </button>
  );
}
