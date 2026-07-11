import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  authCallbackRedirectUrl,
  establishAppSessionFromSupabase,
  startGoogleLogin,
} from "../../lib/auth";
import { supabase, supabaseConfigured } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { trackEvent } from "../../lib/analytics";
import { trackDatafastGoal } from "../../lib/datafast";

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

const COPY = {
  en: {
    title: "Sign up",
    firstName: "First name",
    firstNamePlaceholder: "Alex",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordHint: "At least 6 characters",
    submit: "Sign up",
    or: "or",
    google: "Sign up with Google",
    verifyTitle: "Check your email",
    verifyBody: "We sent a verification link to",
    verifyHint: "Open the link to confirm your account, then you'll continue onboarding automatically.",
    resend: "Resend email",
    resending: "Sending…",
    resendSuccess: "Verification email sent again.",
    useDifferentEmail: "Use a different email",
    firstNameRequired: "Please enter your first name",
    emailRequired: "Please enter your email",
    emailInvalid: "Please enter a valid email address",
    passwordRequired: "Password must be at least 6 characters",
    authNotConfigured: "Email sign-up is not configured",
    authNotConfiguredDesc: "Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in frontend/.env",
    googleNotConfigured: "Google sign-up is not configured",
    signupFailed: "Sign up failed. Please try again.",
    alreadyRegistered: "An account already exists with this email. Sign in instead.",
    signInInstead: "Sign in",
  },
  fr: {
    title: "Inscription",
    firstName: "Prénom",
    firstNamePlaceholder: "Alex",
    email: "E-mail",
    emailPlaceholder: "vous@exemple.com",
    password: "Mot de passe",
    passwordHint: "Au moins 6 caractères",
    submit: "S'inscrire",
    or: "ou",
    google: "S'inscrire avec Google",
    verifyTitle: "Vérifiez votre e-mail",
    verifyBody: "Nous avons envoyé un lien de confirmation à",
    verifyHint: "Ouvrez le lien pour confirmer votre compte, puis l'onboarding reprendra automatiquement.",
    resend: "Renvoyer l'e-mail",
    resending: "Envoi…",
    resendSuccess: "E-mail de vérification renvoyé.",
    useDifferentEmail: "Utiliser un autre e-mail",
    firstNameRequired: "Veuillez entrer votre prénom",
    emailRequired: "Veuillez entrer votre e-mail",
    emailInvalid: "Veuillez entrer une adresse e-mail valide",
    passwordRequired: "Le mot de passe doit contenir au moins 6 caractères",
    authNotConfigured: "L'inscription par e-mail n'est pas configurée",
    authNotConfiguredDesc: "Configurez REACT_APP_SUPABASE_URL et REACT_APP_SUPABASE_ANON_KEY",
    googleNotConfigured: "L'inscription Google n'est pas configurée",
    signupFailed: "Inscription impossible. Réessayez.",
    alreadyRegistered: "Un compte existe déjà avec cet e-mail. Connectez-vous plutôt.",
    signInInstead: "Se connecter",
  },
};

const ONBOARDING_RETURN_PATH = "/onboarding?step=jobSearch";

export default function OnboardingSignup({ onClose, lang = "en" }) {
  const copy = useMemo(() => COPY[lang === "fr" ? "fr" : "en"], [lang]);
  const { setUser, setHasProfile, setHasPreferences } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [screen, setScreen] = useState("form");
  const [error, setError] = useState("");

  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);

  const finishSession = async (session) => {
    const data = await establishAppSessionFromSupabase(session);
    if (!data) return false;
    setUser(data.user);
    setHasProfile(Boolean(data.has_profile));
    setHasPreferences(Boolean(data.has_preferences));
    trackEvent("auth_success", {
      method: "email",
      mode: "signup",
      has_profile: Boolean(data.has_profile),
      has_preferences: Boolean(data.has_preferences),
    });
    trackDatafastGoal("onboarding_signup_email");
    return true;
  };

  const handleGoogleSignup = async () => {
    trackDatafastGoal("onboarding_signup_google");
    sessionStorage.setItem("swiipr_onboarding_return", ONBOARDING_RETURN_PATH);
    const ok = await startGoogleLogin(ONBOARDING_RETURN_PATH);
    if (!ok) {
      toast.error(copy.googleNotConfigured, {
        description: copy.authNotConfiguredDesc,
      });
    }
  };

  const handleEmailSignup = async (event) => {
    event.preventDefault();
    setError("");

    const trimmedFirst = firstName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedFirst) {
      setError(copy.firstNameRequired);
      return;
    }
    if (!trimmedEmail) {
      setError(copy.emailRequired);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(copy.emailInvalid);
      return;
    }
    if (password.length < 6) {
      setError(copy.passwordRequired);
      return;
    }
    if (!supabaseConfigured || !supabase) {
      setError(copy.authNotConfigured);
      return;
    }

    setSubmitting(true);
    sessionStorage.setItem("swiipr_onboarding_return", ONBOARDING_RETURN_PATH);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: authCallbackRedirectUrl(ONBOARDING_RETURN_PATH),
          data: {
            full_name: trimmedFirst,
            name: trimmedFirst,
          },
        },
      });
      if (authError) throw authError;

      if (data?.session) {
        const ok = await finishSession(data.session);
        if (ok) return;
      }

      setScreen("verify");
    } catch (err) {
      const message = err?.message || "";
      if (/already registered|already been registered|user already registered/i.test(message)) {
        setError(copy.alreadyRegistered);
      } else {
        setError(message || copy.signupFailed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (!supabaseConfigured || !supabase || !email.trim()) return;
    setResending(true);
    setError("");
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: {
          emailRedirectTo: authCallbackRedirectUrl(ONBOARDING_RETURN_PATH),
        },
      });
      if (resendError) throw resendError;
      toast.success(copy.resendSuccess);
    } catch (err) {
      setError(err?.message || copy.signupFailed);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex h-dvh max-h-dvh flex-col overflow-hidden bg-white text-zinc-900">
      <div className="relative flex shrink-0 items-center justify-center border-b border-zinc-100 px-5 pb-3 pt-4">
        <button
          type="button"
          onClick={onClose}
          className="absolute left-5 top-5 w-10 h-10 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
          aria-label="Close"
          data-testid="signup-close-btn"
        >
          <X className="w-5 h-5" strokeWidth={2} />
        </button>
        <h1 className="font-display font-semibold text-lg tracking-tight">{copy.title}</h1>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 min-h-0 flex-col justify-center px-5 pb-6 overflow-y-auto">
        {screen === "verify" ? (
          <div className="text-center" data-testid="signup-verify-screen">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-violet-50 text-violet-600">
              <Mail className="h-6 w-6" />
            </div>
            <h2 className="font-display text-xl font-bold tracking-tight">{copy.verifyTitle}</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-600">
              {copy.verifyBody}{" "}
              <span className="font-semibold text-zinc-900">{email.trim()}</span>.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">{copy.verifyHint}</p>
            {error ? <p className="mt-4 text-sm font-medium text-red-600">{error}</p> : null}
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resending}
              className="mt-6 w-full h-12 rounded-full gradient-linkedin text-white font-semibold text-base hover:opacity-90 transition-opacity disabled:opacity-60"
              data-testid="signup-resend-btn"
            >
              {resending ? copy.resending : copy.resend}
            </button>
            <button
              type="button"
              onClick={() => {
                setScreen("form");
                setError("");
              }}
              className="mt-3 w-full text-sm font-semibold text-linkedin hover:text-linkedin-dark"
              data-testid="signup-change-email-btn"
            >
              {copy.useDifferentEmail}
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleEmailSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-first-name" className="text-sm font-medium text-zinc-700">
                  {copy.firstName}
                </Label>
                <Input
                  id="signup-first-name"
                  type="text"
                  autoComplete="given-name"
                  placeholder={copy.firstNamePlaceholder}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="h-12 rounded-full border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 px-5 text-base focus-visible:ring-linkedin"
                  data-testid="signup-first-name-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-email" className="text-sm font-medium text-zinc-700">
                  {copy.email}
                </Label>
                <Input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  placeholder={copy.emailPlaceholder}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-full border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 px-5 text-base focus-visible:ring-linkedin"
                  data-testid="signup-email-input"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-password" className="text-sm font-medium text-zinc-700">
                  {copy.password}
                </Label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={copy.passwordHint}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  className="h-12 rounded-full border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 px-5 text-base focus-visible:ring-linkedin"
                  data-testid="signup-password-input"
                />
              </div>

              {error ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-red-600">{error}</p>
                  {error === copy.alreadyRegistered ? (
                    <Link
                      to="/signin"
                      className="inline-block text-sm font-semibold text-linkedin hover:text-linkedin-dark"
                    >
                      {copy.signInInstead}
                    </Link>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-full gradient-linkedin text-white font-semibold text-base hover:opacity-90 transition-opacity shadow-[0_8px_32px_-8px_rgba(124,58,237,0.5)] disabled:opacity-60"
                data-testid="signup-email-btn"
              >
                {submitting ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : copy.submit}
              </button>
            </form>

            <div className="my-5 flex items-center gap-4">
              <div className="flex-1 h-px bg-zinc-200" />
              <span className="text-sm text-zinc-500 shrink-0">{copy.or}</span>
              <div className="flex-1 h-px bg-zinc-200" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignup}
              className="w-full h-12 rounded-full bg-white border border-zinc-200 flex items-center justify-center gap-3 font-semibold text-zinc-900 hover:bg-zinc-50 transition-colors"
              data-testid="onboarding-signup-btn"
            >
              <GoogleIcon />
              {copy.google}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
