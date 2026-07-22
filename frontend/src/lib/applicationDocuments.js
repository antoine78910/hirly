/** Normalize tailored resume / cover letter fields from API or demo payloads. */

export function getApplicationResume(application) {
  return application?.tailored_resume || application?.tailored_resume_structured || {};
}

export function normalizeCoverLetter(letter = {}) {
  if (!letter || typeof letter !== "object") return {};

  const paragraphs =
    Array.isArray(letter.paragraphs) && letter.paragraphs.length
      ? letter.paragraphs.filter(Boolean)
      : [letter.body].filter(Boolean);

  let signOff = letter.sign_off || "";
  let signatureName = letter.signature_name || null;

  if (!signOff && letter.closing) {
    const parts = String(letter.closing)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    signOff = parts[0] || "";
    signatureName = signatureName || parts[1] || null;
  }

  const template = letter.template || (letter.subject ? "french_formal" : "standard");
  // A user-edited letter folds greeting/sign-off/signature into `paragraphs`
  // as free text -- don't inject the placeholder defaults on top of it.
  const edited = Boolean(letter.cover_letter_edited);

  return {
    ...letter,
    template,
    paragraphs,
    sign_off:
      signOff ||
      (edited
        ? ""
        : template === "french_formal"
          ? "Je vous prie de recevoir, Madame, Monsieur, l'expression de mes sincères salutations."
          : "Warm regards,"),
    signature_name: signatureName,
    greeting:
      letter.greeting || (edited ? "" : template === "french_formal" ? "Madame, Monsieur," : ""),
  };
}

export function isFrenchFormalCoverLetter(letter = {}) {
  const normalized = normalizeCoverLetter(letter);
  return normalized.template === "french_formal" || Boolean(normalized.subject);
}

export function getApplicationCoverLetter(application) {
  const raw = application?.cover_letter || application?.tailored_cover_letter || {};
  return normalizeCoverLetter(raw);
}

export function hasApplicationResume(application) {
  const resume = getApplicationResume(application);
  return Boolean(
    resume.summary ||
      resume.skills?.length ||
      resume.experience?.length ||
      resume.education?.length ||
      resume.highlights?.length,
  );
}

export function hasApplicationCoverLetter(application) {
  const letter = getApplicationCoverLetter(application);
  return Boolean(letter.greeting || letter.paragraphs?.length || letter.sign_off || letter.subject);
}

export function hasApplicationDocuments(application) {
  return hasApplicationResume(application) || hasApplicationCoverLetter(application);
}

export function isApplicationGenerating(application) {
  const generationStatus = application?.generation_status;
  const packageStatus = application?.package_status;
  return (
    generationStatus === "pending_generation" ||
    generationStatus === "generating" ||
    packageStatus === "pending_generation"
  );
}
