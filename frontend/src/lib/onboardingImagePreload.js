import { INTRO_SLIDES, ONBOARDING_SHOWCASE_SCREENS } from "../components/onboarding/onboardingData";
import { preloadImages } from "./preloadImages";

const SHOWCASE_PATHS = Object.values(ONBOARDING_SHOWCASE_SCREENS);
const INTRO_PATHS = INTRO_SLIDES.map((slide) => slide.image);

let showcasePreloadPromise = null;
let introPreloadPromise = null;

/** Warm the browser cache for intro carousel PNGs (first onboarding step). */
export function preloadOnboardingIntroImages() {
  if (!introPreloadPromise) {
    introPreloadPromise = preloadImages(INTRO_PATHS);
  }
  return introPreloadPromise;
}

/** Warm the browser cache for late onboarding showcase PNGs (checkout steps). */
export function preloadOnboardingShowcaseImages() {
  if (!showcasePreloadPromise) {
    showcasePreloadPromise = preloadImages(SHOWCASE_PATHS);
  }
  return showcasePreloadPromise;
}
