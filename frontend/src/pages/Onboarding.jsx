import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { syncBillingAfterCheckout } from "../lib/billingSync";
import { stashCheckoutSessionId } from "../lib/pendingCheckout";
import {
  withDatafastAttribution,
  trackDatafastGoal,
  trackOnboardingContinue,
  trackOnboardingIntroContinue,
  trackOnboardingSkip,
} from "../lib/datafast";
import { shouldMockCvUpload, uploadProfileCv } from "../lib/demoCvUpload";
import {
  CV_ACCEPT_ATTR,
  CV_MAX_BYTES,
  CV_MAX_MB,
  isAcceptedCvFile,
  isLegacyDocFile,
} from "../lib/cvUploadFormats";
import { useAuth } from "../context/AuthContext";
import { useAppLocale } from "../context/AppLocaleContext";
import { Slider } from "../components/ui/slider";
import { FileText, Loader2, CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import PlacesAutocomplete from "../components/PlacesAutocomplete";
import { buildTypedLocationResult } from "../lib/locationSearch";
import { BRAND } from "../lib/brand";
import {
  ProfileSetupStep,
  ProfileWelcomeStep,
  ShowcaseLandingStep,
  ShowcaseAllInOneStep,
  ShowcasePricingStep,
} from "../components/onboarding/OnboardingFinalSteps";
import { startGoogleLogin } from "../lib/auth";
import OnboardingShell, { ContinueButton } from "../components/onboarding/OnboardingShell";
import OnboardingSignup from "../components/onboarding/OnboardingSignup";
import OnboardingIllustration from "../components/onboarding/OnboardingIllustration";
import SelectionCard from "../components/onboarding/SelectionCard";
import {
  InterviewRateChart,
  Compare2xChart,
  LongTermResultsChart,
  InterviewTargetDashes,
} from "../components/onboarding/OnboardingVisuals";
import OnboardingContactPhoneStep, {
  getContactPhoneCopy,
} from "../components/onboarding/OnboardingContactPhoneStep";
import {
  formatContactPhone,
  isValidContactPhone,
  parseStoredContactPhone,
} from "../lib/onboardingContactPhone";
import { getDefaultPhonePrefix, getDefaultPhoneCountryIso2 } from "../lib/phoneCountryCodes";
import { formatLocalPhoneDisplay } from "../lib/phoneLocalFormats";
import {
  getPendingFriendReferralCode,
  isFriendReferralCode,
  normalizeReferralCodeInput,
  redeemFriendReferralCode,
  storePendingFriendReferralCode,
  clearPendingFriendReferralCode,
  friendReferralValidationMessage,
  validateOnboardingReferralCode,
} from "../lib/friendReferral";
import { resolveLandingContractType } from "../lib/landingHeroCopy";
import {
  INTRO_SLIDES,
  INTRO_SLIDES_FR,
  ONBOARDING_STEP_ORDER,
  JOB_SEARCH_OPTIONS,
  JOB_SEARCH_OPTIONS_FR,
  EMPLOYMENT_TYPE_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS_FR,
  OTHER_APPS_OPTIONS,
  OTHER_APPS_OPTIONS_FR,
  JOB_GOAL_OPTIONS,
  JOB_GOAL_OPTIONS_FR,
  JOB_TIMELINE_OPTIONS,
  JOB_TIMELINE_OPTIONS_FR,
  JOB_BLOCKER_OPTIONS,
  JOB_BLOCKER_OPTIONS_FR,
  JOB_ACCOMPLISH_OPTIONS,
  JOB_ACCOMPLISH_OPTIONS_FR,
  JOB_CATEGORIES,
  EXPERIENCE_LEVELS,
  EXPERIENCE_LEVELS_FR,
  ATTRIBUTION_OPTIONS,
  ATTRIBUTION_OPTIONS_FR,
  formatSalary,
  interviewFeedback,
  rolesForCategories,
  iconForCategoryLabel,
  SUGGESTED_ONBOARDING_LOCATIONS,
  readOnboardingPreviewBoot,
} from "../components/onboarding/onboardingData";
import { devBypassAuth } from "../lib/dev";
import { splitFullName } from "../lib/personalInfoOptions";
import { ob } from "../components/onboarding/onboardingTheme";
import { trackEvent } from "../lib/analytics";
import {
  preloadOnboardingIntroImages,
  preloadOnboardingShowcaseImages,
} from "../lib/onboardingImagePreload";
import { translateOnboardingCategoryLabel } from "../lib/onboardingJobLabelsFr";
import { translateRoleLabel } from "../lib/localizedDisplay";
import {
  redeemCreatorInvite,
  storePendingInviteCode,
  clearPendingInviteCode,
} from "../lib/creatorInvite";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import { queueDemoWelcome } from "../lib/demoWelcome";
import { goToApp } from "../lib/appDomains";
import {
  applyOnboardingSnapshot,
  buildOnboardingExtrasPayload,
  ONBOARDING_TRANSIENT_STEPS,
  resolveOnboardingResumeStep,
} from "../lib/onboardingResume";

const STEP_ORDER = ONBOARDING_STEP_ORDER;
const ONBOARDING_CHECKOUT_STATE_KEY = "hirly.onboarding.checkoutState";
const ONBOARDING_STARTED_GOAL_KEY = "hirly.onboarding.startedGoal";
const isSixDigitAccessCode = (value) => /^\d{6}$/.test(String(value || "").trim());

const defaultCategoryOptions = () => JOB_CATEGORIES.map(({ id, label }) => ({ id, label }));

const chipReveal = {
  container: {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.03, delayChildren: 0.04 },
    },
  },
  item: {
    hidden: { opacity: 0, y: 10, scale: 0.97 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
    },
  },
};

const stepTitleClass = ob.title;
const stepSubtitleClass = ob.subtitle;

const slideVariants = {
  enter: { opacity: 0, x: 20 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
};

const stepMotion = {
  variants: slideVariants,
  initial: "enter",
  animate: "center",
  exit: "exit",
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
  className: ob.step,
};

const introSlideMotion = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1],
};

export default function Onboarding() {
  const _navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    user,
    hasProfile,
    hasPreferences,
    setHasProfile,
    setHasPreferences,
    checkAuth,
    setHasTrainingAccess,
    loading: authLoading,
  } = useAuth();
  const { lang, setLang } = useAppLocale();
  const introNavDirection = useRef(1);

  const [stepIndex, setStepIndex] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.stepIndex ?? 0,
  );
  const [introIndex, setIntroIndex] = useState(0);
  const [categories, setCategories] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.categories ?? [],
  );
  const [selectedRoles, setSelectedRoles] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.selectedRoles ?? [],
  );
  const [experience, setExperience] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.experience ?? null,
  );
  const [salaryMin, setSalaryMin] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.salaryMin ?? 50000,
  );
  const [salaryMax, setSalaryMax] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.salaryMax ?? 100000,
  );
  const [interviewsPerWeek, setInterviewsPerWeek] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.interviewsPerWeek ?? 4,
  );
  const [jobTimeline, setJobTimeline] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.jobTimeline ?? null,
  );
  const [jobBlocker, setJobBlocker] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.jobBlocker ?? null,
  );
  const [jobAccomplish, setJobAccomplish] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.jobAccomplish ?? null,
  );
  const [jobGoal, setJobGoal] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.jobGoal ?? null,
  );
  const [jobSearchStatus, setJobSearchStatus] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.jobSearchStatus ?? null,
  );
  const [onboardingLocation, setOnboardingLocation] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.onboardingLocation ?? "",
  );
  const [onboardingLocationData, setOnboardingLocationData] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.onboardingLocationData ?? null,
  );
  const [contractType, setContractType] = useState(() => {
    const bootType = readOnboardingPreviewBoot(STEP_ORDER)?.state?.contractType;
    if (bootType) return bootType;
    const params = new URLSearchParams(window.location.search);
    return resolveLandingContractType(params.get("contract") || params.get("type"));
  });
  const [triedOtherApps, setTriedOtherApps] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.triedOtherApps ?? null,
  );
  const [attribution, setAttribution] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.attribution ?? null,
  );
  const [referralCode, setReferralCode] = useState("");
  const [friendReferralRedeemed, setFriendReferralRedeemed] = useState(false);
  const [contactPhonePrefix, setContactPhonePrefix] = useState(() => getDefaultPhonePrefix(lang));
  const [contactPhoneCountryIso2, setContactPhoneCountryIso2] = useState(() =>
    getDefaultPhoneCountryIso2(lang),
  );
  const [contactPhoneLocal, setContactPhoneLocal] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [referralValidating, setReferralValidating] = useState(false);

  useEffect(() => {
    preloadOnboardingIntroImages();
    preloadOnboardingShowcaseImages();
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem(ONBOARDING_STARTED_GOAL_KEY)) return;
    sessionStorage.setItem(ONBOARDING_STARTED_GOAL_KEY, "1");
    trackEvent("onboarding_started");
    trackDatafastGoal("onboarding_started");
  }, []);

  useEffect(() => {
    const fromUrl = searchParams.get("referral");
    if (!fromUrl) return;
    const normalized = normalizeReferralCodeInput(fromUrl);
    if (!isFriendReferralCode(normalized)) return;
    setReferralCode(normalized);
    storePendingFriendReferralCode(normalized);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("referral");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const pending = getPendingFriendReferralCode();
    if (pending && isFriendReferralCode(pending)) {
      setReferralCode((current) => current || normalizeReferralCodeInput(pending));
    }
  }, []);

  const [suggestedCategories, setSuggestedCategories] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.suggestedCategories ?? [],
  );
  const [suggestedRoles, setSuggestedRoles] = useState([]);
  const [customRoles, setCustomRoles] = useState([]);
  const [customRoleDraft, setCustomRoleDraft] = useState("");
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [profile, setProfile] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState("quarterly");
  const [saving, setSaving] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [creatorAccessCode, setCreatorAccessCode] = useState("");
  const [redeemingAccessCode, setRedeemingAccessCode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pendingCheckoutSuccess, setPendingCheckoutSuccess] = useState(false);
  // 'finish' = Stripe cancel (complete setup); 'navigate' = reload after paywall.
  const [pendingEnterAppFromPaywall, setPendingEnterAppFromPaywall] = useState(null);
  const [enteringAppFromPaywall, setEnteringAppFromPaywall] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const resumeAppliedRef = useRef(false);
  const inputRef = useRef();
  const onboardingSaveRef = useRef({ pending: null, running: null });

  const handleContactPhoneCountryChange = ({ dial, iso2 }) => {
    setContactPhonePrefix(dial);
    setContactPhoneCountryIso2(iso2);
    setContactPhoneLocal((current) => formatLocalPhoneDisplay(current, iso2, dial));
  };

  useEffect(() => {
    const parsed = parseStoredContactPhone(profile?.contact?.phone, lang);
    if (!parsed.local) return;
    setContactPhonePrefix(parsed.prefix);
    setContactPhoneCountryIso2(parsed.iso2);
    setContactPhoneLocal(parsed.local);
  }, [profile?.contact?.phone, lang]);

  const step = STEP_ORDER[stepIndex];
  const slides = lang === "fr" ? INTRO_SLIDES_FR : INTRO_SLIDES;
  const progress =
    ((stepIndex + (step === "intro" ? (introIndex + 1) / slides.length : 1)) / STEP_ORDER.length) *
    100;

  const categoryOptions = useMemo(() => {
    const base = suggestedCategories.length
      ? suggestedCategories
      : JOB_CATEGORIES.map(({ id, label }) => ({ id, label }));
    if (lang !== "fr") return base;
    return base.map(({ id, label }) => ({
      id,
      label: translateOnboardingCategoryLabel(id, label, lang),
    }));
  }, [suggestedCategories, lang]);
  const roleSuggestions = useMemo(() => {
    const fromCategories = rolesForCategories(categories, 200, categoryOptions);
    const extras = customRoles.filter((role) => !fromCategories.includes(role));
    if (suggestedRoles.length) {
      const merged = [...suggestedRoles];
      for (const role of extras) {
        if (!merged.includes(role)) merged.push(role);
      }
      return merged;
    }
    return [...fromCategories, ...extras];
  }, [suggestedRoles, categories, categoryOptions, customRoles]);
  const interviewHint = interviewFeedback(interviewsPerWeek, lang);

  const restoreCheckoutState = (payload) => {
    if (!payload || typeof payload !== "object") return;
    if (Array.isArray(payload.categories)) setCategories(payload.categories);
    if (Array.isArray(payload.selectedRoles)) setSelectedRoles(payload.selectedRoles);
    if (payload.experience) setExperience(payload.experience);
    if (typeof payload.salaryMin === "number") setSalaryMin(payload.salaryMin);
    if (typeof payload.salaryMax === "number") setSalaryMax(payload.salaryMax);
    if (typeof payload.interviewsPerWeek === "number")
      setInterviewsPerWeek(payload.interviewsPerWeek);
    if (payload.jobTimeline) setJobTimeline(payload.jobTimeline);
    if (payload.jobBlocker) setJobBlocker(payload.jobBlocker);
    if (payload.jobAccomplish) setJobAccomplish(payload.jobAccomplish);
    if (payload.jobGoal) setJobGoal(payload.jobGoal);
    if (payload.jobSearchStatus) setJobSearchStatus(payload.jobSearchStatus);
    if (typeof payload.onboardingLocation === "string")
      setOnboardingLocation(payload.onboardingLocation);
    if (payload.onboardingLocationData) setOnboardingLocationData(payload.onboardingLocationData);
    if (payload.contractType) setContractType(payload.contractType);
    if (payload.triedOtherApps) setTriedOtherApps(payload.triedOtherApps);
    if (payload.attribution) setAttribution(payload.attribution);
    if (Array.isArray(payload.suggestedCategories))
      setSuggestedCategories(payload.suggestedCategories);
    if (payload.selectedPlan) setSelectedPlan(payload.selectedPlan);
    if (isSixDigitAccessCode(payload.creatorAccessCode))
      setCreatorAccessCode(payload.creatorAccessCode);
  };

  const getOnboardingExtrasPayload = useCallback(
    (lastStep, lastStepIndex) =>
      buildOnboardingExtrasPayload({
        jobSearchStatus,
        onboardingLocation,
        onboardingLocationData,
        contractType,
        triedOtherApps,
        categories,
        suggestedCategories,
        selectedRoles,
        experience,
        interviewsPerWeek,
        jobTimeline,
        jobBlocker,
        jobAccomplish,
        jobGoal,
        attribution,
        referralCode,
        salaryMin,
        salaryMax,
        selectedPlan,
        phone:
          formatContactPhone(contactPhonePrefix, contactPhoneLocal, contactPhoneCountryIso2) ||
          profile?.contact?.phone ||
          null,
        lastStep,
        lastStepIndex,
      }),
    [
      jobSearchStatus,
      onboardingLocation,
      onboardingLocationData,
      contractType,
      triedOtherApps,
      categories,
      suggestedCategories,
      selectedRoles,
      experience,
      interviewsPerWeek,
      jobTimeline,
      jobBlocker,
      jobAccomplish,
      jobGoal,
      attribution,
      referralCode,
      salaryMin,
      salaryMax,
      selectedPlan,
      contactPhonePrefix,
      contactPhoneLocal,
      contactPhoneCountryIso2,
      profile?.contact?.phone,
    ],
  );

  const enqueueOnboardingPatch = useCallback(async (payload) => {
    const state = onboardingSaveRef.current;
    state.pending = payload;
    while (state.pending || state.running) {
      if (!state.running) {
        state.running = (async () => {
          while (state.pending) {
            const latest = state.pending;
            state.pending = null;
            await api.patch("/profile/onboarding", latest);
          }
        })().finally(() => {
          state.running = null;
        });
      }
      try {
        await state.running;
      } catch (error) {
        // A newer full snapshot may have arrived while an older request was
        // failing. Drain that newer snapshot before returning to its caller.
        if (!state.pending) throw error;
      }
    }
  }, []);

  const persistOnboardingProgress = useCallback(
    async (nextStep, nextStepIndex) => {
      if (!user || ONBOARDING_TRANSIENT_STEPS.has(nextStep)) return;
      try {
        const roles = selectedRoles.map((role) => String(role || "").trim()).filter(Boolean);
        const experienceLevel = EXPERIENCE_LEVELS.find((entry) => entry.id === experience);
        await enqueueOnboardingPatch({
          onboarding: getOnboardingExtrasPayload(nextStep, nextStepIndex),
          preferences: {
            target_role: roles[0] || undefined,
            target_roles: roles,
            target_location:
              onboardingLocationData?.location_label || onboardingLocation || undefined,
            target_location_data: onboardingLocationData || undefined,
            contract_type: contractType || undefined,
            seniority: experienceLevel?.backend,
            remote_preference: "any",
          },
          contact: {
            location: onboardingLocationData?.location_label || onboardingLocation || undefined,
            location_data: onboardingLocationData || undefined,
          },
        });
      } catch (e) {
        console.warn("onboarding progress save skipped", e);
      }
    },
    [
      user,
      getOnboardingExtrasPayload,
      selectedRoles,
      onboardingLocation,
      onboardingLocationData,
      contractType,
      experience,
      enqueueOnboardingPatch,
    ],
  );

  const goToStepIndex = useCallback(
    (nextIndex) => {
      if (nextIndex < 0 || nextIndex >= STEP_ORDER.length) return;
      const nextStep = STEP_ORDER[nextIndex];
      void persistOnboardingProgress(nextStep, nextIndex);
      setStepIndex(nextIndex);
    },
    [persistOnboardingProgress],
  );

  // Persist the visible step after bootstrap so reload keeps the same screen.
  useEffect(() => {
    if (!user || authLoading || bootstrapping) return;
    if (!resumeAppliedRef.current) return;
    const currentStep = STEP_ORDER[stepIndex];
    if (!currentStep || ONBOARDING_TRANSIENT_STEPS.has(currentStep)) return;
    void persistOnboardingProgress(currentStep, stepIndex);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (next.get("step") === currentStep) return prev;
        next.set("step", currentStep);
        return next;
      },
      { replace: true },
    );
  }, [user, stepIndex, authLoading, bootstrapping, persistOnboardingProgress, setSearchParams]);

  // Save referral code draft while the user types (reload should not lose it).
  useEffect(() => {
    if (step !== "referralCode" || !user || bootstrapping || !resumeAppliedRef.current) return;
    const timer = window.setTimeout(() => {
      void persistOnboardingProgress("referralCode", STEP_ORDER.indexOf("referralCode"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [step, user, bootstrapping, persistOnboardingProgress]);

  useEffect(
    () => {
      const preview = searchParams.get("preview");
      const stepParam = searchParams.get("step");
      const checkoutStatus = searchParams.get("checkout");

      if (checkoutStatus) {
        const checkoutSessionId = searchParams.get("session_id");
        try {
          restoreCheckoutState(
            JSON.parse(sessionStorage.getItem(ONBOARDING_CHECKOUT_STATE_KEY) || "null"),
          );
        } catch (_) {
          /* ignore corrupt checkout state */
        }
        if (checkoutStatus === "success") {
          setSearchParams({}, { replace: true });
          setPendingCheckoutSuccess(true);
          if (checkoutSessionId) {
            sessionStorage.setItem("hirly.onboarding.checkoutSessionId", checkoutSessionId);
            stashCheckoutSessionId(checkoutSessionId);
          }
          resumeAppliedRef.current = true;
          setBootstrapping(false);
        } else {
          // Stripe back/cancel: skip paywall and enter the app (onboarding already reached pricing).
          setSearchParams({}, { replace: true });
          setPendingEnterAppFromPaywall("finish");
        }
        resumeAppliedRef.current = true;
        setBootstrapping(false);
        return;
      }

      if (preview) {
        const boot = readOnboardingPreviewBoot(STEP_ORDER);
        if (boot) {
          setStepIndex(boot.stepIndex);
          if (boot.state) {
            setCategories(boot.state.categories);
            setSelectedRoles(boot.state.selectedRoles);
            setExperience(boot.state.experience);
            setSalaryMin(boot.state.salaryMin);
            setSalaryMax(boot.state.salaryMax);
            setInterviewsPerWeek(boot.state.interviewsPerWeek);
            setJobTimeline(boot.state.jobTimeline);
            setJobBlocker(boot.state.jobBlocker);
            setJobAccomplish(boot.state.jobAccomplish);
            setJobGoal(boot.state.jobGoal);
            setJobSearchStatus(boot.state.jobSearchStatus);
            setOnboardingLocation(boot.state.onboardingLocation);
            setOnboardingLocationData(boot.state.onboardingLocationData);
            setContractType(boot.state.contractType);
            setTriedOtherApps(boot.state.triedOtherApps);
            setAttribution(boot.state.attribution);
            setSuggestedCategories(boot.state.suggestedCategories);
            if (boot.state.selectedPlan) setSelectedPlan(boot.state.selectedPlan);
          }
        }
        resumeAppliedRef.current = true;
        setBootstrapping(false);
        if (!devBypassAuth && stepParam && stepParam !== "intro") {
          setSearchParams({}, { replace: true });
        }
        return;
      }
    },
    // biome-ignore lint/correctness/useExhaustiveDependencies: Checkout restore is intentionally keyed to the URL state.
    [searchParams, setSearchParams, restoreCheckoutState],
  );

  useEffect(() => {
    if (authLoading || resumeAppliedRef.current) return;
    if (searchParams.get("checkout") || searchParams.get("preview")) return;

    const stepParam = searchParams.get("step");
    let cancelled = false;

    const bootstrapOnboarding = async () => {
      if (devBypassAuth && stepParam && STEP_ORDER.includes(stepParam)) {
        const boot = readOnboardingPreviewBoot(STEP_ORDER);
        if (boot) {
          setStepIndex(boot.stepIndex);
          if (boot.state) {
            restoreCheckoutState(boot.state);
          }
          resumeAppliedRef.current = true;
          setBootstrapping(false);
          return;
        }
      }

      if (user?.demo_account) {
        goToApp("/swipe");
        resumeAppliedRef.current = true;
        setBootstrapping(false);
        return;
      }

      // Drop stale demo/creator invite codes — normal onboarding must not
      // inherit a link visited earlier in the same browser.
      clearPendingInviteCode();

      if (user && hasProfile && hasPreferences) {
        goToApp("/swipe");
        resumeAppliedRef.current = true;
        setBootstrapping(false);
        return;
      }

      if (!user) {
        resumeAppliedRef.current = true;
        setBootstrapping(false);
        return;
      }

      try {
        const { data: profileData } = await api.get("/profile");
        if (cancelled) return;

        applyOnboardingSnapshot(profileData?.extras?.onboarding, profileData, {
          setCategories,
          setSelectedRoles,
          setExperience,
          setSalaryMin,
          setSalaryMax,
          setInterviewsPerWeek,
          setJobTimeline,
          setJobBlocker,
          setJobAccomplish,
          setJobGoal,
          setJobSearchStatus,
          setOnboardingLocation,
          setOnboardingLocationData,
          setContractType,
          setTriedOtherApps,
          setAttribution,
          setSuggestedCategories,
          setSelectedPlan,
          setReferralCode,
          setProfile,
        });

        const resumeStep = resolveOnboardingResumeStep({
          stepParam,
          onboarding: profileData?.extras?.onboarding,
          profile: profileData,
          user,
        });

        // Once the user has reached the paywall, reload should enter the app —
        // not re-show pricing. Mid-funnel users (last_step before pricing) stay put.
        if (profileData?.extras?.onboarding?.last_step === "showcasePricing") {
          setPendingEnterAppFromPaywall("navigate");
          resumeAppliedRef.current = true;
          setBootstrapping(false);
          return;
        }

        setStepIndex(STEP_ORDER.indexOf(resumeStep));

        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("step", resumeStep);
            return next;
          },
          { replace: true },
        );
      } catch {
        if (!cancelled && user) {
          const fallbackStep =
            stepParam && STEP_ORDER.includes(stepParam) ? stepParam : "jobSearch";
          setStepIndex(STEP_ORDER.indexOf(fallbackStep));
        }
      } finally {
        if (!cancelled) {
          resumeAppliedRef.current = true;
          setBootstrapping(false);
        }
      }
    };

    void bootstrapOnboarding();
    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user,
    hasProfile,
    hasPreferences,
    searchParams,
    setSearchParams,
    // biome-ignore lint/correctness/useExhaustiveDependencies: Bootstrap deliberately follows the URL restore lifecycle.
    restoreCheckoutState,
  ]);

  useEffect(() => {
    if (!user || step !== "signup") return;
    setStepIndex(STEP_ORDER.indexOf("jobSearch"));
  }, [user, step]);

  // After a successful Stripe checkout Stripe redirects back here with
  // ?checkout=success. Once the auth state is ready (user resolved) we confirm
  // billing server-side, then finish onboarding and navigate to the app with
  // checkout params so the app subdomain can sync credits too if needed.
  useEffect(
    () => {
      if (!pendingCheckoutSuccess) return;
      if (!user) return; // wait until auth resolves
      setPendingCheckoutSuccess(false);
      setCheckoutLoading(true);
      const sessionId = sessionStorage.getItem("hirly.onboarding.checkoutSessionId") || undefined;
      let cancelled = false;

      (async () => {
        try {
          await syncBillingAfterCheckout({ sessionId, maxAttempts: 15, delayMs: 1500 });
        } catch (_) {
          /* polling fallback already handled in syncBillingAfterCheckout */
        } finally {
          sessionStorage.removeItem("hirly.onboarding.checkoutSessionId");
        }
        if (cancelled) return;
        const checkoutSearch = sessionId
          ? `?upgrade=success&session_id=${encodeURIComponent(sessionId)}`
          : "?upgrade=success";
        await finishOnboarding(checkoutSearch);
        if (!cancelled) setCheckoutLoading(false);
      })();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    // biome-ignore lint/correctness/noInvalidUseBeforeDeclaration: The callback is initialized before effects run after render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: Checkout completion deliberately follows redirect state.
    [pendingCheckoutSuccess, user, finishOnboarding],
  );

  // Stripe cancel/back or reload after reaching the paywall → enter app.
  useEffect(
    () => {
      if (!pendingEnterAppFromPaywall) return;
      if (!user) return;
      const mode = pendingEnterAppFromPaywall;
      setPendingEnterAppFromPaywall(null);
      setEnteringAppFromPaywall(true);
      let cancelled = false;
      (async () => {
        if (mode === "navigate" && hasProfile && hasPreferences) {
          goToApp("/swipe");
        } else {
          await finishOnboarding();
        }
        if (!cancelled) setEnteringAppFromPaywall(false);
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    // biome-ignore lint/correctness/noInvalidUseBeforeDeclaration: The callback is initialized before effects run after render.
    // biome-ignore lint/correctness/useExhaustiveDependencies: Paywall exit deliberately follows redirect state.
    [pendingEnterAppFromPaywall, user, hasProfile, hasPreferences, finishOnboarding],
  );

  useEffect(() => {
    if (step !== "categories" || !contractType) return;
    const items = defaultCategoryOptions();
    setSuggestedCategories(items);
    setCategories((prev) => prev.filter((id) => items.some((c) => c.id === id)));
  }, [step, contractType]);

  const goNext = () => {
    if (step === "intro") {
      if (introIndex < slides.length - 1) {
        introNavDirection.current = 1;
        setIntroIndex((i) => i + 1);
        return;
      }
    }
    // Auto-create a typed location when the user continues without picking from the list
    if (
      step === "location" &&
      onboardingLocation.trim() &&
      !onboardingLocationData?.location_label
    ) {
      const typed = buildTypedLocationResult(onboardingLocation.trim());
      if (typed[0]) {
        setOnboardingLocationData({
          location_label: typed[0].label,
          place_id: "",
          country: "",
          country_code: "",
          lat: null,
          lng: null,
          source: "typed",
          kind: "city",
        });
      }
    }
    if (stepIndex < STEP_ORDER.length - 1) goToStepIndex(stepIndex + 1);
  };

  const goBack = () => {
    if (step === "intro" && introIndex > 0) {
      introNavDirection.current = -1;
      setIntroIndex((i) => i - 1);
      return;
    }
    if (stepIndex > 0) {
      const prev = stepIndex - 1;
      setStepIndex(prev);
      if (STEP_ORDER[prev] === "intro") setIntroIndex(slides.length - 1);
    }
  };

  const toggleCategory = (id) => {
    setCategories((prev) => {
      let next;
      if (prev.includes(id)) next = prev.filter((c) => c !== id);
      else if (prev.length >= 3) {
        toast.message(
          lang === "fr" ? "Choisissez jusqu'à 3 catégories" : "Pick up to 3 categories",
        );
        return prev;
      } else next = [...prev, id];

      const options = suggestedCategories.length ? suggestedCategories : defaultCategoryOptions();
      const available = new Set([...rolesForCategories(next, 200, options), ...customRoles]);
      setSelectedRoles((roles) => roles.filter((role) => available.has(role)));
      setSuggestedRoles([]);
      return next;
    });
  };

  const addCustomRole = () => {
    const role = customRoleDraft.trim();
    if (!role) return;
    if (selectedRoles.length >= 3) {
      toast.message(lang === "fr" ? "Choisissez jusqu'à 3 postes" : "Pick up to 3 roles");
      return;
    }
    if (!selectedRoles.includes(role)) {
      setSelectedRoles((prev) => [...prev, role]);
      setCustomRoles((prev) => (prev.includes(role) ? prev : [...prev, role]));
    }
    setCustomRoleDraft("");
  };

  const toggleRole = (role) => {
    setSelectedRoles((prev) => {
      if (prev.includes(role)) return prev.filter((r) => r !== role);
      if (prev.length >= 3) {
        toast.message(lang === "fr" ? "Choisissez jusqu'à 3 postes" : "Pick up to 3 roles");
        return prev;
      }
      return [...prev, role];
    });
  };

  const handleUpload = async (f) => {
    if (!f) return;
    if (isLegacyDocFile(f)) {
      toast.error(
        lang === "fr"
          ? "Les fichiers .doc ne sont pas pris en charge. Réenregistrez votre CV en PDF ou DOCX."
          : "Legacy .doc files aren't supported. Please re-save your resume as PDF or DOCX.",
      );
      return;
    }
    if (!isAcceptedCvFile(f)) {
      toast.error(
        lang === "fr"
          ? "Importez un PDF, DOCX, RTF, TXT ou une image."
          : "Please upload a PDF, DOCX, RTF, TXT, or image resume",
      );
      return;
    }
    if (f.size > CV_MAX_BYTES) {
      toast.error(
        lang === "fr"
          ? `Le fichier doit faire ${CV_MAX_MB} Mo ou moins.`
          : `File must be ${CV_MAX_MB}MB or smaller.`,
      );
      return;
    }
    if (!user && !shouldMockCvUpload()) {
      toast.error(
        lang === "fr"
          ? "Connectez-vous avec Google pour importer votre CV"
          : "Sign in with Google to upload your resume",
      );
      return;
    }
    setFile(f);
    setParsing(true);
    trackEvent("cv_upload_started", { source: "onboarding" });
    preloadOnboardingShowcaseImages();

    const CV_PARSE_UI_MAX_MS = 3000;
    let advanced = false;

    const advanceAfterUpload = () => {
      if (advanced) return;
      advanced = true;
      setParsing(false);
      trackOnboardingContinue("upload");
      setStepIndex(STEP_ORDER.indexOf("profileSetup"));
    };

    const uploadTask = (async () => {
      try {
        const { data } = await uploadProfileCv(f, api);
        setProfile(data);
        trackEvent("cv_upload_completed", { source: "onboarding" });
        if (!shouldMockCvUpload()) {
          const { data: authState } = await api.get("/auth/me");
          setHasProfile(Boolean(authState?.has_profile));
          if (checkAuth) await checkAuth();
          toast.success(lang === "fr" ? "Votre profil est prêt" : "Your profile is ready");
        } else {
          setHasProfile(true);
        }
        if (!advanced) {
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          advanceAfterUpload();
        }
      } catch (e) {
        console.error(e);
        trackEvent("cv_upload_failed", {
          source: "onboarding",
          message: e?.response?.data?.detail || e?.message,
        });
        if (!shouldMockCvUpload()) {
          toast.error(
            e?.response?.data?.detail ||
              (lang === "fr" ? "Échec de l'analyse du CV" : "Failed to parse CV"),
          );
        }
        if (!advanced) {
          setParsing(false);
        } else if (!shouldMockCvUpload()) {
          // The auto-advance timer already moved the user forward before the
          // upload actually failed — send them back to retry instead of
          // silently leaving them on a step with no real profile.
          setFile(null);
          setParsing(false);
          setStepIndex(STEP_ORDER.indexOf("upload"));
        }
      }
    })();

    setTimeout(() => {
      advanceAfterUpload();
    }, CV_PARSE_UI_MAX_MS);

    await uploadTask;
  };

  const saveContactPhone = async () => {
    const formatted = formatContactPhone(
      contactPhonePrefix,
      contactPhoneLocal,
      contactPhoneCountryIso2,
    );
    if (!formatted) return true;
    setSavingPhone(true);
    try {
      await api.put("/profile/contact", { phone: formatted });
      await api.patch("/profile/extras", {
        onboarding: getOnboardingExtrasPayload(step, stepIndex),
      });
      setProfile((prev) => ({
        ...(prev || {}),
        contact: { ...(prev?.contact || {}), phone: formatted },
      }));
      return true;
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          (lang === "fr" ? "Impossible d'enregistrer le numéro" : "Could not save phone number"),
      );
      return false;
    } finally {
      setSavingPhone(false);
    }
  };

  const redeemAccessCodeIfPresent = async () => {
    const code = creatorAccessCode.trim();
    if (!isSixDigitAccessCode(code)) return true;

    setRedeemingAccessCode(true);
    try {
      const redeemed = await redeemCreatorInvite(api, code, {
        plan: selectedPlan,
        interval: selectedPlan,
        source: "onboarding",
      });
      if (redeemed?.demo_account) {
        setDemoAccountFromUser({ ...user, demo_account: true });
        queueDemoWelcome();
      }
      if (redeemed?.training_access) {
        setHasTrainingAccess(true);
      }
      toast.success(
        redeemed?.master_code
          ? lang === "fr"
            ? "Plan test activé"
            : "Test plan activated"
          : lang === "fr"
            ? "Accès créateur activé"
            : "Creator access activated",
      );
      return true;
    } catch (inviteErr) {
      toast.error(
        inviteErr?.response?.data?.detail ||
          (lang === "fr"
            ? "Impossible d'activer le code d'accès"
            : "Could not activate access code"),
      );
      return false;
    } finally {
      setRedeemingAccessCode(false);
    }
  };

  const redeemFriendReferralIfPresent = async () => {
    // Already redeemed right when the code was submitted on the
    // referralCode step -- nothing left to do here.
    if (friendReferralRedeemed) return true;
    const code = referralCode.trim().toUpperCase();
    // Friend-referral codes are also 6 digits now, the same shape as
    // creator/demo access codes -- try friend-referral first since that's
    // the common case for regular users, not just when the shape looks
    // like the old 4-8-char free text codes.
    if (!code || !isFriendReferralCode(code)) return true;
    try {
      await redeemFriendReferralCode(code);
      clearPendingFriendReferralCode();
      // It redeemed as a real referral code -- don't also let
      // redeemAccessCodeIfPresent try the same value as a creator/demo
      // invite code afterwards.
      setCreatorAccessCode("");
      setFriendReferralRedeemed(true);
      return true;
    } catch (err) {
      const detail = err?.response?.data?.detail;
      // Already redeemed earlier this session (e.g. a reload re-ran this
      // fallback) -- treat as success rather than blocking onboarding.
      if (detail === "You have already used a friend referral code") {
        clearPendingFriendReferralCode();
        setFriendReferralRedeemed(true);
        return true;
      }
      // Not a recognized referral code -- if it's also shaped like a
      // 6-digit creator/demo invite code, let redeemAccessCodeIfPresent
      // try that instead rather than blocking onboarding on this specific
      // rejection.
      if (detail === "Referral code not found" && isSixDigitAccessCode(code)) {
        return true;
      }
      toast.error(
        detail || (lang === "fr" ? "Code de parrainage invalide" : "Invalid referral code"),
      );
      return false;
    }
  };

  const finishOnboarding = async (checkoutReturnSearch = "") => {
    if (!user) {
      await startGoogleLogin("/onboarding?step=showcasePricing");
      return;
    }
    setSaving(true);
    try {
      if (!(await redeemFriendReferralIfPresent())) {
        setSaving(false);
        return;
      }
      if (!(await redeemAccessCodeIfPresent())) {
        setSaving(false);
        return;
      }
      const nameParts = splitFullName(user?.name || profile?.contact?.name || "");
      const formattedPhone =
        formatContactPhone(contactPhonePrefix, contactPhoneLocal, contactPhoneCountryIso2) ||
        profile?.contact?.phone ||
        undefined;
      const experienceLevel = EXPERIENCE_LEVELS.find((entry) => entry.id === experience);
      await enqueueOnboardingPatch({
        onboarding: getOnboardingExtrasPayload(step, stepIndex),
        preferences: {
          target_role: selectedRoles[0] || undefined,
          target_roles: selectedRoles,
          target_location:
            onboardingLocationData?.location_label || onboardingLocation || undefined,
          target_location_data: onboardingLocationData || undefined,
          contract_type: contractType || undefined,
          seniority: experienceLevel?.backend,
          remote_preference: "any",
        },
        contact: {
          first_name: nameParts.first_name || undefined,
          last_name: nameParts.last_name || undefined,
          location: onboardingLocationData?.location_label || onboardingLocation || undefined,
          location_data: onboardingLocationData || undefined,
          phone: formattedPhone,
        },
      });
      if (checkAuth) await checkAuth();
      clearPendingInviteCode();
      sessionStorage.removeItem(ONBOARDING_CHECKOUT_STATE_KEY);
      setHasProfile(true);
      setHasPreferences(true);
      trackEvent("onboarding_completed", {
        selected_roles: selectedRoles,
        target_location: onboardingLocationData?.location_label || onboardingLocation || "",
      });
      trackDatafastGoal("onboarding_completed", {
        plan: selectedPlan,
        target_location: onboardingLocationData?.location_label || onboardingLocation || "",
      });
      goToApp("/swipe", checkoutReturnSearch);
    } catch {
      toast.error(lang === "fr" ? "Échec de la configuration" : "Failed to finish setup");
    } finally {
      setSaving(false);
    }
  };

  const startOnboardingCheckout = async () => {
    trackOnboardingContinue("showcasePricing", { plan: selectedPlan });
    if (!user) {
      await startGoogleLogin("/onboarding?step=showcasePricing");
      return;
    }
    if (isSixDigitAccessCode(creatorAccessCode)) {
      setCheckoutLoading(true);
      try {
        await finishOnboarding();
      } finally {
        setCheckoutLoading(false);
      }
      return;
    }
    setCheckoutLoading(true);
    try {
      await persistOnboardingProgress("showcasePricing", STEP_ORDER.indexOf("showcasePricing"));
      sessionStorage.setItem(
        ONBOARDING_CHECKOUT_STATE_KEY,
        JSON.stringify({
          categories,
          selectedRoles,
          experience,
          salaryMin,
          salaryMax,
          interviewsPerWeek,
          jobTimeline,
          jobBlocker,
          jobAccomplish,
          jobGoal,
          jobSearchStatus,
          onboardingLocation,
          onboardingLocationData,
          contractType,
          triedOtherApps,
          attribution,
          suggestedCategories,
          selectedPlan,
          creatorAccessCode,
        }),
      );
      const { data } = await api.post(
        "/billing/create-checkout-session",
        withDatafastAttribution({
          plan: selectedPlan,
          interval: selectedPlan,
          source: "onboarding",
        }),
      );
      if (!data?.url) throw new Error("Missing checkout URL");
      trackEvent("checkout_started", { source: "onboarding", plan: selectedPlan });
      trackDatafastGoal("onboarding_checkout_started", { plan: selectedPlan });
      window.location.href = data.url;
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not start checkout");
    } finally {
      setCheckoutLoading(false);
    }
  };

  const canContinue = () => {
    switch (step) {
      case "intro":
        return true;
      case "signup":
        return !!user;
      case "jobSearch":
        return !!jobSearchStatus;
      case "location":
        if (!onboardingLocation.trim()) return false;
        // Allow free-form text — we'll create a typed location if nothing was picked
        return true;
      case "contractType":
        return !!contractType;
      case "otherApps":
        return !!triedOtherApps;
      case "categories":
        return categories.length > 0 && selectedRoles.length > 0;
      case "experience":
        return !!experience;
      case "salary":
        return salaryMin <= salaryMax;
      case "interviews":
        return interviewsPerWeek >= 1;
      case "jobTimeline":
        return !!jobTimeline;
      case "interviewsConfirm":
      case "potentialChart":
      case "compare2x":
      case "longTerm":
        return true;
      case "jobBlocker":
        return !!jobBlocker;
      case "jobAccomplish":
        return !!jobAccomplish;
      case "jobGoal":
        return !!jobGoal;
      case "attribution":
        return !!attribution;
      case "referralCode":
        return true;
      case "contactPhone":
        return isValidContactPhone(contactPhoneLocal, contactPhoneCountryIso2, contactPhonePrefix);
      case "upload":
        return !parsing;
      case "profileSetup":
      case "profileWelcome":
      case "showcaseLanding":
      case "showcaseAllInOne":
      case "showcasePricing":
        return true;
      default:
        return false;
    }
  };

  const skipStep = () => {
    trackOnboardingSkip(step);
    goNext();
  };

  const submitReferralCode = async () => {
    const code = referralCode.trim();
    if (!code) {
      toast.error(
        lang === "fr"
          ? "Entrez un code de parrainage ou appuyez sur Passer"
          : "Enter a referral code or tap Skip",
      );
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      toast.error(friendReferralValidationMessage("invalid_format", lang));
      return;
    }

    setReferralValidating(true);
    try {
      const result = await validateOnboardingReferralCode(code);
      if (!result.valid) {
        toast.error(friendReferralValidationMessage(result.reason, lang));
        return;
      }

      if (result.kind === "friend") {
        // Redeem right away -- the reward is earned the moment a friend
        // signs up, not only once they finish the whole onboarding flow
        // (which can be minutes later, or never, if they abandon before
        // paying).
        try {
          await redeemFriendReferralCode(code);
          setFriendReferralRedeemed(true);
          clearPendingFriendReferralCode();
        } catch (err) {
          toast.error(
            err?.response?.data?.detail || friendReferralValidationMessage("not_found", lang),
          );
          return;
        }
        setReferralCode(code);
        setCreatorAccessCode("");
        clearPendingInviteCode();
        toast.success(lang === "fr" ? "Code de parrainage appliqué" : "Referral code applied");
      } else {
        setReferralCode("");
        setCreatorAccessCode(code);
        storePendingInviteCode(code);
        clearPendingFriendReferralCode();
        toast.success(lang === "fr" ? "Code d'accès valide" : "Access code accepted");
      }
      trackOnboardingContinue("referralCode");
      goNext();
    } catch (err) {
      toast.error(
        err?.response?.data?.detail || friendReferralValidationMessage("not_found", lang),
      );
    } finally {
      setReferralValidating(false);
    }
  };

  const submitContactPhone = async () => {
    if (!isValidContactPhone(contactPhoneLocal, contactPhoneCountryIso2, contactPhonePrefix)) {
      toast.error(lang === "fr" ? "Entrez un numéro valide" : "Enter a valid phone number");
      return;
    }
    if (!(await saveContactPhone())) return;
    trackEvent("onboarding_step_completed", { step: "contactPhone", step_index: stepIndex });
    trackOnboardingContinue("contactPhone");
    goNext();
  };

  const onContinue = () => {
    if (step === "contactPhone") {
      void submitContactPhone();
      return;
    }
    if (step === "upload" && !file) {
      inputRef.current?.click();
      return;
    }

    trackEvent("onboarding_step_completed", { step, step_index: stepIndex });
    const continueParams =
      step === "intro"
        ? { intro_slide: String(introIndex), intro_total: String(slides.length) }
        : { step_index: String(stepIndex) };
    if (step === "intro") {
      trackOnboardingIntroContinue(introIndex, slides.length, continueParams);
    } else {
      trackOnboardingContinue(step, continueParams);
    }
    if (step === "intro" && introIndex === slides.length - 1) {
      goToStepIndex(STEP_ORDER.indexOf("signup"));
      return;
    }
    if (step === "signup") {
      goToStepIndex(STEP_ORDER.indexOf("jobSearch"));
      return;
    }
    goNext();
  };

  const isLastIntroSlide = step === "intro" && introIndex === slides.length - 1;
  const hideFooter =
    parsing ||
    step === "profileSetup" ||
    (step === "signup" && !user) ||
    step === "showcasePricing";

  const footer = !hideFooter ? (
    step === "profileWelcome" ? (
      <ContinueButton onClick={onContinue} testId="profile-welcome-continue">
        {lang === "fr" ? "Continuer" : "Continue"}
      </ContinueButton>
    ) : step === "showcaseLanding" || step === "showcaseAllInOne" ? (
      <ContinueButton onClick={onContinue} disabled={!canContinue() || parsing}>
        {lang === "fr" ? "Continuer" : "Continue"}
      </ContinueButton>
    ) : step === "contactPhone" ? (
      <div className="space-y-2.5">
        <ContinueButton
          onClick={submitContactPhone}
          disabled={!canContinue() || savingPhone}
          testId="contact-phone-continue"
        >
          {savingPhone
            ? lang === "fr"
              ? "Enregistrement..."
              : "Saving..."
            : lang === "fr"
              ? "Continuer"
              : "Continue"}
        </ContinueButton>
        <button
          type="button"
          onClick={skipStep}
          className="w-full h-11 sm:h-12 rounded-full border border-zinc-200 bg-white text-sm sm:text-base font-semibold text-linkedin hover:bg-violet-50 transition-colors"
          data-testid="contact-phone-skip"
        >
          {lang === "fr" ? "Passer pour l'instant" : "Skip for now"}
        </button>
      </div>
    ) : step === "referralCode" ? (
      <div className="space-y-2.5">
        <ContinueButton
          onClick={() => {
            void submitReferralCode();
          }}
          disabled={!referralCode.trim() || referralValidating}
          testId="referral-submit"
        >
          {referralValidating
            ? lang === "fr"
              ? "Vérification..."
              : "Checking..."
            : lang === "fr"
              ? "Valider"
              : "Submit"}
        </ContinueButton>
        <button
          type="button"
          onClick={skipStep}
          className="w-full h-11 sm:h-12 rounded-full border border-zinc-200 bg-white text-sm sm:text-base font-semibold text-linkedin hover:bg-violet-50 transition-colors"
          data-testid="referral-skip"
        >
          {lang === "fr" ? "Passer" : "Skip"}
        </button>
      </div>
    ) : step === "contractType" || step === "categories" ? (
      <div className="space-y-2.5">
        <ContinueButton onClick={onContinue} disabled={!canContinue() || parsing}>
          {lang === "fr" ? "Continuer" : "Continue"}
        </ContinueButton>
        <button
          type="button"
          onClick={skipStep}
          className="w-full h-11 sm:h-12 rounded-full border border-zinc-200 bg-white text-sm sm:text-base font-semibold text-linkedin hover:bg-violet-50 transition-colors"
          data-testid={step === "categories" ? "categories-skip" : "contract-type-skip"}
        >
          {lang === "fr" ? "Passer" : "Skip"}
        </button>
      </div>
    ) : (
      <ContinueButton onClick={onContinue} disabled={!canContinue() || parsing}>
        {isLastIntroSlide
          ? lang === "fr"
            ? "Commencer"
            : "Get Started"
          : step === "intro"
            ? lang === "fr"
              ? "Continuer"
              : "Continue"
            : step === "signup"
              ? lang === "fr"
                ? "Continuer"
                : "Continue"
              : step === "upload" && !file
                ? lang === "fr"
                  ? "Importer le CV"
                  : "Upload resume"
                : lang === "fr"
                  ? "Continuer"
                  : "Continue"}
      </ContinueButton>
    )
  ) : null;

  if (bootstrapping || pendingEnterAppFromPaywall || enteringAppFromPaywall) {
    // Keep the same neutral loading screen through the paywall → app hand-off
    // (Stripe cancel/back, or reload after reaching pricing) instead of
    // flashing the onboarding intro step behind it while we navigate.
    return (
      <div className="grid min-h-dvh place-items-center bg-white">
        <Loader2
          className="h-6 w-6 animate-spin text-zinc-400"
          data-testid="onboarding-bootstrap-loading"
        />
      </div>
    );
  }

  return (
    <>
      {step === "signup" && !user ? (
        <OnboardingSignup onClose={goBack} lang={lang} />
      ) : (
        <OnboardingShell
          progress={progress}
          onBack={goBack}
          ambientClassName={step === "showcaseLanding" ? "showcase-landing-ambient" : undefined}
          showBack={(stepIndex > 0 || introIndex > 0) && step !== "profileSetup"}
          showProgress={
            step !== "intro" &&
            step !== "profileSetup" &&
            step !== "profileWelcome" &&
            step !== "showcaseLanding" &&
            step !== "showcaseAllInOne" &&
            step !== "showcasePricing"
          }
          footer={parsing ? null : footer}
        >
          {step !== "signup" && (
            <button
              type="button"
              onClick={() => setLang(lang === "fr" ? "en" : "fr")}
              className="fixed top-3 right-3 z-50 text-xs font-semibold px-3 py-1.5 rounded-full border border-zinc-200 bg-white/90 text-zinc-600 hover:border-linkedin hover:text-linkedin transition-colors shadow-sm backdrop-blur-sm"
              aria-label="Switch language"
            >
              {lang === "fr" ? "EN" : "FR"}
            </button>
          )}
          <AnimatePresence mode="wait">
            {step === "intro" && (
              <div className={`${ob.step} items-center justify-center text-center`}>
                <div className={ob.introStage}>
                  {slides.map((slide, i) => {
                    const active = i === introIndex;
                    const exitX = introNavDirection.current > 0 ? -20 : 20;
                    return (
                      <motion.div
                        key={slide.id}
                        className={ob.introSlide}
                        initial={false}
                        animate={{
                          opacity: active ? 1 : 0,
                          x: active ? 0 : exitX,
                          scale: active ? 1 : 0.98,
                        }}
                        transition={introSlideMotion}
                        style={{ pointerEvents: active ? "auto" : "none" }}
                        aria-hidden={!active}
                      >
                        <div className={ob.introImageSlot}>
                          <OnboardingIllustration src={slide.image} alt="" large priority />
                        </div>
                        <div className={ob.introTextSlot}>
                          <h1 className={ob.introTitle}>{slide.title}</h1>
                          <p className={ob.introBody}>{slide.body}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
                <div className={ob.introDots} aria-hidden>
                  {slides.map((_, i) => (
                    <motion.div
                      key={JSON.stringify(_)}
                      layout
                      transition={{ type: "spring", stiffness: 420, damping: 32 }}
                      className={`h-2 rounded-full ${i === introIndex ? "gradient-linkedin" : "bg-zinc-200"}`}
                      animate={{ width: i === introIndex ? 24 : 8 }}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === "jobSearch" && (
              <motion.div key="jobSearch" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Êtes-vous à la recherche d'un emploi ?"
                    : "Are you looking for a new job?"}
                </h1>
                <div className={ob.stepBodyOptions}>
                  <div className={ob.optionList} data-testid="job-search-options">
                    {(lang === "fr" ? JOB_SEARCH_OPTIONS_FR : JOB_SEARCH_OPTIONS).map(
                      ({ id, label, hint, Icon }) => (
                        <SelectionCard
                          key={id}
                          selected={jobSearchStatus === id}
                          onClick={() => setJobSearchStatus(id)}
                          icon={Icon}
                          title={label}
                          hint={hint}
                          variant="qcm"
                          testId={`job-search-${id}`}
                        />
                      ),
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === "location" && (
              <motion.div key="location" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Où cherchez-vous du travail ?"
                    : "Where are you looking for work?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Nous suggérerons des types de postes populaires dans votre région."
                    : "We\u2019ll suggest job types that are popular in your area."}
                </p>
                <div className={`${ob.stepBody} overflow-visible`}>
                  <PlacesAutocomplete
                    label={lang === "fr" ? "Votre localisation" : "Your location"}
                    variant="light"
                    value={onboardingLocation}
                    selectedLocation={onboardingLocationData}
                    onInputChange={setOnboardingLocation}
                    onSelect={(loc) => {
                      setOnboardingLocationData(loc);
                      if (loc) setOnboardingLocation(loc.location_label);
                    }}
                    placeholder={
                      lang === "fr"
                        ? "ex. Bordeaux, France ou Paris, France"
                        : "e.g. Bordeaux, France or New York, NY"
                    }
                    suggestions={SUGGESTED_ONBOARDING_LOCATIONS}
                    compactChips
                    maxSuggestions={8}
                    lang={lang}
                    testId="onboarding-location"
                  />
                </div>
              </motion.div>
            )}

            {step === "contractType" && (
              <motion.div key="contractType" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Quel type de poste recherchez-vous ?"
                    : "What type of job are you looking for?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Sélectionnez le contrat ou la durée qui vous convient le mieux."
                    : "Select the contract or duration that fits you best."}
                </p>
                <div
                  className={`${ob.stepBody} ${ob.optionGrid}`}
                  data-testid="contract-type-options"
                >
                  {(lang === "fr" ? EMPLOYMENT_TYPE_OPTIONS_FR : EMPLOYMENT_TYPE_OPTIONS).map(
                    ({ id, label, hint, Icon }) => (
                      <SelectionCard
                        key={id}
                        selected={contractType === id}
                        onClick={() => setContractType(id)}
                        icon={Icon}
                        title={label}
                        hint={hint}
                        testId={`contract-type-${id}`}
                      />
                    ),
                  )}
                </div>
              </motion.div>
            )}

            {step === "otherApps" && (
              <motion.div key="otherApps" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Avez-vous déjà essayé d'autres apps de recherche d'emploi ?"
                    : "Have you tried other job search apps?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Sélectionnez une option ci-dessous."
                    : "Please select one of the options below."}
                </p>
                <div className={ob.stepBodyOptions}>
                  <div className={ob.optionList} data-testid="other-apps-options">
                    {(lang === "fr" ? OTHER_APPS_OPTIONS_FR : OTHER_APPS_OPTIONS).map(
                      ({ id, label, Icon }) => (
                        <SelectionCard
                          key={id}
                          selected={triedOtherApps === id}
                          onClick={() => setTriedOtherApps(id)}
                          icon={Icon}
                          title={label}
                          variant="qcm"
                          testId={`other-apps-${id}`}
                        />
                      ),
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === "categories" && (
              <motion.div
                key="categories"
                {...stepMotion}
                className="flex flex-1 flex-col min-h-0 overflow-y-auto overflow-x-hidden"
              >
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Quels types de postes recherchez-vous ?"
                    : "What kind of job are you looking for?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {onboardingLocation
                    ? lang === "fr"
                      ? `Populaires autour de ${onboardingLocationData?.location_label || onboardingLocation}. Choisissez jusqu'à 3 domaines.`
                      : `Suggested for ${onboardingLocationData?.location_label || onboardingLocation}. Pick up to 3.`
                    : lang === "fr"
                      ? "Choisissez jusqu'à 3 domaines, puis précisez les métiers qui vous intéressent."
                      : "Select up to 3 job categories that interest you most."}
                </p>
                <div className="mt-2 sm:mt-3 flex flex-col gap-4 pb-2">
                  <motion.div
                    key={`categories-${onboardingLocation}-${contractType}`}
                    className="flex flex-wrap gap-2 content-start"
                    data-testid="job-categories"
                    variants={chipReveal.container}
                    initial="hidden"
                    animate="visible"
                  >
                    {categoryOptions.map(({ id, label }) => {
                      const Icon = iconForCategoryLabel(label);
                      const on = categories.includes(id);
                      return (
                        <motion.button
                          key={id}
                          type="button"
                          layout={false}
                          variants={chipReveal.item}
                          onClick={() => toggleCategory(id)}
                          className={`${ob.chip} ${on ? ob.chipOn : ob.chipOff}`}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span>{label}</span>
                        </motion.button>
                      );
                    })}
                  </motion.div>

                  {categories.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm sm:text-[15px] font-medium text-zinc-900 leading-snug">
                        {lang === "fr"
                          ? "Précisez les métiers qui vous correspondent le mieux"
                          : "Select the most relevant roles for your job search"}
                      </p>
                      <motion.div
                        key={`roles-${categories.join(",")}`}
                        className="flex flex-wrap gap-2 content-start"
                        data-testid="role-chips"
                        variants={chipReveal.container}
                        initial="hidden"
                        animate="visible"
                      >
                        {roleSuggestions.map((role) => {
                          const on = selectedRoles.includes(role);
                          return (
                            <motion.button
                              key={role}
                              type="button"
                              layout={false}
                              variants={chipReveal.item}
                              onClick={() => toggleRole(role)}
                              className={`${ob.chip} ${on ? ob.chipOn : ob.chipOff}`}
                            >
                              <span>{translateRoleLabel(role, lang)}</span>
                            </motion.button>
                          );
                        })}
                      </motion.div>
                      <div className="flex gap-2 pt-1">
                        <input
                          type="text"
                          value={customRoleDraft}
                          onChange={(e) => setCustomRoleDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCustomRole();
                            }
                          }}
                          placeholder={
                            lang === "fr"
                              ? "Votre poste n'est pas listé ? Ajoutez-le"
                              : "Can't find your role? Add it here"
                          }
                          className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-linkedin/30"
                          data-testid="custom-role-input"
                        />
                        <button
                          type="button"
                          onClick={addCustomRole}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linkedin text-white transition-colors duration-200 ease-out hover:bg-linkedin/90 active:scale-[0.97]"
                          aria-label="Add role"
                          data-testid="custom-role-add"
                        >
                          <Plus className="h-5 w-5" strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {step === "experience" && (
              <motion.div key="experience" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Quelle est votre expérience ?"
                    : "How much experience do you have?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Sélectionnez votre niveau ci-dessous."
                    : "Select your experience level below."}
                </p>
                <div className={`${ob.stepBody} ${ob.optionGrid}`}>
                  {(lang === "fr" ? EXPERIENCE_LEVELS_FR : EXPERIENCE_LEVELS).map(
                    ({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setExperience(id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl border text-left transition-all duration-200 ease-out active:scale-[0.99] ${
                          experience === id ? ob.optionOn : ob.optionOff
                        }`}
                        data-testid={`experience-${id}`}
                      >
                        <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${ob.accent} shrink-0`} />
                        <span className="font-medium text-sm sm:text-[15px] text-zinc-900 leading-tight">
                          {label}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </motion.div>
            )}

            {step === "salary" && (
              <motion.div key="salary" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr" ? "Fourchette salariale souhaitée ?" : "Expected salary range?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Indiquez votre fourchette pour cibler les offres adaptées."
                    : "Set your range to help match you with the right jobs."}
                </p>
                <div className={`${ob.stepBody} space-y-5 sm:space-y-6`}>
                  <div>
                    <div className={`flex justify-between text-sm ${ob.muted} mb-2`}>
                      <span>{lang === "fr" ? "Salaire minimum" : "Minimum salary"}</span>
                      <span className={`${ob.accent} font-bold text-lg`}>
                        {formatSalary(salaryMin, lang)}
                      </span>
                    </div>
                    <Slider
                      value={[salaryMin]}
                      min={0}
                      max={500000}
                      step={5000}
                      onValueChange={([v]) => setSalaryMin(Math.min(v, salaryMax))}
                      className={ob.slider}
                    />
                    <div className={`flex justify-between text-xs ${ob.dim} mt-1`}>
                      <span>{formatSalary(0, lang)}</span>
                      <span>{formatSalary(500_000, lang)}</span>
                    </div>
                  </div>
                  <div>
                    <div className={`flex justify-between text-sm ${ob.muted} mb-2`}>
                      <span>{lang === "fr" ? "Salaire maximum" : "Maximum salary"}</span>
                      <span className={`${ob.accent} font-bold text-lg`}>
                        {formatSalary(salaryMax, lang)}
                      </span>
                    </div>
                    <Slider
                      value={[salaryMax]}
                      min={0}
                      max={500000}
                      step={5000}
                      onValueChange={([v]) => setSalaryMax(Math.max(v, salaryMin))}
                      className={ob.slider}
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {step === "interviews" && (
              <motion.div
                key="interviews"
                {...stepMotion}
                className={`${ob.step} text-center justify-center`}
              >
                <h1 className={stepTitleClass}>
                  {lang === "fr" ? "Entretiens par semaine" : "Interviews per week"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Ceci calibrera votre plan personnalisé."
                    : "This will be used to calibrate your custom plan."}
                </p>
                <div className={`${ob.stepBody} items-center text-center`}>
                  <p className="font-display text-3xl sm:text-4xl font-black text-zinc-900">
                    {interviewsPerWeek}{" "}
                    <span className={`text-xl font-semibold ${ob.dim}`}>
                      {lang === "fr" ? "entretiens" : "interviews"}
                    </span>
                  </p>
                  <div className="mt-4 w-full px-2 sm:mt-6">
                    <Slider
                      value={[interviewsPerWeek]}
                      min={1}
                      max={7}
                      step={1}
                      onValueChange={([v]) => setInterviewsPerWeek(v)}
                      className={ob.slider}
                    />
                  </div>
                  <div
                    className={`mt-3 sm:mt-4 inline-flex items-center gap-2 text-xs sm:text-sm font-semibold ${interviewHint.tone === "good" ? ob.accent : ob.muted}`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {interviewHint.label}
                  </div>
                </div>
              </motion.div>
            )}

            {step === "jobTimeline" && (
              <motion.div key="jobTimeline" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Quand avez-vous besoin d'un nouvel emploi ?"
                    : "When do you need a new job?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Ceci servira à calibrer votre plan personnalisé."
                    : "This will be used to calibrate your custom plan."}
                </p>
                <div className={ob.stepBodyOptions}>
                  <div className={ob.optionList} data-testid="job-timeline-options">
                    {(lang === "fr" ? JOB_TIMELINE_OPTIONS_FR : JOB_TIMELINE_OPTIONS).map(
                      ({ id, label, hint, Icon }) => (
                        <SelectionCard
                          key={id}
                          selected={jobTimeline === id}
                          onClick={() => setJobTimeline(id)}
                          icon={Icon}
                          title={label}
                          hint={hint}
                          variant="qcm-timeline"
                          testId={`job-timeline-${id}`}
                        />
                      ),
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === "interviewsConfirm" && (
              <motion.div key="interviewsConfirm" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? `Obtenir ${interviewsPerWeek} entretiens/semaine est totalement réalisable !`
                    : `Getting ${interviewsPerWeek} interviews/week is totally achievable!`}
                </h1>
                <div className={ob.stepBody}>
                  <InterviewTargetDashes count={Math.min(interviewsPerWeek, 8)} />
                  <div className={`mt-3 sm:mt-4 ${ob.cardInner} p-4 sm:p-5 text-center`}>
                    <p className="font-bold text-base sm:text-lg text-zinc-900">
                      {lang === "fr"
                        ? "Vous êtes sur la bonne voie !"
                        : "You\u2019re right on track!"}
                    </p>
                    <p className={`text-xs sm:text-sm ${ob.muted} mt-2 leading-snug`}>
                      {lang === "fr"
                        ? `${interviewsPerWeek} entretiens par semaine, c'est l'objectif de 75 % de nos utilisateurs qui réussissent.`
                        : `${interviewsPerWeek} interviews per week is what 75% of our successful users aim for.`}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {step === "jobBlocker" && (
              <motion.div key="jobBlocker" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Qu'est-ce qui vous empêche d'atteindre vos objectifs ?"
                    : "What's stopping you from reaching your goals?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Sélectionnez le principal obstacle dans votre recherche d'emploi."
                    : "Select the main blocker in your job search."}
                </p>
                <div className={ob.stepBodyOptions}>
                  <div className={ob.optionList} data-testid="job-blocker-options">
                    {(lang === "fr" ? JOB_BLOCKER_OPTIONS_FR : JOB_BLOCKER_OPTIONS).map(
                      ({ id, label, Icon }) => (
                        <SelectionCard
                          key={id}
                          selected={jobBlocker === id}
                          onClick={() => setJobBlocker(id)}
                          icon={Icon}
                          title={label}
                          variant="qcm"
                          testId={`job-blocker-${id}`}
                        />
                      ),
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === "jobAccomplish" && (
              <motion.div key="jobAccomplish" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Que souhaitez-vous accomplir ?"
                    : "What do you want to accomplish?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Sélectionnez votre objectif principal dans votre recherche d'emploi."
                    : "Select your primary goal in your job search journey."}
                </p>
                <div className={ob.stepBodyOptions}>
                  <div className={ob.optionList} data-testid="job-accomplish-options">
                    {(lang === "fr" ? JOB_ACCOMPLISH_OPTIONS_FR : JOB_ACCOMPLISH_OPTIONS).map(
                      ({ id, label, Icon }) => (
                        <SelectionCard
                          key={id}
                          selected={jobAccomplish === id}
                          onClick={() => setJobAccomplish(id)}
                          icon={Icon}
                          title={label}
                          variant="qcm"
                          testId={`job-accomplish-${id}`}
                        />
                      ),
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === "jobGoal" && (
              <motion.div key="jobGoal" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr" ? "Quel est votre objectif ?" : "What's your goal?"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Ceci servira à personnaliser vos offres d'emploi."
                    : "This will be used to personalize your job matches."}
                </p>
                <div className={ob.stepBodyOptions}>
                  <div className={ob.optionList} data-testid="job-goal-options">
                    {(lang === "fr" ? JOB_GOAL_OPTIONS_FR : JOB_GOAL_OPTIONS).map(
                      ({ id, label, Icon }) => (
                        <SelectionCard
                          key={id}
                          selected={jobGoal === id}
                          onClick={() => setJobGoal(id)}
                          icon={Icon}
                          title={label}
                          variant="qcm"
                          testId={`job-goal-${id}`}
                        />
                      ),
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === "potentialChart" && (
              <motion.div key="potentialChart" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? "Vous avez le potentiel pour dépasser votre objectif"
                    : "You have great potential to crush your goal"}
                </h1>
                <div className={ob.stepBody}>
                  <InterviewRateChart lang={lang} />
                </div>
              </motion.div>
            )}

            {step === "compare2x" && (
              <motion.div key="compare2x" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? `Décrochez deux fois plus d'entretiens avec ${BRAND.NAME} qu'en solo.`
                    : `Land twice as many interviews with ${BRAND.NAME} vs on your own.`}
                </h1>
                <div className={`${ob.stepBody} items-center justify-center`}>
                  <Compare2xChart lang={lang} />
                </div>
              </motion.div>
            )}

            {step === "longTerm" && (
              <motion.div key="longTerm" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr"
                    ? `${BRAND.NAME} crée des résultats durables`
                    : `${BRAND.NAME} creates long-term results`}
                </h1>
                <div className={ob.stepBody}>
                  <LongTermResultsChart lang={lang} />
                </div>
              </motion.div>
            )}

            {step === "attribution" && (
              <motion.div key="attribution" {...stepMotion}>
                <h1 className={`${stepTitleClass} text-center sm:text-left`}>
                  {lang === "fr"
                    ? "Comment avez-vous entendu parler de nous ?"
                    : "How did you hear about us?"}
                </h1>
                <div className={`${ob.stepBody} ${ob.optionGrid}`}>
                  {(lang === "fr" ? ATTRIBUTION_OPTIONS_FR : ATTRIBUTION_OPTIONS).map(
                    ({ id, label, hint, Icon }) => (
                      <SelectionCard
                        key={id}
                        selected={attribution === id}
                        onClick={() => setAttribution(id)}
                        icon={Icon}
                        title={label}
                        hint={hint}
                        testId={`attribution-${id}`}
                      />
                    ),
                  )}
                </div>
              </motion.div>
            )}

            {step === "referralCode" && (
              <motion.div key="referralCode" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr" ? "Code de parrainage" : "Referral code"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Collez un code de parrainage si vous en avez un."
                    : "Paste a referral code below if you have one."}
                </p>

                <div className={`${ob.stepBody} items-center`}>
                  <OnboardingIllustration src="/onboarding/referral-gift.png" alt="" />

                  <div className="w-full mt-2">
                    <label
                      htmlFor="referral-code-input"
                      className="mb-2 block text-sm font-semibold text-zinc-800"
                    >
                      {lang === "fr" ? "Code de parrainage" : "Referral Code"}
                    </label>
                    <input
                      id="referral-code-input"
                      data-testid="referral-code-input"
                      type="tel"
                      value={referralCode}
                      onChange={(e) => setReferralCode(normalizeReferralCodeInput(e.target.value))}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pasted = e.clipboardData.getData("text");
                        setReferralCode(normalizeReferralCodeInput(pasted));
                      }}
                      placeholder="123456"
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="one-time-code"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full h-12 sm:h-14 rounded-2xl border border-zinc-200 bg-white px-4 text-center font-mono text-lg tracking-[0.2em] text-zinc-900 placeholder:text-zinc-300 focus:border-linkedin focus:outline-none focus:ring-2 focus:ring-linkedin/20"
                    />
                  </div>
                </div>
              </motion.div>
            )}

            {step === "upload" && !parsing && (
              <motion.div key="upload" {...stepMotion}>
                <h1 className={stepTitleClass}>
                  {lang === "fr" ? "Importez votre CV" : "Upload your resume"}
                </h1>
                <p className={stepSubtitleClass}>
                  {lang === "fr"
                    ? "Importez votre CV pour que nous construisions votre profil et commencions à postuler immédiatement."
                    : "Upload your resume so we can build your profile and start applying to jobs right away."}
                </p>

                <div className={ob.stepBody}>
                  <label
                    htmlFor="cv-input"
                    data-testid="cv-dropzone"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) handleUpload(f);
                    }}
                    className={`block border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center transition-all bg-white cursor-pointer ${
                      dragOver
                        ? "border-linkedin bg-linkedin-light scale-[1.01]"
                        : "border-zinc-200 hover:border-linkedin/40"
                    }`}
                  >
                    {!file ? (
                      <>
                        <div
                          className={`w-12 h-12 mx-auto rounded-xl ${ob.accentSoft} flex items-center justify-center mb-3`}
                        >
                          <FileText className={`w-6 h-6 ${ob.accent}`} />
                        </div>
                        <p className="font-semibold text-sm sm:text-base text-zinc-900">
                          {lang === "fr" ? "Aucun CV sélectionné" : "No resume selected"}
                        </p>
                        <p className={`text-xs sm:text-sm ${ob.muted} mt-1`}>
                          {lang === "fr"
                            ? `PDF, DOCX, RTF, TXT ou image • ${CV_MAX_MB} Mo max`
                            : `PDF, DOCX, RTF, TXT, or image • Max ${CV_MAX_MB}MB`}
                        </p>
                      </>
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-zinc-700">
                        <FileText className="w-5 h-5" />
                        <span className="font-medium text-sm">{file.name}</span>
                      </div>
                    )}
                    <input
                      ref={inputRef}
                      id="cv-input"
                      data-testid="cv-file-input"
                      type="file"
                      accept={CV_ACCEPT_ATTR}
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setFile(f);
                          handleUpload(f);
                        }
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      trackOnboardingSkip("upload");
                      setStepIndex(STEP_ORDER.indexOf("profileSetup"));
                      toast.message(
                        lang === "fr"
                          ? "Vous pouvez importer votre CV plus tard depuis le Profil"
                          : "You can upload your resume later from Profile",
                      );
                    }}
                    className={`mt-3 w-full text-center text-sm ${ob.muted} hover:text-zinc-900 underline-offset-2 hover:underline`}
                  >
                    {lang === "fr" ? "Passer pour l'instant" : "Skip for now"}
                  </button>
                </div>
              </motion.div>
            )}

            {parsing && (
              <motion.div
                key="parsing"
                className={`${ob.step} items-center justify-center text-center`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              >
                <h1 className={ob.title}>
                  {lang === "fr" ? "Lecture de votre CV" : "Reading your CV"}
                  <span className="text-linkedin">…</span>
                </h1>
                <p className={ob.subtitle}>
                  {lang === "fr" ? "Construction de votre profil." : "Building your profile."}
                </p>
                <motion.div
                  className={`${ob.stepBody} flex flex-col items-center justify-center gap-3`}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  <Loader2
                    className="h-9 w-9 animate-spin text-linkedin"
                    data-testid="parse-loading"
                  />
                  <p className={`text-sm ${ob.muted}`}>
                    {lang === "fr" ? "Cela ne prend qu'un moment." : "This only takes a moment."}
                  </p>
                </motion.div>
              </motion.div>
            )}

            {step === "profileSetup" && !parsing && (
              <ProfileSetupStep
                onComplete={() => {
                  trackOnboardingContinue("profileSetup");
                  goToStepIndex(STEP_ORDER.indexOf("profileWelcome"));
                }}
              />
            )}

            {step === "profileWelcome" && !parsing && (
              <motion.div key="profileWelcome" {...stepMotion}>
                <ProfileWelcomeStep
                  salaryMin={salaryMin}
                  selectedRoles={selectedRoles}
                  categories={categories}
                  categoryOptions={categoryOptions}
                  interviewsPerWeek={interviewsPerWeek}
                />
              </motion.div>
            )}

            {step === "contactPhone" &&
              !parsing &&
              (() => {
                const phoneCopy = getContactPhoneCopy(lang);
                return (
                  <motion.div key="contactPhone" {...stepMotion}>
                    <h1 className={stepTitleClass}>{phoneCopy.title}</h1>
                    <p className={stepSubtitleClass}>{phoneCopy.subtitle}</p>
                    <div className={ob.stepBody}>
                      <OnboardingContactPhoneStep
                        lang={lang}
                        phonePrefix={contactPhonePrefix}
                        phoneCountryIso2={contactPhoneCountryIso2}
                        phoneLocal={contactPhoneLocal}
                        onCountryChange={handleContactPhoneCountryChange}
                        onPhoneChange={setContactPhoneLocal}
                      />
                    </div>
                  </motion.div>
                );
              })()}

            {step === "showcaseLanding" && !parsing && (
              <motion.div key="showcaseLanding" {...stepMotion}>
                <ShowcaseLandingStep />
              </motion.div>
            )}

            {step === "showcaseAllInOne" && !parsing && (
              <motion.div key="showcaseAllInOne" {...stepMotion}>
                <ShowcaseAllInOneStep />
              </motion.div>
            )}

            {step === "showcasePricing" && !parsing && (
              <motion.div key="showcasePricing" {...stepMotion}>
                <ShowcasePricingStep
                  selectedPlan={selectedPlan}
                  onSelectPlan={setSelectedPlan}
                  onContinueCheckout={startOnboardingCheckout}
                  checkoutLoading={checkoutLoading}
                  redeemingAccessCode={redeemingAccessCode}
                  saving={saving}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </OnboardingShell>
      )}
    </>
  );
}
