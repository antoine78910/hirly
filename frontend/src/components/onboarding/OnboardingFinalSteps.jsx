import { motion } from "framer-motion";
import { Briefcase, Check, Loader2, MapPin, Zap } from "lucide-react";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { ob } from "./onboardingTheme";
import { ONBOARDING_PAIN_TAGS, ONBOARDING_PRICING_PLANS } from "./onboardingData";

function PhoneShell({ children, className = "", tilt = 0, scale = 1, zIndex = 1 }) {
  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ transform: `rotate(${tilt}deg) scale(${scale})`, zIndex }}
    >
      <div className="rounded-[1.35rem] border-[3px] border-zinc-800 bg-zinc-900 p-1 shadow-[0_20px_50px_-20px_rgba(124,58,237,0.45)]">
        <div className="relative overflow-hidden rounded-[1.05rem] bg-white">
          <div className="flex items-center justify-center gap-1 border-b border-zinc-100 bg-zinc-50 px-2 py-1">
            <div className="h-1 w-8 rounded-full bg-zinc-200" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function JobCardMini({ title, company, location, tags = [], applyStamp = false }) {
  return (
    <div className="relative p-2.5">
      {applyStamp ? (
        <span className="absolute -left-1 top-3 z-10 -rotate-12 rounded-md gradient-linkedin px-2 py-0.5 text-[8px] font-black uppercase tracking-wide text-white shadow-sm">
          Apply
        </span>
      ) : null}
      <div className="rounded-xl border border-zinc-200 bg-white p-2 shadow-sm">
        <div className="mb-1.5 flex items-start justify-between gap-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100">
            <Briefcase className="h-3.5 w-3.5 text-violet-600" />
          </div>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[8px] font-semibold text-violet-700">
            <Zap className="h-2.5 w-2.5" /> 1
          </span>
        </div>
        <p className="text-[9px] font-bold leading-tight text-zinc-900">{title}</p>
        <p className="text-[8px] text-zinc-500">{company}</p>
        <p className="mt-0.5 flex items-center gap-0.5 text-[7px] text-zinc-400">
          <MapPin className="h-2 w-2" />
          {location}
        </p>
        {tags.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-0.5">
            {tags.map((tag) => (
              <span key={tag} className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[6px] font-medium text-zinc-600">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ShowcaseLandingStep() {
  return (
    <div className={`${ob.step} items-center text-center`}>
      <div className="mb-3 flex items-center justify-center gap-2 sm:mb-4">
        <Logo size={22} />
        <span className="font-display text-sm font-bold text-zinc-700">{BRAND.NAME}</span>
      </div>

      <p className={`text-sm sm:text-base ${ob.muted}`}>Stop applying.</p>
      <h1 className="mt-1 font-display text-[1.45rem] font-black leading-tight tracking-tight text-zinc-900 sm:text-3xl">
        Start landing interviews.
      </h1>

      <div className={`${ob.stepBody} relative flex items-center justify-center overflow-visible`}>
        <div className="relative flex h-[min(42dvh,260px)] w-full max-w-sm items-end justify-center">
          <PhoneShell tilt={-14} scale={0.82} zIndex={1} className="absolute -left-2 bottom-2 sm:-left-4">
            <div className="w-[108px] p-2 sm:w-[118px]">
              <p className="text-[8px] font-bold text-zinc-900">Screening</p>
              <p className="mt-0.5 text-[7px] text-zinc-500">Question 1 of 8</p>
              <div className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50 px-1.5 py-1 text-[7px] font-semibold text-rose-600">
                High priority
              </div>
              <p className="mt-1.5 text-[7px] leading-snug text-zinc-600">
                Describe your experience managing a team in a fast-paced environment.
              </p>
            </div>
          </PhoneShell>

          <PhoneShell tilt={0} scale={1} zIndex={3} className="relative">
            <div className="w-[132px] sm:w-[148px]">
              <JobCardMini
                title="Software Engineer"
                company="Tech Company"
                location="San Francisco, CA"
                tags={["Full Time", "Mid Level", "Hybrid"]}
              />
              <p className="px-2 pb-2 text-center text-[7px] text-violet-600">Tap for details</p>
            </div>
          </PhoneShell>

          <PhoneShell tilt={12} scale={0.82} zIndex={2} className="absolute -right-2 bottom-2 sm:-right-4">
            <div className="w-[108px] sm:w-[118px]">
              <JobCardMini
                title="Operations Lead"
                company="Growth Co."
                location="Remote, US"
                applyStamp
              />
              <div className="mt-2 flex justify-around border-t border-zinc-100 px-1 pt-1.5">
                {["Browse", "Apps", "Profile"].map((item) => (
                  <span key={item} className="text-[6px] font-medium text-zinc-400">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </PhoneShell>
        </div>
      </div>
    </div>
  );
}

function PainTagRow({ tags, reverse = false }) {
  return (
    <div className={`flex gap-2 whitespace-nowrap ${reverse ? "justify-end" : ""}`}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex shrink-0 items-center rounded-full border border-zinc-200/90 bg-white/80 px-2.5 py-1 text-[10px] font-medium text-zinc-500 shadow-sm backdrop-blur-sm sm:text-[11px]"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export function ShowcaseAllInOneStep() {
  const rows = [
    ONBOARDING_PAIN_TAGS.slice(0, 2),
    ONBOARDING_PAIN_TAGS.slice(2, 4),
    ONBOARDING_PAIN_TAGS.slice(4, 6),
  ];

  return (
    <div className={`${ob.step} items-center text-center`}>
      <div className="mb-2 flex items-center justify-center gap-2">
        <Logo size={22} />
        <span className="font-display text-sm font-bold text-zinc-700">{BRAND.NAME}</span>
      </div>

      <h1 className="font-display text-[1.35rem] font-black leading-tight tracking-tight text-zinc-900 sm:text-2xl">
        All in one place
      </h1>
      <p className={`mt-1.5 max-w-sm text-sm leading-snug ${ob.muted}`}>
        Built for real results: everything your job search should&apos;ve been.
      </p>

      <div className={`${ob.stepBody} relative flex items-center justify-center overflow-hidden`}>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 space-y-2 opacity-70">
          {rows.map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: i % 2 === 0 ? -12 : 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
            >
              <PainTagRow tags={row} reverse={i % 2 === 1} />
            </motion.div>
          ))}
        </div>

        <PhoneShell className="relative z-10" scale={1.05}>
          <div className="w-[min(58vw,210px)] p-2.5 sm:w-[220px]">
            <div className="mb-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-left">
              <p className="text-[9px] font-bold text-zinc-900">Product Manager</p>
              <p className="text-[8px] text-zinc-500">Acme Corp · Paris, France</p>
            </div>
            <div className="mb-2 flex rounded-full bg-zinc-100 p-0.5">
              <span className="flex-1 rounded-full bg-white py-1 text-center text-[8px] font-semibold text-zinc-900 shadow-sm">
                Resume
              </span>
              <span className="flex-1 py-1 text-center text-[8px] font-medium text-zinc-500">Cover Letter</span>
            </div>
            <p className="mb-1 text-left text-[8px] font-semibold text-zinc-700">Generated Resume</p>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
              <div className="space-y-1">
                <div className="h-1 w-full rounded bg-zinc-200" />
                <div className="h-1 w-[92%] rounded bg-zinc-200" />
                <div className="h-1 w-[85%] rounded bg-zinc-200" />
                <div className="h-1 w-[78%] rounded bg-zinc-200" />
              </div>
              <p className="mt-2 text-center text-[7px] text-violet-600">Tap to preview full document</p>
            </div>
          </div>
        </PhoneShell>
      </div>
    </div>
  );
}

export function ShowcasePricingStep({ selectedPlan, onSelectPlan, locationLabel = "Your city" }) {
  const plan = ONBOARDING_PRICING_PLANS.find((p) => p.id === selectedPlan) || ONBOARDING_PRICING_PLANS[0];

  return (
    <div className={`${ob.step} min-h-0`}>
      <div className="shrink-0 text-center">
        <div className="mb-2 flex items-center justify-center gap-2">
          <Logo size={22} />
          <span className="font-display text-sm font-bold text-zinc-700">{BRAND.NAME}</span>
        </div>
        <h1 className="font-display text-[1.25rem] font-black leading-tight tracking-tight text-zinc-900 sm:text-2xl">
          All-in-one job search.
        </h1>
        <p className={`mt-0.5 text-sm font-medium ${ob.muted}`}>Anywhere, anytime.</p>
      </div>

      <div className={`${ob.stepBody} min-h-0 justify-start gap-3 overflow-y-auto pr-0.5`}>
        <div className="flex shrink-0 justify-center py-1">
          <PhoneShell scale={0.92}>
            <div className="w-[min(52vw,190px)] p-2 sm:w-[200px]">
              <div className="mb-1.5 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[8px] font-medium text-violet-700">
                Software Engineer · {locationLabel}
              </div>
              <JobCardMini
                title="Full Stack Developer"
                company="Zoox"
                location="San Francisco, CA"
                tags={["Full Time", "Entry Level"]}
              />
            </div>
          </PhoneShell>
        </div>

        <div className="space-y-2">
          {ONBOARDING_PRICING_PLANS.map((item) => {
            const on = selectedPlan === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectPlan(item.id)}
                className={`relative w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200 ease-out sm:px-4 ${
                  on
                    ? "border-violet-400/70 bg-gradient-to-br from-violet-50 via-fuchsia-50/70 to-violet-50 ring-1 ring-violet-300/45 shadow-sm"
                    : "border-zinc-200 bg-white hover:border-violet-200 hover:bg-violet-50/40"
                }`}
                data-testid={`pricing-plan-${item.id}`}
              >
                {item.badge ? (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full gradient-linkedin px-2.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                    {item.badge}
                  </span>
                ) : null}
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      on ? "border-violet-500 bg-violet-500 text-white" : "border-zinc-300 bg-white"
                    }`}
                  >
                    {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm text-zinc-900">{item.label}</p>
                    <p className={`text-xs ${ob.muted}`}>{item.billed}</p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-zinc-900">
                    {item.weekly}
                    <span className={`block text-right text-[10px] font-medium ${ob.dim}`}>/ week</span>
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <p className={`text-center text-[11px] ${ob.dim}`}>{plan.footnote}</p>
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
