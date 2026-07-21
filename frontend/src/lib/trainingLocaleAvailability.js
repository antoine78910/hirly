export const TRAINING_LOCALE_UNAVAILABLE_COPY = {
  unsupported: {
    title: "Training is unavailable for this locale.",
    body: "Choose a supported training language to continue.",
    action: "Go to French training",
  },
  de: {
    title: "Diese Schulung ist noch nicht auf Deutsch verfügbar.",
    body: "Die deutschsprachige Version wird vorbereitet. Bitte wählen Sie eine verfügbare Schulungssprache.",
    action: "Zur französischen Schulung",
  },
  es: {
    title: "Esta formación todavía no está disponible en español.",
    body: "Estamos preparando la versión en español. Elige un idioma de formación disponible.",
    action: "Ir a la formación en francés",
  },
  it: {
    title: "Questa formazione non è ancora disponibile in italiano.",
    body: "Stiamo preparando la versione italiana. Scegli una lingua di formazione disponibile.",
    action: "Vai alla formazione in francese",
  },
};

export function trainingLocaleUnavailableCopy(locale) {
  return TRAINING_LOCALE_UNAVAILABLE_COPY[locale] || TRAINING_LOCALE_UNAVAILABLE_COPY.unsupported;
}
