import { isFrench, translateJobTitle } from "./localizedDisplay";
import { formatMoney } from "./currency";

const DESCRIPTION_TITLE_START_RE =
  /^(nous |vous |votre |le candidat|missions?\s*:|profil\s*:|description\s*:|contexte\s*:|ce poste )/i;

function cleanDisplayTitleText(value) {
  const text = stripHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.includes("\n")) {
    const firstLine = text
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean);
    return firstLine || text;
  }
  return text;
}

function titleLooksLikeDescription(text, { maxLen = 90, maxWords = 14 } = {}) {
  if (!text) return false;
  if (text.length > maxLen) return true;
  if (text.split(/\s+/).length > maxWords) return true;
  if (text.length > 70 && /[.!?]\s+\S/.test(text)) return true;
  return DESCRIPTION_TITLE_START_RE.test(text);
}

function shortenDisplayTitle(text, { maxLen = 90, maxWords = 14 } = {}) {
  if (text.length <= maxLen && text.split(/\s+/).length <= maxWords) return text;
  if (/[.!?]\s+/.test(text) && text.length > 50) {
    const first = text.split(/[.!?]\s+/)[0]?.trim();
    if (first && first.length >= 8 && first.length <= maxLen) return first;
  }
  const words = text.split(/\s+/);
  if (words.length > maxWords) return words.slice(0, maxWords).join(" ");
  if (text.length > maxLen) {
    const clipped = text.slice(0, maxLen);
    return (clipped.includes(" ") ? clipped.replace(/\s+\S*$/, "") : clipped)
      .trim()
      .replace(/[.,;:-]+$/, "");
  }
  return text;
}

export function sanitizeDisplayTitle(value, { fallback = "", maxLen = 90, maxWords = 14 } = {}) {
  const primary = cleanDisplayTitleText(value);
  const backup = cleanDisplayTitleText(fallback);
  const opts = { maxLen, maxWords };

  if (primary && !titleLooksLikeDescription(primary, opts)) {
    return shortenDisplayTitle(primary, opts);
  }
  if (backup && !titleLooksLikeDescription(backup, opts)) {
    return shortenDisplayTitle(backup, opts);
  }
  if (primary) return shortenDisplayTitle(primary, opts);
  return backup;
}

export function getJobDisplayTitle(job, { lang = "en" } = {}) {
  const title = sanitizeDisplayTitle(job?.title, { fallback: job?.rome_label });
  return translateJobTitle(title, lang);
}

export function stripHtml(value = "") {
  const withBreaks = String(value)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const textarea = typeof document !== "undefined" ? document.createElement("textarea") : null;
  if (textarea) {
    textarea.innerHTML = withoutTags;
    return textarea.value
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n\n")
      .trim();
  }
  return withoutTags
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export function humanizeLabel(value, lang = "en") {
  if (!value) return "";
  const normalized = String(value).trim();
  const map = isFrench(lang)
    ? {
        high_school: "Lycée",
        lycee: "Lycée",
        cap: "CAP",
        bepa: "BEPA",
        seasonal: "Saisonnier",
        cdd: "CDD",
        full_time: "Temps plein",
        part_time: "Temps partiel",
        internship: "Stage",
        contract: "Contrat",
      }
    : {
        high_school: "High School",
        lycee: "High School",
        cap: "CAP",
        bepa: "BEPA",
        seasonal: "Seasonal",
        cdd: "Fixed-Term",
        full_time: "Full Time",
        part_time: "Part Time",
      };
  const key = normalized.toLowerCase().replace(/\s+/g, "_");
  if (map[key]) return map[key];
  return normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function seniorityLabel(job, lang = "en") {
  const m = isFrench(lang)
    ? {
        junior: "Junior",
        mid: "Intermédiaire",
        senior: "Senior",
        lead: "Lead",
        principal: "Principal",
        entry: "Junior",
        executive: "Direction",
      }
    : {
        junior: "Entry Level",
        mid: "Mid Level",
        senior: "Senior Level",
        lead: "Lead",
        principal: "Principal",
        entry: "Entry Level",
        executive: "Executive Level",
      };
  return (
    m[job?.seniority] ||
    humanizeLabel(job?.seniority, lang) ||
    (isFrench(lang) ? "Junior" : "Entry Level")
  );
}

export function workModelLabel(remote, lang = "en") {
  const labels = isFrench(lang)
    ? { remote: "Télétravail", hybrid: "Hybride", onsite: "Présentiel" }
    : { remote: "Remote", hybrid: "Hybrid", onsite: "In Person" };
  return labels[remote] || labels.onsite;
}

function industryFallback(job, lang = "en") {
  const stack = (job?.tech_stack || []).join(" ").toLowerCase();
  const title = (job?.title || "").toLowerCase();
  if (title.includes("vendange") || title.includes("vineyard") || title.includes("viticult")) {
    return isFrench(lang) ? "Viticulture / production de vin" : "Viticulture / Wine Production";
  }
  if (title.includes("design")) return isFrench(lang) ? "Design produit" : "Product Design";
  if (stack.includes("ml") || stack.includes("pytorch")) return "AI / ML";
  return isFrench(lang) ? "Technologie" : "Technology";
}

function inferEducationLevel(job) {
  const text =
    `${job?.title || ""} ${job?.description || ""} ${job?.clean_description || ""}`.toLowerCase();
  if (/high school|lycée|lycee|niveau cap|bepa\b/.test(text)) return "High School";
  if (/\bbac\s*\+\s*[2-5]\b/.test(text)) return "Bachelor+";
  return "";
}

export function getJobTags(job, { lang = "en" } = {}) {
  const tags = [];
  const push = (label) => {
    const text = humanizeLabel(label, lang);
    if (text && !tags.includes(text)) tags.push(text);
  };

  push(
    job?.education_level ||
      job?.min_education ||
      job?.education_requirement ||
      inferEducationLevel(job),
  );
  push(seniorityLabel(job, lang));
  push(workModelLabel(job?.remote, lang));
  push(job?.industry || job?.sector || industryFallback(job, lang));

  const jobType = job?.job_type || job?.employment_type || job?.contract_type;
  const description = `${job?.description || ""} ${job?.clean_description || ""}`.toLowerCase();
  if (
    description.includes("saisonnier") ||
    description.includes("seasonal") ||
    description.includes("cdd saisonnier")
  ) {
    push(isFrench(lang) ? "Saisonnier" : "Seasonal");
  }
  if (jobType) {
    if (Array.isArray(jobType)) jobType.forEach(push);
    else push(jobType);
  } else if (!tags.some((t) => /seasonal|full time|part time|contract/i.test(t))) {
    push(isFrench(lang) ? "Temps plein" : "Full Time");
  }

  return tags;
}

/** Ordered badge items for desktop job cards (Sprout-style). */
export function getJobBadgeItems(job, { lang = "en" } = {}) {
  const items = [];
  const add = (label, icon) => {
    const text = humanizeLabel(label, lang);
    if (!text) return;
    if (items.some((item) => item.label.toLowerCase() === text.toLowerCase())) return;
    items.push({ label: text, icon });
  };

  const description = `${job?.description || ""} ${job?.clean_description || ""}`.toLowerCase();
  if (
    description.includes("saisonnier") ||
    description.includes("seasonal") ||
    description.includes("cdd saisonnier")
  ) {
    add(isFrench(lang) ? "Saisonnier" : "Seasonal", "contract");
  }

  const jobType = job?.job_type || job?.employment_type || job?.contract_type;
  if (jobType) {
    if (Array.isArray(jobType))
      jobType.forEach((value) => {
        add(value, "contract");
      });
    else add(jobType, "contract");
  } else if (!items.some((item) => /seasonal|full time|part time|contract/i.test(item.label))) {
    add(isFrench(lang) ? "Temps plein" : "Full Time", "contract");
  }

  const education =
    job?.education_level ||
    job?.min_education ||
    job?.education_requirement ||
    inferEducationLevel(job);
  if (education) add(education, "graduation");

  add(seniorityLabel(job, lang), "chart");
  add(workModelLabel(job?.remote, lang), "laptop");
  add(job?.industry || job?.sector || industryFallback(job, lang), "factory");

  return items;
}

export function formatJobSalaryLabel(job, { lang = "en" } = {}) {
  const min = job?.salary_min;
  const max = job?.salary_max;
  if ((min == null || min === "") && (max == null || max === "")) {
    const salaryLabel = stripHtml(job?.salary_label || "");
    if (salaryLabel) return salaryLabel;
    const complement = [
      job?.offer_details?.find?.((item) => item?.key === "salary_complement_1")?.value,
      job?.offer_details?.find?.((item) => item?.key === "salary_complement_2")?.value,
    ]
      .filter(Boolean)
      .join(" · ");
    if (complement) return complement;
    return "";
  }
  const minNum = min != null && min !== "" ? Number(min) : null;
  const maxNum = max != null && max !== "" ? Number(max) : null;
  if (minNum != null && maxNum != null && minNum !== maxNum) {
    return `${formatMoney(minNum, lang)} – ${formatMoney(maxNum, lang)}`;
  }
  const value = maxNum ?? minNum;
  return value != null ? formatMoney(value, lang) : "";
}

const OFFER_DETAIL_LABEL_KEYS = {
  contract_type: "offerContractType",
  contract_nature: "offerContractNature",
  work_schedule: "offerWorkSchedule",
  experience: "offerExperience",
  salary: "offerSalary",
  salary_note: "offerSalaryNote",
  salary_complement_1: "offerSalaryNote",
  salary_complement_2: "offerSalaryNote",
  benefits: "offerBenefits",
  travel: "offerTravel",
  work_context: "offerWorkContext",
  work_conditions: "offerWorkConditions",
};

const OFFER_DETAIL_ORDER = [
  "contract_type",
  "contract_nature",
  "work_schedule",
  "experience",
  "salary",
  "salary_note",
  "salary_complement_1",
  "salary_complement_2",
  "benefits",
  "travel",
  "work_context",
  "work_conditions",
];

function offerDetailLabel(t, key) {
  const labelKey = OFFER_DETAIL_LABEL_KEYS[key];
  return labelKey ? t(`swipe.${labelKey}`) : key;
}

function buildFallbackOfferDetailRows(job, { t, lang }) {
  const rows = [];
  const contract = job?.employment_type || job?.contract_type;
  if (contract) {
    rows.push({
      key: "contract_type",
      label: offerDetailLabel(t, "contract_type"),
      value: humanizeLabel(contract, lang),
    });
  }
  const salary = formatJobSalaryLabel(job, { lang });
  if (salary) {
    rows.push({
      key: "salary",
      label: offerDetailLabel(t, "salary"),
      value: salary,
    });
  }
  if (job?.salary_comment) {
    rows.push({
      key: "salary_note",
      label: offerDetailLabel(t, "salary_note"),
      value: stripHtml(job.salary_comment),
    });
  }
  return rows;
}

/** Labeled offer rows (contract, salary, benefits, travel, etc.) when available. */
export function getJobOfferDetailRows(job, { t, lang = "en" } = {}) {
  if (!job || typeof t !== "function") return [];

  const details = Array.isArray(job.offer_details) ? job.offer_details : [];
  if (!details.length) {
    return buildFallbackOfferDetailRows(job, { t, lang });
  }

  const rows = [];
  const seen = new Set();
  const complementValues = details
    .filter((item) => item?.key === "salary_complement_1" || item?.key === "salary_complement_2")
    .map((item) => stripHtml(item.value || ""))
    .filter(Boolean);
  if (complementValues.length) {
    rows.push({
      key: "salary_complements",
      label: offerDetailLabel(t, "salary_note"),
      items: complementValues.length > 1 ? complementValues : undefined,
      value: complementValues.length === 1 ? complementValues[0] : undefined,
    });
    seen.add("salary_complement_1");
    seen.add("salary_complement_2");
  }

  for (const key of OFFER_DETAIL_ORDER) {
    const entry = details.find((item) => item?.key === key);
    if (!entry || seen.has(key)) continue;
    if (Array.isArray(entry.items) && entry.items.length) {
      rows.push({
        key,
        label: offerDetailLabel(t, key),
        items: entry.items.map((item) => stripHtml(item)).filter(Boolean),
      });
      seen.add(key);
      continue;
    }
    const value = stripHtml(entry.value || "");
    if (!value) continue;
    rows.push({
      key,
      label: offerDetailLabel(t, key),
      value,
    });
    seen.add(key);
  }

  for (const entry of details) {
    const key = entry?.key;
    if (!key || seen.has(key)) continue;
    if (Array.isArray(entry.items) && entry.items.length) {
      rows.push({
        key,
        label: offerDetailLabel(t, key),
        items: entry.items.map((item) => stripHtml(item)).filter(Boolean),
      });
      continue;
    }
    const value = stripHtml(entry.value || "");
    if (!value) continue;
    rows.push({
      key,
      label: offerDetailLabel(t, key),
      value,
    });
  }

  return rows;
}

const CARD_HIGHLIGHT_PRIORITY = [
  "contract_type",
  "contract_nature",
  "work_schedule",
  "experience",
  "salary",
  "benefits",
  "work_context",
];

/** Compact labeled rows for the swipe card front (before flip). */
export function getJobCardHighlightRows(job, { t, lang = "en", max = 3 } = {}) {
  if (!job || typeof t !== "function") return [];
  const rows = getJobOfferDetailRows(job, { t, lang });
  if (!rows.length) return [];

  const sorted = [...rows].sort((a, b) => {
    const ai = CARD_HIGHLIGHT_PRIORITY.indexOf(a.key);
    const bi = CARD_HIGHLIGHT_PRIORITY.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return sorted
    .slice(0, Math.max(1, max))
    .map((row) => ({
      key: row.key,
      label: row.label,
      value: row.value || (row.items || []).slice(0, 2).join(" · "),
    }))
    .filter((row) => row.value);
}

export function getJobMatchScore(job) {
  const raw = job?.match_score ?? job?.matchScore ?? job?.feed_score;
  const score = Number(raw);
  if (!Number.isFinite(score) || score <= 0) return null;
  return Math.round(Math.max(0, Math.min(100, score)));
}

function sectionTitleMatches(title, patterns) {
  const normalized = stripHtml(title).toLowerCase();
  return patterns.some((pattern) => pattern.test(normalized));
}

function cleanBullets(bullets) {
  return (bullets || []).map((bullet) => stripHtml(bullet)).filter(Boolean);
}

function findSection(sections, patterns) {
  return (sections || []).find((section) => sectionTitleMatches(section?.title, patterns));
}

function remainingSections(sections, used) {
  const usedSet = new Set(used.filter(Boolean));
  return (sections || []).filter((section) => {
    if (!section?.title || !section?.bullets?.length) return false;
    if (usedSet.has(section)) return false;
    if (sectionTitleMatches(section.title, ABOUT_PATTERNS)) {
      return false;
    }
    return true;
  });
}

const SECTION_ORDER = [
  {
    key: "required",
    patterns: [
      /required qualification/i,
      /^requirements$/i,
      /qualifications?\s+requises?/i,
      /profil recherch/i,
      /ce que nous recherchons/i,
      /what we(?:'|')?re looking for/i,
    ],
  },
  {
    key: "desired",
    patterns: [
      /desired qualification/i,
      /nice to have/i,
      /preferred qualification/i,
      /qualifications?\s+souhait/i,
      /serait un plus/i,
      /apprécié/i,
      /atout/i,
    ],
  },
  {
    key: "restrictions",
    patterns: [/restriction/i, /eligibility/i, /conditions?\s+requises?/i, /permis requis/i],
  },
];

const ABOUT_PATTERNS = [
  /about(\s+this)?\s+role/i,
  /^about the role$/i,
  /^about$/i,
  /à propos/i,
  /description du poste/i,
  /présentation du poste/i,
  /^le poste$/i,
  /mission du poste/i,
];

export function getJobDisplayContent(job) {
  const sections = job?.job_description_sections || [];
  const aboutSection = findSection(sections, ABOUT_PATTERNS);
  const fullDescription = stripHtml(job?.clean_description || job?.description || "");

  const snippetSource = stripHtml(job?.summary || job?.tagline || "");
  const snippet =
    snippetSource ||
    cleanBullets(aboutSection?.bullets).slice(0, 1).join(" ") ||
    fullDescription.split(/\n\n/)[0]?.slice(0, 280);

  let about = "";
  if (aboutSection?.bullets?.length) {
    about = cleanBullets(aboutSection.bullets).join("\n\n");
  } else {
    about = fullDescription;
  }

  const detailSections = [];
  const used = [aboutSection];

  for (const { patterns } of SECTION_ORDER) {
    const match = findSection(sections, patterns);
    if (match) {
      detailSections.push({
        title: stripHtml(match.title),
        bullets: cleanBullets(match.bullets),
      });
      used.push(match);
    }
  }

  if (!detailSections.some((s) => /required/i.test(s.title)) && job?.requirements?.length) {
    detailSections.unshift({
      title: "Required Qualifications",
      bullets: job.requirements.map((item) => stripHtml(item)).filter(Boolean),
    });
  }

  for (const section of remainingSections(sections, used)) {
    detailSections.push({
      title: stripHtml(section.title),
      bullets: cleanBullets(section.bullets),
    });
  }

  return { snippet, about, fullDescription, detailSections };
}

export function jobExternalUrl(job) {
  return (
    job?.apply_url ||
    job?.application_url ||
    job?.selected_apply_url ||
    job?.url ||
    job?.external_url ||
    null
  );
}

/** Open employer apply URL (Safari / system browser on iOS when possible). */
export function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    const browser = typeof window !== "undefined" ? window.Capacitor?.Plugins?.Browser : null;
    if (browser && typeof browser.open === "function") {
      browser.open({ url: target });
      return true;
    }
  } catch {
    // Fall through to window.open.
  }
  if (typeof window !== "undefined") {
    window.open(target, "_blank", "noopener,noreferrer");
    return true;
  }
  return false;
}

/** Best employer apply URL from a public application payload. */
export function applicationApplyUrl(application) {
  return application?.apply_url || jobExternalUrl(application?.job) || null;
}
