import { TUTORIAL_BYPASS_AUTH, demoMode } from "./dev";
import { isDemoAccountEnabled } from "./demoAccount";
import { isFinanceDemoEnabled } from "./demoSettings";
import { FINANCE_DEMO_PROFILE } from "./financeDemoJobs";
import { EXAMPLE_RESUME } from "./exampleResume";
import { normalizeCvUploadFile } from "./cvUploadFormats";

const DEMO_CV_STORAGE_KEY = "hirly.demo.cv.v1";

function readStoredCv() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_CV_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredCv(payload) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_CV_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

function guessMime(filename = "", fallback = "application/pdf") {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  return fallback;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function readTextFile(file) {
  return file.text();
}

function baseProfileForDemo() {
  if (isFinanceDemoEnabled()) {
    return { ...FINANCE_DEMO_PROFILE };
  }
  return {
    ...EXAMPLE_RESUME,
    target_role: EXAMPLE_RESUME.target_role,
    target_roles: EXAMPLE_RESUME.target_roles,
    target_location: EXAMPLE_RESUME.target_location,
    target_location_data: EXAMPLE_RESUME.target_location_data,
    remote_preference: EXAMPLE_RESUME.remote_preference,
    seniority: EXAMPLE_RESUME.seniority,
    contact: { ...EXAMPLE_RESUME.contact },
    skills: [...(EXAMPLE_RESUME.skills || [])],
    experience: [...(EXAMPLE_RESUME.experience || [])],
    education: [...(EXAMPLE_RESUME.education || [])],
    cv_text: EXAMPLE_RESUME.cv_text,
    template_style: EXAMPLE_RESUME.template_style || "modern",
  };
}

export function mergeDemoCvIntoProfile(profile) {
  const stored = readStoredCv();
  if (!stored) return profile;
  return {
    ...profile,
    cv_filename: stored.cv_filename,
    cv_mime: stored.cv_mime,
    cv_text: stored.cv_text || profile?.cv_text,
  };
}

/** Demo / tutorial — skip backend CV parsing (no AI key required). */
export function shouldMockCvUpload() {
  return isDemoAccountEnabled() || isFinanceDemoEnabled() || TUTORIAL_BYPASS_AUTH || demoMode;
}

export function hasDemoCvStored() {
  return Boolean(readStoredCv()?.cv_original_b64);
}

export async function fetchDemoCvOriginal() {
  const stored = readStoredCv();
  if (!stored?.cv_original_b64) return null;
  const binary = atob(stored.cv_original_b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: stored.cv_mime || "application/octet-stream" });
}

/** Simulates POST /profile/cv for demo mode. */
export async function handleDemoCvUpload(file) {
  if (!file) {
    throw new Error("No file provided");
  }

  const mime = file.type || guessMime(file.name);
  const [cvOriginalB64, cvText] = await Promise.all([
    readFileAsBase64(file),
    mime === "text/plain" ? readTextFile(file) : Promise.resolve(""),
  ]);

  const base = baseProfileForDemo();
  const profile = {
    ...base,
    user_id: base.user_id || "demo_local",
    cv_filename: file.name,
    cv_mime: mime,
    cv_text: cvText || base.cv_text || "Demo resume uploaded locally.",
    updated_at: new Date().toISOString(),
  };

  writeStoredCv({
    cv_filename: file.name,
    cv_mime: mime,
    cv_original_b64: cvOriginalB64,
    cv_text: profile.cv_text,
    updated_at: profile.updated_at,
  });

  const response = { ...profile };
  delete response.cv_text;
  return response;
}

function extractUploadFile(data) {
  if (!data) return null;
  if (typeof FormData !== "undefined" && data instanceof FormData) {
    return data.get("file");
  }
  return null;
}

/** Upload CV — local mock in demo/tutorial, real API otherwise. */
export async function uploadProfileCv(file, apiClient) {
  if (!file) {
    throw new Error("No file provided");
  }
  if (shouldMockCvUpload()) {
    const data = await handleDemoCvUpload(normalizeCvUploadFile(file));
    return { data };
  }
  const form = new FormData();
  form.append("file", normalizeCvUploadFile(file));
  return apiClient.post("/profile/cv", form, { timeout: 120000 });
}

export { extractUploadFile };
