const GENDER_DEFS = [
  { value: "Male", key: "male" },
  { value: "Female", key: "female" },
  { value: "Non-binary", key: "nonBinary" },
  { value: "Other", key: "other" },
];

const ETHNICITY_DEFS = [
  { value: "Alaskan Native / American Indian / Indigenous American / Native American", key: "indigenousAmerican" },
  { value: "Black / Of African descent", key: "blackAfrican" },
  { value: "Central Asian", key: "centralAsian" },
  { value: "East Asian", key: "eastAsian" },
  { value: "Hispanic, Latino, Latina, or Latinx", key: "hispanicLatino" },
  { value: "Middle Eastern or North African", key: "mena" },
  { value: "Native Hawaiian or Pacific Islander", key: "pacificIslander" },
  { value: "South Asian", key: "southAsian" },
  { value: "Southeast Asian", key: "southeastAsian" },
  { value: "White", key: "white" },
  { value: "I don't wish to answer", key: "noAnswer" },
];

const DISABILITY_DEFS = [
  { value: "Yes", key: "yes" },
  { value: "No", key: "no" },
  { value: "I don't wish to answer", key: "noAnswer" },
];

const SEXUAL_ORIENTATION_DEFS = [
  { value: "Heterosexual", key: "heterosexual" },
  { value: "Gay", key: "gay" },
  { value: "Lesbian", key: "lesbian" },
  { value: "Bisexual", key: "bisexual" },
  { value: "Asexual", key: "asexual" },
  { value: "Pansexual", key: "pansexual" },
  { value: "Queer", key: "queer" },
  { value: "Questioning", key: "questioning" },
  { value: "Other", key: "other" },
  { value: "I don't wish to answer", key: "noAnswer" },
];

const VETERAN_DEFS = [
  { value: "Yes, I am a veteran", key: "yes" },
  { value: "No, I am not a veteran", key: "no" },
  { value: "I identify as a protected veteran", key: "protected" },
  { value: "I don't wish to answer", key: "noAnswer" },
];

const CITIZENSHIP_DEFS = [
  { value: "Citizen", key: "citizen" },
  { value: "Permanent resident", key: "permanentResident" },
  { value: "Work visa", key: "workVisa" },
  { value: "Student visa", key: "studentVisa" },
  { value: "Requires sponsorship", key: "requiresSponsorship" },
  { value: "Other", key: "other" },
];

function mapOptions(defs, t, prefix) {
  return defs.map(({ value, key }) => ({
    value,
    label: t(`${prefix}.${key}`),
  }));
}

export function getGenderOptions(t) {
  return mapOptions(GENDER_DEFS, t, "personalInfoOptions.gender");
}

export function getEthnicityOptions(t) {
  return mapOptions(ETHNICITY_DEFS, t, "personalInfoOptions.ethnicity");
}

export function getDisabilityOptions(t) {
  return mapOptions(DISABILITY_DEFS, t, "personalInfoOptions.disability");
}

export function getSexualOrientationOptions(t) {
  return mapOptions(SEXUAL_ORIENTATION_DEFS, t, "personalInfoOptions.sexualOrientation");
}

export function getVeteranOptions(t) {
  return mapOptions(VETERAN_DEFS, t, "personalInfoOptions.veteran");
}

export function getCitizenshipStatusOptions(t) {
  return mapOptions(CITIZENSHIP_DEFS, t, "personalInfoOptions.citizenship");
}

export function labelForStoredOption(value, options) {
  return options.find((option) => option.value === value)?.label || value;
}

/** @deprecated use getGenderOptions(t) */
export const GENDER_OPTIONS = GENDER_DEFS.map(({ value }) => value);
/** @deprecated use getEthnicityOptions(t) */
export const ETHNICITY_OPTIONS = ETHNICITY_DEFS.map(({ value }) => value);
/** @deprecated use getDisabilityOptions(t) */
export const DISABILITY_OPTIONS = DISABILITY_DEFS.map(({ value }) => value);
/** @deprecated use getSexualOrientationOptions(t) */
export const SEXUAL_ORIENTATION_OPTIONS = SEXUAL_ORIENTATION_DEFS.map(({ value }) => value);
/** @deprecated use getVeteranOptions(t) */
export const VETERAN_OPTIONS = VETERAN_DEFS.map(({ value }) => value);
/** @deprecated use getCitizenshipStatusOptions(t) */
export const CITIZENSHIP_STATUS_OPTIONS = CITIZENSHIP_DEFS.map(({ value }) => value);

export function splitFullName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export function buildPersonalInfoState(profile, userEmail) {
  const contact = profile?.contact || {};
  const onboarding = profile?.extras?.onboarding || {};
  const demographics = profile?.extras?.demographics || {};
  const split = splitFullName(contact.name);

  return {
    firstName: contact.first_name || split.first_name,
    lastName: contact.last_name || split.last_name,
    email: userEmail || contact.email || "",
    phone: contact.phone || "",
    address: contact.location || profile?.target_location || onboarding.onboarding_location || "",
    addressData: contact.location_data || profile?.target_location_data || onboarding.onboarding_location_data || null,
    salaryMin: onboarding.salary_min ?? 50_000,
    salaryMax: onboarding.salary_max ?? 100_000,
    dateOfBirth: demographics.date_of_birth || "",
    gender: demographics.gender || "",
    ethnicity: Array.isArray(demographics.ethnicity) ? demographics.ethnicity : [],
    disabilityStatus: demographics.disability_status || "",
    sexualOrientation: demographics.sexual_orientation || "",
    veteranStatus: demographics.veteran_status || "",
    citizenship: Array.isArray(demographics.citizenship) ? demographics.citizenship : [],
  };
}
