import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTrainingLocale } from "../context/TrainingLocaleContext";
import TrainingShell, { useTrainingPageMode } from "../components/training/TrainingShell";
import ModuleGalleryCard from "../components/training/ModuleGalleryCard";
import TrainingCompletionFeedbackModal from "../components/training/TrainingCompletionFeedbackModal";
import { fetchTrainingCatalog, fetchTrainingCourseDetail } from "../lib/trainingData";
import { TRAINING_COURSE_ID } from "../lib/demoTrainingData";
import { SCORED_MODULE_IDS, courseProgressFraction } from "../lib/trainingProgress";
import {
  dismissTrainingCompletionFeedback,
  shouldShowTrainingCompletionFeedback,
} from "../lib/trainingCompletionFeedback";
import {
  parseTrainingLocale,
  trainingModulePath,
} from "../lib/trainingRoutes";

export default function Training() {
  useTrainingPageMode();
  const navigate = useNavigate();
  const location = useLocation();
  const routeLocale = parseTrainingLocale(location.pathname);
  const { lang, t } = useTrainingLocale();
  const { user, setIsTrainingCreator } = useAuth();
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState([]);
  const [catalogModules, setCatalogModules] = useState([]);
  const [enrollment, setEnrollment] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTrainingCatalog(lang);
      const courses = data.courses || [];
      setCatalog(courses);
      if (data.is_training_creator) setIsTrainingCreator(true);

      const firstCourseId = courses[0]?.course_id || TRAINING_COURSE_ID;
      const detail = await fetchTrainingCourseDetail(firstCourseId, lang);
      setCatalogModules(detail?.modules?.length ? detail.modules : []);
      setEnrollment(detail?.enrollment || null);
    } catch (e) {
      const fallback = await fetchTrainingCourseDetail(TRAINING_COURSE_ID, lang);
      setCatalog([{ course_id: TRAINING_COURSE_ID }]);
      setCatalogModules(fallback?.modules || []);
      setEnrollment(fallback?.enrollment || null);
      if (!fallback?.modules?.length) {
        toast.error(e?.response?.data?.detail || t("loadError"));
      }
    } finally {
      setLoading(false);
    }
  }, [lang, setIsTrainingCreator, t]);

  useEffect(() => { load(); }, [load]);

  const featured = catalog[0];
  const courseId = featured?.course_id || TRAINING_COURSE_ID;
  const progressPct = useMemo(
    () => Math.round(courseProgressFraction(courseId, catalogModules, enrollment) * 100),
    [courseId, catalogModules, enrollment],
  );
  const scoredComplete = useMemo(() => {
    const scored = catalogModules.filter((m) => SCORED_MODULE_IDS.includes(m.module_id));
    if (!scored.length) return false;
    return scored.every((m) => m.completed);
  }, [catalogModules]);

  useEffect(() => {
    if (!user?.user_id || loading) return;
    if (progressPct < 100 && !scoredComplete) return;
    if (shouldShowTrainingCompletionFeedback(courseId, user.user_id)) {
      setFeedbackOpen(true);
    }
  }, [user?.user_id, loading, progressPct, scoredComplete, courseId]);

  const handleFeedbackDismiss = ({ submitted = false } = {}) => {
    dismissTrainingCompletionFeedback(courseId, user?.user_id, { submitted });
    setFeedbackOpen(false);
  };
  const completedCount = catalogModules.filter((m) => m.completed).length;

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <TrainingShell showSidebar={false}>
      <TrainingCompletionFeedbackModal
        open={feedbackOpen}
        courseId={courseId}
        onDismiss={handleFeedbackDismiss}
        onSubmitted={() => handleFeedbackDismiss({ submitted: true })}
      />
      {featured && catalogModules.length > 0 ? (
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
                  {t("hubTitle")}
                </h1>
                <p className="mt-1 text-sm text-zinc-500">{t("hubSubtitle")}</p>
              </div>
              <div className="w-full shrink-0 sm:max-w-[16rem]">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-700">
                  <span>{t("yourProgress")}</span>
                  <span className="text-violet-600">{progressPct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 via-violet-400 to-indigo-400 transition-[width] duration-700 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {completedCount}/{catalogModules.length} {t("lessons")}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 md:gap-4">
              {catalogModules.map((mod, index) => (
                <ModuleGalleryCard
                  key={mod.module_id}
                  module={mod}
                  index={index}
                  active={index === 0}
                  locked={false}
                  size="hub"
                  onSelect={() => {
                    const firstSection = mod.sections?.[0]?.section_id;
                    navigate(trainingModulePath(routeLocale, courseId, mod.module_id, firstSection));
                  }}
                  t={t}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center sm:px-8">
          <p className="text-sm text-zinc-500">{t("noCourses")}</p>
          <button
            type="button"
            onClick={load}
            className="mt-4 rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Retry
          </button>
        </section>
      )}
    </TrainingShell>
  );
}
