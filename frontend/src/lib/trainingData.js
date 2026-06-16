import { api } from "./api";
import {
  TRAINING_COURSE_ID,
  getDemoTrainingCatalog,
  getDemoTrainingCourseDetail,
} from "./demoTrainingData";

/** Set REACT_APP_TRAINING_API=true when the live training backend is ready. */
function useLiveTrainingApi() {
  return process.env.REACT_APP_TRAINING_API === "true";
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
    return {
      ...base,
      ...fromApi,
      title: fromApi.title || base.title,
      description: fromApi.description || base.description,
      content: fromApi.content?.length ? fromApi.content : base.content,
      sections: fromApi.sections?.length ? fromApi.sections : base.sections,
      video_url: fromApi.video_url || base.video_url,
    };
  });
}

/** Load catalog — static bundled data by default (no backend required). */
export async function fetchTrainingCatalog(lang) {
  const staticData = demoCatalog(lang);
  if (!useLiveTrainingApi()) return staticData;

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
  if (!useLiveTrainingApi()) return staticData;

  const id = courseId || TRAINING_COURSE_ID;
  try {
    const { data } = await api.get(`/training/courses/${id}`, { params: { lang } });
    if (data) {
      return {
        ...staticData,
        ...data,
        course: { ...staticData.course, ...data.course },
        modules: mergeModules(data.modules, staticData.modules),
        enrollment: data.enrollment || staticData.enrollment,
      };
    }
  } catch {
    /* static fallback */
  }
  return staticData;
}

/** Best-effort API calls — never block UX when backend is unavailable. */
export async function tryEnrollCourse(courseId) {
  if (!useLiveTrainingApi()) return;
  try {
    await api.post(`/training/courses/${courseId}/enroll`);
  } catch {
    /* ignore */
  }
}

export async function tryCompleteModule(courseId, moduleId) {
  if (!useLiveTrainingApi()) return;
  try {
    await api.post(`/training/courses/${courseId}/modules/${moduleId}/complete`);
  } catch {
    /* ignore */
  }
}
