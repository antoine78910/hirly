import { ONBOARDING_SHOWCASE_SCREENS } from "../components/onboarding/onboardingData";
import { preloadImages } from "./preloadImages";

const SHOWCASE_PATHS = Object.values(ONBOARDING_SHOWCASE_SCREENS);

let preloadPromise = null;

/** Warm the browser cache for late onboarding showcase PNGs (checkout steps). */
export function preloadOnboardingShowcaseImages() {
  if (!preloadPromise) {
    preloadPromise = preloadImages(SHOWCASE_PATHS);
  }
  return preloadPromise;
}
