import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { api, setSessionToken } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { startGoogleLogin } from "../../lib/auth";
import { supabase, supabaseConfigured } from "../../lib/supabase";
import { setDemoAccountFromUser } from "../../lib/demoAccount";
import { TrainingAuthForm, TrainingAuthPopup } from "./TrainingAuthPopup";

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
    <TrainingAuthPopup
      testId="training-login-page"
      aside={(
        <>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <GraduationCap className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-black tracking-tight sm:text-3xl">
            Accéder à la formation
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-violet-100/95 sm:text-base">
            Connecte-toi avec le compte que tu as créé lors de ton inscription.
            Tu as besoin d&apos;un lien d&apos;invitation pour rejoindre la formation.
          </p>
          <div className="mt-6 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm leading-relaxed text-violet-50">
            <span className="font-semibold text-white">Pas encore de compte ?</span>
            {" "}
            Ouvre le lien d&apos;invitation que tu as reçu pour créer ton compte et activer l&apos;accès.
          </div>
        </>
      )}
    >
      <TrainingAuthForm
        title="Connexion"
        subtitle="Connecte-toi pour accéder à ta formation."
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
      />
    </TrainingAuthPopup>
  );
}
