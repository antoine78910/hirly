/** Demo / fallback structured doc blocks (mirrors backend training_module_content.py). */

import {
  CREATING_CONTENT_SECTIONS_EN,
  CREATING_CONTENT_SECTIONS_FR,
} from "./creatingContentSections";

import {
  WARM_UP_SECTIONS_EN,
  WARM_UP_SECTIONS_FR,
} from "./warmupSections";

import {
  CONTENT_BANK_SECTIONS_EN,
  CONTENT_BANK_SECTIONS_FR,
} from "./contentBankSections";

import {
  WARM_UP_PLAYBOOK_EN,
  WARM_UP_PLAYBOOK_FR,
} from "./warmUpPlaybook";

export { CREATING_CONTENT_SECTIONS_EN, CREATING_CONTENT_SECTIONS_FR };
export { WARM_UP_PLAYBOOK_EN, WARM_UP_PLAYBOOK_FR };

export function moduleContentFor(moduleId, lang = "en") {
  if (moduleId === "mod_warm_up") {
    return lang === "fr" ? WARM_UP_PLAYBOOK_FR : WARM_UP_PLAYBOOK_EN;
  }
  return null;
}

export function moduleSectionsFor(moduleId, lang = "en") {
  if (moduleId === "mod_warm_up") {
    return lang === "fr" ? WARM_UP_SECTIONS_FR : WARM_UP_SECTIONS_EN;
  }
  if (moduleId === "mod_creating_content") {
    return lang === "fr" ? CREATING_CONTENT_SECTIONS_FR : CREATING_CONTENT_SECTIONS_EN;
  }
  if (moduleId === "mod_content_bank") {
    return lang === "fr" ? CONTENT_BANK_SECTIONS_FR : CONTENT_BANK_SECTIONS_EN;
  }
  return [];
}

export function moduleExtrasFor(moduleId, lang = "en") {
  return {
    content: moduleContentFor(moduleId, lang) || [],
    sections: moduleSectionsFor(moduleId, lang),
  };
}
