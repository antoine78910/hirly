import { useEffect, useState } from "react";
import { preloadOnboardingShowcaseImages } from "../../lib/onboardingImagePreload";
import { isImagePreloaded, publicAssetUrl } from "../../lib/preloadImages";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { ob } from "./onboardingTheme";
import { useAppLocale } from "../../context/AppLocaleContext";
import {
  getOnboardingPricingPlans,
  ONBOARDING_PRICING_PLANS,
  ONBOARDING_SHOWCASE_SCREENS,
  PROFILE_SETUP_PHASES,
  PROFILE_SETUP_PHASES_FR,
  ONBOARDING_PAIN_POINTS,
  ONBOARDING_PAIN_POINTS_FR,
  buildPainMarqueeRows,
  buildProfileWelcomeItems,
  getOnboardingValueTagline,
} from "./onboardingData";
import { FRIEND_REFERRAL_GOAL, FRIEND_REFERRAL_REWARD_CREDITS } from "../../lib/friendReferral";

function OnboardingValueTagline({ className = "", prominent = false }) {
  const { lang } = useAppLocale();
  return (
    <p
      className={
        prominent
          ? `font-display text-[1.35rem] font-black leading-[1.15] tracking-tight text-zinc-900 sm:text-[1.65rem] ${className}`
          : `text-sm font-semibold leading-snug text-linkedin sm:text-base ${className}`
      }
    >
      {getOnboardingValueTagline(lang)}
    </p>
  );
}

const welcomeListReveal = {
  container: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.14, delayChildren: 0.12 },
    },
  },
  item: {
    hidden: { opacity: 0, y: 18, scale: 0.98 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
    },
  },
};

const SETUP_PHASE_MS = 2200;

function ShowcaseImage({ src, alt, className = "" }) {
  const url = publicAssetUrl(src);
  const [ready, setReady] = useState(() => isImagePreloaded(src));

  useEffect(() => {
    setReady(isImagePreloaded(src));
  }, [src]);

  return (
    <img
      src={url}
      alt={alt}
      loading="eager"
      fetchPriority="high"
      decoding="async"
      onLoad={() => setReady(true)}
      className={`mx-auto w-full max-w-full bg-transparent object-contain transition-opacity duration-150 ${ready ? "opacity-100" : "opacity-0"} ${className}`}
      draggable={false}
    />
  );
}

function SetupSpinner() {
  return (
    <div className="relative h-[3.25rem] w-[3.25rem] sm:h-14 sm:w-14" aria-hidden>
      <div className="absolute inset-0 rounded-full border-[3px] border-violet-200" />
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 90deg, transparent 0deg, transparent 250deg, #7C3AED 300deg, #A78BFA 330deg, transparent 360deg)",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px))",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}

export function ProfileSetupStep({ onComplete }) {
  const { lang } = useAppLocale();
  const phases = lang === "fr" ? PROFILE_SETUP_PHASES_FR : PROFILE_SETUP_PHASES;
  const [phaseIndex, setPhaseIndex] = useState(0);
  const phase = phases[phaseIndex];

  useEffect(() => {
    preloadOnboardingShowcaseImages();
  }, []);

  useEffect(() => {
    if (phaseIndex >= phases.length - 1) {
      const done = setTimeout(onComplete, SETUP_PHASE_MS);
      return () => clearTimeout(done);
    }
    const next = setTimeout(() => setPhaseIndex((i) => i + 1), SETUP_PHASE_MS);
    return () => clearTimeout(next);
  }, [phaseIndex, phases.length, onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gradient-linkedin-soft px-6 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      data-testid="profile-setup-loading"
    >
      <div className="absolute inset-0 bg-grid mask-radial pointer-events-none" />

      <div className="relative flex flex-col items-center">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-display text-lg font-bold text-swiipr-gradient sm:text-xl">{BRAND.NAME}</span>
        </div>

        <SetupSpinner />

        <h1 className="mt-8 font-display text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
          {lang === "fr" ? "Tout est en cours de préparation" : "Setting up everything"}
        </h1>

        <div className="relative mt-2 h-6 w-full max-w-xs">
          <AnimatePresence mode="wait">
            <motion.p
              key={phase.sub}
              className="absolute inset-x-0 text-sm text-zinc-600"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              data-testid={`profile-setup-phase-${phaseIndex}`}
            >
              {phase.sub}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function PainTagPill({ point }) {
  const Icon = point.Icon;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white/95 px-3 py-1.5 text-[10px] font-medium text-zinc-500 shadow-sm sm:gap-2 sm:px-3.5 sm:py-2 sm:text-[11px]">
      <Icon className="h-3 w-3 shrink-0 text-zinc-400 sm:h-3.5 sm:w-3.5" strokeWidth={2} />
      <span>{point.label}</span>
    </span>
  );
}

const PAIN_MARQUEE_COPIES = 4;

function PainTagTrack({ tags, suffix, hidden = false }) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 pr-2"
      aria-hidden={hidden || undefined}
    >
      {tags.map((point, index) => (
        <PainTagPill key={`${point.id}-${suffix}-${index}`} point={point} />
      ))}
    </div>
  );
}

function ScrollingPainTagRow({ tags, reverse = false, duration = 30, delayOffset = 0 }) {
  if (!tags.length) return null;

  const delaySeconds = -(duration * delayOffset);

  return (
    <div className="pain-marquee-mask w-full overflow-hidden">
      <div
        className={`flex w-max flex-nowrap items-center ${reverse ? "pain-marquee-right" : "pain-marquee-left"}`}
        style={{
          animationDuration: `${duration}s`,
          animationDelay: `${delaySeconds}s`,
        }}
      >
        {Array.from({ length: PAIN_MARQUEE_COPIES }, (_, copy) => (
          <PainTagTrack
            key={copy}
            tags={tags}
            suffix={`c${copy}`}
            hidden={copy > 0}
          />
        ))}
      </div>
    </div>
  );
}

export function ProfileWelcomeStep({
  salaryMin,
  selectedRoles,
  categories,
  categoryOptions,
  interviewsPerWeek,
}) {
  const { lang } = useAppLocale();
  const items = buildProfileWelcomeItems({
    salaryMin,
    selectedRoles,
    categories,
    categoryOptions,
    interviewsPerWeek,
    lang,
  });

  return (
    <div className={`${ob.step} text-left`}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className={ob.title}>{lang === "fr" ? `Bienvenue sur ${BRAND.NAME} !` : `Welcome to ${BRAND.NAME}!`}</h1>
        <p className={`${ob.subtitle} mt-2`}>
          {lang === "fr" ? "Voici comment nous allons vous aider à réussir :" : "Based on your profile, here\u2019s how we\u2019ll help you succeed:"}
        </p>
      </motion.div>

      <motion.div
        className={`${ob.stepBody} justify-start space-y-2.5 overflow-y-auto sm:space-y-3`}
        variants={welcomeListReveal.container}
        initial="hidden"
        animate="visible"
      >
        {items.map((item, index) => (
          <motion.div
            key={item.title}
            variants={welcomeListReveal.item}
            className="rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 shadow-sm sm:px-5 sm:py-4"
            data-testid={`profile-welcome-item-${index + 1}`}
          >
            <p className="font-display text-[15px] font-bold leading-snug text-zinc-900 sm:text-base">
              {index + 1}. {item.title}
            </p>
            <p className={`mt-2 text-[13px] leading-relaxed sm:text-sm ${ob.muted}`}>
              {item.body}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

export function ShowcaseLandingStep() {
  const { lang } = useAppLocale();
  return (
    <div className={`${ob.step} min-h-0 items-center overflow-hidden text-center`}>
      <div className="mb-1.5 shrink-0 sm:mb-2">
        <div className="mb-1.5 flex items-center justify-center gap-2 sm:mb-2">
          <Logo size={24} />
          <span className="font-display text-base font-bold text-swiipr-gradient">{BRAND.NAME}</span>
        </div>

        <h1 className="mt-2 font-display text-lg font-bold leading-tight tracking-tight text-zinc-900 sm:text-xl">
          {lang === "fr" ? "Postulez en un swipe" : "Apply in one swipe"}
        </h1>
      </div>

      <div className="mt-1 flex min-h-0 flex-1 items-center justify-center sm:mt-1.5">
        <div className="relative left-1/2 flex h-full w-screen max-w-none -translate-x-1/2 items-center justify-center">
          <ShowcaseImage
            src={ONBOARDING_SHOWCASE_SCREENS.landing}
            alt="Swipe job feed"
            className="mx-0 h-full max-h-full w-full max-w-none drop-shadow-[0_20px_48px_-20px_rgba(124,58,237,0.18)]"
          />
        </div>
      </div>
    </div>
  );
}

export function ShowcaseAllInOneStep() {
  const { lang } = useAppLocale();
  const painPoints = lang === "fr" ? ONBOARDING_PAIN_POINTS_FR : ONBOARDING_PAIN_POINTS;
  const painRows = buildPainMarqueeRows(painPoints);

  return (
    <div className={`${ob.step} items-center text-center`}>
      <div className="mb-2 flex items-center justify-center gap-2">
        <Logo size={24} />
        <span className="font-display text-base font-bold text-swiipr-gradient">{BRAND.NAME}</span>
      </div>

      <h1 className="mt-2 font-display text-lg font-bold leading-tight tracking-tight text-zinc-900 sm:text-xl">
        {lang === "fr" ? "Tout au même endroit" : "All in one place"}
      </h1>
      <p className={`mt-1.5 max-w-sm px-2 text-sm leading-snug sm:text-base ${ob.muted}`}>
        {lang === "fr" ? "Conçu pour de vrais résultats : tout ce que votre recherche d\u2019emploi aurait dû être." : "Built for real results: everything your job search should\u2019ve been."}
      </p>

      <div className={`${ob.stepBody} flex min-h-0 flex-col items-center justify-center gap-2 overflow-hidden sm:gap-3`}>
        <div
          className="relative left-1/2 w-screen max-w-none shrink-0 -translate-x-1/2 space-y-1.5 sm:space-y-2"
          aria-hidden
        >
          {painRows.map((row, index) => (
            <ScrollingPainTagRow
              key={index}
              tags={row.tags}
              reverse={row.reverse}
              duration={row.duration}
              delayOffset={row.delayOffset}
            />
          ))}
        </div>

        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <ShowcaseImage
            src={ONBOARDING_SHOWCASE_SCREENS.allInOne}
            alt="Resume and cover letter"
            className="max-h-full w-full"
          />
        </div>
      </div>
    </div>
  );
}

export function ShowcasePricingStep({
  selectedPlan,
  onSelectPlan,
  onContinueCheckout,
  onInviteFriends,
  checkoutLoading = false,
  friendReferralEnrolling = false,
  redeemingAccessCode = false,
  saving = false,
}) {
  const { lang } = useAppLocale();
  const plans = getOnboardingPricingPlans(lang);
  const plan = plans.find((p) => p.id === selectedPlan) || plans[0];
  const actionsDisabled = checkoutLoading || redeemingAccessCode || saving || friendReferralEnrolling;

  return (
    <div className="grid h-full min-h-0 w-full min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <div className="shrink-0 text-center">
        <div className="mb-0.5 flex items-center justify-center gap-2">
          <Logo size={22} />
          <span className="font-display text-sm font-bold text-swiipr-gradient sm:text-base">{BRAND.NAME}</span>
        </div>
        <OnboardingValueTagline prominent className="mt-0.5 px-2" />
        <p className={`mt-0.5 text-xs font-medium ${ob.muted}`}>
          {lang === "fr" ? "Recherche d\u2019emploi tout-en-un." : "All-in-one job search."}
        </p>
      </div>

      <div className="relative -mx-4 flex min-h-0 w-[calc(100%+2rem)] items-end justify-center overflow-hidden sm:-mx-8 sm:w-[calc(100%+4rem)]">
        <div className="showcase-pricing-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative z-10 flex h-full w-full max-w-md items-end justify-center px-4 sm:px-8">
          <ShowcaseImage
            src={ONBOARDING_SHOWCASE_SCREENS.pricing}
            alt="Hirly inbox, swipe feed, and applications"
            className="mx-0 h-full max-h-full w-full object-contain object-bottom"
          />
        </div>
      </div>

      <div className="min-h-0 w-full min-w-0 shrink-0 pt-1">
        <div className="space-y-1.5">
          {plans.map((item) => {
            const on = selectedPlan === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectPlan(item.id)}
                className={`relative w-full rounded-xl border-2 px-2.5 py-1.5 text-left transition-all duration-200 ease-out sm:px-3 sm:py-2 ${
                  on
                    ? "border-violet-500 bg-gradient-to-br from-violet-50 via-fuchsia-50/70 to-violet-50 shadow-[0_0_0_1px_rgba(124,58,237,0.15)]"
                    : "border-zinc-200 bg-white hover:border-violet-200 hover:bg-violet-50/40"
                }`}
                data-testid={`pricing-plan-${item.id}`}
              >
                {item.badge ? (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full gradient-linkedin px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm">
                    {item.badge}
                  </span>
                ) : null}
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      on ? "border-violet-500 bg-violet-500 text-white" : "border-zinc-300 bg-white"
                    }`}
                  >
                    {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-zinc-900 sm:text-sm">{item.label}</p>
                    <p className={`text-[11px] sm:text-xs ${ob.muted}`}>{item.billed}</p>
                  </div>
                  <p className="shrink-0 text-xs font-bold text-zinc-900 sm:text-sm">
                    {item.weekly}
                    <span className={`block text-right text-[9px] font-medium ${ob.dim}`}>{lang === "fr" ? "/ semaine" : "/ week"}</span>
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <p className={`mt-1 text-center text-[10px] ${ob.dim}`}>{plan.footnote}</p>

        <div className="mt-1.5 space-y-2 pb-0.5 sm:pb-1">
          <button
            type="button"
            onClick={onContinueCheckout}
            disabled={actionsDisabled}
            data-testid="showcase-pricing-continue"
            className="w-full h-11 sm:h-12 rounded-full gradient-linkedin text-white font-bold text-sm sm:text-base disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shadow-[0_12px_40px_-12px_rgba(124,58,237,0.45)]"
          >
            {checkoutLoading
              ? (lang === "fr" ? "Ouverture du paiement..." : "Opening checkout...")
              : redeemingAccessCode || saving
                ? (lang === "fr" ? "Activation..." : "Activating...")
                : (lang === "fr" ? "Continuer" : "Continue")}
          </button>
          <button
            type="button"
            onClick={onInviteFriends}
            disabled={actionsDisabled}
            className="w-full h-11 sm:h-12 rounded-full border-2 border-violet-500 bg-white text-sm sm:text-base font-bold text-linkedin hover:bg-violet-50 transition-colors disabled:opacity-50"
            data-testid="showcase-pricing-friend-referral"
          >
            {friendReferralEnrolling
              ? (lang === "fr" ? "Préparation..." : "Preparing...")
              : (lang === "fr" ? `Inviter ${FRIEND_REFERRAL_GOAL} amis` : `Invite ${FRIEND_REFERRAL_GOAL} friends`)}
          </button>
          <p className={`text-center text-[10px] ${ob.dim}`}>
            {lang === "fr"
              ? `${FRIEND_REFERRAL_REWARD_CREDITS} candidatures offertes`
              : `${FRIEND_REFERRAL_REWARD_CREDITS} applications included`}
          </p>
        </div>
      </div>
    </div>
  );
}

export function FinishOnboardingButton({ saving, onClick }) {
  const { lang } = useAppLocale();
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
          {lang === "fr" ? "Démarrage…" : "Starting…"}
        </span>
      ) : (
        lang === "fr" ? "Commencer à swiper" : "Start swiping"
      )}
    </button>
  );
}
