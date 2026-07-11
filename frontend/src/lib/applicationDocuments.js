/** Normalize tailored resume / cover letter fields from API or demo payloads. */

export function getApplicationResume(application) {
  return application?.tailored_resume
    || application?.tailored_resume_structured
    || {};
}

export function normalizeCoverLetter(letter = {}) {
  if (!letter || typeof letter !== "object") return {};

  const paragraphs = Array.isArray(letter.paragraphs) && letter.paragraphs.length
    ? letter.paragraphs.filter(Boolean)
    : [letter.body].filter(Boolean);

  let signOff = letter.sign_off || "";
  let signatureName = letter.signature_name || null;

  if (!signOff && letter.closing) {
    const parts = String(letter.closing).split("\n").map((line) => line.trim()).filter(Boolean);
    signOff = parts[0] || "";
    signatureName = signatureName || parts[1] || null;
  }

  return {
    ...letter,
    paragraphs,
    sign_off: signOff || "Warm regards,",
    signature_name: signatureName,
  };
}

export function getApplicationCoverLetter(application) {
  const raw = application?.cover_letter || application?.tailored_cover_letter || {};
  return normalizeCoverLetter(raw);
}

export function hasApplicationResume(application) {
  const resume = getApplicationResume(application);
  return Boolean(
    resume.summary
    || resume.skills?.length
    || resume.experience?.length
    || resume.education?.length
    || resume.highlights?.length,
  );
}

export function hasApplicationCoverLetter(application) {
  const letter = getApplicationCoverLetter(application);
  return Boolean(letter.greeting || letter.paragraphs?.length || letter.sign_off);
}

export function hasApplicationDocuments(application) {
  return hasApplicationResume(application) || hasApplicationCoverLetter(application);
}
