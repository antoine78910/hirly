import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff, Loader2, Lock, Mail, User, X } from "lucide-react";
import { toast } from "sonner";
import Logo from "../Logo";
import { BRAND } from "../../lib/brand";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import GoogleSignInButton from "../auth/GoogleSignInButton";
import {
  authCallbackRedirectUrl,
  establishAppSessionFromSupabase,
  startGoogleLogin,
  storeOnboardingReturnPath,
} from "../../lib/auth";
import { supabase, supabaseConfigured } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { trackEvent } from "../../lib/analytics";
import { trackOnboardingSignup } from "../../lib/datafast";

const COPY = {
  en: {
    title: "Create your account",
    subtitle: "Start applying to jobs in minutes",
    firstNamePlaceholder: "First name",
    emailPlaceholder: "Email address",
    passwordPlaceholder: "Password (6+ characters)",
    submit: "Create account",
    orEmail: "or",
    google: "Continue with Google",
    verifyTitle: "Check your email",
    verifyBody: "We sent a verification link to",
    verifyBodyPending: "We need to verify",
    verifyHint:
      "Open the link to confirm your account, then you'll continue onboarding automatically.",
    emailDispatchFailed:
      'We couldn\'t send the verification email. Tap "Resend email" below, or try signing up with Google.',
    resend: "Resend email",
    resending: "Sending…",
    resendSuccess: "Verification email sent again.",
    useDifferentEmail: "Use a different email",
    firstNameRequired: "Please enter your first name",
    emailRequired: "Please enter your email",
    emailInvalid: "Please enter a valid email address",
    passwordRequired: "Password must be at least 6 characters",
    authNotConfigured: "Email sign-up is not configured",
    authNotConfiguredDesc:
      "Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in frontend/.env",
    googleNotConfigured: "Google sign-up is not configured",
    signupFailed: "Sign up failed. Please try again.",
    alreadyRegistered: "An account already exists with this email. Sign in instead.",
    signInInstead: "Sign in",
    hasAccount: "Already have an account?",
    signIn: "Sign in",
  },
  fr: {
    title: "Créez votre compte",
    subtitle: "Commencez à postuler en quelques minutes",
    firstNamePlaceholder: "Prénom",
    emailPlaceholder: "Adresse e-mail",
    passwordPlaceholder: "Mot de passe (6 car. min.)",
    submit: "Créer mon compte",
    orEmail: "ou",
    google: "Continuer avec Google",
    verifyTitle: "Vérifiez votre e-mail",
    verifyBody: "Nous avons envoyé un lien de confirmation à",
    verifyBodyPending: "Nous devons vérifier",
    verifyHint:
      "Ouvrez le lien pour confirmer votre compte, puis l'onboarding reprendra automatiquement.",
    emailDispatchFailed:
      "Impossible d'envoyer l'e-mail de vérification. Appuyez sur « Renvoyer l'e-mail » ci-dessous, ou inscrivez-vous avec Google.",
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
    hasAccount: "Vous avez déjà un compte ?",
    signIn: "Se connecter",
  },
};

const ONBOARDING_RETURN_PATH = "/onboarding?step=jobSearch";

function isConfirmationEmailSendError(message = "") {
  return /confirmation mail|confirmation email|error sending confirmation/i.test(message);
}

export default function OnboardingSignup({ onClose, lang = "en" }) {
  const copy = useMemo(() => COPY[lang === "fr" ? "fr" : "en"], [lang]);
  const { setUser, setHasProfile, setHasPreferences } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [screen, setScreen] = useState("form");
  const [error, setError] = useState("");
  const [emailDispatchFailed, setEmailDispatchFailed] = useState(false);

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
    trackOnboardingSignup("email");
    return true;
  };

  const handleGoogleSignup = async () => {
    storeOnboardingReturnPath(ONBOARDING_RETURN_PATH);
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
    storeOnboardingReturnPath(ONBOARDING_RETURN_PATH);
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
      if (authError) {
        if (isConfirmationEmailSendError(authError.message || "")) {
          setEmailDispatchFailed(true);
          setScreen("verify");
          setError(copy.emailDispatchFailed);
          return;
        }
        throw authError;
      }

      if (data?.session) {
        const ok = await finishSession(data.session);
        if (ok) {
          onClose?.();
          return;
        }
      }

      setEmailDispatchFailed(false);
      setScreen("verify");
    } catch (err) {
      const message = err?.message || "";
      if (isConfirmationEmailSendError(message)) {
        setEmailDispatchFailed(true);
        setScreen("verify");
        setError(copy.emailDispatchFailed);
      } else if (
        /already registered|already been registered|user already registered/i.test(message)
      ) {
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
      setEmailDispatchFailed(false);
      toast.success(copy.resendSuccess);
    } catch (err) {
      setError(err?.message || copy.signupFailed);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 min-h-dvh overflow-y-auto bg-white px-6 py-10 text-zinc-900 sm:py-16">
      <button
        type="button"
        onClick={onClose}
        className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 sm:left-6 sm:top-6"
        aria-label="Close"
        data-testid="signup-close-btn"
      >
        <X className="h-5 w-5" strokeWidth={2} />
      </button>

      <div className="mx-auto flex w-full max-w-sm flex-col items-center">
        <Link
          to="/"
          className="flex items-center gap-2 font-display text-lg font-black tracking-tight"
        >
          <Logo size={30} />
          <span>{BRAND.NAME}</span>
        </Link>

        <div className="mt-10 w-full">
          {screen === "verify" ? (
            <div className="text-center" data-testid="signup-verify-screen">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-zinc-100 text-linkedin">
                <Mail className="h-6 w-6" />
              </div>
              <h2 className="font-display text-xl font-bold tracking-tight">{copy.verifyTitle}</h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">
                {emailDispatchFailed ? copy.verifyBodyPending : copy.verifyBody}{" "}
                <span className="font-semibold text-zinc-900">{email.trim()}</span>.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">{copy.verifyHint}</p>
              {error ? (
                <p
                  className={`mt-4 rounded-xl px-4 py-3 text-sm font-medium ${emailDispatchFailed ? "bg-amber-50 text-amber-900" : "text-red-600"}`}
                >
                  {error}
                </p>
              ) : null}
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resending}
                className="mt-6 h-12 w-full rounded-full gradient-linkedin text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                data-testid="signup-resend-btn"
              >
                {resending ? copy.resending : copy.resend}
              </button>
              <button
                type="button"
                onClick={() => {
                  setScreen("form");
                  setError("");
                  setEmailDispatchFailed(false);
                }}
                className="mt-3 w-full text-sm font-semibold text-linkedin hover:text-linkedin-dark"
                data-testid="signup-change-email-btn"
              >
                {copy.useDifferentEmail}
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-center font-display text-3xl font-bold tracking-tight">
                {copy.title}
              </h1>
              <p className="mt-2 text-center text-sm text-zinc-500">{copy.subtitle}</p>

              <div className="mt-8 space-y-4">
                <GoogleSignInButton
                  onClick={handleGoogleSignup}
                  disabled={submitting}
                  label={copy.google}
                  className="h-12 rounded-full"
                  testId="onboarding-signup-btn"
                />

                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-zinc-200" />
                  <span className="text-xs font-medium text-zinc-400">{copy.orEmail}</span>
                  <div className="h-px flex-1 bg-zinc-200" />
                </div>

                <form onSubmit={handleEmailSignup} className="space-y-3">
                  <label className="block">
                    <span className="sr-only">{copy.firstNamePlaceholder}</span>
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      <Input
                        id="signup-first-name"
                        type="text"
                        autoComplete="given-name"
                        placeholder={copy.firstNamePlaceholder}
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="h-12 rounded-2xl pl-10"
                        data-testid="signup-first-name-input"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="sr-only">{copy.emailPlaceholder}</span>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      <Input
                        id="signup-email"
                        type="email"
                        autoComplete="email"
                        placeholder={copy.emailPlaceholder}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-12 rounded-2xl pl-10"
                        data-testid="signup-email-input"
                      />
                    </div>
                  </label>

                  <label className="block">
                    <span className="sr-only">{copy.passwordPlaceholder}</span>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder={copy.passwordPlaceholder}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={6}
                        className="h-12 rounded-2xl pl-10 pr-10"
                        data-testid="signup-password-input"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </label>

                  {error ? (
                    <div className="space-y-1">
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

                  <Button
                    type="submit"
                    disabled={submitting}
                    className="h-12 w-full rounded-full gradient-linkedin font-semibold text-white hover:opacity-90"
                    data-testid="signup-email-btn"
                  >
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {copy.submit}
                  </Button>
                </form>
              </div>

              <p className="mt-6 text-center text-sm text-zinc-500">
                {copy.hasAccount}{" "}
                <Link to="/signin" className="font-semibold text-linkedin hover:text-linkedin-dark">
                  {copy.signIn}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
