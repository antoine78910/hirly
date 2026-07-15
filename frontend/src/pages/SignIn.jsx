import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, Lock, Mail } from "lucide-react";
import Logo from "../components/Logo";
import GoogleSignInButton from "../components/auth/GoogleSignInButton";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { BRAND } from "../lib/brand";
import { resolveAuthReturnPath } from "../lib/authReturnPath";
import { startGoogleLogin, supabaseSessionPayload } from "../lib/auth";
import { api, setSessionToken } from "../lib/api";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { trackEvent } from "../lib/analytics";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import { goToApp } from "../lib/appDomains";
import {
  openJobSeekerDestination,
  resolveJobSeekerEntryDestination,
} from "../lib/jobSeekerEntry";
import { useAppLocale } from "../context/AppLocaleContext";

const COPY = {
  en: {
    title: "Welcome back",
    subtitle: "Continue with Google or your email.",
    or: "or",
    email: "Email",
    password: "Password",
    continue: "Continue",
    google: "Continue with Google",
    newUser: "New to {brand}?",
    getStarted: "Get started",
    confirmEmail: "Check your email to confirm your account, then come back to sign in.",
    authNotConfigured: "Email authentication is not configured.",
    credentialsRequired: "Enter your email and password (at least 6 characters).",
    signInFailed: "Sign in failed. Please try again.",
  },
  fr: {
    title: "Bon retour",
    subtitle: "Continuez avec Google ou votre e-mail.",
    or: "ou",
    email: "Adresse e-mail",
    password: "Mot de passe",
    continue: "Continuer",
    google: "Continuer avec Google",
    newUser: "Nouveau sur {brand} ?",
    getStarted: "Commencer",
    confirmEmail: "Vérifiez votre e-mail pour confirmer votre compte, puis reconnectez-vous.",
    authNotConfigured: "L'authentification par e-mail n'est pas configurée.",
    credentialsRequired: "Saisissez votre e-mail et votre mot de passe (6 caractères minimum).",
    signInFailed: "Connexion impossible. Réessayez.",
  },
};

export default function SignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnPath = resolveAuthReturnPath(searchParams.get("next"));
  const {
    user,
    loading: authLoading,
    setUser,
    setHasProfile,
    setHasPreferences,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { lang } = useAppLocale();
  const copy = useMemo(() => COPY[lang === "fr" ? "fr" : "en"], [lang]);

  useEffect(() => {
    trackEvent("signin_page_view");
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const dest = await resolveJobSeekerEntryDestination(user);
        if (cancelled) return;
        if (dest.host === "app") {
          goToApp(returnPath);
          return;
        }
        openJobSeekerDestination(
          { ...dest, search: dest.search || "?step=jobSearch" },
          navigate,
        );
      } catch {
        if (!cancelled) navigate("/onboarding?step=jobSearch", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, navigate, returnPath]);

  const finishWithSupabaseSession = async (session) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      setError(copy.confirmEmail);
      return;
    }

    const { data } = await api.post("/auth/supabase-session", supabaseSessionPayload(session));
    if (data?.session_token) setSessionToken(data.session_token);
    setUser(data.user);
    setHasProfile(Boolean(data.has_profile));
    setHasPreferences(Boolean(data.has_preferences));
    setDemoAccountFromUser(data.user, Boolean(data.is_admin));
    trackEvent("auth_success", {
      method: "email",
      mode: "login",
      has_profile: Boolean(data.has_profile),
      has_preferences: Boolean(data.has_preferences),
    });
    if (data?.user?.demo_account) {
      goToApp("/swipe");
      return;
    }
    try {
      const dest = await resolveJobSeekerEntryDestination(data.user);
      if (dest.host === "app") {
        goToApp(returnPath);
        return;
      }
      openJobSeekerDestination(
        { ...dest, search: dest.search || "?step=jobSearch" },
        navigate,
      );
    } catch {
      navigate("/onboarding?step=jobSearch", { replace: true });
    }
  };

  const onEmailSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!supabaseConfigured || !supabase) {
      setError(copy.authNotConfigured);
      return;
    }
    if (!email.trim() || password.length < 6) {
      setError(copy.credentialsRequired);
      return;
    }

    setSubmitting(true);
    trackEvent("login_email_submitted");
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) throw authError;
      await finishWithSupabaseSession(data?.session);
    } catch (err) {
      setError(err?.message || copy.signInFailed);
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleClick = () => {
    trackEvent("signin_google_clicked");
    startGoogleLogin(returnPath);
  };

  if (authLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white px-6 py-10 text-zinc-900 sm:py-16">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center">
        <Link to="/" className="flex items-center gap-2 font-display text-lg font-black tracking-tight">
          <Logo size={30} />
          <span>{BRAND.NAME}</span>
        </Link>

        <div className="mt-10 w-full">
          <h1 className="text-center font-display text-3xl font-bold tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-center text-sm text-zinc-500">
            {copy.subtitle}
          </p>

          <div className="mt-8 space-y-4">
            <GoogleSignInButton
              onClick={onGoogleClick}
              disabled={submitting}
              label={copy.google}
              className="h-12 rounded-full"
              testId="signin-google-btn"
            />

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-200" />
              <span className="text-xs font-medium text-zinc-400">{copy.or}</span>
              <div className="h-px flex-1 bg-zinc-200" />
            </div>

            <form className="space-y-3" onSubmit={onEmailSubmit}>
              <label className="block">
                <span className="sr-only">{copy.email}</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={copy.email}
                    className="h-12 rounded-2xl pl-10"
                    autoComplete="email"
                    data-testid="signin-email-input"
                  />
                </div>
              </label>

              <label className="block">
                <span className="sr-only">{copy.password}</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={copy.password}
                    className="h-12 rounded-2xl pl-10"
                    autoComplete="current-password"
                    data-testid="signin-password-input"
                  />
                </div>
              </label>

              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

              <div className='flex justify-end'>
                <Link
                  to='/reset-password'
                  className='text-sm font-semibold text-linkedin hover:text-linkedin-dark'
                  data-testid='signin-forgot-password'
                >
                  {lang === 'fr' ? 'Mot de passe oublie ?' : 'Forgot password?'}
                </Link>
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full rounded-full gradient-linkedin font-semibold text-white hover:opacity-90"
                data-testid="signin-email-submit"
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {copy.continue}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-sm text-zinc-500">
            {copy.newUser.replace("{brand}", BRAND.NAME)}{" "}
            <Link to="/onboarding" className="font-semibold text-linkedin hover:text-linkedin-dark">
              {copy.getStarted}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
