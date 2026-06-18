export function stripHtml(value = "") {
  const withBreaks = String(value)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const textarea = typeof document !== "undefined" ? document.createElement("textarea") : null;
  if (textarea) {
    textarea.innerHTML = withoutTags;
    return textarea.value.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  }
  return withoutTags.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

export function humanizeLabel(value) {
  if (!value) return "";
  const normalized = String(value).trim();
  const map = {
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
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function seniorityLabel(job) {
  const m = {
    junior: "Entry Level",
    mid: "Mid Level",
    senior: "Senior Level",
    lead: "Lead",
    principal: "Principal",
    entry: "Entry Level",
    executive: "Executive Level",
  };
  return m[job?.seniority] || humanizeLabel(job?.seniority) || "Entry Level";
}

export function workModelLabel(remote) {
  return ({ remote: "Remote", hybrid: "Hybrid", onsite: "In Person" }[remote] || "In Person");
}

function industryFallback(job) {
  const stack = (job?.tech_stack || []).join(" ").toLowerCase();
  const title = (job?.title || "").toLowerCase();
  if (title.includes("vendange") || title.includes("vineyard") || title.includes("viticult")) {
    return "Viticulture / Wine Production";
  }
  if (title.includes("design")) return "Product Design";
  if (stack.includes("ml") || stack.includes("pytorch")) return "AI / ML";
  return "Technology";
}

function inferEducationLevel(job) {
  const text = `${job?.title || ""} ${job?.description || ""} ${job?.clean_description || ""}`.toLowerCase();
  if (/high school|lycée|lycee|niveau cap|bepa\b/.test(text)) return "High School";
  if (/\bbac\s*\+\s*[2-5]\b/.test(text)) return "Bachelor+";
  return "";
}

export function getJobTags(job) {
  const tags = [];
  const push = (label) => {
    const text = humanizeLabel(label);
    if (text && !tags.includes(text)) tags.push(text);
  };

  push(job?.education_level || job?.min_education || job?.education_requirement || inferEducationLevel(job));
  push(seniorityLabel(job));
  push(workModelLabel(job?.remote));
  push(job?.industry || job?.sector || industryFallback(job));

  const jobType = job?.job_type || job?.employment_type || job?.contract_type;
  const description = `${job?.description || ""} ${job?.clean_description || ""}`.toLowerCase();
  if (description.includes("saisonnier") || description.includes("seasonal") || description.includes("cdd saisonnier")) {
    push("Seasonal");
  }
  if (jobType) {
    if (Array.isArray(jobType)) jobType.forEach(push);
    else push(jobType);
  } else if (!tags.some((t) => /seasonal|full time|part time|contract/i.test(t))) {
    push("Full Time");
  }

  return tags;
}

/** Ordered badge items for desktop job cards (Sprout-style). */
export function getJobBadgeItems(job) {
  const items = [];
  const add = (label, icon) => {
    const text = humanizeLabel(label);
    if (!text) return;
    if (items.some((item) => item.label.toLowerCase() === text.toLowerCase())) return;
    items.push({ label: text, icon });
  };

  const description = `${job?.description || ""} ${job?.clean_description || ""}`.toLowerCase();
  if (description.includes("saisonnier") || description.includes("seasonal") || description.includes("cdd saisonnier")) {
    add("Seasonal", "contract");
  }

  const jobType = job?.job_type || job?.employment_type || job?.contract_type;
  if (jobType) {
    if (Array.isArray(jobType)) jobType.forEach((value) => add(value, "contract"));
    else add(jobType, "contract");
  } else if (!items.some((item) => /seasonal|full time|part time|contract/i.test(item.label))) {
    add("Full Time", "contract");
  }

  const education = job?.education_level || job?.min_education || job?.education_requirement || inferEducationLevel(job);
  if (education) add(education, "graduation");

  add(seniorityLabel(job), "chart");
  add(workModelLabel(job?.remote), "laptop");
  add(job?.industry || job?.sector || industryFallback(job), "factory");

  return items;
}

function sectionTitleMatches(title, patterns) {
  const normalized = stripHtml(title).toLowerCase();
  return patterns.some((pattern) => pattern.test(normalized));
}

function cleanBullets(bullets) {
  return (bullets || [])
    .map((bullet) => stripHtml(bullet))
    .filter(Boolean);
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

  const snippetSource = stripHtml(job?.summary || job?.tagline || "");
  const snippet = snippetSource
    || cleanBullets(aboutSection?.bullets).slice(0, 1).join(" ")
    || stripHtml(job?.clean_description || job?.description || "").split(/\n\n/)[0]?.slice(0, 280);

  let about = "";
  if (aboutSection?.bullets?.length) {
    about = cleanBullets(aboutSection.bullets).join("\n\n");
  } else {
    about = stripHtml(job?.clean_description || job?.description || "");
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

  return { snippet, about, detailSections };
}

export function jobExternalUrl(job) {
  return job?.url || job?.external_url || null;
}
