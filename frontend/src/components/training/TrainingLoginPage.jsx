import { useState } from "react";
import { Link } from "react-router-dom";
import { GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import Logo from "../Logo";
import GoogleSignInButton from "../auth/GoogleSignInButton";
import { Input } from "../ui/input";
import { BRAND } from "../../lib/brand";
import { api, setSessionToken } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { startGoogleLogin } from "../../lib/auth";
import { supabase, supabaseConfigured } from "../../lib/supabase";
import { setDemoAccountFromUser } from "../../lib/demoAccount";

export default function TrainingLoginPage() {
  const { setUser, setHasProfile, setHasPreferences, setHasTrainingAccess, setIsTrainingCreator } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const RETURN_PATH = "/fr/training";

  const onGoogleClick = () => {
    startGoogleLogin(RETURN_PATH, email.trim() ? { login_hint: email.trim() } : undefined);
  };

  const establishSession = async (session) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      setAuthNotice("Vérifiez votre boîte mail pour confirmer votre compte, puis reconnectez-vous.");
      return null;
    }
    const { data } = await api.post("/auth/supabase-session", { access_token: accessToken });
    if (data?.session_token) setSessionToken(data.session_token);
    setUser(data.user);
    setHasProfile(Boolean(data.has_profile));
    setHasPreferences(Boolean(data.has_preferences));
    setIsTrainingCreator(Boolean(data.is_training_creator));
    setHasTrainingAccess(Boolean(data.has_training_access));
    if (data?.user?.demo_account) setDemoAccountFromUser(data.user);
    return data.user;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthNotice("");

    if (!supabaseConfigured || !supabase) {
      setAuthError("L'authentification par e-mail n'est pas configurée.");
      return;
    }
    if (!email.trim() || password.length < 6) {
      setAuthError("Saisissez un e-mail et un mot de passe d'au moins 6 caractères.");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      const sessionUser = await establishSession(data?.session);
      if (!sessionUser) return;
      if (!sessionUser.training_access && !data.has_training_access) {
        setAuthError("Ce compte n'a pas accès à la formation. Utilisez votre lien d'invitation.");
      }
    } catch (err) {
      setAuthError(err?.response?.data?.detail || err?.message || "Identifiants incorrects. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-white text-zinc-900" data-testid="training-login-page">
      <header className="border-b border-zinc-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <Logo size={28} />
            <span>{BRAND.NAME}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-14 sm:py-20">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_400px] lg:gap-16">
          <section className="max-w-lg">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100">
              <GraduationCap className="h-6 w-6 text-violet-600" />
            </div>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Accéder à la formation
            </h1>
            <p className="mt-4 text-base leading-relaxed text-zinc-500">
              Connecte-toi avec le compte que tu as créé lors de ton inscription.
              Tu as besoin d&apos;un lien d&apos;invitation pour rejoindre la formation.
            </p>

            <div className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
              <span className="font-medium text-zinc-800">Pas encore de compte ?</span>
              {" "}
              Ouvre le lien d&apos;invitation que tu as reçu pour créer ton compte et activer l&apos;accès.
            </div>
          </section>

          <section className="w-full max-w-md justify-self-center lg:justify-self-end">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h2 className="font-display text-lg font-semibold">Connexion</h2>
              <p className="mt-1 text-sm text-zinc-500">
                Connecte-toi pour accéder à ta formation.
              </p>

              <div className="mt-6">
                <GoogleSignInButton
                  onClick={onGoogleClick}
                  disabled={submitting}
                  label="Continuer avec Google"
                  testId="training-login-google-btn"
                />
              </div>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200" />
                <span className="text-xs text-zinc-400">ou</span>
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
                    className="h-11"
                    autoComplete="email"
                    required
                    data-testid="training-login-email"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-zinc-700">Mot de passe</span>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11"
                    autoComplete="current-password"
                    required
                    minLength={6}
                    data-testid="training-login-password"
                  />
                </label>

                {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
                {authNotice ? <p className="text-sm text-amber-700">{authNotice}</p> : null}

                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  data-testid="training-login-submit"
                  className="h-11 w-full rounded-md bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Connexion…
                    </span>
                  ) : (
                    "Se connecter"
                  )}
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
