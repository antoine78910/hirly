import { GraduationCap } from "lucide-react";
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTrainingLocale } from "../../context/TrainingLocaleContext";
import { api, setSessionToken } from "../../lib/api";
import { startGoogleLogin, supabaseSessionPayload } from "../../lib/auth";
import { setDemoAccountFromUser } from "../../lib/demoAccount";
import { supabase, supabaseConfigured } from "../../lib/supabase";
import { trainingPath } from "../../lib/trainingRoutes";
import { TrainingAuthForm, TrainingAuthPopup } from "./TrainingAuthPopup";
import TrainingLanguageToggle from "./TrainingLanguageToggle";

export default function TrainingLoginPage() {
  const { lang, t } = useTrainingLocale();
  const { setUser, setHasProfile, setHasPreferences, setHasTrainingAccess, setIsTrainingCreator } =
    useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const returnPath = trainingPath(lang);

  const onGoogleClick = () => {
    startGoogleLogin(returnPath, email.trim() ? { login_hint: email.trim() } : undefined);
  };

  const establishSession = async (session) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      setAuthNotice(t("auth.confirmEmail"));
      return null;
    }
    const { data } = await api.post("/auth/supabase-session", supabaseSessionPayload(session));
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
      setAuthError(t("auth.emailNotConfigured"));
      return;
    }
    if (!email.trim() || password.length < 6) {
      setAuthError(t("auth.credentialsRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      const sessionUser = await establishSession(data?.session);
      if (!sessionUser) return;
      if (!sessionUser.training_access && !data.has_training_access) {
        setAuthError(t("auth.accessRequired"));
      }
    } catch (err) {
      setAuthError(err?.response?.data?.detail || err?.message || t("auth.invalidCredentials"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TrainingAuthPopup
      testId="training-login-page"
      aside={
        <>
          <TrainingLanguageToggle className="mb-8" />
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <GraduationCap className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">
            {t("auth.title")}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-violet-100/95 sm:text-base">
            {t("auth.description")}
          </p>
          <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm leading-relaxed text-violet-50">
            <span className="font-semibold text-white">{t("auth.noAccount")}</span>{" "}
            {t("auth.noAccountHelp")}
          </div>
        </>
      }
    >
      <TrainingAuthForm
        title={t("auth.signIn")}
        subtitle={t("auth.description")}
        authMode="login"
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        authError={authError}
        authNotice={authNotice}
        submitting={submitting}
        onSubmit={onSubmit}
        onGoogleClick={onGoogleClick}
        googleTestId="training-login-google-btn"
        emailTestId="training-login-email"
        passwordTestId="training-login-password"
        submitTestId="training-login-submit"
        labels={{
          signIn: t("auth.signIn"),
          signUp: t("auth.signUp"),
          google: t("auth.google"),
          or: t("auth.or"),
          email: t("auth.email"),
          emailPlaceholder: t("auth.emailPlaceholder"),
          password: t("auth.password"),
          loading: t("auth.loading"),
          noAccount: t("auth.noAccount"),
          alreadyHaveAccount: t("auth.alreadyHaveAccount"),
        }}
      />
    </TrainingAuthPopup>
  );
}
