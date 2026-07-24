import { APP_LANGUAGES, isAppLanguage } from "./appUi";

export const INVITE_LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
];

export const INVITE_COPY = {
  en: {
    activating: "Activating your access…",
    invalidTitle: "Invalid invitation link",
    invalidBody: "This link is not recognized. Contact the Hirly team to get a new invitation.",
    backToHirly: "Back to Hirly",
    language: "Invitation language",
    badge: "Creator invitation",
    greeting: "Hello {name}",
    welcome: "Welcome",
    demoDescription:
      "Create your account to access the {brand} demo workspace and save your screen recordings.",
    trainingDescription: "Create your account to join the {brand} creator training program.",
    trainingAccess: "Full access to the Job Search Mastery course",
    demoAccess: "Demo account for your screen recordings",
    confidentialLead: "Confidential access.",
    confidentialBody:
      "Do not share your access or the training content. Any detected sharing results in immediate removal from the program.",
    signIn: "Sign in",
    createAccount: "Create an account",
    signInSubtitle: "Sign in to activate your invitation.",
    signUpSubtitle: "Sign up to activate your invitation.",
    emailPasswordInvalid: "Enter an email address and a password with at least 6 characters.",
    accountExists: "An account already exists with this email. Switch to sign in.",
    authenticationFailed: "Authentication failed. Please try again.",
    invitationUsed: "This invitation was already used by another account.",
    activationFailed: "Could not activate this invitation.",
    clearSavedInvite: "Clear saved invitation",
    continueWithGoogle: "Continue with Google",
    or: "or",
    email: "Email",
    emailPlaceholder: "you@email.com",
    password: "Password",
    loading: "Loading…",
    noAccount: "No account yet?",
    alreadyHaveAccount: "Already have an account?",
  },
  fr: {
    activating: "Activation de votre accès…",
    invalidTitle: "Lien d'invitation invalide",
    invalidBody:
      "Ce lien n'est pas reconnu. Contactez l'équipe Hirly pour recevoir une nouvelle invitation.",
    backToHirly: "Retour à Hirly",
    language: "Langue de l'invitation",
    badge: "Invitation créateur",
    greeting: "Bonjour {name}",
    welcome: "Bienvenue",
    demoDescription:
      "Créez votre compte pour accéder à l'environnement démo {brand} et enregistrer vos vidéos.",
    trainingDescription:
      "Créez votre compte pour rejoindre le programme de formation créateur {brand}.",
    trainingAccess: "Accès complet au cours Job Search Mastery",
    demoAccess: "Compte démo pour vos enregistrements d'écran",
    confidentialLead: "Accès confidentiel.",
    confidentialBody:
      "Ne partagez pas votre accès ni le contenu de la formation. Tout partage détecté entraîne une exclusion immédiate du programme.",
    signIn: "Connexion",
    createAccount: "Créer un compte",
    signInSubtitle: "Connectez-vous pour activer votre invitation.",
    signUpSubtitle: "Inscrivez-vous pour activer votre invitation.",
    emailPasswordInvalid: "Saisissez un e-mail et un mot de passe d'au moins 6 caractères.",
    accountExists: "Un compte existe déjà avec cet e-mail. Passez en mode connexion.",
    authenticationFailed: "Échec de l'authentification. Réessayez.",
    invitationUsed: "Cette invitation a déjà été utilisée par un autre compte.",
    activationFailed: "Impossible d'activer cette invitation.",
    clearSavedInvite: "Effacer l'invitation enregistrée",
    continueWithGoogle: "Continuer avec Google",
    or: "ou",
    email: "E-mail",
    emailPlaceholder: "vous@email.com",
    password: "Mot de passe",
    loading: "Chargement…",
    noAccount: "Pas encore de compte ?",
    alreadyHaveAccount: "Déjà un compte ?",
  },
  de: {
    activating: "Dein Zugang wird aktiviert…",
    invalidTitle: "Ungültiger Einladungslink",
    invalidBody:
      "Dieser Link wird nicht erkannt. Kontaktiere das Hirly-Team, um eine neue Einladung zu erhalten.",
    backToHirly: "Zurück zu Hirly",
    language: "Sprache der Einladung",
    badge: "Creator-Einladung",
    greeting: "Hallo {name}",
    welcome: "Willkommen",
    demoDescription:
      "Erstelle dein Konto, um auf den {brand}-Demo-Arbeitsbereich zuzugreifen und deine Bildschirmaufnahmen zu speichern.",
    trainingDescription:
      "Erstelle dein Konto, um am {brand}-Creator-Trainingsprogramm teilzunehmen.",
    trainingAccess: "Vollzugriff auf den Kurs Job Search Mastery",
    demoAccess: "Demokonto für deine Bildschirmaufnahmen",
    confidentialLead: "Vertraulicher Zugang.",
    confidentialBody:
      "Teile weder deinen Zugang noch die Trainingsinhalte. Jede festgestellte Weitergabe führt zum sofortigen Ausschluss aus dem Programm.",
    signIn: "Anmelden",
    createAccount: "Konto erstellen",
    signInSubtitle: "Melde dich an, um deine Einladung zu aktivieren.",
    signUpSubtitle: "Registriere dich, um deine Einladung zu aktivieren.",
    emailPasswordInvalid: "Gib eine E-Mail-Adresse und ein Passwort mit mindestens 6 Zeichen ein.",
    accountExists: "Für diese E-Mail existiert bereits ein Konto. Wechsle zur Anmeldung.",
    authenticationFailed: "Anmeldung fehlgeschlagen. Bitte versuche es erneut.",
    invitationUsed: "Diese Einladung wurde bereits von einem anderen Konto verwendet.",
    activationFailed: "Diese Einladung konnte nicht aktiviert werden.",
    clearSavedInvite: "Gespeicherte Einladung löschen",
    continueWithGoogle: "Mit Google fortfahren",
    or: "oder",
    email: "E-Mail",
    emailPlaceholder: "du@email.com",
    password: "Passwort",
    loading: "Wird geladen…",
    noAccount: "Noch kein Konto?",
    alreadyHaveAccount: "Hast du bereits ein Konto?",
  },
  es: {
    activating: "Activando tu acceso…",
    invalidTitle: "Enlace de invitación no válido",
    invalidBody:
      "Este enlace no se reconoce. Ponte en contacto con el equipo de Hirly para recibir una nueva invitación.",
    backToHirly: "Volver a Hirly",
    language: "Idioma de la invitación",
    badge: "Invitación para creador",
    greeting: "Hola {name}",
    welcome: "Te damos la bienvenida",
    demoDescription:
      "Crea tu cuenta para acceder al espacio de demostración de {brand} y guardar tus grabaciones de pantalla.",
    trainingDescription:
      "Crea tu cuenta para unirte al programa de formación para creadores de {brand}.",
    trainingAccess: "Acceso completo al curso Job Search Mastery",
    demoAccess: "Cuenta de demostración para tus grabaciones de pantalla",
    confidentialLead: "Acceso confidencial.",
    confidentialBody:
      "No compartas tu acceso ni el contenido de la formación. Cualquier uso compartido detectado conlleva la expulsión inmediata del programa.",
    signIn: "Iniciar sesión",
    createAccount: "Crear una cuenta",
    signInSubtitle: "Inicia sesión para activar tu invitación.",
    signUpSubtitle: "Regístrate para activar tu invitación.",
    emailPasswordInvalid:
      "Introduce un correo electrónico y una contraseña de al menos 6 caracteres.",
    accountExists: "Ya existe una cuenta con este correo. Cambia al inicio de sesión.",
    authenticationFailed: "La autenticación ha fallado. Inténtalo de nuevo.",
    invitationUsed: "Esta invitación ya fue utilizada por otra cuenta.",
    activationFailed: "No se ha podido activar esta invitación.",
    clearSavedInvite: "Borrar la invitación guardada",
    continueWithGoogle: "Continuar con Google",
    or: "o",
    email: "Correo electrónico",
    emailPlaceholder: "tu@email.com",
    password: "Contraseña",
    loading: "Cargando…",
    noAccount: "¿Aún no tienes una cuenta?",
    alreadyHaveAccount: "¿Ya tienes una cuenta?",
  },
  it: {
    activating: "Stiamo attivando il tuo accesso…",
    invalidTitle: "Link di invito non valido",
    invalidBody:
      "Questo link non è riconosciuto. Contatta il team Hirly per ricevere un nuovo invito.",
    backToHirly: "Torna a Hirly",
    language: "Lingua dell'invito",
    badge: "Invito creator",
    greeting: "Ciao {name}",
    welcome: "Benvenuto",
    demoDescription:
      "Crea il tuo account per accedere all'area demo di {brand} e salvare le registrazioni dello schermo.",
    trainingDescription:
      "Crea il tuo account per partecipare al programma di formazione creator di {brand}.",
    trainingAccess: "Accesso completo al corso Job Search Mastery",
    demoAccess: "Account demo per le tue registrazioni dello schermo",
    confidentialLead: "Accesso riservato.",
    confidentialBody:
      "Non condividere il tuo accesso né i contenuti della formazione. Qualsiasi condivisione rilevata comporta l'esclusione immediata dal programma.",
    signIn: "Accedi",
    createAccount: "Crea un account",
    signInSubtitle: "Accedi per attivare il tuo invito.",
    signUpSubtitle: "Registrati per attivare il tuo invito.",
    emailPasswordInvalid: "Inserisci un'e-mail e una password di almeno 6 caratteri.",
    accountExists: "Esiste già un account con questa e-mail. Passa all'accesso.",
    authenticationFailed: "Autenticazione non riuscita. Riprova.",
    invitationUsed: "Questo invito è già stato usato da un altro account.",
    activationFailed: "Non è stato possibile attivare questo invito.",
    clearSavedInvite: "Cancella l'invito salvato",
    continueWithGoogle: "Continua con Google",
    or: "oppure",
    email: "E-mail",
    emailPlaceholder: "tu@email.com",
    password: "Password",
    loading: "Caricamento…",
    noAccount: "Non hai ancora un account?",
    alreadyHaveAccount: "Hai già un account?",
  },
};

export function normalizeInviteLocale(value, fallback = "fr") {
  const locale = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return isAppLanguage(locale) ? locale : isAppLanguage(fallback) ? fallback : "fr";
}

export function inviteT(locale, key, vars = {}) {
  const text = INVITE_COPY[normalizeInviteLocale(locale)]?.[key];
  if (typeof text !== "string") return key;
  return Object.entries(vars).reduce(
    (result, [name, value]) => result.replace(new RegExp(`\\{${name}\\}`, "g"), String(value)),
    text,
  );
}

export function isInviteLocale(value) {
  const locale = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/, 1)[0];
  return APP_LANGUAGES.includes(locale);
}
