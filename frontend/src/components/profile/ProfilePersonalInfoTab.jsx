import { useEffect, useMemo, useState } from "react";
import { Calendar, Globe, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { demoMode } from "../../lib/dev";
import { formatMoney, formatSalary } from "../../lib/currency";
import { useAppLocale } from "../../context/AppLocaleContext";
import PlacesAutocomplete, { hasGooglePlacesKey } from "../PlacesAutocomplete";
import ProfileFormSection from "./ProfileFormSection";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Slider } from "../ui/slider";
import {
  buildPersonalInfoState,
  getGenderOptions,
  getEthnicityOptions,
  getDisabilityOptions,
  getSexualOrientationOptions,
  getVeteranOptions,
  getCitizenshipStatusOptions,
  labelForStoredOption,
} from "../../lib/personalInfoOptions";

const SALARY_MAX = 500_000;
const SALARY_STEP = 5_000;

function SaveButton({ disabled, saving, onClick, testId }) {
  const { t } = useAppLocale();
  return (
    <Button type="button" variant="brand" disabled={disabled || saving} onClick={onClick} data-testid={testId}>
      {saving ? t("common.loading") : t("common.save")}
    </Button>
  );
}

function FieldBlock({ label, htmlFor, children }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="shell-title text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}

function snapshotsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function ProfilePersonalInfoTab({ profile, userEmail, onSaved }) {
  const { t, lang } = useAppLocale();
  const baseline = useMemo(() => buildPersonalInfoState(profile, userEmail), [profile, userEmail]);

  const [contact, setContact] = useState(() => ({
    firstName: baseline.firstName,
    lastName: baseline.lastName,
    phone: baseline.phone,
    address: baseline.address,
    addressData: baseline.addressData,
  }));
  const [salary, setSalary] = useState(() => ({
    salaryMin: baseline.salaryMin,
    salaryMax: baseline.salaryMax,
  }));
  const [demographics, setDemographics] = useState(() => ({
    dateOfBirth: baseline.dateOfBirth,
    gender: baseline.gender,
    ethnicity: baseline.ethnicity,
    disabilityStatus: baseline.disabilityStatus,
    sexualOrientation: baseline.sexualOrientation,
    veteranStatus: baseline.veteranStatus,
    citizenship: baseline.citizenship,
  }));

  const [addressEditing, setAddressEditing] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [savingSalary, setSavingSalary] = useState(false);
  const [savingDemographics, setSavingDemographics] = useState(false);
  const [citizenshipDraft, setCitizenshipDraft] = useState({ country: "", status: "" });

  useEffect(() => {
    setContact({
      firstName: baseline.firstName,
      lastName: baseline.lastName,
      phone: baseline.phone,
      address: baseline.address,
      addressData: baseline.addressData,
    });
    setSalary({ salaryMin: baseline.salaryMin, salaryMax: baseline.salaryMax });
    setDemographics({
      dateOfBirth: baseline.dateOfBirth,
      gender: baseline.gender,
      ethnicity: baseline.ethnicity,
      disabilityStatus: baseline.disabilityStatus,
      sexualOrientation: baseline.sexualOrientation,
      veteranStatus: baseline.veteranStatus,
      citizenship: baseline.citizenship,
    });
    setAddressEditing(false);
  }, [baseline]);

  const contactBaseline = useMemo(() => ({
    firstName: baseline.firstName,
    lastName: baseline.lastName,
    phone: baseline.phone,
    address: baseline.address,
    addressData: baseline.addressData,
  }), [baseline]);

  const salaryBaseline = useMemo(() => ({
    salaryMin: baseline.salaryMin,
    salaryMax: baseline.salaryMax,
  }), [baseline]);

  const demographicsBaseline = useMemo(() => ({
    dateOfBirth: baseline.dateOfBirth,
    gender: baseline.gender,
    ethnicity: baseline.ethnicity,
    disabilityStatus: baseline.disabilityStatus,
    sexualOrientation: baseline.sexualOrientation,
    veteranStatus: baseline.veteranStatus,
    citizenship: baseline.citizenship,
  }), [baseline]);

  const contactDirty = !snapshotsEqual(contact, contactBaseline);
  const salaryDirty = !snapshotsEqual(salary, salaryBaseline);
  const demographicsDirty = !snapshotsEqual(demographics, demographicsBaseline);

  const saveContact = async () => {
    if (hasGooglePlacesKey() && contact.address && !contact.addressData?.location_label) {
      toast.error(t("profile.selectLocation"));
      return;
    }
    setSavingContact(true);
    try {
      if (!demoMode) {
        await api.put("/profile/contact", {
          first_name: contact.firstName.trim(),
          last_name: contact.lastName.trim(),
          phone: contact.phone.trim(),
          location: contact.addressData?.location_label || contact.address.trim(),
          location_data: contact.addressData,
        });
      }
      toast.success(t("profile.personalInfo.contactSaved"));
      await onSaved?.();
    } catch (_) {
      toast.error(t("profile.personalInfo.saveError"));
    } finally {
      setSavingContact(false);
    }
  };

  const saveSalary = async () => {
    setSavingSalary(true);
    try {
      if (!demoMode) {
        const existingOnboarding = profile?.extras?.onboarding || {};
        await api.patch("/profile/extras", {
          onboarding: {
            ...existingOnboarding,
            salary_min: salary.salaryMin,
            salary_max: salary.salaryMax,
          },
        });
      }
      toast.success(t("profile.personalInfo.salarySaved"));
      await onSaved?.();
    } catch (_) {
      toast.error(t("profile.personalInfo.saveError"));
    } finally {
      setSavingSalary(false);
    }
  };

  const saveDemographics = async () => {
    setSavingDemographics(true);
    try {
      if (!demoMode) {
        await api.patch("/profile/extras", {
          demographics: {
            date_of_birth: demographics.dateOfBirth || null,
            gender: demographics.gender || null,
            ethnicity: demographics.ethnicity,
            disability_status: demographics.disabilityStatus || null,
            sexual_orientation: demographics.sexualOrientation || null,
            veteran_status: demographics.veteranStatus || null,
            citizenship: demographics.citizenship,
          },
        });
      }
      toast.success(t("profile.personalInfo.demographicsSaved"));
      await onSaved?.();
    } catch (_) {
      toast.error(t("profile.personalInfo.saveError"));
    } finally {
      setSavingDemographics(false);
    }
  };

  const toggleEthnicity = (value) => {
    setDemographics((prev) => {
      const selected = prev.ethnicity.includes(value)
        ? prev.ethnicity.filter((item) => item !== value)
        : [...prev.ethnicity, value];
      return { ...prev, ethnicity: selected };
    });
  };

  const addCitizenship = () => {
    const country = citizenshipDraft.country.trim();
    const status = citizenshipDraft.status.trim();
    if (!country || !status) return;
    setDemographics((prev) => ({
      ...prev,
      citizenship: [...prev.citizenship, { country, status }],
    }));
    setCitizenshipDraft({ country: "", status: "" });
  };

  const removeCitizenship = (index) => {
    setDemographics((prev) => ({
      ...prev,
      citizenship: prev.citizenship.filter((_, i) => i !== index),
    }));
  };

  const salarySummary = t("profile.personalInfo.salarySummary", {
    min: formatSalary(salary.salaryMin, lang),
    max: formatSalary(salary.salaryMax, lang),
  });

  const genderOptions = useMemo(() => getGenderOptions(t), [t]);
  const ethnicityOptions = useMemo(() => getEthnicityOptions(t), [t]);
  const disabilityOptions = useMemo(() => getDisabilityOptions(t), [t]);
  const sexualOrientationOptions = useMemo(() => getSexualOrientationOptions(t), [t]);
  const veteranOptions = useMemo(() => getVeteranOptions(t), [t]);
  const citizenshipStatusOptions = useMemo(() => getCitizenshipStatusOptions(t), [t]);

  return (
    <div className="space-y-8 pb-6" data-testid="profile-personal-info">
      <ProfileFormSection
        title={t("profile.personalInfo.contactTitle")}
        description={t("profile.personalInfo.contactDesc")}
        footer={(
          <SaveButton
            disabled={!contactDirty}
            saving={savingContact}
            onClick={saveContact}
            testId="personal-info-save-contact"
          />
        )}
      >
        <form id="basic-info-form" className="space-y-5" onSubmit={(e) => e.preventDefault()}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FieldBlock label={t("profile.personalInfo.firstName")} htmlFor="firstName">
              <Input
                id="firstName"
                name="firstName"
                value={contact.firstName}
                onChange={(e) => setContact((s) => ({ ...s, firstName: e.target.value }))}
                placeholder={t("profile.personalInfo.firstNamePlaceholder")}
                data-testid="personal-info-first-name"
              />
            </FieldBlock>
            <FieldBlock label={t("profile.personalInfo.lastName")} htmlFor="lastName">
              <Input
                id="lastName"
                name="lastName"
                value={contact.lastName}
                onChange={(e) => setContact((s) => ({ ...s, lastName: e.target.value }))}
                placeholder={t("profile.personalInfo.lastNamePlaceholder")}
                data-testid="personal-info-last-name"
              />
            </FieldBlock>
          </div>

          <FieldBlock label={t("profile.personalInfo.email")} htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              value={baseline.email}
              readOnly
              className="shell-inset bg-zinc-50 text-zinc-600 dark:text-zinc-400"
              data-testid="personal-info-email"
            />
          </FieldBlock>

          <FieldBlock label={t("profile.personalInfo.phone")} htmlFor="phone">
            <Input
              id="phone"
              name="phone"
              type="tel"
              value={contact.phone}
              onChange={(e) => setContact((s) => ({ ...s, phone: e.target.value }))}
              placeholder="+33 6 12 34 56 78"
              data-testid="personal-info-phone"
            />
          </FieldBlock>

          <FieldBlock label={t("profile.personalInfo.address")} htmlFor="address">
            {addressEditing || !contact.address ? (
              <PlacesAutocomplete
                label=""
                value={contact.address}
                selectedLocation={contact.addressData}
                onInputChange={(value) => setContact((s) => ({ ...s, address: value, addressData: null }))}
                onSelect={(loc) => {
                  setContact((s) => ({
                    ...s,
                    address: loc?.location_label || s.address,
                    addressData: loc,
                  }));
                  setAddressEditing(false);
                }}
                placeholder={t("profileSections.locationPlaceholder")}
                variant="light"
                lang={lang}
                testId="personal-info-address"
              />
            ) : (
              <div className="shell-inset flex flex-wrap items-center gap-2.5 rounded-md px-4 py-3">
                <div className="shell-title min-w-0 flex-1 text-sm font-medium">{contact.address}</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setAddressEditing(true)}
                    aria-label={t("profile.personalInfo.editAddress")}
                    data-testid="personal-info-edit-address"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setContact((s) => ({ ...s, address: "", addressData: null }))}
                    aria-label={t("profile.personalInfo.clearAddress")}
                    data-testid="personal-info-clear-address"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </FieldBlock>
        </form>
      </ProfileFormSection>

      <ProfileFormSection
        title={t("profile.personalInfo.salaryTitle")}
        description={t("profile.personalInfo.salaryDesc")}
        footer={(
          <SaveButton
            disabled={!salaryDirty}
            saving={savingSalary}
            onClick={saveSalary}
            testId="personal-info-save-salary"
          />
        )}
      >
        <form id="salary-expectations-form" className="space-y-5" onSubmit={(e) => e.preventDefault()}>
          <div className="flex items-center justify-center gap-6 sm:gap-8">
            <div className="min-w-[120px] text-center sm:min-w-[140px]">
              <span className="text-sm shell-body">{t("profile.personalInfo.minimum")}</span>
              <p className="text-2xl font-bold text-linkedin">{formatSalary(salary.salaryMin, lang)}</p>
            </div>
            <span className="text-zinc-400">—</span>
            <div className="min-w-[120px] text-center sm:min-w-[140px]">
              <span className="text-sm shell-body">{t("profile.personalInfo.maximum")}</span>
              <p className="text-2xl font-bold text-linkedin">{formatSalary(salary.salaryMax, lang)}</p>
            </div>
          </div>

          <Slider
            value={[salary.salaryMin, salary.salaryMax]}
            min={0}
            max={SALARY_MAX}
            step={SALARY_STEP}
            onValueChange={([min, max]) => {
              setSalary({
                salaryMin: Math.min(min, max),
                salaryMax: Math.max(min, max),
              });
            }}
            data-testid="personal-info-salary-slider"
          />

          <div className="flex justify-between text-sm shell-body">
            <span>{formatMoney(0, lang)}</span>
            <span>{formatMoney(SALARY_MAX, lang)}</span>
          </div>

          <p className="shell-inset rounded-lg p-4 text-center text-sm text-zinc-600 dark:text-zinc-400">{salarySummary}</p>
        </form>
      </ProfileFormSection>

      <ProfileFormSection
        title={t("profile.personalInfo.demographicsTitle")}
        description={t("profile.personalInfo.demographicsDesc")}
        footer={(
          <SaveButton
            disabled={!demographicsDirty}
            saving={savingDemographics}
            onClick={saveDemographics}
            testId="personal-info-save-demographics"
          />
        )}
      >
        <form id="demographics-form" className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <FieldBlock label={t("profile.personalInfo.dateOfBirth")} htmlFor="dob">
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                id="dob"
                type="date"
                value={demographics.dateOfBirth}
                onChange={(e) => setDemographics((s) => ({ ...s, dateOfBirth: e.target.value }))}
                className="pl-10"
                data-testid="personal-info-dob"
              />
            </div>
          </FieldBlock>

          <FieldBlock label={t("profile.personalInfo.gender")} htmlFor="gender">
            <Select value={demographics.gender || undefined} onValueChange={(value) => setDemographics((s) => ({ ...s, gender: value }))}>
              <SelectTrigger id="gender" className="w-full sm:w-72" data-testid="personal-info-gender">
                <SelectValue placeholder={t("profile.personalInfo.selectGender")} />
              </SelectTrigger>
              <SelectContent>
                {genderOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label={t("profile.personalInfo.ethnicity")} htmlFor="ethnicity">
            <div className="flex flex-wrap gap-2">
              {ethnicityOptions.map((option) => {
                const active = demographics.ethnicity.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleEthnicity(option.value)}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? "border-transparent gradient-linkedin text-white shadow-sm"
                        : "shell-chip-idle"
                    }`}
                    data-testid={`personal-info-ethnicity-${option.value.slice(0, 12)}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </FieldBlock>

          <FieldBlock label={t("profile.personalInfo.disabilityStatus")} htmlFor="disabilityStatus">
            <Select
              value={demographics.disabilityStatus || undefined}
              onValueChange={(value) => setDemographics((s) => ({ ...s, disabilityStatus: value }))}
            >
              <SelectTrigger id="disabilityStatus" className="w-full sm:w-72" data-testid="personal-info-disability">
                <SelectValue placeholder={t("profile.personalInfo.selectStatus")} />
              </SelectTrigger>
              <SelectContent>
                {disabilityOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label={t("profile.personalInfo.sexualOrientation")} htmlFor="sexualOrientation">
            <Select
              value={demographics.sexualOrientation || undefined}
              onValueChange={(value) => setDemographics((s) => ({ ...s, sexualOrientation: value }))}
            >
              <SelectTrigger id="sexualOrientation" className="w-full sm:w-72" data-testid="personal-info-orientation">
                <SelectValue placeholder={t("profile.personalInfo.selectOrientation")} />
              </SelectTrigger>
              <SelectContent>
                {sexualOrientationOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <FieldBlock label={t("profile.personalInfo.veteranStatus")} htmlFor="veteranStatus">
            <Select
              value={demographics.veteranStatus || undefined}
              onValueChange={(value) => setDemographics((s) => ({ ...s, veteranStatus: value }))}
            >
              <SelectTrigger id="veteranStatus" className="w-full sm:w-72" data-testid="personal-info-veteran">
                <SelectValue placeholder={t("profile.personalInfo.selectStatus")} />
              </SelectTrigger>
              <SelectContent>
                {veteranOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldBlock>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="shell-title text-sm font-medium">{t("profile.personalInfo.citizenshipStatus")}</Label>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addCitizenship}
                disabled={!citizenshipDraft.country.trim() || !citizenshipDraft.status}
                aria-label={t("profile.personalInfo.addCitizenship")}
                data-testid="personal-info-add-citizenship"
              >
                <Plus className="h-4 w-4 text-linkedin" />
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                value={citizenshipDraft.country}
                onChange={(e) => setCitizenshipDraft((s) => ({ ...s, country: e.target.value }))}
                placeholder={t("profile.personalInfo.citizenshipCountry")}
                data-testid="personal-info-citizenship-country"
              />
              <Select
                value={citizenshipDraft.status || undefined}
                onValueChange={(value) => setCitizenshipDraft((s) => ({ ...s, status: value }))}
              >
                <SelectTrigger data-testid="personal-info-citizenship-status">
                  <SelectValue placeholder={t("profile.personalInfo.citizenshipType")} />
                </SelectTrigger>
                <SelectContent>
                  {citizenshipStatusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {demographics.citizenship.length ? (
              <ul className="space-y-2">
                {demographics.citizenship.map((entry, index) => (
                  <li
                    key={`${entry.country}-${entry.status}-${index}`}
                    className="shell-inset flex items-center justify-between gap-3 rounded-md px-4 py-3 text-sm"
                  >
                    <span className="shell-title font-medium">{entry.country}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-600 dark:text-zinc-400">{labelForStoredOption(entry.status, citizenshipStatusOptions)}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeCitizenship(index)}
                        aria-label={t("profile.personalInfo.removeCitizenship")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="shell-dashed flex flex-col items-center justify-center gap-3 rounded-lg border px-6 py-8 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-lg shell-icon-box">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <p className="shell-title text-base font-medium">{t("profile.personalInfo.noCitizenship")}</p>
                  <p className="mt-1 text-sm shell-body">{t("profile.personalInfo.noCitizenshipDesc")}</p>
                </div>
              </div>
            )}
          </div>
        </form>
      </ProfileFormSection>
    </div>
  );
}
