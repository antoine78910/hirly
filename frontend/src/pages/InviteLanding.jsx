import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  GraduationCap,
  Loader2,
  Lock,
  Mail,
  MonitorPlay,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import Logo from "../components/Logo";
import { Button } from "../components/ui/button";
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
import { startGoogleLogin } from "../lib/auth";
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
        setInviteMeta({ valid: false, reason: "not_found" });
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
      <div className="min-h-dvh flex items-center justify-center bg-zinc-950/40">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-8 py-6 shadow-xl">
          <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
          <p className="text-sm text-zinc-600">Activation de votre accès créateur…</p>
        </div>
      </div>
    );
  }

  const isValid = !invalid && inviteMeta?.valid !== false;
  const influencerName = inviteMeta?.influencer_name;

  return (
    <div className="min-h-dvh bg-zinc-950/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-4 flex justify-center">
          <Link to="/" className="flex items-center gap-2 font-display font-black tracking-tight text-lg text-white">
            <Logo size={26} />
            <span>{BRAND.NAME}</span>
          </Link>
        </div>

        {isValid ? (
          <div
            className="rounded-3xl border border-zinc-200 bg-white shadow-2xl overflow-hidden"
            data-testid="welcome-creator-modal"
          >
            <div className="bg-gradient-to-br from-violet-600 to-indigo-600 px-6 py-8 text-center text-white">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold mb-4">
                <Sparkles className="h-3.5 w-3.5" />
                Bienvenue, Créateur
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-black tracking-tight">
                {influencerName ? `Bonjour ${influencerName} !` : "Vous êtes invité(e)"}
              </h1>
              <p className="mt-2 text-sm text-violet-100 leading-relaxed">
                {demoInvite
                  ? `Créez votre compte ${BRAND.NAME} pour accéder à l'environnement démo et enregistrer vos vidéos.`
                  : `Créez votre compte ${BRAND.NAME} pour accéder au programme de formation créateur.`}
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              {inviteMeta?.invite_type !== "demo" ? (
                <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
                  <p className="text-xs leading-relaxed text-amber-900">
                    <span className="font-semibold">Accès confidentiel.</span>
                    {" "}
                    Il est strictement interdit de partager votre accès ou le contenu de la formation. Nous détectons
                    les partages — en cas d&apos;abus, vous serez immédiatement exclu(e) du programme.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3">
                {trainingInvite ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50/50 px-4 py-3">
                    <GraduationCap className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-zinc-900">Formation créateur</p>
                      <p className="text-xs text-zinc-500 mt-0.5">Accès complet au cours Job Search Mastery</p>
                    </div>
                  </div>
                ) : null}
                {demoInvite ? (
                  <div className="flex items-start gap-3 rounded-2xl border border-violet-100 bg-violet-50/50 px-4 py-3">
                    <MonitorPlay className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-zinc-900">Compte démo</p>
                      <p className="text-xs text-zinc-500 mt-0.5">Environnement sandbox pour vos enregistrements d&apos;écran</p>
                    </div>
                  </div>
                ) : null}
              </div>

              <Button
                type="button"
                onClick={onGoogleClick}
                className="h-12 w-full rounded-full border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
                disabled={submitting}
                data-testid="invite-google-btn"
              >
                <span className="mr-2 grid h-5 w-5 place-items-center rounded-full border border-zinc-200 text-xs font-black text-linkedin">G</span>
                Continuer avec Google
              </Button>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200" />
                <span className="text-xs font-medium text-zinc-400">ou</span>
                <div className="h-px flex-1 bg-zinc-200" />
              </div>

              <form className="space-y-3" onSubmit={onEmailSubmit}>
                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-zinc-700">E-mail</span>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="vous@email.com"
                      className="h-12 rounded-2xl pl-10"
                      autoComplete="email"
                      required
                      data-testid="invite-email-input"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-zinc-700">Mot de passe</span>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 rounded-2xl pl-10"
                      autoComplete={authMode === "login" ? "current-password" : "new-password"}
                      required
                      minLength={6}
                      data-testid="invite-password-input"
                    />
                  </div>
                </label>

                {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
                {authNotice ? <p className="text-sm text-amber-700">{authNotice}</p> : null}

                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  data-testid="invite-submit-btn"
                  className="w-full h-12 rounded-full gradient-linkedin text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {authMode === "login" ? "Se connecter et activer" : "Créer mon compte et activer"}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-xs text-zinc-500">
                {authMode === "login" ? (
                  <>
                    Pas encore de compte ?
                    {" "}
                    <button type="button" className="font-semibold text-linkedin hover:underline" onClick={() => { setAuthMode("signup"); setAuthError(""); }}>
                      S&apos;inscrire
                    </button>
                  </>
                ) : (
                  <>
                    Déjà un compte ?
                    {" "}
                    <button type="button" className="font-semibold text-linkedin hover:underline" onClick={() => { setAuthMode("login"); setAuthError(""); }}>
                      Se connecter
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-2xl">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 mb-5">
              <Sparkles className="h-6 w-6 text-zinc-400" />
            </div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">Lien d&apos;invitation invalide</h1>
            <p className="mt-3 text-sm text-zinc-500 leading-relaxed">
              Ce lien est manquant ou expiré. Contactez l&apos;équipe Hirly pour obtenir une nouvelle invitation.
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-linkedin hover:underline"
            >
              Retour à Hirly
            </Link>
          </div>
        )}

        <button
          type="button"
          className="mx-auto mt-4 block text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
          onClick={() => clearPendingInviteCode()}
        >
          Effacer l&apos;invitation enregistrée
        </button>
      </div>
    </div>
  );
}
