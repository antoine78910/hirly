import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { shouldMockCvUpload, uploadProfileCv } from "../lib/demoCvUpload";
import { useAuth } from "../context/AuthContext";
import { Slider } from "../components/ui/slider";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import PlacesAutocomplete from "../components/PlacesAutocomplete";
import { BRAND } from "../lib/brand";
import {
  ProfileSetupStep,
  ProfileWelcomeStep,
  ShowcaseLandingStep,
  ShowcaseAllInOneStep,
  ShowcasePricingStep,
  FinishOnboardingButton,
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
import {
  INTRO_SLIDES,
  ONBOARDING_STEP_ORDER,
  JOB_SEARCH_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  OTHER_APPS_OPTIONS,
  JOB_CATEGORIES,
  EXPERIENCE_LEVELS,
  ATTRIBUTION_OPTIONS,
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
import { preloadOnboardingIntroImages, preloadOnboardingShowcaseImages } from "../lib/onboardingImagePreload";
import { getPendingInviteCode, redeemCreatorInvite, storePendingInviteCode } from "../lib/creatorInvite";
import { setDemoAccountFromUser } from "../lib/demoAccount";

const STEP_ORDER = ONBOARDING_STEP_ORDER;
const ONBOARDING_CHECKOUT_STATE_KEY = "hirly.onboarding.checkoutState";
const isSixDigitAccessCode = (value) => /^\d{6}$/.test(String(value || "").trim());

const defaultCategoryOptions = () =>
  JOB_CATEGORIES.map(({ id, label }) => ({ id, label }));

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, setHasProfile, setHasPreferences, checkAuth } = useAuth();
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
  const [jobSearchStatus, setJobSearchStatus] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.jobSearchStatus ?? null,
  );
  const [onboardingLocation, setOnboardingLocation] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.onboardingLocation ?? "",
  );
  const [onboardingLocationData, setOnboardingLocationData] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.onboardingLocationData ?? null,
  );
  const [contractType, setContractType] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.contractType ?? null,
  );
  const [triedOtherApps, setTriedOtherApps] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.triedOtherApps ?? null,
  );
  const [attribution, setAttribution] = useState(
    () => readOnboardingPreviewBoot(STEP_ORDER)?.state?.attribution ?? null,
  );
  const [referralCode, setReferralCode] = useState("");
  const [creatorAccessCode, setCreatorAccessCode] = useState(() => getPendingInviteCode());
  const [redeemingCreatorCode, setRedeemingCreatorCode] = useState(false);

  useEffect(() => {
    preloadOnboardingIntroImages();
    preloadOnboardingShowcaseImages();
  }, []);

  useEffect(() => {
    trackEvent("onboarding_started");
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
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const step = STEP_ORDER[stepIndex];
  const progress = ((stepIndex + (step === "intro" ? (introIndex + 1) / INTRO_SLIDES.length : 1)) / STEP_ORDER.length) * 100;

  const categoryOptions = suggestedCategories.length
    ? suggestedCategories
    : JOB_CATEGORIES.map(({ id, label }) => ({ id, label }));
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
  const interviewHint = interviewFeedback(interviewsPerWeek);

  const restoreCheckoutState = (payload) => {
    if (!payload || typeof payload !== "object") return;
    if (Array.isArray(payload.categories)) setCategories(payload.categories);
    if (Array.isArray(payload.selectedRoles)) setSelectedRoles(payload.selectedRoles);
    if (payload.experience) setExperience(payload.experience);
    if (typeof payload.salaryMin === "number") setSalaryMin(payload.salaryMin);
    if (typeof payload.salaryMax === "number") setSalaryMax(payload.salaryMax);
    if (typeof payload.interviewsPerWeek === "number") setInterviewsPerWeek(payload.interviewsPerWeek);
    if (payload.jobSearchStatus) setJobSearchStatus(payload.jobSearchStatus);
    if (typeof payload.onboardingLocation === "string") setOnboardingLocation(payload.onboardingLocation);
    if (payload.onboardingLocationData) setOnboardingLocationData(payload.onboardingLocationData);
    if (payload.contractType) setContractType(payload.contractType);
    if (payload.triedOtherApps) setTriedOtherApps(payload.triedOtherApps);
    if (payload.attribution) setAttribution(payload.attribution);
    if (Array.isArray(payload.suggestedCategories)) setSuggestedCategories(payload.suggestedCategories);
    if (payload.selectedPlan) setSelectedPlan(payload.selectedPlan);
    if (isSixDigitAccessCode(payload.creatorAccessCode)) setCreatorAccessCode(payload.creatorAccessCode);
  };

  useEffect(() => {
    const preview = searchParams.get("preview");
    const stepParam = searchParams.get("step");
    const checkoutStatus = searchParams.get("checkout");

    if (checkoutStatus) {
      try {
        restoreCheckoutState(JSON.parse(sessionStorage.getItem(ONBOARDING_CHECKOUT_STATE_KEY) || "null"));
      } catch (_) {
        /* ignore corrupt checkout state */
      }
      setStepIndex(STEP_ORDER.indexOf(checkoutStatus === "success" ? "creatorAccessCode" : "showcasePricing"));
      if (checkoutStatus === "success") toast.success("Payment received");
      if (checkoutStatus === "cancelled") toast("Checkout cancelled");
      return;
    }

    if (!preview && !stepParam) return;

    const boot = readOnboardingPreviewBoot(STEP_ORDER);
    if (!boot) return;

    setStepIndex(boot.stepIndex);
    if (boot.state) {
      setCategories(boot.state.categories);
      setSelectedRoles(boot.state.selectedRoles);
      setExperience(boot.state.experience);
      setSalaryMin(boot.state.salaryMin);
      setSalaryMax(boot.state.salaryMax);
      setInterviewsPerWeek(boot.state.interviewsPerWeek);
      setJobSearchStatus(boot.state.jobSearchStatus);
      setOnboardingLocation(boot.state.onboardingLocation);
      setOnboardingLocationData(boot.state.onboardingLocationData);
      setContractType(boot.state.contractType);
      setTriedOtherApps(boot.state.triedOtherApps);
      setAttribution(boot.state.attribution);
      setSuggestedCategories(boot.state.suggestedCategories);
      if (boot.state.selectedPlan) setSelectedPlan(boot.state.selectedPlan);
    }

    if (!devBypassAuth && stepParam && stepParam !== "intro") {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!user || step !== "signup") return;
    setStepIndex(STEP_ORDER.indexOf("jobSearch"));
  }, [user, step]);

  useEffect(() => {
    if (step !== "categories" || !onboardingLocation.trim() || !contractType) return;
    const items = defaultCategoryOptions();
    setSuggestedCategories(items);
    setCategories((prev) => prev.filter((id) => items.some((c) => c.id === id)));
  }, [step, onboardingLocation, contractType]);

  const goNext = () => {
    if (step === "intro") {
      if (introIndex < INTRO_SLIDES.length - 1) {
        introNavDirection.current = 1;
        setIntroIndex((i) => i + 1);
        return;
      }
    }
    if (stepIndex < STEP_ORDER.length - 1) setStepIndex((i) => i + 1);
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
      if (STEP_ORDER[prev] === "intro") setIntroIndex(INTRO_SLIDES.length - 1);
    }
  };

  const toggleCategory = (id) => {
    setCategories((prev) => {
      let next;
      if (prev.includes(id)) next = prev.filter((c) => c !== id);
      else if (prev.length >= 3) {
        toast.message("Pick up to 3 categories");
        return prev;
      } else next = [...prev, id];

      const options = suggestedCategories.length ? suggestedCategories : defaultCategoryOptions();
      const available = new Set([
        ...rolesForCategories(next, 200, options),
        ...customRoles,
      ]);
      setSelectedRoles((roles) => roles.filter((role) => available.has(role)));
      setSuggestedRoles([]);
      return next;
    });
  };

  const addCustomRole = () => {
    const role = customRoleDraft.trim();
    if (!role) return;
    if (selectedRoles.length >= 3) {
      toast.message("Pick up to 3 roles");
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
        toast.message("Pick up to 3 roles");
        return prev;
      }
      return [...prev, role];
    });
  };

  const handleUpload = async (f) => {
    if (!f) return;
    if (!user && !shouldMockCvUpload()) {
      toast.error("Sign in with Google to upload your resume");
      return;
    }
    setFile(f);
    setParsing(true);
    trackEvent("cv_upload_started", { source: "onboarding" });
    preloadOnboardingShowcaseImages();
    try {
      const { data } = await uploadProfileCv(f, api);
      setProfile(data);
      trackEvent("cv_upload_completed", { source: "onboarding" });
      if (!shouldMockCvUpload()) {
        const { data: authState } = await api.get("/auth/me");
        setHasProfile(Boolean(authState?.has_profile));
        if (checkAuth) await checkAuth();
        toast.success("Your profile is ready");
      } else {
        setHasProfile(true);
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      setStepIndex(STEP_ORDER.indexOf("profileSetup"));
    } catch (e) {
      console.error(e);
      trackEvent("cv_upload_failed", { source: "onboarding", message: e?.response?.data?.detail || e?.message });
      if (!shouldMockCvUpload()) {
        toast.error(e?.response?.data?.detail || "Failed to parse CV");
      }
    } finally {
      setParsing(false);
    }
  };

  const persistOnboardingMeta = async () => {
    try {
      await api.patch("/profile/extras", {
        onboarding: {
          job_search_status: jobSearchStatus,
          onboarding_location: onboardingLocationData?.location_label || onboardingLocation,
          onboarding_location_data: onboardingLocationData,
          contract_type: contractType,
          job_priorities: [],
          tried_other_apps: triedOtherApps,
          categories,
          suggested_categories: suggestedCategories,
          selected_roles: selectedRoles,
          interviews_per_week: interviewsPerWeek,
          acquisition_source: attribution,
          referral_code: referralCode.trim().toUpperCase() || null,
          salary_min: salaryMin,
          salary_max: salaryMax,
        },
      });
    } catch (e) {
      console.warn("extras save skipped", e);
    }
  };

  const finishOnboarding = async ({ skipCreatorCode = false } = {}) => {
    if (!user) {
      await startGoogleLogin("/onboarding?step=creatorAccessCode");
      return;
    }
    setSaving(true);
    try {
      const code = skipCreatorCode ? "" : creatorAccessCode.trim();
      if (/^\d{6}$/.test(code)) {
        setRedeemingCreatorCode(true);
        try {
          const redeemed = await redeemCreatorInvite(api, code, {
            plan: selectedPlan,
            interval: selectedPlan,
            source: "onboarding",
          });
          if (redeemed?.demo_account) {
            setDemoAccountFromUser({ ...user, demo_account: true });
          }
          toast.success(redeemed?.master_code ? "Test plan activated" : "Creator access activated");
        } catch (inviteErr) {
          toast.error(inviteErr?.response?.data?.detail || "Could not activate invitation code");
          setSaving(false);
          setRedeemingCreatorCode(false);
          return;
        } finally {
          setRedeemingCreatorCode(false);
        }
      }

      await persistOnboardingMeta();
      const exp = EXPERIENCE_LEVELS.find((e) => e.id === experience);
      const primaryRole = selectedRoles[0] || profile?.target_roles?.[0] || "Software Engineer";
      await api.put("/profile/preferences", {
        target_role: primaryRole,
        target_roles: selectedRoles.length ? selectedRoles : profile?.target_roles?.length ? profile.target_roles : [primaryRole],
        target_location: onboardingLocationData?.location_label || onboardingLocation || "",
        target_location_data: onboardingLocationData,
        remote_preference: "any",
        seniority: exp?.backend,
      });
      const nameParts = splitFullName(user?.name || profile?.contact?.name || "");
      await api.put("/profile/contact", {
        first_name: nameParts.first_name || undefined,
        last_name: nameParts.last_name || undefined,
        location: onboardingLocationData?.location_label || onboardingLocation || undefined,
        location_data: onboardingLocationData || undefined,
      });
      if (checkAuth) await checkAuth();
      sessionStorage.removeItem(ONBOARDING_CHECKOUT_STATE_KEY);
      setHasProfile(true);
      setHasPreferences(true);
      trackEvent("onboarding_completed", {
        selected_roles: selectedRoles,
        target_location: onboardingLocationData?.location_label || onboardingLocation || "",
      });
      navigate("/swipe", { replace: true });
    } catch {
      toast.error("Failed to finish setup");
    } finally {
      setSaving(false);
    }
  };

  const startOnboardingCheckout = async () => {
    if (!user) {
      await startGoogleLogin("/onboarding?step=showcasePricing");
      return;
    }
    if (isSixDigitAccessCode(creatorAccessCode)) {
      setStepIndex(STEP_ORDER.indexOf("creatorAccessCode"));
      toast.success("Access code ready");
      return;
    }
    setCheckoutLoading(true);
    try {
      sessionStorage.setItem(ONBOARDING_CHECKOUT_STATE_KEY, JSON.stringify({
        categories,
        selectedRoles,
        experience,
        salaryMin,
        salaryMax,
        interviewsPerWeek,
        jobSearchStatus,
        onboardingLocation,
        onboardingLocationData,
        contractType,
        triedOtherApps,
        attribution,
        suggestedCategories,
        selectedPlan,
        creatorAccessCode,
      }));
      const { data } = await api.post("/billing/create-checkout-session", {
        plan: selectedPlan,
        interval: selectedPlan,
        source: "onboarding",
      });
      if (!data?.url) throw new Error("Missing checkout URL");
      trackEvent("checkout_started", { source: "onboarding", plan: selectedPlan });
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
        if (!onboardingLocationData?.location_label) return false;
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
      case "interviewsConfirm":
      case "potentialChart":
      case "compare2x":
      case "longTerm":
        return true;
      case "attribution":
        return !!attribution;
      case "referralCode":
        return true;
      case "upload":
        return !parsing;
      case "profileSetup":
      case "profileWelcome":
      case "showcaseLanding":
      case "showcaseAllInOne":
      case "showcasePricing":
        return true;
      case "creatorAccessCode":
        return true;
      default:
        return false;
    }
  };

  const submitReferralCode = () => {
    const code = referralCode.trim().toUpperCase();
    if (!code) {
      toast.error("Enter a referral code or tap Skip");
      return;
    }
    if (isSixDigitAccessCode(code)) {
      setReferralCode(code);
      setCreatorAccessCode(code);
      storePendingInviteCode(code);
      toast.success("Access code applied");
      goNext();
      return;
    }
    if (!/^[A-Z0-9]{4,8}$/.test(code)) {
      toast.error("Enter a valid referral code (4–8 letters or numbers)");
      return;
    }
    setReferralCode(code);
    toast.success("Referral code applied");
    goNext();
  };

  const onContinue = () => {
    trackEvent("onboarding_step_completed", { step, step_index: stepIndex });
    if (step === "intro" && introIndex === INTRO_SLIDES.length - 1) {
      setStepIndex(STEP_ORDER.indexOf("signup"));
      return;
    }
    if (step === "signup") {
      setStepIndex(STEP_ORDER.indexOf("jobSearch"));
      return;
    }
    if (step === "upload" && !file) {
      inputRef.current?.click();
      return;
    }
    goNext();
  };

  const isLastIntroSlide = step === "intro" && introIndex === INTRO_SLIDES.length - 1;
  const hideFooter = parsing || step === "profileSetup" || (step === "signup" && !user);

  const footer = !hideFooter ? (
    step === "creatorAccessCode" ? (
      <div className="space-y-2.5">
        <FinishOnboardingButton saving={saving || redeemingCreatorCode} onClick={finishOnboarding} />
        <button
          type="button"
          onClick={() => finishOnboarding({ skipCreatorCode: true })}
          disabled={saving || redeemingCreatorCode}
          className="w-full h-11 sm:h-12 rounded-full border border-zinc-200 bg-white text-sm sm:text-base font-semibold text-linkedin hover:bg-violet-50 transition-colors disabled:opacity-60"
          data-testid="creator-access-skip"
        >
          Skip for now
        </button>
      </div>
    ) : step === "showcasePricing" ? (
      <ContinueButton onClick={startOnboardingCheckout} disabled={checkoutLoading} testId="showcase-pricing-continue">
        {checkoutLoading ? "Opening checkout..." : "Continue"}
      </ContinueButton>
    ) : step === "profileWelcome" ? (
      <div className="space-y-2">
        <ContinueButton onClick={onContinue} testId="profile-welcome-continue">
          Continue
        </ContinueButton>
        <p className="text-center text-xs text-zinc-500">Let&apos;s make sure you&apos;re ready</p>
      </div>
    ) : step === "referralCode" ? (
      <div className="space-y-2.5">
        <ContinueButton onClick={submitReferralCode} disabled={!referralCode.trim()} testId="referral-submit">
          Submit
        </ContinueButton>
        <button
          type="button"
          onClick={goNext}
          className="w-full h-11 sm:h-12 rounded-full border border-zinc-200 bg-white text-sm sm:text-base font-semibold text-linkedin hover:bg-violet-50 transition-colors"
          data-testid="referral-skip"
        >
          Skip
        </button>
      </div>
    ) : (
      <ContinueButton onClick={onContinue} disabled={!canContinue() || parsing}>
        {isLastIntroSlide ? (
          "Get Started"
        ) : step === "intro" ? (
          "Continue"
        ) : step === "signup" ? (
          "Continue"
        ) : step === "upload" && !file ? (
          "Upload resume"
        ) : (
          "Continue"
        )}
      </ContinueButton>
    )
  ) : null;

  return (
    <>
    {step === "signup" && !user ? (
      <OnboardingSignup onClose={goBack} />
    ) : (
    <OnboardingShell
      progress={progress}
      onBack={goBack}
      ambientClassName={step === "showcaseLanding" ? "showcase-landing-ambient" : undefined}
      showBack={(stepIndex > 0 || introIndex > 0) && step !== "profileSetup"}
      showProgress={
        step !== "intro"
        && step !== "profileSetup"
        && step !== "profileWelcome"
        && step !== "showcaseLanding"
        && step !== "showcaseAllInOne"
        && step !== "showcasePricing"
        && step !== "creatorAccessCode"
      }
      footer={parsing ? null : footer}
    >
      <AnimatePresence mode="wait">
        {step === "intro" && (
          <div className={`${ob.step} items-center justify-center text-center`}>
            <div className={ob.introStage}>
              {INTRO_SLIDES.map((slide, i) => {
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
              {INTRO_SLIDES.map((_, i) => (
                <motion.div
                  key={i}
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
            <h1 className={stepTitleClass}>Are you looking for a new job?</h1>
            <div className={`${ob.stepBody} ${ob.optionList}`} data-testid="job-search-options">
              {JOB_SEARCH_OPTIONS.map(({ id, label, hint, Icon }) => (
                <SelectionCard
                  key={id}
                  selected={jobSearchStatus === id}
                  onClick={() => setJobSearchStatus(id)}
                  icon={Icon}
                  title={label}
                  hint={hint}
                  testId={`job-search-${id}`}
                />
              ))}
            </div>
          </motion.div>
        )}

        {step === "location" && (
          <motion.div key="location" {...stepMotion}>
            <h1 className={stepTitleClass}>Where are you looking for work?</h1>
            <p className={stepSubtitleClass}>
              We&apos;ll suggest job types that are popular in your area.
            </p>
            <div className={`${ob.stepBody} overflow-visible`}>
              <PlacesAutocomplete
                label="Your location"
                variant="light"
                value={onboardingLocation}
                selectedLocation={onboardingLocationData}
                onInputChange={setOnboardingLocation}
                onSelect={(loc) => {
                  setOnboardingLocationData(loc);
                  if (loc) setOnboardingLocation(loc.location_label);
                }}
                placeholder="e.g. Bordeaux, France or New York, NY"
                suggestions={SUGGESTED_ONBOARDING_LOCATIONS}
                compactChips
                maxSuggestions={8}
                testId="onboarding-location"
              />
            </div>
          </motion.div>
        )}

        {step === "contractType" && (
          <motion.div key="contractType" {...stepMotion}>
            <h1 className={stepTitleClass}>What type of job are you looking for?</h1>
            <p className={stepSubtitleClass}>Select the contract or duration that fits you best.</p>
            <div className={`${ob.stepBody} ${ob.optionGrid}`} data-testid="contract-type-options">
              {EMPLOYMENT_TYPE_OPTIONS.map(({ id, label, hint, Icon }) => (
                <SelectionCard
                  key={id}
                  selected={contractType === id}
                  onClick={() => setContractType(id)}
                  icon={Icon}
                  title={label}
                  hint={hint}
                  testId={`contract-type-${id}`}
                />
              ))}
            </div>
          </motion.div>
        )}

        {step === "otherApps" && (
          <motion.div key="otherApps" {...stepMotion}>
            <h1 className={stepTitleClass}>Have you tried other job search apps?</h1>
            <p className={stepSubtitleClass}>Please select one of the options below.</p>
            <div className={`${ob.stepBody} ${ob.optionList}`} data-testid="other-apps-options">
              {OTHER_APPS_OPTIONS.map(({ id, label, Icon }) => (
                <SelectionCard
                  key={id}
                  selected={triedOtherApps === id}
                  onClick={() => setTriedOtherApps(id)}
                  icon={Icon}
                  title={label}
                  testId={`other-apps-${id}`}
                />
              ))}
            </div>
          </motion.div>
        )}

        {step === "categories" && (
          <motion.div
            key="categories"
            {...stepMotion}
            className="flex flex-1 flex-col min-h-0 overflow-y-auto overflow-x-hidden"
          >
            <h1 className={stepTitleClass}>What kind of job are you looking for?</h1>
            <p className={stepSubtitleClass}>
              {onboardingLocation
                ? `Suggested for ${onboardingLocationData?.location_label || onboardingLocation}. Pick up to 3.`
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
                    Select the most relevant roles for your job search
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
                          <span>{role}</span>
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
                      placeholder="Can't find your role? Add it here"
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
            <h1 className={stepTitleClass}>How much experience do you have?</h1>
            <p className={stepSubtitleClass}>Select your experience level below.</p>
            <div className={`${ob.stepBody} ${ob.optionGrid}`}>
              {EXPERIENCE_LEVELS.map(({ id, label, Icon }) => (
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
                  <span className="font-medium text-sm sm:text-[15px] text-zinc-900 leading-tight">{label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === "salary" && (
          <motion.div key="salary" {...stepMotion}>
            <h1 className={stepTitleClass}>Expected salary range?</h1>
            <p className={stepSubtitleClass}>Set your range to help match you with the right jobs.</p>
            <div className={`${ob.stepBody} space-y-5 sm:space-y-6`}>
              <div>
                <div className={`flex justify-between text-sm ${ob.muted} mb-2`}>
                  <span>Minimum salary</span>
                  <span className={`${ob.accent} font-bold text-lg`}>{formatSalary(salaryMin)}</span>
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
                  <span>{formatSalary(0)}</span>
                  <span>{formatSalary(500_000)}</span>
                </div>
              </div>
              <div>
                <div className={`flex justify-between text-sm ${ob.muted} mb-2`}>
                  <span>Maximum salary</span>
                  <span className={`${ob.accent} font-bold text-lg`}>{formatSalary(salaryMax)}</span>
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
          <motion.div key="interviews" {...stepMotion} className={`${ob.step} text-center justify-center`}>
            <h1 className={stepTitleClass}>Interviews per week</h1>
            <p className={stepSubtitleClass}>This will be used to calibrate your custom plan.</p>
            <div className={`${ob.stepBody} items-center text-center`}>
            <p className="font-display text-3xl sm:text-4xl font-black text-zinc-900">
              {interviewsPerWeek} <span className={`text-xl font-semibold ${ob.dim}`}>interviews</span>
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
            <div className={`mt-3 sm:mt-4 inline-flex items-center gap-2 text-xs sm:text-sm font-semibold ${interviewHint.tone === "good" ? ob.accent : ob.muted}`}>
              <CheckCircle2 className="w-4 h-4" />
              {interviewHint.label}
            </div>
            </div>
          </motion.div>
        )}

        {step === "interviewsConfirm" && (
          <motion.div key="interviewsConfirm" {...stepMotion}>
            <h1 className={stepTitleClass}>
              Getting {interviewsPerWeek} interviews/week is totally achievable!
            </h1>
            <div className={ob.stepBody}>
            <InterviewTargetDashes count={Math.min(interviewsPerWeek, 8)} />
            <div className={`mt-3 sm:mt-4 ${ob.cardInner} p-4 sm:p-5 text-center`}>
              <p className="font-bold text-base sm:text-lg text-zinc-900">You&apos;re right on track!</p>
              <p className={`text-xs sm:text-sm ${ob.muted} mt-2 leading-snug`}>
                {interviewsPerWeek} interviews per week is what 75% of our successful users aim for.
              </p>
            </div>
            </div>
          </motion.div>
        )}

        {step === "potentialChart" && (
          <motion.div key="potentialChart" {...stepMotion}>
            <h1 className={stepTitleClass}>You have great potential to crush your goal</h1>
            <div className={ob.stepBody}>
              <InterviewRateChart />
            </div>
          </motion.div>
        )}

        {step === "compare2x" && (
          <motion.div key="compare2x" {...stepMotion}>
            <h1 className={stepTitleClass}>
              Land twice as many interviews with {BRAND.NAME} vs on your own.
            </h1>
            <div className={`${ob.stepBody} items-center justify-center`}>
              <Compare2xChart />
            </div>
          </motion.div>
        )}

        {step === "longTerm" && (
          <motion.div key="longTerm" {...stepMotion}>
            <h1 className={stepTitleClass}>{BRAND.NAME} creates long-term results</h1>
            <div className={ob.stepBody}>
              <LongTermResultsChart />
            </div>
          </motion.div>
        )}

        {step === "attribution" && (
          <motion.div key="attribution" {...stepMotion}>
            <h1 className={`${stepTitleClass} text-center sm:text-left`}>How did you hear about us?</h1>
            <div className={`${ob.stepBody} ${ob.optionGrid}`}>
              {ATTRIBUTION_OPTIONS.map(({ id, label, hint, Icon }) => (
                <SelectionCard
                  key={id}
                  selected={attribution === id}
                  onClick={() => setAttribution(id)}
                  icon={Icon}
                  title={label}
                  hint={hint}
                  testId={`attribution-${id}`}
                />
              ))}
            </div>
          </motion.div>
        )}

        {step === "referralCode" && (
          <motion.div key="referralCode" {...stepMotion}>
            <h1 className={stepTitleClass}>Referral code</h1>
            <p className={stepSubtitleClass}>Paste a referral code below if you have one.</p>

            <div className={`${ob.stepBody} items-center`}>
              <OnboardingIllustration src="/onboarding/referral-gift.png" alt="" />

              <div className="w-full mt-2">
                <label htmlFor="referral-code-input" className="mb-2 block text-sm font-semibold text-zinc-800">
                  Referral Code
                </label>
                <input
                  id="referral-code-input"
                  data-testid="referral-code-input"
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                  placeholder="GR7E34"
                  autoCapitalize="characters"
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
            <h1 className={stepTitleClass}>Upload your resume</h1>
            <p className={stepSubtitleClass}>Upload your resume so we can build your profile and start applying to jobs right away.</p>

            <div className={ob.stepBody}>
            <label
              htmlFor="cv-input"
              data-testid="cv-dropzone"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleUpload(f);
              }}
              className={`block border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center transition-all bg-white cursor-pointer ${
                dragOver ? "border-linkedin bg-linkedin-light scale-[1.01]" : "border-zinc-200 hover:border-linkedin/40"
              }`}
            >
              {!file ? (
                <>
                  <div className={`w-12 h-12 mx-auto rounded-xl ${ob.accentSoft} flex items-center justify-center mb-3`}>
                    <FileText className={`w-6 h-6 ${ob.accent}`} />
                  </div>
                  <p className="font-semibold text-sm sm:text-base text-zinc-900">No resume selected</p>
                  <p className={`text-xs sm:text-sm ${ob.muted} mt-1`}>PDF or DOCX supported</p>
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
                accept=".pdf,.docx,.txt"
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
                setStepIndex(STEP_ORDER.indexOf("profileSetup"));
                toast.message("You can upload your resume later from Profile");
              }}
              className={`mt-3 w-full text-center text-sm ${ob.muted} hover:text-zinc-900 underline-offset-2 hover:underline`}
            >
              Skip for now
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
              Reading your CV<span className="text-linkedin">…</span>
            </h1>
            <p className={ob.subtitle}>Building your profile.</p>
            <motion.div
              className={`${ob.stepBody} flex flex-col items-center justify-center gap-3`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <Loader2 className="h-9 w-9 animate-spin text-linkedin" data-testid="parse-loading" />
              <p className={`text-sm ${ob.muted}`}>This only takes a moment.</p>
            </motion.div>
          </motion.div>
        )}

        {step === "profileSetup" && !parsing && (
          <ProfileSetupStep
            onComplete={() => setStepIndex(STEP_ORDER.indexOf("profileWelcome"))}
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
              locationLabel={onboardingLocationData?.location_label || onboardingLocation || "Your city"}
            />
          </motion.div>
        )}

        {step === "creatorAccessCode" && !parsing && (
          <motion.div key="creatorAccessCode" {...stepMotion}>
            <h1 className={stepTitleClass}>Creator access code</h1>
            <p className={stepSubtitleClass}>
              If you received a Hirly creator invitation, enter the 6-digit code here to unlock training and your demo account.
            </p>
            <div className="mt-6">
              <input
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-4 text-center font-mono text-2xl font-bold tracking-[0.25em] text-zinc-900 outline-none focus:border-violet-400"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={creatorAccessCode}
                onChange={(e) => setCreatorAccessCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                data-testid="creator-access-code-input"
              />
              <p className="mt-3 text-center text-xs leading-relaxed text-zinc-500">
                You can also open the invitation link you received by email or DM. Skip this step if you already activated your access on web.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </OnboardingShell>
    )}
    </>
  );
}
