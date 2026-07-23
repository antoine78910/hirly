import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { BRAND } from "../../lib/brand";
import GoogleSignInButton from "../auth/GoogleSignInButton";
import Logo from "../Logo";
import { Input } from "../ui/input";

export function TrainingAuthPopup({ aside, children, testId = "training-auth-popup" }) {
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 gradient-linkedin-soft showcase-landing-ambient text-zinc-900"
      data-testid={testId}
    >
      <Link
        to="/"
        className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-white/80 px-3 py-2 font-display text-sm font-semibold tracking-tight shadow-sm backdrop-blur-sm transition-colors hover:bg-white sm:left-6 sm:top-6"
      >
        <Logo size={22} />
        <span>{BRAND.NAME}</span>
      </Link>

      <div className="flex min-h-dvh items-center justify-center overflow-y-auto px-4 py-16 sm:px-6 sm:py-20">
        <div
          className="relative my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-violet-200/70 bg-white shadow-[0_32px_80px_-28px_rgba(124,58,237,0.38)] md:max-h-[calc(100dvh-2rem)] md:max-w-4xl lg:max-w-5xl"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:flex-row md:overflow-hidden">
            <aside className="shrink-0 gradient-linkedin px-6 py-8 text-white md:flex md:w-[42%] md:flex-col md:justify-center md:overflow-y-auto md:px-8 md:py-10 lg:w-[44%]">
              {aside}
            </aside>
            <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto overscroll-contain px-6 py-7 sm:px-8 sm:py-9">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TrainingAuthForm({
  title,
  subtitle,
  authMode = "login",
  email,
  setEmail,
  password,
  setPassword,
  authError,
  authNotice,
  submitting,
  onSubmit,
  onGoogleClick,
  onToggleMode,
  submitLabel,
  googleTestId = "training-auth-google-btn",
  emailTestId = "training-auth-email",
  passwordTestId = "training-auth-password",
  submitTestId = "training-auth-submit",
  showModeToggle = false,
  labels = {},
}) {
  const copy = {
    signIn: "Se connecter",
    signUp: "Créer mon compte",
    google: "Continuer avec Google",
    or: "ou",
    email: "E-mail",
    emailPlaceholder: "vous@email.com",
    password: "Mot de passe",
    loading: "Chargement…",
    noAccount: "Pas encore de compte ?",
    alreadyHaveAccount: "Déjà un compte ?",
    ...labels,
  };
  const resolvedSubmitLabel = submitLabel || (authMode === "login" ? copy.signIn : copy.signUp);

  return (
    <>
      <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      {subtitle ? <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{subtitle}</p> : null}

      <div className="mt-6">
        <GoogleSignInButton
          onClick={onGoogleClick}
          disabled={submitting}
          label={copy.google}
          testId={googleTestId}
          className="rounded-full"
        />
      </div>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-200" />
        <span className="text-xs font-medium text-zinc-400">{copy.or}</span>
        <div className="h-px flex-1 bg-zinc-200" />
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block" htmlFor="training-auth-email">
          <span className="mb-1.5 block text-sm font-medium text-zinc-700">{copy.email}</span>
          <Input
            id="training-auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={copy.emailPlaceholder}
            className="h-11 rounded-2xl border-zinc-200 focus-visible:ring-violet-400/40"
            autoComplete="email"
            required
            data-testid={emailTestId}
          />
        </label>

        <label className="block" htmlFor="training-auth-password">
          <span className="mb-1.5 block text-sm font-medium text-zinc-700">{copy.password}</span>
          <Input
            id="training-auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-2xl border-zinc-200 focus-visible:ring-violet-400/40"
            autoComplete={authMode === "login" ? "current-password" : "new-password"}
            required
            minLength={6}
            data-testid={passwordTestId}
          />
        </label>

        {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
        {authNotice ? <p className="text-sm text-violet-700">{authNotice}</p> : null}

        <button
          type="submit"
          disabled={submitting || !email.trim()}
          data-testid={submitTestId}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full gradient-linkedin text-sm font-semibold text-white shadow-[0_8px_32px_-8px_rgba(124,58,237,0.45)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy.loading}
            </>
          ) : (
            resolvedSubmitLabel
          )}
        </button>
      </form>

      {showModeToggle && onToggleMode ? (
        <p className="mt-5 text-center text-sm text-zinc-500">
          {authMode === "login" ? (
            <>
              {copy.noAccount}{" "}
              <button
                type="button"
                className="font-semibold text-linkedin hover:text-linkedin-dark"
                onClick={() => onToggleMode("signup")}
              >
                {copy.signUp}
              </button>
            </>
          ) : (
            <>
              {copy.alreadyHaveAccount}{" "}
              <button
                type="button"
                className="font-semibold text-linkedin hover:text-linkedin-dark"
                onClick={() => onToggleMode("login")}
              >
                {copy.signIn}
              </button>
            </>
          )}
        </p>
      ) : null}
    </>
  );
}
