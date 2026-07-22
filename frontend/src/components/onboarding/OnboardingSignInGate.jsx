import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { BRAND } from "../../lib/brand";
import { ob } from "./onboardingTheme";

export default function OnboardingSignInGate() {
  return (
    <div className={`${ob.card} p-8 sm:p-10 text-center`}>
      <p className="font-display font-bold text-lg text-zinc-900 mb-4">{BRAND.NAME}</p>
      <p className="text-zinc-900 font-semibold text-lg">Sign in to save your progress</p>
      <p className={`text-sm ${ob.muted} mt-2 leading-relaxed`}>
        You can preview the onboarding flow. To upload your resume and start swiping, sign in with
        Google or email.
      </p>
      <Button
        asChild
        className="mt-6 w-full h-12 rounded-full gradient-linkedin hover:opacity-90 text-white font-semibold"
        data-testid="onboarding-signin-btn"
      >
        <Link to="/signin?next=%2Fonboarding">Sign in</Link>
      </Button>
    </div>
  );
}
