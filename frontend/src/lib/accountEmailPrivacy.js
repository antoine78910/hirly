const STORAGE_KEY = "hirly.blur_account_email";

export function readAccountEmailBlurred() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveAccountEmailBlurred(blurred) {
  try {
    localStorage.setItem(STORAGE_KEY, blurred ? "1" : "0");
  } catch {
    /* ignore */
  }
}
