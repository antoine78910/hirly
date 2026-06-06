import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { startGoogleLogin } from "../../lib/auth";

function GoogleIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export default function OnboardingSignup({ onClose }) {
  const [email, setEmail] = useState("");

  const handleGoogleSignup = async () => {
    const ok = await startGoogleLogin("/onboarding?step=jobSearch");
    if (!ok) {
      toast.error("Google sign-up is not configured", {
        description: "Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in frontend/.env",
      });
    }
  };

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Please enter your email");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email address");
      return;
    }
    sessionStorage.setItem("swiipr_signup_email", trimmed);
    await handleGoogleSignup();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-zinc-900 min-h-dvh">
      <div className="flex items-center justify-center relative px-5 pt-5 pb-4 shrink-0 border-b border-zinc-100">
        <button
          type="button"
          onClick={onClose}
          className="absolute left-5 top-5 w-10 h-10 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
          aria-label="Close"
          data-testid="signup-close-btn"
        >
          <X className="w-5 h-5" strokeWidth={2} />
        </button>
        <h1 className="font-display font-semibold text-lg tracking-tight">Sign up</h1>
      </div>

      <div className="flex-1 w-full max-w-md mx-auto px-5 pb-8 flex flex-col justify-center">
        <form onSubmit={handleEmailSignup} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="signup-email" className="text-sm font-medium text-zinc-700">
              Email
            </Label>
            <Input
              id="signup-email"
              type="email"
              autoComplete="email"
              placeholder="johndoe@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 rounded-full border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 px-5 text-base focus-visible:ring-linkedin"
              data-testid="signup-email-input"
            />
          </div>

          <button
            type="submit"
            className="w-full h-12 rounded-full gradient-linkedin text-white font-semibold text-base hover:opacity-90 transition-opacity shadow-[0_8px_32px_-8px_rgba(124,58,237,0.5)]"
            data-testid="signup-email-btn"
          >
            Sign up
          </button>
        </form>

        <div className="flex items-center gap-4 my-8">
          <div className="flex-1 h-px bg-zinc-200" />
          <span className="text-sm text-zinc-500 shrink-0">or</span>
          <div className="flex-1 h-px bg-zinc-200" />
        </div>

        <button
          type="button"
          onClick={handleGoogleSignup}
          className="w-full h-12 rounded-full bg-white border border-zinc-200 flex items-center justify-center gap-3 font-semibold text-zinc-900 hover:bg-zinc-50 transition-colors"
          data-testid="onboarding-signup-btn"
        >
          <GoogleIcon />
          Sign up with Google
        </button>
      </div>
    </div>
  );
}
