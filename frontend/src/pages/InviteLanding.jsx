import { GraduationCap, Loader2, MonitorPlay, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import Logo from "../components/Logo";
import { TrainingAuthForm, TrainingAuthPopup } from "../components/training/TrainingAuthPopup";
import { useAppLocale } from "../context/AppLocaleContext";
import { useAuth } from "../context/AuthContext";
import { api, setSessionToken } from "../lib/api";
import { startGoogleLogin } from "../lib/auth";
import { BRAND } from "../lib/brand";
import {
  applyRedeemToAuth,
  clearPendingInviteCode,
  goToInviteDestination,
  inviteLandingPath,
  redeemCreatorInvite,
  storePendingInviteCode,
} from "../lib/creatorInvite";
import { setDemoAccountFromUser } from "../lib/demoAccount";
import { getLocalDevInviteMeta } from "../lib/inviteDevMocks";
import {
  INVITE_LANGUAGE_OPTIONS,
  inviteT,
  isInviteLocale,
  normalizeInviteLocale,
} from "../lib/inviteLocalization";

function isTrainingInvite(meta) {
  const type = meta?.invite_type;
  return type === "training" || type === "creator" || (type !== "demo" && type !== "creator");
}

function isDemoInvite(meta) {
  const type = meta?.invite_type;
  return type === "demo" || type === "creator";
}

function InviteLanguageSelect({ locale, onChange, label, className = "" }) {
  return (
    <label className={`inline-flex items-center gap-2 text-xs font-semibold ${className}`}>
      <span className="sr-only">{label}</span>
      <select
        value={locale}
        onChange={(event) => onChange(event.target.value)}
        data-testid="invite-language-selector"
        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm outline-none transition-colors hover:border-violet-300 focus:border-violet-500"
      >
        {INVITE_LANGUAGE_OPTIONS.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function InviteLanding() {
  const { code } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { lang, setLang } = useAppLocale();
  const {
    user,
    loading: authLoading,
    setUser,
    setHasProfile,
    setHasPreferences,
    setHasTrainingAccess,
    checkAuth,
  } = useAuth();
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
  const [redeemFailed, setRedeemFailed] = useState(false);
  const [autoRedeemSettled, setAutoRedeemSettled] = useState(false);

  const normalized = String(code || "").trim();
  const requestedLocale = new URLSearchParams(location.search).get("lang");
  const inviteLocale = isInviteLocale(requestedLocale)
    ? normalizeInviteLocale(requestedLocale)
    : lang;
  const t = useCallback((key, vars) => inviteT(inviteLocale, key, vars), [inviteLocale]);
  const invalid = !/^\d{6}$/.test(normalized);
  const trainingInvite = isTrainingInvite(inviteMeta);
  const demoInvite = isDemoInvite(inviteMeta);
  const isValid = !invalid && inviteMeta?.valid === true;

  useEffect(() => {
    if (!isInviteLocale(requestedLocale) || inviteLocale === lang) return;
    setLang(inviteLocale);
  }, [inviteLocale, lang, requestedLocale, setLang]);

  const updateInviteLocale = useCallback(
    (nextLocale) => {
      const next = normalizeInviteLocale(nextLocale);
      const params = new URLSearchParams(location.search);
      params.set("lang", next);
      setLang(next);
      navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true });
    },
    [location.pathname, location.search, navigate, setLang],
  );

  useEffect(() => {
    setAutoRedeemSettled(false);
    setRedeemFailed(false);
    autoRedeemStarted.current = false;
  }, []);

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
        const local =
          process.env.NODE_ENV === "development" ? getLocalDevInviteMeta(normalized) : null;
        setInviteMeta(local || { valid: false, reason: "not_found" });
      } finally {
        setChecking(false);
      }
    })();
  }, [normalized, invalid]);

  const finishRedeemAndNavigate = useCallback(
    async (sessionUser, redeemData) => {
      applyRedeemToAuth(redeemData, sessionUser, {
        setUser,
        setHasTrainingAccess,
        setDemoAccountFromUser,
        setHasProfile,
        setHasPreferences,
      });
      try {
        await checkAuth?.();
      } catch {
        /* local auth state already updated */
      }
      goToInviteDestination(redeemData, inviteMeta, inviteLocale);
    },
    [
      checkAuth,
      inviteLocale,
      inviteMeta,
      setHasPreferences,
      setHasProfile,
      setHasTrainingAccess,
      setUser,
    ],
  );

  // Demo invite + existing demo account → go straight to the app (skip onboarding resume).
  useEffect(() => {
    if (authLoading || checking || invalid || !isValid || !demoInvite) return;
    if (!user?.demo_account) return;
    autoRedeemStarted.current = true;
    goToInviteDestination(null, inviteMeta, inviteLocale);
    const timer = window.setTimeout(() => setAutoRedeemSettled(true), 2000);
    return () => window.clearTimeout(timer);
  }, [authLoading, checking, invalid, isValid, demoInvite, user, inviteLocale, inviteMeta]);

  useEffect(() => {
    if (authLoading || checking || !user || redeeming || autoRedeemStarted.current || redeemFailed)
      return;
    if (!isValid) return;
    autoRedeemStarted.current = true;
    (async () => {
      setRedeeming(true);
      try {
        const data = await redeemCreatorInvite(api, normalized);
        await finishRedeemAndNavigate(user, data);
      } catch (err) {
        setRedeemFailed(true);
        if (err?.response?.status === 409) {
          if (user?.demo_account) {
            goToInviteDestination(null, inviteMeta, inviteLocale);
          } else {
            toast.error(t("invitationUsed"));
          }
        } else {
          toast.error(err?.response?.data?.detail || t("activationFailed"));
        }
      } finally {
        setRedeeming(false);
        setAutoRedeemSettled(true);
      }
    })();
  }, [
    authLoading,
    checking,
    user,
    normalized,
    isValid,
    redeeming,
    redeemFailed,
    inviteMeta,
    finishRedeemAndNavigate,
    inviteLocale,
    t,
  ]);

  const onEmailSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");
    setAuthNotice("");

    if (!email.trim() || password.length < 6) {
      setAuthError(t("emailPasswordInvalid"));
      return;
    }

    setSubmitting(true);
    storePendingInviteCode(normalized);
    try {
      const { data } = await api.post("/auth/invite-email", {
        email: email.trim(),
        password,
        code: normalized,
        mode: authMode,
      });
      if (data?.session_token) setSessionToken(data.session_token);
      setUser(data.user);
      setHasProfile(Boolean(data.has_profile));
      setHasPreferences(Boolean(data.has_preferences));
      if (data?.user) setDemoAccountFromUser(data.user, Boolean(data.is_admin));
      if (data?.has_training_access) setHasTrainingAccess(true);
      if (data?.user?.demo_account) {
        setHasProfile(true);
        setHasPreferences(true);
      }
      const redeemData = await redeemCreatorInvite(api, normalized);
      await finishRedeemAndNavigate(data.user, redeemData);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const message = typeof detail === "string" ? detail : err?.message;
      if (
        authMode === "signup" &&
        /already been registered|already registered/i.test(message || "")
      ) {
        setAuthNotice(t("accountExists"));
        setAuthMode("login");
      } else {
        setAuthError(message || t("authenticationFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogleClick = () => {
    storePendingInviteCode(normalized);
    startGoogleLogin(
      inviteLandingPath(normalized, inviteLocale),
      email.trim() ? { login_hint: email.trim() } : undefined,
    );
  };

  const onToggleMode = (nextMode) => {
    setAuthMode(nextMode);
    setAuthError("");
    setAuthNotice("");
  };

  if (checking || redeeming || (user && isValid && !redeemFailed && !autoRedeemSettled)) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <Loader2 className="h-6 w-6 animate-spin text-linkedin" />
          <p className="text-sm">{t("activating")}</p>
        </div>
      </div>
    );
  }

  const influencerName = inviteMeta?.influencer_name;

  if (!isValid) {
    return (
      <div className="fixed inset-0 z-50 gradient-linkedin-soft showcase-landing-ambient">
        <InviteLanguageSelect
          locale={inviteLocale}
          onChange={updateInviteLocale}
          label={t("language")}
          className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6"
        />
        <Link
          to="/"
          className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full bg-white/80 px-3 py-2 font-display text-sm font-semibold tracking-tight shadow-sm backdrop-blur-sm sm:left-6 sm:top-6"
        >
          <Logo size={22} />
          <span>{BRAND.NAME}</span>
        </Link>
        <div className="flex min-h-dvh items-center justify-center px-4 py-16">
          <div className="w-full max-w-md rounded-3xl border border-violet-200/70 bg-white p-8 text-center shadow-[0_32px_80px_-28px_rgba(124,58,237,0.38)]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-violet-100">
              <Sparkles className="h-6 w-6 text-violet-500" />
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight">{t("invalidTitle")}</h1>
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">{t("invalidBody")}</p>
            <Link
              to="/"
              className="mt-6 inline-block text-sm font-semibold text-linkedin hover:text-linkedin-dark"
            >
              {t("backToHirly")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TrainingAuthPopup
      testId="welcome-creator-page"
      aside={
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5" />
              {t("badge")}
            </div>
            <InviteLanguageSelect
              locale={inviteLocale}
              onChange={updateInviteLocale}
              label={t("language")}
            />
          </div>
          <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">
            {influencerName ? t("greeting", { name: influencerName }) : t("welcome")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-violet-100/95 sm:text-base">
            {demoInvite
              ? t("demoDescription", { brand: BRAND.NAME })
              : t("trainingDescription", { brand: BRAND.NAME })}
          </p>

          <ul className="mt-6 space-y-3 text-sm text-violet-50">
            {trainingInvite ? (
              <li className="flex items-start gap-3">
                <GraduationCap className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{t("trainingAccess")}</span>
              </li>
            ) : null}
            {demoInvite ? (
              <li className="flex items-start gap-3">
                <MonitorPlay className="mt-0.5 h-5 w-5 shrink-0" />
                <span>{t("demoAccess")}</span>
              </li>
            ) : null}
          </ul>

          {inviteMeta?.invite_type !== "demo" ? (
            <p className="mt-6 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-xs leading-relaxed text-violet-50">
              <span className="font-semibold text-white">{t("confidentialLead")}</span>{" "}
              {t("confidentialBody")}
            </p>
          ) : null}
        </>
      }
    >
      <TrainingAuthForm
        title={authMode === "login" ? t("signIn") : t("createAccount")}
        subtitle={authMode === "login" ? t("signInSubtitle") : t("signUpSubtitle")}
        authMode={authMode}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        authError={authError}
        authNotice={authNotice}
        submitting={submitting}
        onSubmit={onEmailSubmit}
        onGoogleClick={onGoogleClick}
        onToggleMode={onToggleMode}
        showModeToggle
        googleTestId="invite-google-btn"
        emailTestId="invite-email-input"
        passwordTestId="invite-password-input"
        submitTestId="invite-submit-btn"
        labels={{
          signIn: t("signIn"),
          signUp: t("createAccount"),
          google: t("continueWithGoogle"),
          or: t("or"),
          email: t("email"),
          emailPlaceholder: t("emailPlaceholder"),
          password: t("password"),
          loading: t("loading"),
          noAccount: t("noAccount"),
          alreadyHaveAccount: t("alreadyHaveAccount"),
        }}
      />

      <button
        type="button"
        className="mx-auto mt-4 block text-xs text-zinc-400 transition-colors hover:text-zinc-600"
        onClick={() => clearPendingInviteCode()}
      >
        {t("clearSavedInvite")}
      </button>
    </TrainingAuthPopup>
  );
}
