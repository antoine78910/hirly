export const GENDER_OPTIONS = [
  "Male",
  "Female",
  "Non-binary",
  "Other",
];

export const ETHNICITY_OPTIONS = [
  "Alaskan Native / American Indian / Indigenous American / Native American",
  "Black / Of African descent",
  "Central Asian",
  "East Asian",
  "Hispanic, Latino, Latina, or Latinx",
  "Middle Eastern or North African",
  "Native Hawaiian or Pacific Islander",
  "South Asian",
  "Southeast Asian",
  "White",
  "I don't wish to answer",
];

export const DISABILITY_OPTIONS = [
  "Yes",
  "No",
  "I don't wish to answer",
];

export const SEXUAL_ORIENTATION_OPTIONS = [
  "Heterosexual",
  "Gay",
  "Lesbian",
  "Bisexual",
  "Asexual",
  "Pansexual",
  "Queer",
  "Questioning",
  "Other",
  "I don't wish to answer",
];

export const VETERAN_OPTIONS = [
  "Yes, I am a veteran",
  "No, I am not a veteran",
  "I identify as a protected veteran",
  "I don't wish to answer",
];

export const CITIZENSHIP_STATUS_OPTIONS = [
  "Citizen",
  "Permanent resident",
  "Work visa",
  "Student visa",
  "Requires sponsorship",
  "Other",
];

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
