import { motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { ob } from "./onboardingTheme";
import {
  ONBOARDING_PAIN_TAGS,
  ONBOARDING_PRICING_PLANS,
  ONBOARDING_SHOWCASE_SCREENS,
} from "./onboardingData";
import PhoneMockup from "./PhoneMockup";

function PainTagRow({ tags, reverse = false }) {
  return (
    <div className={`flex gap-2 whitespace-nowrap ${reverse ? "justify-end" : ""}`}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex shrink-0 items-center rounded-full border border-zinc-200/90 bg-white/90 px-3 py-1.5 text-[10px] font-medium text-zinc-500 shadow-sm backdrop-blur-sm sm:text-[11px]"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export function ShowcaseLandingStep() {
  const screens = ONBOARDING_SHOWCASE_SCREENS.landing;

  return (
    <div className={`${ob.step} items-center text-center`}>
      <div className="mb-2 flex items-center justify-center gap-2 sm:mb-3">
        <Logo size={24} />
        <span className="font-display text-base font-bold text-swiipr-gradient">{BRAND.NAME}</span>
      </div>

      <p className={`text-base sm:text-lg ${ob.muted}`}>Stop applying.</p>
      <h1 className="mt-0.5 font-display text-[1.55rem] font-black leading-[1.1] tracking-tight text-zinc-900 sm:text-[2rem]">
        Start landing interviews.
      </h1>

      <div className={`${ob.stepBody} relative flex items-end justify-center overflow-visible`}>
        <div className="relative flex h-[min(50dvh,340px)] w-full max-w-lg items-end justify-center">
          <PhoneMockup
            src={screens.left}
            alt="Screening questions"
            placeholderLabel="Screening questions"
            width={124}
            tilt={-16}
            scale={0.86}
            zIndex={1}
            className="absolute -left-1 bottom-1 sm:-left-4 sm:bottom-2"
          />

          <PhoneMockup
            src={screens.center}
            alt="Swipe feed"
            placeholderLabel="Swipe feed"
            width={158}
            tilt={0}
            scale={1}
            zIndex={3}
            className="relative -translate-y-1"
          />

          <PhoneMockup
            src={screens.right}
            alt="Applications tracker"
            placeholderLabel="Applications"
            width={124}
            tilt={14}
            scale={0.86}
            zIndex={2}
            className="absolute -right-1 bottom-1 sm:-right-4 sm:bottom-2"
          />
        </div>
      </div>
    </div>
  );
}

export function ShowcaseAllInOneStep() {
  const rows = [
    ONBOARDING_PAIN_TAGS.slice(0, 2),
    ONBOARDING_PAIN_TAGS.slice(2, 4),
    ONBOARDING_PAIN_TAGS.slice(4, 6),
    ONBOARDING_PAIN_TAGS.slice(6, 8),
    ONBOARDING_PAIN_TAGS.slice(8, 10),
  ];

  return (
    <div className={`${ob.step} items-center text-center`}>
      <div className="mb-2 flex items-center justify-center gap-2">
        <Logo size={24} />
        <span className="font-display text-base font-bold text-swiipr-gradient">{BRAND.NAME}</span>
      </div>

      <h1 className="font-display text-[1.4rem] font-black leading-tight tracking-tight text-zinc-900 sm:text-2xl">
        All in one place
      </h1>
      <p className={`mt-1.5 max-w-sm px-2 text-sm leading-snug sm:text-base ${ob.muted}`}>
        Built for real results: everything your job search should&apos;ve been.
      </p>

      <div className={`${ob.stepBody} relative flex items-center justify-center overflow-hidden`}>
        <div className="pointer-events-none absolute inset-x-[-10%] top-1/2 -translate-y-1/2 space-y-2.5 opacity-75">
          {rows.map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
            >
              <PainTagRow tags={row} reverse={i % 2 === 1} />
            </motion.div>
          ))}
        </div>

        <PhoneMockup
          src={ONBOARDING_SHOWCASE_SCREENS.allInOne}
          alt="Resume and cover letter"
          placeholderLabel="Resume & cover letter"
          width={210}
          scale={1.08}
          zIndex={10}
          className="relative"
        />
      </div>
    </div>
  );
}

export function ShowcasePricingStep({ selectedPlan, onSelectPlan }) {
  const plan = ONBOARDING_PRICING_PLANS.find((p) => p.id === selectedPlan) || ONBOARDING_PRICING_PLANS[0];

  return (
    <div className={`${ob.step} min-h-0`}>
      <div className="shrink-0 text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          <Logo size={24} />
          <span className="font-display text-base font-bold text-swiipr-gradient">{BRAND.NAME}</span>
        </div>
        <h1 className="font-display text-[1.35rem] font-black leading-tight tracking-tight text-zinc-900 sm:text-[1.65rem]">
          All-in-one job search.
        </h1>
        <p className={`mt-1 text-sm font-medium sm:text-base ${ob.muted}`}>Anywhere, anytime.</p>
      </div>

      <div className={`${ob.stepBody} min-h-0 justify-start gap-3 overflow-y-auto pr-0.5`}>
        <div className="flex shrink-0 justify-center pb-1 pt-1">
          <PhoneMockup
            src={ONBOARDING_SHOWCASE_SCREENS.pricing}
            alt="Job search feed"
            placeholderLabel="Swipe feed"
            width={188}
            scale={1}
          />
        </div>

        <div className="space-y-3 pt-1">
          {ONBOARDING_PRICING_PLANS.map((item) => {
            const on = selectedPlan === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectPlan(item.id)}
                className={`relative w-full rounded-2xl border-2 px-3 py-3.5 text-left transition-all duration-200 ease-out sm:px-4 ${
                  on
                    ? "border-violet-500 bg-gradient-to-br from-violet-50 via-fuchsia-50/70 to-violet-50 shadow-[0_0_0_1px_rgba(124,58,237,0.15)]"
                    : "border-zinc-200 bg-white hover:border-violet-200 hover:bg-violet-50/40"
                }`}
                data-testid={`pricing-plan-${item.id}`}
              >
                {item.badge ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full gradient-linkedin px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                    {item.badge}
                  </span>
                ) : null}
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      on ? "border-violet-500 bg-violet-500 text-white" : "border-zinc-300 bg-white"
                    }`}
                  >
                    {on ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-zinc-900 sm:text-base">{item.label}</p>
                    <p className={`text-xs sm:text-sm ${ob.muted}`}>{item.billed}</p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-zinc-900 sm:text-base">
                    {item.weekly}
                    <span className={`block text-right text-[10px] font-medium ${ob.dim}`}>/ week</span>
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <p className={`pb-1 text-center text-[11px] sm:text-xs ${ob.dim}`}>{plan.footnote}</p>
      </div>
    </div>
  );
}

export function FinishOnboardingButton({ saving, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      data-testid="start-swiping-btn"
      className="w-full h-11 sm:h-12 rounded-full gradient-linkedin text-white font-bold text-sm sm:text-base disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shadow-[0_12px_40px_-12px_rgba(124,58,237,0.45)]"
    >
      {saving ? (
        <span className="inline-flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Starting…
        </span>
      ) : (
        "Start landing interviews"
      )}
    </button>
  );
}
