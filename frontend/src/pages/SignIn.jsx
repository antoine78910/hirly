import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
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

export default function SignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnPath = resolveAuthReturnPath(searchParams.get("next"));
  const {
    user,
    hasProfile,
    hasPreferences,
    loading: authLoading,
    setUser,
    setHasProfile,
    setHasPreferences,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    trackEvent("signin_page_view");
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    navigate(
      hasProfile && hasPreferences ? returnPath : "/onboarding?step=jobSearch",
      { replace: true },
    );
  }, [authLoading, user, hasProfile, hasPreferences, navigate, returnPath]);

  const finishWithSupabaseSession = async (session) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      setError("Check your email to confirm your account, then come back to sign in.");
      return;
    }

    const { data } = await api.post("/auth/supabase-session", supabaseSessionPayload(session));
    if (data?.session_token) setSessionToken(data.session_token);
    setUser(data.user);
    setHasProfile(Boolean(data.has_profile));
    setHasPreferences(Boolean(data.has_preferences));
    trackEvent("auth_success", {
      method: "email",
      mode: "login",
      has_profile: Boolean(data.has_profile),
      has_preferences: Boolean(data.has_preferences),
    });
    navigate(
      data.has_profile && data.has_preferences ? returnPath : "/onboarding?step=jobSearch",
      { replace: true },
    );
  };

  const onEmailSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!supabaseConfigured || !supabase) {
      setError("Email authentication is not configured.");
      return;
    }
    if (!email.trim() || password.length < 6) {
      setError("Enter your email and password (at least 6 characters).");
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
      setError(err?.message || "Sign in failed. Please try again.");
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
            <p className="text-sm font-semibold text-linkedin">Welcome back</p>
            <h1 className="mt-3 font-display text-5xl font-black leading-tight tracking-tight sm:text-6xl">
              Sign in to {BRAND.NAME}.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-600">
              Pick up where you left off — your swipes, profile, and applications stay synced.
            </p>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-[0_24px_80px_-28px_rgba(124,58,237,0.28)]">
            <div className="mb-5">
              <h2 className="font-display text-2xl font-bold">Sign in</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Continue with Google or use your email and password.
              </p>
            </div>

            <GoogleSignInButton
              onClick={onGoogleClick}
              disabled={submitting}
              className="h-12 rounded-full"
              testId="signin-google-btn"
            />

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
                    data-testid="signin-email-input"
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
                    autoComplete="current-password"
                    data-testid="signin-password-input"
                  />
                </div>
              </label>

              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full rounded-full gradient-linkedin font-semibold text-white hover:opacity-90"
                data-testid="signin-email-submit"
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sign in
                {!submitting ? <ArrowRight className="ml-1.5 h-4 w-4" /> : null}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-zinc-500">
              New to {BRAND.NAME}?{" "}
              <Link to="/onboarding" className="font-semibold text-linkedin hover:text-linkedin-dark">
                Get started
              </Link>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
