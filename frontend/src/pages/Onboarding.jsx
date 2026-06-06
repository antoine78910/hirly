import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Slider } from "../components/ui/slider";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import PlacesAutocomplete from "../components/PlacesAutocomplete";
import { BRAND } from "../lib/brand";
import {
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
} from "../components/onboarding/onboardingData";
import { ob } from "../components/onboarding/onboardingTheme";

const PARSING_STEPS = [
  "Reading your CV…",
  "Extracting your skills…",
  "Mapping your experience…",
  "Finding the perfect roles for you…",
  "Polishing your profile…",
];

const STEP_ORDER = ONBOARDING_STEP_ORDER;

const stepTitleClass = ob.title;
const stepSubtitleClass = ob.subtitle;

const slideVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

const stepMotion = {
  variants: slideVariants,
  initial: "enter",
  animate: "center",
  exit: "exit",
  transition: { duration: 0.28 },
  className: ob.step,
};

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, setHasProfile, setHasPreferences, checkAuth } = useAuth();

  const [stepIndex, setStepIndex] = useState(() => {
    const stepParam = new URLSearchParams(window.location.search).get("step");
    if (stepParam) {
      const idx = STEP_ORDER.indexOf(stepParam);
      if (idx >= 0) return idx;
    }
    return 0;
  });
  const [introIndex, setIntroIndex] = useState(0);
  const [categories, setCategories] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [experience, setExperience] = useState(null);
  const [salaryMin, setSalaryMin] = useState(50000);
  const [salaryMax, setSalaryMax] = useState(100000);
  const [interviewsPerWeek, setInterviewsPerWeek] = useState(4);
  const [jobSearchStatus, setJobSearchStatus] = useState(null);
  const [onboardingLocation, setOnboardingLocation] = useState("");
  const [onboardingLocationData, setOnboardingLocationData] = useState(null);
  const [contractType, setContractType] = useState(null);
  const [triedOtherApps, setTriedOtherApps] = useState(null);
  const [attribution, setAttribution] = useState(null);
  const [referralCode, setReferralCode] = useState("");
  const [suggestedCategories, setSuggestedCategories] = useState([]);
  const [suggestedRoles, setSuggestedRoles] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(false);

  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsePhase, setParsePhase] = useState(0);
  const [profile, setProfile] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState("quarterly");
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const step = STEP_ORDER[stepIndex];
  const progress = ((stepIndex + (step === "intro" ? (introIndex + 1) / INTRO_SLIDES.length : 1)) / STEP_ORDER.length) * 100;

  const categoryOptions = suggestedCategories.length
    ? suggestedCategories
    : JOB_CATEGORIES.map(({ id, label }) => ({ id, label }));
  const roleSuggestions = useMemo(() => {
    if (suggestedRoles.length) return suggestedRoles;
    return rolesForCategories(categories, 24, categoryOptions);
  }, [suggestedRoles, categories, categoryOptions]);
  const interviewHint = interviewFeedback(interviewsPerWeek);

  useEffect(() => {
    if (!parsing) return;
    setParsePhase(0);
    const t = setInterval(() => setParsePhase((p) => Math.min(p + 1, PARSING_STEPS.length - 1)), 1200);
    return () => clearInterval(t);
  }, [parsing]);

  useEffect(() => {
    const stepParam = searchParams.get("step");
    if (!stepParam) return;
    const idx = STEP_ORDER.indexOf(stepParam);
    if (idx >= 0) setStepIndex(idx);
    if (stepParam !== "intro") setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!user || step !== "signup") return;
    setStepIndex(STEP_ORDER.indexOf("jobSearch"));
  }, [user, step]);

  useEffect(() => {
    if (step !== "categories" || !onboardingLocation.trim() || !contractType) return;
    let cancelled = false;
    setLoadingCategories(true);
    api
      .post("/onboarding/suggest-categories", {
        location: onboardingLocation,
        contract_type: contractType,
        location_data: onboardingLocationData,
      })
      .then(({ data }) => {
        if (cancelled) return;
        const items = data?.categories?.length
          ? data.categories
          : JOB_CATEGORIES.map(({ id, label }) => ({ id, label }));
        setSuggestedCategories(items);
        setCategories((prev) => prev.filter((id) => items.some((c) => c.id === id)));
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestedCategories(JOB_CATEGORIES.map(({ id, label }) => ({ id, label })));
      })
      .finally(() => {
        if (!cancelled) setLoadingCategories(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, onboardingLocation, contractType, onboardingLocationData]);

  useEffect(() => {
    if (step !== "roles" || categories.length === 0) return;
    const selectedCats = suggestedCategories.filter((c) => categories.includes(c.id));
    const payloadCats = selectedCats.length
      ? selectedCats
      : JOB_CATEGORIES.filter((c) => categories.includes(c.id)).map(({ id, label }) => ({ id, label }));
    if (!payloadCats.length) return;

    let cancelled = false;
    setLoadingRoles(true);
    api
      .post("/onboarding/suggest-roles", {
        location: onboardingLocation,
        contract_type: contractType,
        location_data: onboardingLocationData,
        categories: payloadCats,
      })
      .then(({ data }) => {
        if (cancelled) return;
        setSuggestedRoles(data?.roles || []);
        setSelectedRoles((prev) => prev.filter((r) => (data?.roles || []).includes(r)));
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestedRoles(rolesForCategories(categories, 24, categoryOptions));
      })
      .finally(() => {
        if (!cancelled) setLoadingRoles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, categories, suggestedCategories, onboardingLocation, contractType, onboardingLocationData]);

  const goNext = () => {
    if (step === "intro") {
      if (introIndex < INTRO_SLIDES.length - 1) {
        setIntroIndex((i) => i + 1);
        return;
      }
    }
    if (stepIndex < STEP_ORDER.length - 1) setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    if (step === "intro" && introIndex > 0) {
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
      setSelectedRoles([]);
      setSuggestedRoles([]);
      return next;
    });
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
    if (!user) {
      toast.error("Sign in with Google to upload your resume");
      return;
    }
    setFile(f);
    setParsing(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const { data } = await api.post("/profile/cv", form, { headers: { "Content-Type": "multipart/form-data" } });
      setProfile(data);
      const { data: authState } = await api.get("/auth/me");
      setHasProfile(Boolean(authState?.has_profile));
      if (checkAuth) await checkAuth();
      toast.success("Your profile is ready");
      setStepIndex(STEP_ORDER.indexOf("showcaseLanding"));
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Failed to parse CV");
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

  const finishOnboarding = async () => {
    if (!user) {
      await startGoogleLogin("/onboarding?step=showcasePricing");
      return;
    }
    setSaving(true);
    try {
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
      setHasPreferences(true);
      navigate("/swipe", { replace: true });
    } catch {
      toast.error("Failed to finish setup");
    } finally {
      setSaving(false);
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
        return categories.length > 0;
      case "roles":
        return selectedRoles.length > 0;
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
      case "showcaseLanding":
      case "showcaseAllInOne":
      case "showcasePricing":
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
    if (!/^[A-Z0-9]{4,8}$/.test(code)) {
      toast.error("Enter a valid referral code (4–8 letters or numbers)");
      return;
    }
    setReferralCode(code);
    toast.success("Referral code applied");
    goNext();
  };

  const onContinue = () => {
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

  const introSlide = INTRO_SLIDES[introIndex];
  const isLastIntroSlide = step === "intro" && introIndex === INTRO_SLIDES.length - 1;
  const hideFooter = parsing || (step === "signup" && !user);

  const footer = !hideFooter ? (
    step === "showcasePricing" ? (
      <FinishOnboardingButton saving={saving} onClick={finishOnboarding} />
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
      showBack={stepIndex > 0 || introIndex > 0}
      showProgress={step !== "intro"}
      footer={parsing ? null : footer}
    >
      <AnimatePresence mode="wait">
        {step === "intro" && (
          <div className={`${ob.step} items-center justify-center text-center`}>
            <AnimatePresence mode="wait">
              <motion.div
                key={introIndex}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.28 }}
                className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-5 sm:gap-6"
              >
                <div className="flex w-full shrink-0 items-center justify-center">
                  <OnboardingIllustration src={introSlide.image} alt="" large />
                </div>
                <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 sm:gap-4">
                  <h1 className={ob.introTitle}>{introSlide.title}</h1>
                  <p className={ob.introBody}>{introSlide.body}</p>
                </div>
              </motion.div>
            </AnimatePresence>
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
          <motion.div key="categories" {...stepMotion}>
            <h1 className={stepTitleClass}>What kind of job are you looking for?</h1>
            <p className={stepSubtitleClass}>
              {onboardingLocation
                ? `Suggested for ${onboardingLocationData?.location_label || onboardingLocation}. Pick up to 3.`
                : "Select up to 3 job categories that interest you most."}
            </p>
            {loadingCategories ? (
              <div className={`${ob.stepBody} flex items-center justify-center gap-2 ${ob.muted}`}>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Finding categories for your area…</span>
              </div>
            ) : (
              <div className={`${ob.stepBody} ${ob.chipGrid}`} data-testid="job-categories">
                {categoryOptions.map(({ id, label }) => {
                  const Icon = iconForCategoryLabel(label);
                  const on = categories.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleCategory(id)}
                      className={`${ob.chipGridItem} ${on ? ob.chipOn : ob.chipOff}`}
                    >
                      <Icon className="hidden h-3.5 w-3.5 shrink-0 sm:block" />
                      <span className="line-clamp-2">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {step === "roles" && (
          <motion.div key="roles" {...stepMotion}>
            <h1 className={stepTitleClass}>Select relevant roles</h1>
            <p className={stepSubtitleClass}>Pick up to 3 specific roles for your job search.</p>
            {loadingRoles ? (
              <div className={`${ob.stepBody} flex items-center justify-center gap-2 ${ob.muted}`}>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading role examples…</span>
              </div>
            ) : (
            <div className={`${ob.stepBody} ${ob.chipGrid}`} data-testid="role-chips">
              {roleSuggestions.map((role) => {
                const on = selectedRoles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={`${ob.chipGridItem} ${on ? ob.chipOn : ob.chipOff}`}
                  >
                    <span className="line-clamp-2">{role}</span>
                  </button>
                );
              })}
            </div>
            )}
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
                  <span>$0</span>
                  <span>$500,000</span>
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
                setStepIndex(STEP_ORDER.indexOf("showcaseLanding"));
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
          <motion.div key="parsing" className={ob.step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h1 className={ob.title}>
              Reading your CV<span className="text-linkedin">…</span>
            </h1>
            <p className={ob.subtitle}>Building your profile.</p>
            <div className={`${ob.stepBody} space-y-2`}>
              {PARSING_STEPS.map((s, i) => (
                <div key={i} className="flex items-center gap-3" data-testid={`parse-step-${i}`}>
                  {i < parsePhase ? (
                    <CheckCircle2 className={`w-5 h-5 ${ob.accent} shrink-0`} />
                  ) : i === parsePhase ? (
                    <Loader2 className={`w-5 h-5 ${ob.accent} animate-spin shrink-0`} />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-zinc-200 shrink-0" />
                  )}
                  <span className={`text-[15px] ${i <= parsePhase ? "text-zinc-900 font-medium" : ob.dim}`}>{s}</span>
                </div>
              ))}
            </div>
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
      </AnimatePresence>
    </OnboardingShell>
    )}
    </>
  );
}
