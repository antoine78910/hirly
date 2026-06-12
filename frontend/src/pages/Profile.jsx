import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { demoMode } from "../lib/dev";
import { DEMO_PROFILE } from "../lib/demoData";
import {
  User as UserIcon,
  FileText,
  FolderOpen,
  Settings as SettingsIcon,
  ChevronRight,
  Zap,
  Pencil,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import PersonalInfoSheet from "../components/PersonalInfoSheet";
import ResumeSheet from "../components/ResumeSheet";
import ProfessionalProfileSheet from "../components/ProfessionalProfileSheet";
import DocumentsSheet from "../components/DocumentsSheet";
import Sheet, { Field, SaveButton } from "../components/Sheet";
import PlacesAutocomplete, { hasGooglePlacesKey } from "../components/PlacesAutocomplete";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import RolePicker from "../components/RolePicker";
import { TitleHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import { trackEvent } from "../lib/analytics";

const PROFILE_TABS = [
  { key: "resume", label: "Resume", icon: FileText },
  { key: "personal", label: "Personal", icon: UserIcon },
  { key: "files", label: "Files", icon: FolderOpen },
];

const RESUME_SECTIONS = [
  { key: "certifications", title: "Certifications", countKey: null, add: "Add certifications" },
  { key: "awards", title: "Awards", countKey: "awards", add: "Add awards" },
  { key: "coursework", title: "Relevant Coursework", countKey: "coursework", add: "Add coursework" },
  { key: "languages", title: "Languages", countKey: "languages", add: "Add languages" },
  { key: "skills", title: "Skills", countKey: "skills", add: "Add skills" },
];

function JobPreferencesSheet({ open, profile, onClose, onSaved }) {
  const [targetRole, setTargetRole] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [targetLocationData, setTargetLocationData] = useState(null);
  const [remote, setRemote] = useState("any");
  const [seniority, setSeniority] = useState("any");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetRole(profile?.target_role || profile?.target_roles?.[0] || "");
    setTargetLocation(profile?.target_location_data?.location_label || profile?.target_location || "");
    setTargetLocationData(profile?.target_location_data || null);
    setRemote(profile?.remote_preference || "any");
    setSeniority(profile?.seniority || "any");
  }, [open, profile]);

  const save = async () => {
    if (hasGooglePlacesKey() && targetLocation && !targetLocationData) {
      toast.error("Select a location from the suggestions");
      return;
    }
    setSaving(true);
    try {
      await api.put("/profile/preferences", {
        target_role: targetRole,
        target_location: targetLocationData?.location_label || targetLocation,
        target_location_data: targetLocationData,
        remote_preference: remote,
        seniority: seniority === "any" ? null : seniority,
      });
      toast.success("Preferences saved");
      trackEvent("profile_updated", { section: "job_preferences" });
      await onSaved?.();
      onClose();
    } catch (_) {
      toast.error("Could not save preferences");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      title="Job Preferences"
      onClose={onClose}
      testId="job-preferences-sheet"
      footer={<SaveButton saving={saving} onClick={save} testId="job-preferences-save" />}
    >
      <div className="space-y-4">
        <RolePicker value={targetRole} onChange={setTargetRole} testId="job-prefs-role" />
        <PlacesAutocomplete
          label="Target location"
          optional
          value={targetLocation}
          selectedLocation={targetLocationData}
          onInputChange={setTargetLocation}
          onSelect={(loc) => {
            setTargetLocationData(loc);
            if (loc) setTargetLocation(loc.location_label);
          }}
          placeholder="Search for a city or country"
          testId="job-prefs-location"
        />
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">Remote preference</Label>
          <Select value={remote} onValueChange={setRemote}>
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="job-prefs-remote">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sprout-surface border-sprout-border text-white">
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="remote">Remote only</SelectItem>
              <SelectItem value="hybrid">Hybrid</SelectItem>
              <SelectItem value="onsite">On-site</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">Seniority</Label>
          <Select value={seniority} onValueChange={setSeniority}>
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="job-prefs-seniority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sprout-surface border-sprout-border text-white">
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="junior">Junior</SelectItem>
              <SelectItem value="mid">Mid level</SelectItem>
              <SelectItem value="senior">Senior</SelectItem>
              <SelectItem value="lead">Lead</SelectItem>
              <SelectItem value="principal">Principal</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Sheet>
  );
}

function boolSelectValue(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unset";
}

function boolSelectToValue(value) {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function ApplicationDefaultsSheet({ open, profile, onClose, onSaved }) {
  const [defaults, setDefaults] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDefaults({ ...(profile?.application_defaults || {}) });
  }, [open, profile]);

  const update = (key, value) => setDefaults((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/profile/application-defaults", { application_defaults: defaults });
      toast.success("Application defaults saved");
      trackEvent("application_defaults_updated");
      await onSaved?.();
      onClose();
    } catch (_) {
      toast.error("Could not save application defaults");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      title="Application Defaults"
      onClose={onClose}
      testId="application-defaults-sheet"
      footer={<SaveButton saving={saving} onClick={save} testId="application-defaults-save" />}
    >
      <div className="space-y-4">
        <Field
          label="Phone country code"
          value={defaults.phone_country_code}
          onChange={(v) => update("phone_country_code", v)}
          placeholder="+44"
          testId="app-defaults-phone-country-code"
        />
        <Field
          label="Education school"
          value={defaults.education_school}
          onChange={(v) => update("education_school", v)}
          placeholder="University or school"
          testId="app-defaults-education-school"
        />
        <Field
          label="Degree"
          value={defaults.education_degree}
          onChange={(v) => update("education_degree", v)}
          placeholder="Bachelor's Degree"
          testId="app-defaults-education-degree"
        />
        <Field
          label="Field of study"
          value={defaults.education_discipline}
          onChange={(v) => update("education_discipline", v)}
          placeholder="Computer Science"
          testId="app-defaults-education-discipline"
        />
        <Field
          label="Graduation year"
          value={defaults.education_graduation_year}
          onChange={(v) => update("education_graduation_year", v)}
          placeholder="2024"
          testId="app-defaults-education-year"
        />
        <Field
          label="LinkedIn URL"
          value={defaults.linkedin_url}
          onChange={(v) => update("linkedin_url", v)}
          placeholder="https://linkedin.com/in/..."
          testId="app-defaults-linkedin"
        />
        <Field
          label="Website or portfolio"
          value={defaults.website_url}
          onChange={(v) => update("website_url", v)}
          placeholder="https://..."
          testId="app-defaults-website"
        />
        <Field
          label="Current country"
          value={defaults.current_location_country}
          onChange={(v) => update("current_location_country", v)}
          placeholder="United Kingdom"
          testId="app-defaults-current-country"
        />
        <Field
          label="Current city"
          value={defaults.current_location_city}
          onChange={(v) => update("current_location_city", v)}
          placeholder="London"
          testId="app-defaults-current-city"
        />
        <Field
          label="Work-authorized countries"
          value={Array.isArray(defaults.work_authorized_countries) ? defaults.work_authorized_countries.join(", ") : defaults.work_authorized_countries}
          onChange={(v) => update("work_authorized_countries", v.split(",").map((item) => item.trim()).filter(Boolean))}
          placeholder="United Kingdom, United States"
          testId="app-defaults-work-authorized-countries"
        />
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">Requires visa sponsorship</Label>
          <Select value={boolSelectValue(defaults.requires_sponsorship)} onValueChange={(v) => update("requires_sponsorship", boolSelectToValue(v))}>
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="app-defaults-sponsorship">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sprout-surface border-sprout-border text-white">
              <SelectItem value="unset">Not set</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">Willing to relocate</Label>
          <Select value={boolSelectValue(defaults.willing_to_relocate)} onValueChange={(v) => update("willing_to_relocate", boolSelectToValue(v))}>
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="app-defaults-relocate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sprout-surface border-sprout-border text-white">
              <SelectItem value="unset">Not set</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Field
          label="Default referral source"
          value={defaults.referral_source}
          onChange={(v) => update("referral_source", v)}
          placeholder="Hirly"
          testId="app-defaults-referral-source"
        />
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">Privacy consent default</Label>
          <Select value={boolSelectValue(defaults.privacy_consent)} onValueChange={(v) => update("privacy_consent", boolSelectToValue(v))}>
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="app-defaults-privacy-consent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sprout-surface border-sprout-border text-white">
              <SelectItem value="unset">Not set</SelectItem>
              <SelectItem value="yes">I agree</SelectItem>
              <SelectItem value="no">I do not agree</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-xl border border-sprout-border bg-sprout-surface-2 p-4">
          <span>
            <span className="block text-sm font-semibold text-zinc-200">Prefer not to say for demographics</span>
            <span className="mt-1 block text-xs text-sprout-muted">Use decline/prefer-not-to-say options when forms provide them.</span>
          </span>
          <Switch
            checked={Boolean(defaults.prefer_not_to_say_demographics)}
            onCheckedChange={(checked) => update("prefer_not_to_say_demographics", checked)}
            data-testid="app-defaults-prefer-not-demographics"
          />
        </label>
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">Former employer or non-compete restriction</Label>
          <Select
            value={boolSelectValue(defaults.former_employer_restriction_or_noncompete)}
            onValueChange={(v) => update("former_employer_restriction_or_noncompete", boolSelectToValue(v))}
          >
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="app-defaults-noncompete">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sprout-surface border-sprout-border text-white">
              <SelectItem value="unset">Not set</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </Sheet>
  );
}

function profileCompletion(profile) {
  if (!profile) return 0;
  if (typeof profile.profile_completion?.percentage === "number") {
    return profile.profile_completion.percentage;
  }
  const checks = [
    Boolean(profile.cv_text),
    Boolean(profile.contact?.name),
    Boolean(profile.contact?.email),
    Boolean(profile.target_role),
    (profile.skills || []).length > 0,
    (profile.experience || []).length > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim()) || "";
}

export default function Profile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(() => (demoMode ? DEMO_PROFILE : null));
  const [loading, setLoading] = useState(!demoMode);
  const [tab, setTab] = useState("resume");
  const [openSheet, setOpenSheet] = useState(null);
  const [creditsDismissed, setCreditsDismissed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get("/profile");
      if (data) setProfile(data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    trackEvent("profile_view");
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [reload]);

  const completion = useMemo(() => profileCompletion(profile), [profile]);
  const applicationDefaults = profile?.application_defaults || {};
  const primaryEducation = Array.isArray(profile?.education) ? (profile.education[0] || {}) : {};
  const extractedSummary = {
    school: firstValue(primaryEducation.school, applicationDefaults.education_school),
    degree: firstValue(primaryEducation.degree, applicationDefaults.education_degree),
    discipline: firstValue(primaryEducation.discipline, primaryEducation.field_of_study, applicationDefaults.education_discipline),
    graduationYear: firstValue(primaryEducation.graduation_year, primaryEducation.year, applicationDefaults.education_graduation_year),
    linkedin: firstValue(profile?.contact?.linkedin, applicationDefaults.linkedin_url),
    website: firstValue(profile?.contact?.website, applicationDefaults.website_url, applicationDefaults.portfolio_url),
    phoneCountryCode: firstValue(applicationDefaults.phone_country_code),
  };
  const swipeCredits = 40;

  const sectionCount = (key) => {
    if (!key) return 0;
    const val = profile?.[key];
    return Array.isArray(val) ? val.length : 0;
  };

  const showSkeleton = loading && !profile;

  return (
    <AppPage className="bg-white text-zinc-900">
      <TitleHeader
        title="Profile"
        rightAction={(
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="grid h-10 w-10 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100"
            aria-label="Settings"
            data-testid="profile-settings-btn"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        )}
      />

      <AppPageScroll>
        <div className="mx-auto max-w-md space-y-4 px-4">
        {!creditsDismissed ? (
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-3 py-3 shadow-sm">
            <button
              type="button"
              onClick={() => setCreditsDismissed(true)}
              className="text-zinc-300 hover:text-zinc-500"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/credits")}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              data-testid="profile-credits-card"
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-violet-100">
                <Zap className="h-5 w-5 text-linkedin" fill="currentColor" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">
                  <span className="text-amber-500">{swipeCredits}</span> Swipes
                </p>
                <p className="text-xs text-zinc-500">Get More Credits</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300" />
            </button>
          </div>
        ) : null}

        <div className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm ${showSkeleton ? "animate-pulse" : ""}`}>
          <div className="flex items-center gap-4">
            <div
              className="relative grid h-16 w-16 place-items-center rounded-full"
              style={{
                background: showSkeleton
                  ? "#e4e4e7"
                  : `conic-gradient(#7C3AED ${completion * 3.6}deg, #e4e4e7 0deg)`,
              }}
            >
              <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-sm font-bold text-zinc-900">
                {showSkeleton ? "—" : `${completion}%`}
              </div>
            </div>
            <div className="flex-1">
              <p className="font-display text-lg font-bold">Complete your profile</p>
              <p className="text-sm text-zinc-500">Auto-fill more job application fields.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpenSheet("professional")}
            className="mt-4 w-full rounded-full gradient-linkedin py-3 text-sm font-semibold text-white hover:opacity-90"
            data-testid="profile-finish-btn"
          >
            Finish profile
          </button>
        </div>

        <div className="flex border-b border-zinc-200">
          {PROFILE_TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-semibold ${
                  active ? "text-linkedin" : "text-zinc-400"
                }`}
                data-testid={`profile-tab-${t.key}`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
                {t.label}
                {active ? <span className="h-0.5 w-8 rounded-full bg-linkedin" /> : <span className="h-0.5 w-8" />}
              </button>
            );
          })}
        </div>

        {tab === "resume" && (
          <div className="space-y-5 pb-4">
            <button
              type="button"
              onClick={() => setOpenSheet("resume")}
              className="flex w-full items-center justify-between rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-left hover:bg-zinc-50"
            >
              <div>
                <p className="font-semibold text-zinc-900">Your CV</p>
                <p className="text-sm text-zinc-500">
                  {profile?.cv_text ? "Resume uploaded — tap to update" : "Upload your resume"}
                </p>
              </div>
              <Pencil className="h-4 w-4 text-zinc-400" />
            </button>

            {RESUME_SECTIONS.map((section) => {
              const count = sectionCount(section.countKey);
              return (
                <div key={section.key}>
                  <h3 className="mb-2 font-bold text-zinc-900">
                    {section.title}
                    {section.countKey ? ` (${count})` : ""}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setOpenSheet("professional")}
                    className="flex w-full items-center justify-between rounded-xl border border-dashed border-zinc-300 px-4 py-4 text-left hover:bg-zinc-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-violet-50 text-linkedin">
                        <Plus className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-zinc-900">{section.add}</p>
                        {section.key === "languages" ? (
                          <p className="text-sm text-zinc-500">Highlight the languages you speak and your proficiency.</p>
                        ) : null}
                      </div>
                    </div>
                    <Plus className="h-5 w-5 text-linkedin" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === "personal" && (
          <div className="space-y-3 pb-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-zinc-900">Extracted application data</p>
                  <p className="text-sm text-zinc-600">Reusable CV details used for job forms</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenSheet("application-defaults")}
                  className="text-sm font-semibold text-linkedin hover:opacity-80"
                >
                  Edit
                </button>
              </div>
              <div className="mt-4 grid gap-3 text-sm">
                {[
                  ["School", extractedSummary.school],
                  ["Degree", extractedSummary.degree],
                  ["Field of study", extractedSummary.discipline],
                  ["Graduation year", extractedSummary.graduationYear],
                  ["LinkedIn", extractedSummary.linkedin],
                  ["Website or portfolio", extractedSummary.website],
                  ["Phone country code", extractedSummary.phoneCountryCode],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-2 last:border-b-0 last:pb-0">
                    <span className="text-zinc-600">{label}</span>
                    <span className="max-w-[60%] break-words text-right font-medium text-zinc-900">
                      {value || "Not set"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpenSheet("personal")}
              className="flex w-full items-center justify-between border-b border-zinc-100 py-4 text-left"
            >
              <div>
                <p className="font-semibold">Personal details</p>
                <p className="text-sm text-zinc-500">{profile?.contact?.name || "Add your name"}</p>
              </div>
              <Pencil className="h-4 w-4 text-zinc-400" />
            </button>
            <button
              type="button"
              onClick={() => setOpenSheet("preferences")}
              className="flex w-full items-center justify-between border-b border-zinc-100 py-4 text-left"
            >
              <div>
                <p className="font-semibold">Job preferences</p>
                <p className="text-sm text-zinc-500">{profile?.target_role || "Set target role"}</p>
              </div>
              <Pencil className="h-4 w-4 text-zinc-400" />
            </button>
            <button
              type="button"
              onClick={() => setOpenSheet("application-defaults")}
              className="flex w-full items-center justify-between border-b border-zinc-100 py-4 text-left"
              data-testid="profile-application-defaults-card"
            >
              <div>
                <p className="font-semibold">Application defaults</p>
                <p className="text-sm text-zinc-500">Reusable answers for one-swipe applications</p>
              </div>
              <ShieldCheck className="h-4 w-4 text-zinc-400" />
            </button>
          </div>
        )}

        {tab === "files" && (
          <div className="pb-4">
            <button
              type="button"
              onClick={() => setOpenSheet("documents")}
              className="flex w-full items-center justify-between rounded-xl border border-dashed border-zinc-300 px-4 py-4 text-left hover:bg-zinc-50"
            >
              <div>
                <p className="font-semibold text-zinc-900">Other files</p>
                <p className="text-sm text-zinc-500">Transcripts, portfolios, certificates…</p>
              </div>
              <Plus className="h-5 w-5 text-linkedin" />
            </button>
          </div>
        )}
        </div>
      </AppPageScroll>

      <PersonalInfoSheet
        open={openSheet === "personal"}
        profile={profile}
        userEmail={user?.email}
        onClose={() => setOpenSheet(null)}
        onSaved={reload}
      />
      <JobPreferencesSheet
        open={openSheet === "preferences"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
        onSaved={reload}
      />
      <ApplicationDefaultsSheet
        open={openSheet === "application-defaults"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
        onSaved={reload}
      />
      <ResumeSheet
        open={openSheet === "resume"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
        onUploaded={reload}
      />
      <ProfessionalProfileSheet
        open={openSheet === "professional"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
        onChange={reload}
      />
      <DocumentsSheet
        open={openSheet === "documents"}
        profile={profile}
        onClose={() => setOpenSheet(null)}
      />
    </AppPage>
  );
}
