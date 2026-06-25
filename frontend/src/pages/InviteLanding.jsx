import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import Logo from "../components/Logo";
import GoogleSignInButton from "../components/auth/GoogleSignInButton";
import { Input } from "../components/ui/input";
import { BRAND } from "../lib/brand";
import { api, setSessionToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import {
  applyRedeemToAuth,
  clearPendingInviteCode,
  inviteDestination,
  redeemCreatorInvite,
  storePendingInviteCode,
} from "../lib/creatorInvite";
import { getLocalDevInviteMeta } from "../lib/inviteDevMocks";
import { supabase, supabaseConfigured } from "../lib/supabase";

function isTrainingInvite(meta) {
  const type = meta?.invite_type;
  return type === "training" || type === "creator" || (type !== "demo" && type !== "creator");
}

function isDemoInvite(meta) {
  const type = meta?.invite_type;
  return type === "demo" || type === "creator";
}

export default function InviteLanding() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, setUser, setHasProfile, setHasPreferences, setHasTrainingAccess } = useAuth();
  const [checking, setChecking] = useState(true);
  const [inviteMeta, setInviteMeta] = useState(null);
  const [redeeming, setRedeeming] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState("signup");
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const autoRedeemStarted = useRef(false);

  const normalized = String(code || "").trim();
  const invalid = !/^\d{6}$/.test(normalized);
  const trainingInvite = isTrainingInvite(inviteMeta);
  const demoInvite = isDemoInvite(inviteMeta);

  useEffect(() => {
    if (invalid) {
      setChecking(false);
      return;
    }
    storePendingInviteCode(normalized);
    (async () => {
      try {
        const { data } = await api.get(`/invites/${normalized}/validate`);
        setInviteMeta(data);
      } catch {
        const local = getLocalDevInviteMeta(normalized);
        setInviteMeta(local || { valid: false, reason: "not_found" });
      } finally {
        setChecking(false);
      }
    })();
  }, [code, normalized, invalid]);

  const finishRedeemAndNavigate = async (sessionUser, redeemData) => {
    applyRedeemToAuth(redeemData, sessionUser, {
      setUser,
      setHasTrainingAccess,
      setDemoAccountFromUser,
    });
    navigate(inviteDestination(redeemData, inviteMeta), { replace: true });
  };

  useEffect(() => {
    if (authLoading || checking || !user || redeeming || autoRedeemStarted.current) return;
    if (invalid) return;
    autoRedeemStarted.current = true;
    (async () => {
      setRedeeming(true);
      try {
        const data = await redeemCreatorInvite(api, normalized);
        await finishRedeemAndNavigate(user, data);
      } catch (err) {
        autoRedeemStarted.current = false;
        if (err?.response?.status === 409) {
          navigate(inviteDestination(null, inviteMeta), { replace: true });
        } else {
          toast.error(err?.response?.data?.detail || "Impossible d'activer l'invitation");
        }
      } finally {
        setRedeeming(false);
      }
    })();
  }, [authLoading, checking, user, normalized, invalid, navigate, redeeming, inviteMeta]);

  const establishSession = async (session) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      setAuthNotice("Vérifiez votre boîte mail pour confirmer votre compte, puis rouvrez ce lien pour finaliser l'activation.");
      return null;
    }
    const { data } = await api.post("/auth/supabase-session", { access_token: accessToken });
    if (data?.session_token) setSessionToken(data.session_token);
    setUser(data.user);
    setHasProfile(Boolean(data.has_profile));
    setHasPreferences(Boolean(data.has_preferences));
    if (data?.user?.demo_account) setDemoAccountFromUser(data.user);
    if (data?.has_training_access) setHasTrainingAccess(true);
    return data.user;
  };

  const onEmailSubmit = async (event) => {
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
    storePendingInviteCode(normalized);
    try {
      const authCall = authMode === "login"
        ? supabase.auth.signInWithPassword({ email: email.trim(), password })
        : supabase.auth.signUp({ email: email.trim(), password });
      const { data, error } = await authCall;
      if (error) throw error;
      const sessionUser = await establishSession(data?.session);
      if (!sessionUser) return;
      const redeemData = await redeemCreatorInvite(api, normalized);
      await finishRedeemAndNavigate(sessionUser, redeemData);
    } catch (err) {
      setAuthError(err?.response?.data?.detail || err?.message || "Échec de l'authentification. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleClick = () => {
    storePendingInviteCode(normalized);
    startGoogleLogin(`/invite/${normalized}`, email.trim() ? { login_hint: email.trim() } : undefined);
  };

  if (checking || redeeming || (user && !invalid)) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Activation de votre accès…</p>
        </div>
      </div>
    );
  }

  const isValid = !invalid && inviteMeta?.valid !== false;
  const influencerName = inviteMeta?.influencer_name;

  return (
    <div className="min-h-dvh bg-white text-zinc-900" data-testid="welcome-creator-page">
      <header className="border-b border-zinc-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
            <Logo size={28} />
            <span>{BRAND.NAME}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 sm:py-14">
        {!isValid ? (
          <div className="mx-auto max-w-md text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight">Lien d&apos;invitation invalide</h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              Ce lien est manquant ou expiré. Contactez l&apos;équipe Hirly pour obtenir une nouvelle invitation.
            </p>
            <Link to="/" className="mt-6 inline-block text-sm font-medium text-zinc-900 underline-offset-4 hover:underline">
              Retour à Hirly
            </Link>
          </div>
        ) : (
          <div className="grid items-start gap-10 lg:grid-cols-[1fr_400px] lg:gap-16">
            <section className="max-w-lg">
              <p className="text-sm font-medium text-zinc-500">Invitation créateur</p>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {influencerName ? `Bonjour ${influencerName}` : "Bienvenue"}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-zinc-600">
                {demoInvite
                  ? `Créez votre compte pour accéder à l'environnement démo ${BRAND.NAME} et enregistrer vos vidéos.`
                  : `Créez votre compte pour rejoindre le programme de formation créateur ${BRAND.NAME}.`}
              </p>

              <ul className="mt-8 space-y-3 text-sm text-zinc-600">
                {trainingInvite ? (
                  <li className="flex gap-2">
                    <span className="text-zinc-400">—</span>
                    <span>Accès complet au cours Job Search Mastery</span>
                  </li>
                ) : null}
                {demoInvite ? (
                  <li className="flex gap-2">
                    <span className="text-zinc-400">—</span>
                    <span>Compte démo pour vos enregistrements d&apos;écran</span>
                  </li>
                ) : null}
              </ul>

              {inviteMeta?.invite_type !== "demo" ? (
                <p className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs leading-relaxed text-zinc-600">
                  <span className="font-medium text-zinc-800">Accès confidentiel.</span>
                  {" "}
                  Ne partagez pas votre accès ni le contenu de la formation. Tout partage détecté entraîne une exclusion immédiate du programme.
                </p>
              ) : null}
            </section>

            <section className="w-full max-w-md justify-self-center lg:justify-self-end">
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <h2 className="font-display text-lg font-semibold">
                  {authMode === "login" ? "Connexion" : "Créer un compte"}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {authMode === "login"
                    ? "Connectez-vous pour activer votre invitation."
                    : "Inscrivez-vous pour activer votre invitation."}
                </p>

                <div className="mt-6">
                  <GoogleSignInButton
                    onClick={onGoogleClick}
                    disabled={submitting}
                    label="Continuer avec Google"
                    testId="invite-google-btn"
                  />
                </div>

                <div className="my-6 flex items-center gap-3">
                  <div className="h-px flex-1 bg-zinc-200" />
                  <span className="text-xs text-zinc-400">ou</span>
                  <div className="h-px flex-1 bg-zinc-200" />
                </div>

                <form className="space-y-4" onSubmit={onEmailSubmit}>
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
                      data-testid="invite-email-input"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-zinc-700">Mot de passe</span>
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11"
                      autoComplete={authMode === "login" ? "current-password" : "new-password"}
                      required
                      minLength={6}
                      data-testid="invite-password-input"
                    />
                  </label>

                  {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
                  {authNotice ? <p className="text-sm text-amber-700">{authNotice}</p> : null}

                  <button
                    type="submit"
                    disabled={submitting || !email.trim()}
                    data-testid="invite-submit-btn"
                    className="h-11 w-full rounded-md bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submitting ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Chargement…
                      </span>
                    ) : (
                      authMode === "login" ? "Se connecter" : "Créer mon compte"
                    )}
                  </button>
                </form>

                <p className="mt-5 text-center text-sm text-zinc-500">
                  {authMode === "login" ? (
                    <>
                      Pas encore de compte ?
                      {" "}
                      <button
                        type="button"
                        className="font-medium text-zinc-900 hover:underline"
                        onClick={() => { setAuthMode("signup"); setAuthError(""); }}
                      >
                        S&apos;inscrire
                      </button>
                    </>
                  ) : (
                    <>
                      Déjà un compte ?
                      {" "}
                      <button
                        type="button"
                        className="font-medium text-zinc-900 hover:underline"
                        onClick={() => { setAuthMode("login"); setAuthError(""); }}
                      >
                        Se connecter
                      </button>
                    </>
                  )}
                </p>
              </div>

              <button
                type="button"
                className="mx-auto mt-4 block text-xs text-zinc-400 transition-colors hover:text-zinc-600"
                onClick={() => clearPendingInviteCode()}
              >
                Effacer l&apos;invitation enregistrée
              </button>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
