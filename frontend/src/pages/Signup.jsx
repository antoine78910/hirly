import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import Logo from "../components/Logo";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { BRAND } from "../lib/brand";
import { startGoogleLogin, supabaseSessionPayload } from "../lib/auth";
import { api, setSessionToken } from "../lib/api";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { trackEvent } from "../lib/analytics";

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    user,
    hasProfile,
    hasPreferences,
    loading: authLoading,
    setUser,
    setHasProfile,
    setHasPreferences,
  } = useAuth();
  const [mode, setMode] = useState(searchParams.get("mode") === "login" ? "login" : "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    trackEvent("signup_page_view", { mode });
  }, [mode]);

  useEffect(() => {
    if (authLoading || user) return;
    if (mode === "signup") {
      navigate("/onboarding", { replace: true });
    }
  }, [authLoading, user, mode, navigate]);

  useEffect(() => {
    if (authLoading || !user) return;
    navigate(hasProfile && hasPreferences ? "/swipe" : "/onboarding", { replace: true });
  }, [authLoading, user, hasProfile, hasPreferences, navigate]);

  const updateMode = (nextMode) => {
    if (nextMode === "signup") {
      navigate("/onboarding");
      return;
    }
    setMode(nextMode);
    setError("");
    setNotice("");
    setSearchParams({ mode: "login" });
  };

  const finishWithSupabaseSession = async (session) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      setNotice("Check your email to confirm your account, then come back to sign in.");
      return;
    }

    const { data } = await api.post("/auth/supabase-session", supabaseSessionPayload(session));
    if (data?.session_token) setSessionToken(data.session_token);
    setUser(data.user);
    setHasProfile(Boolean(data.has_profile));
    setHasPreferences(Boolean(data.has_preferences));
    trackEvent("auth_success", {
      method: "email",
      mode,
      has_profile: Boolean(data.has_profile),
      has_preferences: Boolean(data.has_preferences),
    });
    navigate(data.has_profile && data.has_preferences ? "/swipe" : "/onboarding?step=jobSearch", { replace: true });
  };

  const onEmailSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!supabaseConfigured || !supabase) {
      setError("Email authentication is not configured.");
      return;
    }
    if (!email.trim() || password.length < 6) {
      setError("Enter an email and a password with at least 6 characters.");
      return;
    }

    setSubmitting(true);
    trackEvent(mode === "login" ? "login_email_submitted" : "signup_email_submitted");
    try {
      const authCall = mode === "login"
        ? supabase.auth.signInWithPassword({ email: email.trim(), password })
        : supabase.auth.signUp({ email: email.trim(), password });
      const { data, error: authError } = await authCall;
      if (authError) throw authError;
      await finishWithSupabaseSession(data?.session);
    } catch (err) {
      setError(err?.message || "Authentication failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const ctaLabel = mode === "login" ? "Sign in" : "Sign up";

  const onGoogleClick = () => {
    trackEvent("signup_google_clicked", { mode });
    startGoogleLogin("/swipe");
  };

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <header className="border-b border-zinc-100 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-black tracking-tight">
            <Logo size={28} />
            <span>{BRAND.NAME}</span>
          </Link>
        </div>
      </header>

      <main className="gradient-linkedin-soft min-h-[calc(100dvh-57px)] px-6 py-12">
        <div className="mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-[1fr_420px]">
          <section>
            <p className="text-sm font-semibold text-linkedin">Start swiping in minutes</p>
            <h1 className="mt-3 font-display text-5xl font-black leading-tight tracking-tight sm:text-6xl">
              Create your account.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600">
              Sign up once, then keep your swipes, profile, and applications synced across sessions.
            </p>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-[0_24px_80px_-28px_rgba(124,58,237,0.28)]">
            <div className="mb-5">
              <h2 className="font-display text-2xl font-bold">
                {mode === "login" ? "Welcome back" : "Choose how to continue"}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {mode === "login" ? "Sign in to return to your job feed." : "Use Google or continue with email and password."}
              </p>
            </div>

            <Button
              type="button"
              onClick={onGoogleClick}
              className="h-12 w-full rounded-full border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
              disabled={submitting}
              data-testid="signup-google-btn"
            >
              <span className="mr-2 grid h-5 w-5 place-items-center rounded-full border border-zinc-200 text-xs font-black text-linkedin">G</span>
              Continue with Google
            </Button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-zinc-200" />
              <span className="text-xs font-medium text-zinc-400">or</span>
              <div className="h-px flex-1 bg-zinc-200" />
            </div>

            <form className="space-y-3" onSubmit={onEmailSubmit}>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-zinc-700">Email</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 rounded-2xl pl-10"
                    autoComplete="email"
                    data-testid="signup-email-input"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-zinc-700">Password</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 rounded-2xl pl-10"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    data-testid="signup-password-input"
                  />
                </div>
              </label>

              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
              {notice ? <p className="text-sm font-medium text-linkedin">{notice}</p> : null}

              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full rounded-full gradient-linkedin font-semibold text-white hover:opacity-90"
                data-testid="signup-email-submit"
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {ctaLabel}
                {!submitting ? <ArrowRight className="ml-1.5 h-4 w-4" /> : null}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-zinc-500">
              {mode === "login" ? "Need an account?" : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => updateMode(mode === "login" ? "signup" : "login")}
                className="font-semibold text-linkedin hover:text-linkedin-dark"
                data-testid="signup-mode-toggle"
              >
                {mode === "login" ? "Sign up" : "Sign in"}
              </button>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
