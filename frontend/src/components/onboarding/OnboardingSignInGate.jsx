import { Button } from "../ui/button";
import { BRAND } from "../../lib/brand";
import { startGoogleLogin } from "../../lib/auth";
import { ob } from "./onboardingTheme";

export default function OnboardingSignInGate() {
  return (
    <div className={`${ob.card} p-8 sm:p-10 text-center`}>
      <p className="font-display font-bold text-lg text-zinc-900 mb-4">{BRAND.NAME}</p>
      <p className="text-zinc-900 font-semibold text-lg">Sign in to save your progress</p>
      <p className={`text-sm ${ob.muted} mt-2 leading-relaxed`}>
        You can preview the onboarding flow. To upload your resume and start swiping, connect with Google.
      </p>
      <Button
        type="button"
        className="mt-6 w-full h-12 rounded-full gradient-linkedin hover:opacity-90 text-white font-semibold"
        onClick={() => startGoogleLogin("/onboarding")}
        data-testid="onboarding-signin-btn"
      >
        Continue with Google
      </Button>
    </div>
  );
}
