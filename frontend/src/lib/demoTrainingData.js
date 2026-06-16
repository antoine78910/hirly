import { moduleExtrasFor } from "./trainingModuleContent";

const COURSE_ID = "course_job_search_mastery";

export const TRAINING_COURSE_ID = COURSE_ID;

const MODULES_EN = [
  { module_id: "mod_getting_started", title: "Getting Started", description: "Set up your workspace and understand how the program works.", category: "fundamentals", sort_order: 1, duration_seconds: 480, video_url: "", completed: false },
  { module_id: "mod_warm_up", title: "Warm Up Playbook", description: "TikTok & IG warmup SOP before you post career content.", category: "fundamentals", sort_order: 2, duration_seconds: 420, video_url: "", completed: false },
  { module_id: "mod_creating_content", title: "Creating Content", description: "Filming, Hirly demos, and editing — three sub-chapters with video lessons.", category: "application", sort_order: 3, duration_seconds: 600, video_url: "", completed: false },
  { module_id: "mod_account_management", title: "Account Management", description: "Manage your profile, settings, and creator account.", category: "interview", sort_order: 4, duration_seconds: 420, video_url: "", completed: false },
  { module_id: "mod_submit_drafts", title: "Submit Drafts & Next Steps", description: "How to submit work, get feedback, and what happens next.", category: "interview", sort_order: 5, duration_seconds: 480, video_url: "", completed: false },
  { module_id: "mod_content_bank", title: "Content Bank Examples", description: "Reference scripts and formats you can reuse and adapt.", category: "reference", sort_order: 6, duration_seconds: 540, video_url: "", completed: false },
];

const MODULES_FR = [
  { module_id: "mod_getting_started", title: "Pour bien commencer", description: "Configure ton espace et comprends comment fonctionne le programme.", category: "fundamentals", sort_order: 1, duration_seconds: 480, video_url: "", completed: false },
  { module_id: "mod_warm_up", title: "Guide d'échauffement", description: "SOP warmup TikTok & IG avant de publier du contenu carrière.", category: "fundamentals", sort_order: 2, duration_seconds: 420, video_url: "", completed: false },
  { module_id: "mod_creating_content", title: "Créer du contenu", description: "Tournage, démos Hirly et montage — trois sous-chapitres avec vidéos.", category: "application", sort_order: 3, duration_seconds: 600, video_url: "", completed: false },
  { module_id: "mod_account_management", title: "Gestion du compte", description: "Gère ton profil, tes paramètres et ton compte créateur.", category: "interview", sort_order: 4, duration_seconds: 420, video_url: "", completed: false },
  { module_id: "mod_submit_drafts", title: "Soumettre les brouillons & la suite", description: "Comment soumettre ton travail, obtenir des retours et la suite du parcours.", category: "interview", sort_order: 5, duration_seconds: 480, video_url: "", completed: false },
  { module_id: "mod_content_bank", title: "Exemples banque de contenu", description: "Scripts et formats de référence à réutiliser et adapter.", category: "reference", sort_order: 6, duration_seconds: 540, video_url: "", completed: false },
];

function courseForLang(lang) {
  const fr = lang === "fr";
  return {
    course_id: COURSE_ID,
    title: "Talking Heads",
    subtitle: fr
      ? "Scripts vidéo et leçons pour booster ta recherche d'emploi"
      : "Video scripts & lessons to level up your job search",
    description: fr
      ? "Parcours chaque module, regarde les vidéos et fais les quiz à la fin de chaque chapitre."
      : "Go through each module, watch the videos, and complete the quizzes at the end of every chapter.",
    thumbnail_url: "/onboarding/intro-3.png",
    level: fr ? "Débutant" : "Beginner",
    module_count: 6,
    duration_minutes: 43,
    creator_id: "creator_swiipr_official",
  };
}

export function getDemoTrainingCatalog(lang = "en") {
  const course = courseForLang(lang);
  return {
    courses: [course],
    my_courses: [],
    is_training_creator: false,
    creator_id: null,
    lang,
  };
}

export function getDemoTrainingCourseDetail(courseId, lang = "en") {
  if (courseId && courseId !== COURSE_ID) return undefined;
  const modules = lang === "fr" ? MODULES_FR : MODULES_EN;
  return {
    course: courseForLang(lang),
    modules: modules.map((m) => {
      const extras = moduleExtrasFor(m.module_id, lang);
      return {
        ...m,
        content: extras.content,
        sections: extras.sections,
      };
    }),
    lang,
    enrollment: { enrolled: false, progress_percent: 0, completed_module_ids: [] },
    creator: {
      display_name: lang === "fr" ? "Académie Hirly" : "Hirly Academy",
      bio: lang === "fr"
        ? "Formation officielle à la recherche d'emploi par l'équipe Hirly."
        : "Official job search training from the Hirly team.",
    },
  };
}
