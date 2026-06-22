import { api } from "./api";
import {
  TRAINING_COURSE_ID,
  getDemoTrainingCatalog,
  getDemoTrainingCourseDetail,
} from "./demoTrainingData";
import { quizIdForModule } from "./trainingQuizzes";

/** Set REACT_APP_TRAINING_API=true when the live training backend is ready. */
function isLiveTrainingApiEnabled() {
  return process.env.REACT_APP_TRAINING_API === "true";
}

function progressStorageKey(courseId) {
  return `hirly_training_progress_${courseId || TRAINING_COURSE_ID}`;
}

export function loadLocalTrainingProgress(courseId) {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(progressStorageKey(courseId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalTrainingProgress(courseId, patch) {
  if (typeof window === "undefined") return;
  try {
    const key = progressStorageKey(courseId);
    const current = loadLocalTrainingProgress(courseId);
    window.localStorage.setItem(key, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* ignore */
  }
}

export function isQuizPassed(enrollment, quizId, courseId) {
  const local = loadLocalTrainingProgress(courseId);
  const fromLocal = local.quiz_results?.[quizId]?.passed;
  if (fromLocal) return true;
  const fromApi = enrollment?.quiz_results?.[quizId]?.passed;
  return Boolean(fromApi);
}

function mergeEnrollment(staticEnrollment, apiEnrollment, courseId) {
  const local = loadLocalTrainingProgress(courseId);
  const quizResults = {
    ...(local.quiz_results || {}),
    ...(apiEnrollment?.quiz_results || {}),
  };
  const completed = apiEnrollment?.completed_module_ids?.length
    ? apiEnrollment.completed_module_ids
    : local.completed_module_ids || staticEnrollment?.completed_module_ids || [];

  return {
    ...staticEnrollment,
    ...apiEnrollment,
    enrolled: apiEnrollment?.enrolled ?? staticEnrollment?.enrolled ?? false,
    progress_percent: apiEnrollment?.progress_percent ?? staticEnrollment?.progress_percent ?? 0,
    completed_module_ids: completed,
    quiz_results: quizResults,
    activity: apiEnrollment?.activity || local.activity || {},
  };
}

function demoCatalog(lang) {
  const demo = getDemoTrainingCatalog(lang);
  return {
    courses: demo.courses,
    my_courses: demo.my_courses || [],
    is_training_creator: demo.is_training_creator,
    creator_id: demo.creator_id,
    lang,
  };
}

function staticCourseDetail(lang) {
  return getDemoTrainingCourseDetail(TRAINING_COURSE_ID, lang);
}

/** Keep bundled curriculum content; overlay API progress/metadata when available. */
function mergeModules(apiModules, staticModules) {
  if (!staticModules?.length) return apiModules || [];
  if (!apiModules?.length) return staticModules;

  const apiById = Object.fromEntries(apiModules.map((m) => [m.module_id, m]));
    return staticModules.map((base) => {
    const fromApi = apiById[base.module_id];
    if (!fromApi) return base;
    const mergedSections = (fromApi.sections?.length ? fromApi.sections : base.sections)?.map((sec) => {
      const baseSec = base.sections?.find((s) => s.section_id === sec.section_id);
      return {
        ...baseSec,
        ...sec,
        content: sec.content?.length ? sec.content : baseSec?.content,
        resources: sec.resources?.length ? sec.resources : baseSec?.resources,
        video_url: sec.video_url || baseSec?.video_url || "",
      };
    });
    return {
      ...base,
      ...fromApi,
      title: fromApi.title || base.title,
      description: fromApi.description || base.description,
      content: fromApi.content?.length ? fromApi.content : base.content,
      sections: mergedSections?.length ? mergedSections : base.sections,
      video_url: fromApi.video_url || base.video_url || "",
    };
  });
}

/** Load catalog — static bundled data by default (no backend required). */
export async function fetchTrainingCatalog(lang) {
  const staticData = demoCatalog(lang);
  if (!isLiveTrainingApiEnabled()) return staticData;

  try {
    const { data } = await api.get("/training/catalog", { params: { lang } });
    if (data?.courses?.length) {
      return {
        ...staticData,
        ...data,
        courses: [{
          ...staticData.courses[0],
          ...data.courses[0],
          course_id: data.courses[0].course_id || TRAINING_COURSE_ID,
        }],
      };
    }
  } catch {
    /* static fallback */
  }
  return staticData;
}

/** Load course detail — static curriculum + optional API progress overlay. */
export async function fetchTrainingCourseDetail(courseId, lang) {
  const staticData = staticCourseDetail(lang);
  if (!staticData) return undefined;
  const id = courseId || TRAINING_COURSE_ID;

  const applyCompletion = (payload) => {
    const completedIds = new Set(payload.enrollment?.completed_module_ids || []);
    return {
      ...payload,
      modules: (payload.modules || []).map((mod) => ({
        ...mod,
        completed: completedIds.has(mod.module_id) || mod.completed,
      })),
    };
  };

  if (!isLiveTrainingApiEnabled()) {
    try {
      const { data } = await api.get(`/training/courses/${id}`, { params: { lang } });
      if (data?.modules?.length) {
        return applyCompletion({
          ...staticData,
          ...data,
          course: { ...staticData.course, ...data.course },
          modules: mergeModules(data.modules, staticData.modules),
          enrollment: mergeEnrollment(staticData.enrollment, data.enrollment, id),
        });
      }
    } catch {
      /* static fallback */
    }
    return applyCompletion({
      ...staticData,
      enrollment: mergeEnrollment(staticData.enrollment, {}, id),
    });
  }

  try {
    const { data } = await api.get(`/training/courses/${id}`, { params: { lang } });
    if (data) {
      return applyCompletion({
        ...staticData,
        ...data,
        course: { ...staticData.course, ...data.course },
        modules: mergeModules(data.modules, staticData.modules),
        enrollment: mergeEnrollment(staticData.enrollment, data.enrollment, id),
      });
    }
  } catch {
    /* static fallback */
  }
  return applyCompletion({
    ...staticData,
    enrollment: mergeEnrollment(staticData.enrollment, {}, id),
  });
}

/** Best-effort API calls — never block UX when backend is unavailable. */
export async function tryEnrollCourse(courseId) {
  if (!isLiveTrainingApiEnabled()) return;
  try {
    await api.post(`/training/courses/${courseId}/enroll`);
  } catch {
    /* ignore */
  }
}

export async function tryTrackTrainingActivity(courseId, moduleId, sectionId = null) {
  const activity = {
    last_module_id: moduleId,
    last_section_id: sectionId,
    updated_at: new Date().toISOString(),
  };
  const local = loadLocalTrainingProgress(courseId);
  const modulesViewed = new Set(local.activity?.modules_viewed || []);
  if (moduleId) modulesViewed.add(moduleId);
  saveLocalTrainingProgress(courseId, {
    activity: {
      ...(local.activity || {}),
      ...activity,
      modules_viewed: [...modulesViewed],
    },
  });

  if (!isLiveTrainingApiEnabled()) return;
  try {
    await api.post(`/training/courses/${courseId}/activity`, {
      module_id: moduleId,
      section_id: sectionId,
    });
  } catch {
    /* ignore */
  }
}

export async function trySubmitQuiz(courseId, quizId, answers, scored) {
  saveLocalTrainingProgress(courseId, {
    quiz_results: {
      ...(loadLocalTrainingProgress(courseId).quiz_results || {}),
      [quizId]: {
        passed: scored.passed,
        score: scored.score,
        submitted_at: new Date().toISOString(),
        answers,
      },
    },
  });

  if (!isLiveTrainingApiEnabled()) return scored;

  try {
    const { data } = await api.post(`/training/courses/${courseId}/quizzes/${quizId}/submit`, {
      answers,
    });
    return data?.result || scored;
  } catch {
    return scored;
  }
}

export async function tryCompleteModule(courseId, moduleId) {
  const quizId = quizIdForModule(moduleId);
  const local = loadLocalTrainingProgress(courseId);
  if (!local.quiz_results?.[quizId]?.passed) {
    throw new Error("Quiz not passed");
  }

  const completed = new Set(local.completed_module_ids || []);
  completed.add(moduleId);
  saveLocalTrainingProgress(courseId, {
    completed_module_ids: [...completed],
  });

  if (!isLiveTrainingApiEnabled()) return;
  try {
    await api.post(`/training/courses/${courseId}/modules/${moduleId}/complete`);
  } catch {
    /* ignore */
  }
}
