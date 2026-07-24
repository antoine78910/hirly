import { APP_LANGUAGES, isAppLanguage } from "./appUi";

export const INVITE_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "it", label: "Italiano" },
];

const INVITE_UI = {
  en: {
    language: "Language",
    activating: "Activating your access…",
    invalidTitle: "Invalid invitation link",
    invalidBody: "This link is not recognized. Contact the Hirly team to get a new invitation.",
    backToHirly: "Back to Hirly",
    badge: "Creator invitation",
    greeting: "Hello {name}",
    welcome: "Welcome",
    demoDescription:
      "Create your account to access the Hirly demo environment and record your videos.",
    trainingDescription: "Create your account to join the Hirly creator training program.",
    trainingAccess: "Full access to the Job Search Mastery course",
    demoAccess: "Demo account for your screen recordings",
    confidentialTitle: "Confidential access.",
    confidentialBody:
      "Do not share your access or the training content. Any detected sharing results in immediate removal from the program.",
    signInTitle: "Sign in",
    signUpTitle: "Create an account",
    signInSubtitle: "Sign in to activate your invitation.",
    signUpSubtitle: "Create an account to activate your invitation.",
    credentialsRequired: "Enter an email address and a password with at least 6 characters.",
    accountExists: "An account already exists for this email. Switch to sign in.",
    authenticationFailed: "Authentication failed. Please try again.",
    inviteAlreadyUsed: "This invitation was already used by another account.",
    activationFailed: "Could not activate this invitation.",
    clearSavedInvite: "Clear saved invitation",
    auth: {
      signIn: "Sign in",
      signUp: "Create my account",
      google: "Continue with Google",
      or: "or",
      email: "Email",
      emailPlaceholder: "you@email.com",
      password: "Password",
      loading: "Loading…",
      noAccount: "No account yet?",
      alreadyHaveAccount: "Already have an account?",
    },
  },
  fr: {
    language: "Langue",
    activating: "Activation de votre accès…",
    invalidTitle: "Lien d’invitation invalide",
    invalidBody: "Ce lien n’est pas reconnu. Contactez l’équipe Hirly pour recevoir une nouvelle invitation.",
    backToHirly: "Retour à Hirly",
    badge: "Invitation créateur",
    greeting: "Bonjour {name}",
    welcome: "Bienvenue",
    demoDescription:
      "Créez votre compte pour accéder à l’environnement démo Hirly et enregistrer vos vidéos.",
    trainingDescription: "Créez votre compte pour rejoindre le programme de formation créateur Hirly.",
    trainingAccess: "Accès complet au cours Job Search Mastery",
    demoAccess: "Compte démo pour vos enregistrements d’écran",
    confidentialTitle: "Accès confidentiel.",
    confidentialBody:
      "Ne partagez pas votre accès ni le contenu de la formation. Tout partage détecté entraîne une exclusion immédiate du programme.",
    signInTitle: "Connexion",
    signUpTitle: "Créer un compte",
    signInSubtitle: "Connectez-vous pour activer votre invitation.",
    signUpSubtitle: "Inscrivez-vous pour activer votre invitation.",
    credentialsRequired: "Saisissez un e-mail et un mot de passe d’au moins 6 caractères.",
    accountExists: "Un compte existe déjà avec cet e-mail. Passez en mode connexion.",
    authenticationFailed: "Échec de l’authentification. Réessayez.",
    inviteAlreadyUsed: "Cette invitation a déjà été utilisée par un autre compte.",
    activationFailed: "Impossible d’activer cette invitation.",
    clearSavedInvite: "Effacer l’invitation enregistrée",
    auth: {
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
    },
  },
  de: {
    language: "Sprache",
    activating: "Dein Zugang wird aktiviert…",
    invalidTitle: "Ungültiger Einladungslink",
    invalidBody: "Dieser Link wird nicht erkannt. Kontaktiere das Hirly-Team für eine neue Einladung.",
    backToHirly: "Zurück zu Hirly",
    badge: "Creator-Einladung",
    greeting: "Hallo {name}",
    welcome: "Willkommen",
    demoDescription:
      "Erstelle dein Konto, um auf die Hirly-Demoumgebung zuzugreifen und deine Videos aufzunehmen.",
    trainingDescription: "Erstelle dein Konto, um am Hirly-Creator-Trainingsprogramm teilzunehmen.",
    trainingAccess: "Vollzugriff auf den Kurs Job Search Mastery",
    demoAccess: "Demokonto für deine Bildschirmaufnahmen",
    confidentialTitle: "Vertraulicher Zugang.",
    confidentialBody:
      "Teile deinen Zugang oder die Trainingsinhalte nicht. Jede festgestellte Weitergabe führt zum sofortigen Ausschluss aus dem Programm.",
    signInTitle: "Anmelden",
    signUpTitle: "Konto erstellen",
    signInSubtitle: "Melde dich an, um deine Einladung zu aktivieren.",
    signUpSubtitle: "Erstelle ein Konto, um deine Einladung zu aktivieren.",
    credentialsRequired: "Gib eine E-Mail-Adresse und ein Passwort mit mindestens 6 Zeichen ein.",
    accountExists: "Für diese E-Mail gibt es bereits ein Konto. Wechsle zur Anmeldung.",
    authenticationFailed: "Anmeldung fehlgeschlagen. Bitte versuche es erneut.",
    inviteAlreadyUsed: "Diese Einladung wurde bereits von einem anderen Konto verwendet.",
    activationFailed: "Diese Einladung konnte nicht aktiviert werden.",
    clearSavedInvite: "Gespeicherte Einladung löschen",
    auth: {
      signIn: "Anmelden",
      signUp: "Mein Konto erstellen",
      google: "Mit Google fortfahren",
      or: "oder",
      email: "E-Mail",
      emailPlaceholder: "du@beispiel.de",
      password: "Passwort",
      loading: "Wird geladen…",
      noAccount: "Noch kein Konto?",
      alreadyHaveAccount: "Du hast bereits ein Konto?",
    },
  },
  es: {
    language: "Idioma",
    activating: "Activando tu acceso…",
    invalidTitle: "Enlace de invitación no válido",
    invalidBody: "Este enlace no se reconoce. Contacta con el equipo de Hirly para recibir una nueva invitación.",
    backToHirly: "Volver a Hirly",
    badge: "Invitación de creador",
    greeting: "Hola {name}",
    welcome: "Bienvenido/a",
    demoDescription:
      "Crea tu cuenta para acceder al entorno de demostración de Hirly y grabar tus vídeos.",
    trainingDescription: "Crea tu cuenta para unirte al programa de formación para creadores de Hirly.",
    trainingAccess: "Acceso completo al curso Job Search Mastery",
    demoAccess: "Cuenta de demostración para tus grabaciones de pantalla",
    confidentialTitle: "Acceso confidencial.",
    confidentialBody:
      "No compartas tu acceso ni el contenido de la formación. Cualquier uso compartido detectado implicará la expulsión inmediata del programa.",
    signInTitle: "Iniciar sesión",
    signUpTitle: "Crear una cuenta",
    signInSubtitle: "Inicia sesión para activar tu invitación.",
    signUpSubtitle: "Crea una cuenta para activar tu invitación.",
    credentialsRequired: "Introduce un correo electrónico y una contraseña de al menos 6 caracteres.",
    accountExists: "Ya existe una cuenta con este correo. Cambia a iniciar sesión.",
    authenticationFailed: "Error de autenticación. Inténtalo de nuevo.",
    inviteAlreadyUsed: "Esta invitación ya fue utilizada por otra cuenta.",
    activationFailed: "No se pudo activar esta invitación.",
    clearSavedInvite: "Borrar invitación guardada",
    auth: {
      signIn: "Iniciar sesión",
      signUp: "Crear mi cuenta",
      google: "Continuar con Google",
      or: "o",
      email: "Correo electrónico",
      emailPlaceholder: "tu@correo.com",
      password: "Contraseña",
      loading: "Cargando…",
      noAccount: "¿Aún no tienes cuenta?",
      alreadyHaveAccount: "¿Ya tienes una cuenta?",
    },
  },
  it: {
    language: "Lingua",
    activating: "Stiamo attivando il tuo accesso…",
    invalidTitle: "Link di invito non valido",
    invalidBody: "Questo link non è riconosciuto. Contatta il team Hirly per ricevere un nuovo invito.",
    backToHirly: "Torna a Hirly",
    badge: "Invito per creator",
    greeting: "Ciao {name}",
    welcome: "Benvenuto/a",
    demoDescription:
      "Crea il tuo account per accedere all’ambiente demo di Hirly e registrare i tuoi video.",
    trainingDescription: "Crea il tuo account per partecipare al programma di formazione per creator di Hirly.",
    trainingAccess: "Accesso completo al corso Job Search Mastery",
    demoAccess: "Account demo per le tue registrazioni dello schermo",
    confidentialTitle: "Accesso riservato.",
    confidentialBody:
      "Non condividere il tuo accesso né i contenuti della formazione. Qualsiasi condivisione rilevata comporterà l’esclusione immediata dal programma.",
    signInTitle: "Accedi",
    signUpTitle: "Crea un account",
    signInSubtitle: "Accedi per attivare il tuo invito.",
    signUpSubtitle: "Crea un account per attivare il tuo invito.",
    credentialsRequired: "Inserisci un indirizzo e-mail e una password di almeno 6 caratteri.",
    accountExists: "Esiste già un account con questa e-mail. Passa all’accesso.",
    authenticationFailed: "Autenticazione non riuscita. Riprova.",
    inviteAlreadyUsed: "Questo invito è già stato usato da un altro account.",
    activationFailed: "Non è stato possibile attivare questo invito.",
    clearSavedInvite: "Cancella invito salvato",
    auth: {
      signIn: "Accedi",
      signUp: "Crea il mio account",
      google: "Continua con Google",
      or: "oppure",
      email: "E-mail",
      emailPlaceholder: "tu@esempio.it",
      password: "Password",
      loading: "Caricamento…",
      noAccount: "Non hai ancora un account?",
      alreadyHaveAccount: "Hai già un account?",
    },
  },
};

export function isInviteLocale(locale) {
  return isAppLanguage(locale);
}

export function normalizeInviteLocale(locale, fallback = "fr") {
  const normalized = String(locale || "").trim().toLowerCase().split(/[-_]/, 1)[0];
  return isInviteLocale(normalized) ? normalized : fallback;
}

export function inviteT(locale, key, variables = {}) {
  const copy = INVITE_UI[normalizeInviteLocale(locale)];
  const value = key.split(".").reduce((current, segment) => current?.[segment], copy);
  if (typeof value !== "string") return key;
  return Object.entries(variables).reduce(
    (text, [name, variable]) => text.replaceAll(`{${name}}`, String(variable)),
    value,
  );
}

export function inviteLanguageOptions() {
  return INVITE_LANGUAGE_OPTIONS.filter(({ value }) => APP_LANGUAGES.includes(value));
}
