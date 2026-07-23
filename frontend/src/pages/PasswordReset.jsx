import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Lock, Mail } from "lucide-react";
import Logo from "../components/Logo";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { BRAND } from "../lib/brand";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { trackEvent } from "../lib/analytics";
import { useAppLocale } from "../context/AppLocaleContext";

const COPY = {
  en: {
    requestTitle: "Reset your password",
    requestSubtitle: "Enter your account email and we will send you a secure reset link.",
    email: "Email",
    send: "Send reset link",
    sentTitle: "Check your email",
    sentBody: "If an account exists for this email, a password reset link has been sent.",
    updateTitle: "Choose a new password",
    updateSubtitle: "Use at least 6 characters.",
    password: "New password",
    confirmPassword: "Confirm new password",
    update: "Update password",
    completeTitle: "Password updated",
    completeBody: "Your new password is ready. You can now sign in.",
    back: "Back to sign in",
    invalidEmail: "Enter a valid email address.",
    passwordTooShort: "Your password must contain at least 6 characters.",
    passwordMismatch: "The passwords do not match.",
    unavailable: "Password reset is temporarily unavailable.",
    invalidLink: "This reset link is invalid or has expired. Request a new one.",
  },
  fr: {
    requestTitle: "Reinitialiser votre mot de passe",
    requestSubtitle: "Saisissez votre adresse e-mail pour recevoir un lien securise.",
    email: "Adresse e-mail",
    send: "Envoyer le lien",
    sentTitle: "Consultez votre messagerie",
    sentBody: "Si un compte existe pour cette adresse, un lien de reinitialisation a ete envoye.",
    updateTitle: "Choisissez un nouveau mot de passe",
    updateSubtitle: "Utilisez au moins 6 caracteres.",
    password: "Nouveau mot de passe",
    confirmPassword: "Confirmer le mot de passe",
    update: "Mettre a jour le mot de passe",
    completeTitle: "Mot de passe mis a jour",
    completeBody: "Votre nouveau mot de passe est pret. Vous pouvez maintenant vous connecter.",
    back: "Retour a la connexion",
    invalidEmail: "Saisissez une adresse e-mail valide.",
    passwordTooShort: "Le mot de passe doit contenir au moins 6 caracteres.",
    passwordMismatch: "Les mots de passe ne correspondent pas.",
    unavailable: "La reinitialisation est temporairement indisponible.",
    invalidLink: "Ce lien est invalide ou a expire. Demandez-en un nouveau.",
  },
};

function recoveryLinkPresent() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.has("code") || query.get("type") === "recovery" || hash.get("type") === "recovery";
}

export default function PasswordReset() {
  const { lang } = useAppLocale();
  const copy = useMemo(() => COPY[lang === "fr" ? "fr" : "en"], [lang]);
  const hasRecoveryLink = useMemo(recoveryLinkPresent, []);
  const [mode, setMode] = useState(hasRecoveryLink ? "loading" : "request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    trackEvent("password_reset_page_view", { mode: hasRecoveryLink ? "recovery" : "request" });
    if (!hasRecoveryLink) return undefined;
    if (!supabaseConfigured || !supabase) {
      setError(copy.unavailable);
      setMode("request");
      return undefined;
    }

    let active = true;
    let invalidLinkTimer;
    const acceptSession = (session) => {
      if (!active || !session?.user) return false;
      if (invalidLinkTimer) window.clearTimeout(invalidLinkTimer);
      window.history.replaceState({}, "", "/reset-password");
      setError("");
      setMode("update");
      return true;
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || hasRecoveryLink) acceptSession(session);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (acceptSession(data?.session)) return;
      invalidLinkTimer = window.setTimeout(() => {
        if (!active) return;
        setError(copy.invalidLink);
        setMode("request");
      }, 5000);
    });

    return () => {
      active = false;
      if (invalidLinkTimer) window.clearTimeout(invalidLinkTimer);
      listener?.subscription?.unsubscribe();
    };
  }, [copy.invalidLink, copy.unavailable, hasRecoveryLink]);

  const requestReset = async (event) => {
    event.preventDefault();
    setError("");
    if (!supabaseConfigured || !supabase) {
      setError(copy.unavailable);
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(copy.invalidEmail);
      return;
    }

    setSubmitting(true);
    try {
      const redirectTo = new URL("/reset-password", window.location.origin).toString();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (resetError) throw resetError;
      trackEvent("password_reset_requested");
      setMode("sent");
    } catch {
      setError(copy.unavailable);
    } finally {
      setSubmitting(false);
    }
  };

  const updatePassword = async (event) => {
    event.preventDefault();
    setError("");
    if (password.length < 6) {
      setError(copy.passwordTooShort);
      return;
    }
    if (password !== confirmPassword) {
      setError(copy.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      trackEvent("password_reset_completed");
      await supabase.auth.signOut({ scope: "local" });
      setMode("complete");
    } catch {
      setError(copy.invalidLink);
    } finally {
      setSubmitting(false);
    }
  };

  const isUpdate = mode === "update";
  const title =
    mode === "sent"
      ? copy.sentTitle
      : mode === "complete"
        ? copy.completeTitle
        : isUpdate
          ? copy.updateTitle
          : copy.requestTitle;
  const subtitle =
    mode === "sent"
      ? copy.sentBody
      : mode === "complete"
        ? copy.completeBody
        : isUpdate
          ? copy.updateSubtitle
          : copy.requestSubtitle;

  return (
    <div className="min-h-dvh bg-white px-6 py-10 text-zinc-900 sm:py-16">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center">
        <Link
          to="/"
          className="flex items-center gap-2 font-display text-lg font-black tracking-tight"
        >
          <Logo size={30} />
          <span>{BRAND.NAME}</span>
        </Link>

        <div className="mt-10 w-full">
          <h1 className="text-center font-display text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-center text-sm leading-6 text-zinc-500">{subtitle}</p>

          {mode === "loading" ? (
            <div className="mt-8 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : null}

          {mode === "request" ? (
            <form className="mt-8 space-y-3" onSubmit={requestReset}>
              <label className="block" htmlFor="password-reset-email">
                <span className="sr-only">{copy.email}</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    id="password-reset-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={copy.email}
                    autoComplete="email"
                    className="h-12 rounded-2xl pl-10"
                    data-testid="password-reset-email"
                  />
                </div>
              </label>
              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full rounded-full gradient-linkedin font-semibold text-white hover:opacity-90"
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {copy.send}
              </Button>
            </form>
          ) : null}

          {mode === "update" ? (
            <form className="mt-8 space-y-3" onSubmit={updatePassword}>
              <label className="block" htmlFor="password-reset-password">
                <span className="sr-only">{copy.password}</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    id="password-reset-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={copy.password}
                    autoComplete="new-password"
                    className="h-12 rounded-2xl pl-10"
                  />
                </div>
              </label>
              <label className="block" htmlFor="password-reset-confirm-password">
                <span className="sr-only">{copy.confirmPassword}</span>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    id="password-reset-confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder={copy.confirmPassword}
                    autoComplete="new-password"
                    className="h-12 rounded-2xl pl-10"
                  />
                </div>
              </label>
              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
              <Button
                type="submit"
                disabled={submitting}
                className="h-12 w-full rounded-full gradient-linkedin font-semibold text-white hover:opacity-90"
              >
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {copy.update}
              </Button>
            </form>
          ) : null}

          {mode !== "loading" && mode !== "update" ? (
            <p className="mt-6 text-center text-sm">
              <Link to="/signin" className="font-semibold text-linkedin hover:text-linkedin-dark">
                {copy.back}
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
