import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import Logo from "../Logo";
import GoogleSignInButton from "../auth/GoogleSignInButton";
import { Input } from "../ui/input";
import { BRAND } from "../../lib/brand";

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

      <div className="flex min-h-dvh items-center justify-center px-4 py-16 sm:px-6">
        <div
          className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-violet-200/70 bg-white shadow-[0_32px_80px_-28px_rgba(124,58,237,0.38)] md:max-w-4xl lg:max-w-5xl"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex flex-col md:min-h-[440px] md:flex-row">
            <aside className="gradient-linkedin px-6 py-8 text-white md:flex md:w-[42%] md:flex-col md:justify-center md:px-8 md:py-10 lg:w-[44%]">
              {aside}
            </aside>
            <div className="flex flex-1 flex-col justify-center px-6 py-7 sm:px-8 sm:py-9">
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
}) {
  const resolvedSubmitLabel = submitLabel || (authMode === "login" ? "Se connecter" : "Créer mon compte");

  return (
    <>
      <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
      {subtitle ? <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{subtitle}</p> : null}

      <div className="mt-6">
        <GoogleSignInButton
          onClick={onGoogleClick}
          disabled={submitting}
          label="Continuer avec Google"
          testId={googleTestId}
          className="rounded-full"
        />
      </div>

      <div className="my-5 flex items-center gap-3">
        <div className="h-px flex-1 bg-zinc-200" />
        <span className="text-xs font-medium text-zinc-400">ou</span>
        <div className="h-px flex-1 bg-zinc-200" />
      </div>

      <form className="space-y-4" onSubmit={onSubmit}>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-700">E-mail</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vous@email.com"
            className="h-11 rounded-2xl border-zinc-200 focus-visible:ring-violet-400/40"
            autoComplete="email"
            required
            data-testid={emailTestId}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-zinc-700">Mot de passe</span>
          <Input
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
              Chargement…
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
              Pas encore de compte ?{" "}
              <button
                type="button"
                className="font-semibold text-linkedin hover:text-linkedin-dark"
                onClick={() => onToggleMode("signup")}
              >
                S&apos;inscrire
              </button>
            </>
          ) : (
            <>
              Déjà un compte ?{" "}
              <button
                type="button"
                className="font-semibold text-linkedin hover:text-linkedin-dark"
                onClick={() => onToggleMode("login")}
              >
                Se connecter
              </button>
            </>
          )}
        </p>
      ) : null}
    </>
  );
}
