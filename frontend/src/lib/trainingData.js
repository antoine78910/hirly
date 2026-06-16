import { api } from "./api";
import { getDemoTrainingCatalog, getDemoTrainingCourseDetail } from "./demoTrainingData";

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

/** Load catalog from API; fall back to bundled demo data if prod API/DB is empty. */
export async function fetchTrainingCatalog(lang) {
  try {
    const { data } = await api.get("/training/catalog", { params: { lang } });
    if (data?.courses?.length) return data;
  } catch {
    /* use fallback below */
  }
  return demoCatalog(lang);
}

/** Load course detail from API; fall back to bundled demo data. */
export async function fetchTrainingCourseDetail(courseId, lang) {
  try {
    const { data } = await api.get(`/training/courses/${courseId}`, { params: { lang } });
    if (data?.modules?.length) return data;
  } catch {
    /* use fallback below */
  }
  return getDemoTrainingCourseDetail(courseId, lang);
}
