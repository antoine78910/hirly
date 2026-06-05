import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Slider } from "../components/ui/slider";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import PlacesAutocomplete, { hasGooglePlacesKey } from "../components/PlacesAutocomplete";
import RolePicker from "../components/RolePicker";
import { BRAND } from "../lib/brand";
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
  JOB_PRIORITIES,
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

export default function Onboarding() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, setHasProfile, setHasPreferences } = useAuth();

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
  const [jobPriorities, setJobPriorities] = useState([]);
  const [triedOtherApps, setTriedOtherApps] = useState(null);
  const [attribution, setAttribution] = useState(null);
  const [suggestedCategories, setSuggestedCategories] = useState([]);
  const [suggestedRoles, setSuggestedRoles] = useState([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(false);

  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsePhase, setParsePhase] = useState(0);
  const [profile, setProfile] = useState(null);
  const [targetRole, setTargetRole] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [targetLocationData, setTargetLocationData] = useState(null);
  const [remote, setRemote] = useState("any");
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const step = STEP_ORDER[stepIndex];
  const progress = ((stepIndex + (step === "intro" ? (introIndex + 1) / INTRO_SLIDES.length : 1)) / STEP_ORDER.length) * 100;

  const roleSuggestions = useMemo(() => {
    if (suggestedRoles.length) return suggestedRoles;
    return rolesForCategories(categories);
  }, [suggestedRoles, categories]);
  const interviewHint = interviewFeedback(interviewsPerWeek);
  const categoryOptions = suggestedCategories.length
    ? suggestedCategories
    : JOB_CATEGORIES.map(({ id, label }) => ({ id, label }));

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
        setSuggestedRoles(rolesForCategories(categories));
      })
      .finally(() => {
        if (!cancelled) setLoadingRoles(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, categories, suggestedCategories, onboardingLocation, contractType, onboardingLocationData]);

  useEffect(() => {
    if (step !== "preferences" || targetLocation) return;
    if (!onboardingLocation) return;
    setTargetLocation(onboardingLocation);
    setTargetLocationData(onboardingLocationData);
  }, [step, onboardingLocation, onboardingLocationData, targetLocation]);

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

  const togglePriority = (id) => {
    setJobPriorities((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 3) {
        toast.message("Pick up to 3 interests");
        return prev;
      }
      return [...prev, id];
    });
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
      setHasProfile(true);
      const primary = selectedRoles[0] || (data.target_roles && data.target_roles[0]) || "";
      setTargetRole(primary);
      setTargetLocation(data.contact?.location || "");
      setTargetLocationData(null);
      toast.success("Your profile is ready");
      setStepIndex(STEP_ORDER.indexOf("welcome"));
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
          job_priorities: jobPriorities,
          tried_other_apps: triedOtherApps,
          categories,
          suggested_categories: suggestedCategories,
          selected_roles: selectedRoles,
          interviews_per_week: interviewsPerWeek,
          acquisition_source: attribution,
          salary_min: salaryMin,
          salary_max: salaryMax,
        },
      });
    } catch (e) {
      console.warn("extras save skipped", e);
    }
  };

  const handlePrefs = async () => {
    if (!user) {
      startGoogleLogin("/onboarding");
      return;
    }
    if (hasGooglePlacesKey() && targetLocation && !targetLocationData) {
      toast.error("Select a location from the suggestions");
      return;
    }
    setSaving(true);
    try {
      await persistOnboardingMeta();
      const exp = EXPERIENCE_LEVELS.find((e) => e.id === experience);
      await api.put("/profile/preferences", {
        target_role: targetRole || selectedRoles[0],
        target_roles: selectedRoles.length ? selectedRoles : targetRole ? [targetRole] : undefined,
        target_location:
          targetLocationData?.location_label
          || targetLocation
          || onboardingLocationData?.location_label
          || onboardingLocation,
        target_location_data: targetLocationData || onboardingLocationData,
        remote_preference: remote,
        seniority: exp?.backend,
      });
      setHasPreferences(true);
      navigate("/swipe", { replace: true });
    } catch {
      toast.error("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  const skipPrefs = async () => {
    setSaving(true);
    try {
      await persistOnboardingMeta();
      const exp = EXPERIENCE_LEVELS.find((e) => e.id === experience);
      await api.put("/profile/preferences", {
        target_role: targetRole || selectedRoles[0] || profile?.target_roles?.[0] || "Software Engineer",
        target_roles: selectedRoles.length ? selectedRoles : undefined,
        target_location: "",
        target_location_data: null,
        remote_preference: "any",
        seniority: exp?.backend,
      });
      setHasPreferences(true);
      navigate("/swipe", { replace: true });
    } catch {
      toast.error("Failed");
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
      case "jobPriorities":
        return jobPriorities.length > 0;
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
      case "upload":
        return !parsing;
      case "welcome":
        return true;
      case "preferences":
        return !!targetRole;
      default:
        return false;
    }
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
    if (step === "welcome") {
      setStepIndex(STEP_ORDER.indexOf("preferences"));
      return;
    }
    goNext();
  };

  const introSlide = INTRO_SLIDES[introIndex];
  const isLastIntroSlide = step === "intro" && introIndex === INTRO_SLIDES.length - 1;
  const hideFooter = parsing || (step === "signup" && !user);

  const footer = !hideFooter && step !== "preferences" ? (
    <ContinueButton onClick={onContinue} disabled={!canContinue() || parsing}>
      {isLastIntroSlide ? (
        "Get Started"
      ) : step === "intro" ? (
        "Continue"
      ) : step === "signup" ? (
        "Continue"
      ) : step === "upload" && !file ? (
        "Upload resume"
      ) : step === "welcome" ? (
        "Continue"
      ) : (
        "Continue"
      )}
    </ContinueButton>
  ) : step === "preferences" && !hideFooter ? (
    <>
      <ContinueButton
        onClick={handlePrefs}
        disabled={!targetRole || saving}
        testId="start-swiping-btn"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : (
          <span className="inline-flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4" /> Start swiping <ArrowRight className="w-4 h-4" />
          </span>
        )}
      </ContinueButton>
      <button
        type="button"
        onClick={skipPrefs}
        className={`mt-3 w-full text-sm ${ob.muted} hover:text-zinc-900`}
        data-testid="skip-prefs-btn"
      >
        Skip — just show me jobs
      </button>
    </>
  ) : null;

  return (
    <>
    {step === "signup" ? (
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
          <motion.div
            key={`intro-${introIndex}`}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28 }}
            className="flex flex-1 flex-col items-center justify-center text-center w-full gap-6 sm:gap-8 py-2 sm:py-4"
          >
            <div className="flex items-center justify-center w-full shrink-0">
              <OnboardingIllustration src={introSlide.image} alt="" large />
            </div>
            <div className="flex flex-col items-center gap-3 sm:gap-4 w-full max-w-md mx-auto">
              <h1 className={ob.introTitle}>{introSlide.title}</h1>
              <p className={ob.introBody}>{introSlide.body}</p>
            </div>
            <div className="flex items-center justify-center gap-2 mt-2 sm:mt-4 shrink-0">
              {INTRO_SLIDES.map((_, i) => (
                <div
                  key={i}
                  className={`h-2 rounded-full transition-all ${i === introIndex ? "w-6 gradient-linkedin" : "w-2 bg-zinc-200"}`}
                />
              ))}
            </div>
          </motion.div>
        )}

        {step === "jobSearch" && (
          <motion.div key="jobSearch" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>Are you looking for a new job?</h1>
            <div className="mt-6 sm:mt-8 space-y-2 sm:space-y-3" data-testid="job-search-options">
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
          <motion.div key="location" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>Where are you looking for work?</h1>
            <p className={stepSubtitleClass}>
              We&apos;ll suggest job types that are popular in your area.
            </p>
            <div className="mt-6">
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
                testId="onboarding-location"
              />
            </div>
          </motion.div>
        )}

        {step === "contractType" && (
          <motion.div key="contractType" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>What type of job are you looking for?</h1>
            <p className={stepSubtitleClass}>Select the contract or duration that fits you best.</p>
            <div className="mt-6 sm:mt-8 space-y-2 sm:space-y-3 max-h-[55vh] overflow-y-auto pr-1" data-testid="contract-type-options">
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

        {step === "jobPriorities" && (
          <motion.div key="jobPriorities" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>What&apos;s most important in a new job?</h1>
            <p className={stepSubtitleClass}>This will be used to calibrate your job matches.</p>
            <p className={`mt-4 text-sm font-medium ${ob.muted}`} data-testid="priorities-counter">
              Select {jobPriorities.length}/3 interests
            </p>
            <div className="mt-4 flex flex-wrap gap-2" data-testid="job-priorities">
              {JOB_PRIORITIES.map(({ id, label, Icon }) => {
                const on = jobPriorities.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => togglePriority(id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-full text-sm font-medium border transition-all ${
                      on ? ob.chipOn : ob.chipOff
                    }`}
                    data-testid={`priority-${id}`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {step === "otherApps" && (
          <motion.div key="otherApps" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>Have you tried other job search apps?</h1>
            <p className={stepSubtitleClass}>Please select one of the options below.</p>
            <div className="mt-6 sm:mt-8 space-y-2 sm:space-y-3" data-testid="other-apps-options">
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
          <motion.div key="categories" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>What kind of job are you looking for?</h1>
            <p className={stepSubtitleClass}>
              {onboardingLocation
                ? `Suggested for ${onboardingLocationData?.location_label || onboardingLocation}. Pick up to 3.`
                : "Select up to 3 job categories that interest you most."}
            </p>
            {loadingCategories ? (
              <div className={`mt-10 flex items-center justify-center gap-2 ${ob.muted}`}>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Finding categories for your area…</span>
              </div>
            ) : (
              <div className="mt-6 flex flex-wrap gap-2" data-testid="job-categories">
                {categoryOptions.map(({ id, label }) => {
                  const Icon = iconForCategoryLabel(label);
                  const on = categories.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleCategory(id)}
                      className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-full text-sm font-medium border transition-all ${
                        on ? ob.chipOn : ob.chipOff
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {step === "roles" && (
          <motion.div key="roles" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>Select relevant roles</h1>
            <p className={stepSubtitleClass}>Pick up to 3 specific roles for your job search.</p>
            {loadingRoles ? (
              <div className={`mt-10 flex items-center justify-center gap-2 ${ob.muted}`}>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading role examples…</span>
              </div>
            ) : (
            <div className="mt-6 flex flex-wrap gap-2 max-h-[50vh] overflow-y-auto pr-1" data-testid="role-chips">
              {roleSuggestions.map((role) => {
                const on = selectedRoles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={`px-3.5 py-2 rounded-full text-sm font-medium border transition-all ${
                      on ? ob.chipOn : ob.chipOff
                    }`}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
            )}
          </motion.div>
        )}

        {step === "experience" && (
          <motion.div key="experience" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>How much experience do you have?</h1>
            <p className={stepSubtitleClass}>Select your experience level below.</p>
            <div className="mt-6 space-y-2">
              {EXPERIENCE_LEVELS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setExperience(id)}
                  className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl border text-left transition-all ${
                    experience === id ? ob.optionOn : ob.optionOff
                  }`}
                  data-testid={`experience-${id}`}
                >
                  <Icon className={`w-6 h-6 ${ob.accent} shrink-0`} />
                  <span className="font-medium text-[15px] text-zinc-900">{label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === "salary" && (
          <motion.div key="salary" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>Expected salary range?</h1>
            <p className={stepSubtitleClass}>Set your range to help match you with the right jobs.</p>
            <div className="mt-8 space-y-8">
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
          <motion.div key="interviews" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }} className="text-center">
            <h1 className={stepTitleClass}>Interviews per week</h1>
            <p className={stepSubtitleClass}>This will be used to calibrate your custom plan.</p>
            <p className="mt-12 font-display font-black text-4xl text-zinc-900">
              {interviewsPerWeek} <span className={`text-2xl font-semibold ${ob.dim}`}>interviews</span>
            </p>
            <div className="mt-10 px-2">
              <Slider
                value={[interviewsPerWeek]}
                min={1}
                max={10}
                step={1}
                onValueChange={([v]) => setInterviewsPerWeek(v)}
                className={ob.slider}
              />
            </div>
            <div className={`mt-6 inline-flex items-center gap-2 text-sm font-semibold ${interviewHint.tone === "good" ? ob.accent : ob.muted}`}>
              <CheckCircle2 className="w-4 h-4" />
              {interviewHint.label}
            </div>
          </motion.div>
        )}

        {step === "interviewsConfirm" && (
          <motion.div key="interviewsConfirm" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>
              Getting {interviewsPerWeek} interviews/week is totally achievable!
            </h1>
            <InterviewTargetDashes count={Math.min(interviewsPerWeek, 8)} />
            <div className={`mt-8 sm:mt-10 ${ob.cardInner} p-6 sm:p-8 text-center`}>
              <p className="font-bold text-lg sm:text-xl text-zinc-900">You&apos;re right on track!</p>
              <p className={`text-sm sm:text-base ${ob.muted} mt-3 leading-relaxed`}>
                {interviewsPerWeek} interviews per week is what 75% of our successful users aim for.
              </p>
            </div>
          </motion.div>
        )}

        {step === "potentialChart" && (
          <motion.div key="potentialChart" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>You have great potential to crush your goal</h1>
            <div className="mt-6 sm:mt-8">
              <InterviewRateChart />
            </div>
          </motion.div>
        )}

        {step === "compare2x" && (
          <motion.div key="compare2x" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>
              Land twice as many interviews with {BRAND.NAME} vs on your own.
            </h1>
            <div className="mt-6 sm:mt-8">
              <Compare2xChart />
            </div>
          </motion.div>
        )}

        {step === "longTerm" && (
          <motion.div key="longTerm" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>{BRAND.NAME} creates long-term results</h1>
            <div className="mt-6 sm:mt-8">
              <LongTermResultsChart />
            </div>
          </motion.div>
        )}

        {step === "attribution" && (
          <motion.div key="attribution" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={`${stepTitleClass} text-center sm:text-left`}>How did you hear about us?</h1>
            <div className="mt-6 sm:mt-8 space-y-2 sm:space-y-3">
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

        {step === "upload" && !parsing && (
          <motion.div key="upload" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>Upload your resume</h1>
            <p className={stepSubtitleClass}>Upload your resume so we can build your profile and start applying to jobs right away.</p>

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
              className={`mt-8 block border-2 border-dashed rounded-2xl p-10 text-center transition-all bg-white cursor-pointer ${
                dragOver ? "border-linkedin bg-linkedin-light scale-[1.01]" : "border-zinc-200 hover:border-linkedin/40"
              }`}
            >
              {!file ? (
                <>
                  <div className={`w-16 h-16 mx-auto rounded-2xl ${ob.accentSoft} flex items-center justify-center mb-4`}>
                    <FileText className={`w-8 h-8 ${ob.accent}`} />
                  </div>
                  <p className="font-semibold text-zinc-900">No resume selected</p>
                  <p className={`text-sm ${ob.muted} mt-1`}>PDF or DOCX supported</p>
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
                setStepIndex(STEP_ORDER.indexOf("welcome"));
                toast.message("You can upload your resume later from Profile");
              }}
              className={`mt-4 w-full text-center text-sm ${ob.muted} hover:text-zinc-900 underline-offset-2 hover:underline`}
            >
              Skip for now
            </button>
          </motion.div>
        )}

        {parsing && (
          <motion.div key="parsing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h1 className={ob.title}>
              Reading your CV<span className="text-linkedin">…</span>
            </h1>
            <p className={ob.subtitle}>Building your profile.</p>
            <div className="mt-10 space-y-3">
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

        {step === "welcome" && !parsing && (
          <motion.div key="welcome" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            <h1 className={stepTitleClass}>Welcome to {BRAND.NAME}!</h1>
            <p className={stepSubtitleClass}>Based on your profile, here&apos;s how we&apos;ll help you succeed:</p>
            <div className="mt-6 space-y-3">
              {[
                {
                  title: "Scale your career fast",
                  body: `Target roles like ${selectedRoles.slice(0, 2).join(" & ") || "your picks"} in the ${formatSalary(salaryMin)}–${formatSalary(salaryMax)} range.`,
                },
                {
                  title: "Apply at light speed",
                  body: "Swipe right and let AI tailor your CV and cover letter for every application.",
                },
                {
                  title: "Land your next win",
                  body: `Stay on track for ~${interviewsPerWeek} interviews per week with smart prep and tracking.`,
                },
              ].map((card, i) => (
                <div key={i} className={`${ob.card} p-4`}>
                  <p className="font-bold text-zinc-900">{i + 1}. {card.title}</p>
                  <p className={`text-sm ${ob.muted} mt-2 leading-relaxed`}>{card.body}</p>
                </div>
              ))}
            </div>
            <p className={`mt-6 text-center text-sm ${ob.dim}`}>Let&apos;s make sure you&apos;re ready</p>
          </motion.div>
        )}

        {step === "preferences" && !parsing && (
          <motion.div key="preferences" variants={slideVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.28 }}>
            {profile && (
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${ob.accentSoft} ${ob.accent} text-xs font-semibold mb-5`}>
                <Check className="w-3.5 h-3.5" /> Profile ready
              </div>
            )}
            <>
            <h1 className={stepTitleClass}>Fine-tune your search</h1>
            <p className={stepSubtitleClass}>Location and work style — change anytime in Settings.</p>

            {profile?.target_roles?.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {profile.target_roles.slice(0, 6).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTargetRole(r)}
                    className={`text-sm font-medium px-3.5 py-2 rounded-full border transition-colors ${
                      targetRole === r ? ob.chipOn : ob.chipOff
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-6 space-y-4">
              <RolePicker value={targetRole} onChange={setTargetRole} testId="target-role-picker" variant="light" />
              <PlacesAutocomplete
                label="Location"
                optional
                variant="light"
                value={targetLocation}
                selectedLocation={targetLocationData}
                onInputChange={setTargetLocation}
                onSelect={(loc) => {
                  setTargetLocationData(loc);
                  if (loc) setTargetLocation(loc.location_label);
                }}
                placeholder="e.g. New York or United Kingdom"
                testId="target-location"
              />
              <div>
                <Label className="text-sm font-semibold text-zinc-700">Remote preference</Label>
                <Select value={remote} onValueChange={setRemote}>
                  <SelectTrigger className="mt-1.5 h-11 rounded-xl bg-white border-zinc-200 text-zinc-900" data-testid="remote-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-zinc-200 text-zinc-900">
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="remote">Remote only</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                    <SelectItem value="onsite">On-site</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            </>
          </motion.div>
        )}
      </AnimatePresence>
    </OnboardingShell>
    )}
    </>
  );
}
