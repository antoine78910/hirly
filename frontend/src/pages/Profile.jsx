import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { demoMode } from "../lib/dev";
import { DEMO_PROFILE } from "../lib/demoData";
import { useSwipeCredits } from "../components/desktop/DesktopCreditsPill";
import { useUpgradeModal } from "../context/UpgradeModalContext";
import {
  User as UserIcon,
  FileText,
  FolderOpen,
  Settings as SettingsIcon,
  ChevronRight,
  Zap,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import ProfilePersonalInfoTab from "../components/profile/ProfilePersonalInfoTab";
import ProfileDocumentsTab from "../components/profile/ProfileDocumentsTab";
import ResumeSheet from "../components/ResumeSheet";
import ProfessionalProfileSheet from "../components/ProfessionalProfileSheet";
import Sheet, { Field, SaveButton } from "../components/Sheet";
import PlacesAutocomplete, { hasGooglePlacesKey } from "../components/PlacesAutocomplete";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import RolePicker from "../components/RolePicker";
import { TitleHeader } from "../components/app/AppScreenHeader";
import { AppPage, AppPageScroll, SHELL_PAGE_CLASS } from "../components/app/AppPageShell";
import DesktopPageHeader from "../components/desktop/DesktopPageHeader";
import { APP_CONTENT_WIDTH } from "../lib/desktopLayout";
import { trackEvent } from "../lib/analytics";
import { useAppLocale } from "../context/AppLocaleContext";
import { getResumeSections } from "../lib/appUi";
import LanguageSettingSection from "../components/settings/LanguageSettingSection";

const PROFILE_TAB_ICONS = {
  resume: FileText,
  personal: UserIcon,
  documents: FolderOpen,
};

function JobPreferencesSheet({ open, profile, onClose, onSaved }) {
  const { t } = useAppLocale();
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
      toast.error(t("profile.selectLocation"));
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
      toast.success(t("profile.preferencesSaved"));
      trackEvent("profile_updated", { section: "job_preferences" });
      await onSaved?.();
      onClose();
    } catch (_) {
      toast.error(t("profile.preferencesError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={t("profile.jobPreferences")}
      onClose={onClose}
      testId="job-preferences-sheet"
      footer={<SaveButton saving={saving} onClick={save} testId="job-preferences-save" />}
    >
      <div className="space-y-4">
        <RolePicker value={targetRole} onChange={setTargetRole} testId="job-prefs-role" />
        <PlacesAutocomplete
          label={t("profile.targetLocation")}
          optional
          value={targetLocation}
          selectedLocation={targetLocationData}
          onInputChange={setTargetLocation}
          onSelect={(loc) => {
            setTargetLocationData(loc);
            if (loc) setTargetLocation(loc.location_label);
          }}
          placeholder={t("profileSections.locationPlaceholder")}
          testId="job-prefs-location"
        />
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">{t("profile.remotePreference")}</Label>
          <Select value={remote} onValueChange={setRemote}>
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="job-prefs-remote">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sprout-surface border-sprout-border text-white">
              <SelectItem value="any">{t("profile.any")}</SelectItem>
              <SelectItem value="remote">{t("profile.remoteOnly")}</SelectItem>
              <SelectItem value="hybrid">{t("swipe.hybrid")}</SelectItem>
              <SelectItem value="onsite">{t("profile.onsite")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">{t("profile.seniority")}</Label>
          <Select value={seniority} onValueChange={setSeniority}>
            <SelectTrigger className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white" data-testid="job-prefs-seniority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-sprout-surface border-sprout-border text-white">
              <SelectItem value="any">{t("profile.any")}</SelectItem>
              <SelectItem value="junior">{t("swipe.entryLevel")}</SelectItem>
              <SelectItem value="mid">{t("swipe.midLevel")}</SelectItem>
              <SelectItem value="senior">{t("swipe.senior")}</SelectItem>
              <SelectItem value="lead">{t("swipe.lead")}</SelectItem>
              <SelectItem value="principal">{t("swipe.principal")}</SelectItem>
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
  const { t } = useAppLocale();
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
      toast.success(t("profile.defaultsSaved"));
      trackEvent("application_defaults_updated");
      await onSaved?.();
      onClose();
    } catch (_) {
      toast.error(t("profile.defaultsError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={t("profileSections.applicationDefaults")}
      onClose={onClose}
      testId="application-defaults-sheet"
      footer={<SaveButton saving={saving} onClick={save} testId="application-defaults-save" />}
    >
      <div className="space-y-4">
        <Field
          label={t("profileSections.phoneCountryCode")}
          value={defaults.phone_country_code}
          onChange={(v) => update("phone_country_code", v)}
          placeholder="+44"
          testId="app-defaults-phone-country-code"
        />
        <Field
          label={t("profileSections.educationSchool")}
          value={defaults.education_school}
          onChange={(v) => update("education_school", v)}
          placeholder={t("profileSections.schoolPlaceholder")}
          testId="app-defaults-education-school"
        />
        <Field
          label={t("profileSections.degree")}
          value={defaults.education_degree}
          onChange={(v) => update("education_degree", v)}
          placeholder={t("profileSections.degreePlaceholder")}
          testId="app-defaults-education-degree"
        />
        <Field
          label={t("profileSections.fieldOfStudy")}
          value={defaults.education_discipline}
          onChange={(v) => update("education_discipline", v)}
          placeholder={t("profileSections.fieldPlaceholder")}
          testId="app-defaults-education-discipline"
        />
        <Field
          label={t("profileSections.graduationYear")}
          value={defaults.education_graduation_year}
          onChange={(v) => update("education_graduation_year", v)}
          placeholder="2024"
          testId="app-defaults-education-year"
        />
        <Field
          label={t("profileSections.linkedinUrl")}
          value={defaults.linkedin_url}
          onChange={(v) => update("linkedin_url", v)}
          placeholder="https://linkedin.com/in/..."
          testId="app-defaults-linkedin"
        />
        <Field
          label={t("profileSections.websitePortfolio")}
          value={defaults.website_url}
          onChange={(v) => update("website_url", v)}
          placeholder="https://..."
          testId="app-defaults-website"
        />
        <Field
          label={t("profileSections.currentCountry")}
          value={defaults.current_location_country}
          onChange={(v) => update("current_location_country", v)}
          placeholder={t("profileSections.countryPlaceholder")}
          testId="app-defaults-current-country"
        />
        <Field
          label={t("profileSections.currentCity")}
          value={defaults.current_location_city}
          onChange={(v) => update("current_location_city", v)}
          placeholder={t("profileSections.cityPlaceholder")}
          testId="app-defaults-current-city"
        />
        <Field
          label={t("profileSections.workAuthorized")}
          value={Array.isArray(defaults.work_authorized_countries) ? defaults.work_authorized_countries.join(", ") : defaults.work_authorized_countries}
          onChange={(v) => update("work_authorized_countries", v.split(",").map((item) => item.trim()).filter(Boolean))}
          placeholder={t("profileSections.workAuthorizedPlaceholder")}
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
          label={t("profileSections.referralSource")}
          value={defaults.referral_source}
          onChange={(v) => update("referral_source", v)}
          placeholder={t("profileSections.referralPlaceholder")}
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

export default function Profile() {
  const { t } = useAppLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { displayCredits, isPremium } = useSwipeCredits();
  const { openUpgrade } = useUpgradeModal();
  const [profile, setProfile] = useState(() => (demoMode ? DEMO_PROFILE : null));
  const [loading, setLoading] = useState(!demoMode);
  const [tab, setTab] = useState("resume");
  const [openSheet, setOpenSheet] = useState(null);
  const [creditsDismissed, setCreditsDismissed] = useState(false);

  const profileTabs = useMemo(() => ([
    { key: "resume", label: t("profile.resume"), icon: PROFILE_TAB_ICONS.resume },
    { key: "personal", label: t("profile.personal"), icon: PROFILE_TAB_ICONS.personal },
    { key: "documents", label: t("profile.documentsTab"), icon: PROFILE_TAB_ICONS.documents },
  ]), [t]);

  const resumeSections = useMemo(() => getResumeSections(t), [t]);

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
  const swipeCredits = displayCredits;

  const sectionCount = (key) => {
    if (!key) return 0;
    const val = profile?.[key];
    return Array.isArray(val) ? val.length : 0;
  };

  const showSkeleton = loading && !profile;

  return (
    <AppPage className={SHELL_PAGE_CLASS}>
      <TitleHeader
        title={t("profile.title")}
        rightAction={(
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="grid h-10 w-10 place-items-center rounded-full text-zinc-500 shell-hover dark:text-zinc-400"
            aria-label={t("profileSections.settings")}
            data-testid="profile-settings-btn"
          >
            <SettingsIcon className="h-5 w-5" />
          </button>
        )}
      />

      <AppPageScroll>
        <div className={`${APP_CONTENT_WIDTH} space-y-4 md:space-y-6`}>
        <DesktopPageHeader
          title={t("profile.title")}
          subtitle={t("profile.subtitle")}
          actions={(
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="shell-btn-outline hidden px-4 py-2 text-sm font-semibold md:inline-flex md:items-center md:gap-2"
            >
              <SettingsIcon className="h-4 w-4" />
              {t("nav.aiSettings")}
            </button>
          )}
        />
        {!creditsDismissed ? (
          <div className="shell-surface flex items-center gap-3 px-3 py-3">
            <button
              type="button"
              onClick={() => setCreditsDismissed(true)}
              className="text-zinc-300 hover:text-zinc-500"
              aria-label={t("profileSections.dismiss")}
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isPremium) openUpgrade();
              }}
              className={`flex min-w-0 flex-1 items-center gap-3 text-left ${isPremium ? "cursor-default" : ""}`}
              data-testid="profile-credits-card"
            >
              <div className="grid h-10 w-10 place-items-center rounded-full bg-violet-100">
                <Zap className="h-5 w-5 text-linkedin" fill="currentColor" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">
                  <span className="text-amber-500">{swipeCredits}</span> {isPremium ? t("common.unlimited") : t("common.credits")}
                </p>
                <p className="text-xs shell-body">{isPremium ? t("profile.unlimitedSwipes") : t("profile.upgradePlan")}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300" />
            </button>
          </div>
        ) : null}

        <div className={`shell-surface p-4 ${showSkeleton ? "animate-pulse" : ""}`}>
          <div className="flex items-center gap-4">
            <div
              className="relative grid h-16 w-16 place-items-center rounded-full"
              style={{
                background: showSkeleton
                  ? "#e4e4e7"
                  : `conic-gradient(#7C3AED ${completion * 3.6}deg, #e4e4e7 0deg)`,
              }}
            >
              <div className="grid h-12 w-12 place-items-center rounded-full bg-white text-sm font-bold shell-title dark:bg-zinc-800">
                {showSkeleton ? "—" : `${completion}%`}
              </div>
            </div>
            <div className="flex-1">
              <p className="font-display text-lg font-bold">{t("profile.completeProfile")}</p>
              <p className="text-sm shell-body">{t("profile.completeProfileBody")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpenSheet("professional")}
            className="mt-4 w-full rounded-full gradient-linkedin py-3 text-sm font-semibold text-white hover:opacity-90"
            data-testid="profile-finish-btn"
          >
            {t("profile.finishProfile")}
          </button>
        </div>

        <LanguageSettingSection variant="profile" />

        <div className="shell-border-b flex">
          {profileTabs.map((tabItem) => {
            const Icon = tabItem.icon;
            const active = tab === tabItem.key;
            return (
              <button
                key={tabItem.key}
                type="button"
                onClick={() => setTab(tabItem.key)}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-3 text-center ${
                  active ? "text-linkedin" : "shell-tab-inactive"
                }`}
                data-testid={`profile-tab-${tabItem.key}`}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.4 : 1.8} />
                <span className="w-full min-w-0 text-[10px] font-semibold leading-tight [overflow-wrap:anywhere] sm:text-xs">
                  {tabItem.label}
                </span>
                {active ? <span className="h-0.5 w-8 rounded-full gradient-linkedin" /> : <span className="h-0.5 w-8" />}
              </button>
            );
          })}
        </div>

        {tab === "resume" && (
          <div className="space-y-5 pb-4">
            {resumeSections.map((section) => {
              const count = sectionCount(section.countKey);
              return (
                <div key={section.key}>
                  <h3 className="shell-title mb-2 font-bold">
                    {section.title}
                    {section.countKey ? ` (${count})` : ""}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setOpenSheet("professional")}
                    className="shell-dashed shell-hover flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-violet-50 text-linkedin">
                        <Plus className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="shell-title font-semibold">{section.add}</p>
                        {section.key === "languages" ? (
                          <p className="text-sm shell-body">{t("profileSections.languagesHint")}</p>
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
          <ProfilePersonalInfoTab
            profile={profile}
            userEmail={user?.email}
            onSaved={reload}
          />
        )}

        {tab === "documents" && (
          <ProfileDocumentsTab
            profile={profile}
            onUploadResume={() => setOpenSheet("resume")}
            onDocumentsChange={reload}
          />
        )}
        </div>
      </AppPageScroll>

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
    </AppPage>
  );
}
