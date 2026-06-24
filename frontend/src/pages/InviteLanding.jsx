import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, Mail, Sparkles, ArrowRight, GraduationCap, MonitorPlay } from "lucide-react";
import { toast } from "sonner";
import Logo from "../components/Logo";
import { BRAND } from "../lib/brand";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import {
  clearPendingInviteCode,
  redeemCreatorInvite,
  storePendingInviteCode,
} from "../lib/creatorInvite";
import { startGoogleLogin } from "../lib/auth";
import { useAppLocale } from "../context/AppLocaleContext";

export default function InviteLanding() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, setUser } = useAuth();
  const { lang } = useAppLocale();
  const [checking, setChecking] = useState(true);
  const [inviteMeta, setInviteMeta] = useState(null);
  const [redeeming, setRedeeming] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const autoRedeemStarted = useRef(false);

  const normalized = String(code || "").trim();
  const invalid = !/^\d{6}$/.test(normalized);

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

  // Auto-redeem when user is already logged in
  useEffect(() => {
    if (authLoading || checking || !user || redeeming || autoRedeemStarted.current) return;
    if (invalid) return;
    autoRedeemStarted.current = true;
    (async () => {
      setRedeeming(true);
      try {
        const data = await redeemCreatorInvite(api, normalized);
        if (data?.demo_account && user) {
          setDemoAccountFromUser({ ...user, demo_account: true });
          setUser({ ...user, demo_account: true });
        }
        navigate("/training", { replace: true });
      } catch (err) {
        autoRedeemStarted.current = false;
        if (err?.response?.status !== 409) {
          toast.error(err?.response?.data?.detail || (lang === "fr" ? "Impossible d'activer l'invitation" : "Could not activate invitation"));
        } else {
          // Already redeemed — just go to training
          navigate("/training", { replace: true });
        }
      } finally {
        setRedeeming(false);
      }
    })();
  }, [authLoading, checking, user, normalized, invalid, navigate, redeeming, setUser, lang]);

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error(lang === "fr" ? "Adresse e-mail invalide" : "Invalid email address");
      return;
    }
    setSubmitting(true);
    storePendingInviteCode(normalized);
    // Redirect back to this invite page after Google login so auto-redeem kicks in
    startGoogleLogin(`/invite/${normalized}`, { login_hint: email.trim() });
  };

  // Loading states
  if (checking || redeeming || (user && !invalid)) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3 text-zinc-600">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">
            {lang === "fr" ? "Activation de votre accès créateur…" : "Setting up your creator access…"}
          </p>
        </div>
      </div>
    );
  }

  const isValid = !invalid && inviteMeta?.valid !== false;
  const influencerName = inviteMeta?.influencer_name;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-violet-50 via-white to-white">
      {/* Header */}
      <header className="px-6 py-5 flex items-center justify-between max-w-lg mx-auto">
        <Link to="/" className="flex items-center gap-2 font-display font-black tracking-tight text-lg">
          <Logo size={26} />
          <span>{BRAND.NAME}</span>
        </Link>
      </header>

      <main className="px-4 pb-16 max-w-lg mx-auto">
        {isValid ? (
          <>
            {/* Hero */}
            <div className="mt-6 mb-8 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-100 text-violet-700 text-xs font-semibold mb-5">
                <Sparkles className="h-3.5 w-3.5" />
                {lang === "fr" ? "Invitation créateur" : "Creator invitation"}
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tight text-zinc-900">
                {influencerName
                  ? (lang === "fr" ? `Bienvenue, ${influencerName} !` : `Welcome, ${influencerName}!`)
                  : (lang === "fr" ? "Accès créateur activé" : "Creator access")}
              </h1>
              <p className="mt-3 text-base text-zinc-500 leading-relaxed max-w-sm mx-auto">
                {lang === "fr"
                  ? `Créez votre compte ${BRAND.NAME} pour accéder à la formation et au mode démo.`
                  : `Create your ${BRAND.NAME} account to access the training and demo mode.`}
              </p>
            </div>

            {/* Perks */}
            <div className="grid grid-cols-2 gap-3 mb-8">
              <div className="rounded-2xl border border-violet-100 bg-white px-4 py-4 shadow-sm">
                <GraduationCap className="h-6 w-6 text-violet-600 mb-2" />
                <p className="text-sm font-bold text-zinc-900">
                  {lang === "fr" ? "Formation complète" : "Full training"}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5 leading-snug">
                  {lang === "fr" ? "Accès au cours Job Search Mastery" : "Job Search Mastery course"}
                </p>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-white px-4 py-4 shadow-sm">
                <MonitorPlay className="h-6 w-6 text-violet-600 mb-2" />
                <p className="text-sm font-bold text-zinc-900">
                  {lang === "fr" ? "Compte démo" : "Demo account"}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5 leading-snug">
                  {lang === "fr" ? "Pour vos enregistrements d'écran" : "For your screen recordings"}
                </p>
              </div>
            </div>

            {/* Email form */}
            <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-zinc-700 mb-4">
                {lang === "fr" ? "Entrez votre adresse e-mail pour commencer" : "Enter your email to get started"}
              </p>
              <form onSubmit={handleEmailSubmit} className="space-y-3">
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={lang === "fr" ? "votre@email.com" : "your@email.com"}
                    autoComplete="email"
                    required
                    className="w-full h-12 rounded-2xl border border-zinc-200 bg-zinc-50 pl-11 pr-4 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
                    data-testid="invite-email-input"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || !email.trim()}
                  data-testid="invite-submit-btn"
                  className="w-full h-12 rounded-full gradient-linkedin text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shadow-[0_8px_32px_-8px_rgba(124,58,237,0.4)]"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {lang === "fr" ? "Continuer avec Google" : "Continue with Google"}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>
              <p className="mt-4 text-center text-xs text-zinc-400">
                {lang === "fr"
                  ? "Vous serez redirigé vers Google pour vous connecter en toute sécurité."
                  : "You'll be redirected to Google for secure sign-in."}
              </p>
            </div>
          </>
        ) : (
          /* Invalid or expired invite */
          <div className="mt-16 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 mb-5">
              <Sparkles className="h-6 w-6 text-zinc-400" />
            </div>
            <h1 className="font-display text-2xl font-bold text-zinc-900">
              {lang === "fr" ? "Lien invalide" : "Invalid invitation link"}
            </h1>
            <p className="mt-3 text-sm text-zinc-500 max-w-xs mx-auto leading-relaxed">
              {lang === "fr"
                ? "Ce lien est manquant ou expiré. Contactez l'équipe Hirly pour un nouveau lien."
                : "This link is missing or expired. Ask the Hirly team for a fresh invitation."}
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-linkedin hover:underline"
            >
              {lang === "fr" ? "Retour à l'accueil" : "Back to Hirly"}
            </Link>
          </div>
        )}

        <button
          type="button"
          className="mx-auto mt-8 block text-xs text-zinc-300 hover:text-zinc-500 transition-colors"
          onClick={() => clearPendingInviteCode()}
        >
          {lang === "fr" ? "Effacer l'invitation enregistrée" : "Clear saved invitation"}
        </button>
      </main>
    </div>
  );
}
