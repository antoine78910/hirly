import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, LayoutDashboard, PlayCircle } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useTrainingLocale } from "../context/TrainingLocaleContext";
import TrainingShell, { TrainingHero, useTrainingPageMode } from "../components/training/TrainingShell";
import ModuleGalleryCard from "../components/training/ModuleGalleryCard";
import { fetchTrainingCatalog, fetchTrainingCourseDetail } from "../lib/trainingData";
import { TRAINING_COURSE_ID } from "../lib/demoTrainingData";
import {
  parseTrainingLocale,
  trainingModulePath,
  trainingPath,
} from "../lib/trainingRoutes";

export default function Training() {
  useTrainingPageMode();
  const navigate = useNavigate();
  const location = useLocation();
  const routeLocale = parseTrainingLocale(location.pathname);
  const { lang, t } = useTrainingLocale();
  const { isTrainingCreator, setIsTrainingCreator } = useAuth();
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState([]);
  const [catalogModules, setCatalogModules] = useState([]);
  const [registering, setRegistering] = useState(false);

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
    } catch (e) {
      const fallback = await fetchTrainingCourseDetail(TRAINING_COURSE_ID, lang);
      setCatalog([{ course_id: TRAINING_COURSE_ID }]);
      setCatalogModules(fallback?.modules || []);
      if (!fallback?.modules?.length) {
        toast.error(e?.response?.data?.detail || t("loadError"));
      }
    } finally {
      setLoading(false);
    }
  }, [lang, setIsTrainingCreator, t]);

  useEffect(() => { load(); }, [load]);

  const becomeCreator = async () => {
    setRegistering(true);
    try {
      await api.post("/training/creator/register", {});
      setIsTrainingCreator(true);
      toast.success(t("creatorUnlocked"));
      navigate(trainingPath(routeLocale || lang, "creator"));
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("creatorError"));
    } finally {
      setRegistering(false);
    }
  };

  const headerActions = isTrainingCreator ? (
    <button
      type="button"
      onClick={() => navigate(trainingPath(routeLocale || lang, "creator"))}
      className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
    >
      <LayoutDashboard className="h-4 w-4" />
      <span className="hidden sm:inline">{t("creatorStudio")}</span>
    </button>
  ) : (
    <button
      type="button"
      onClick={becomeCreator}
      disabled={registering}
      className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-50"
    >
      {registering ? "…" : t("becomeCreator")}
    </button>
  );

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  const featured = catalog[0];

  return (
    <TrainingShell
      isCreator={isTrainingCreator}
      showSidebar={false}
      actions={headerActions}
      hero={(
        <TrainingHero
          title={t("hubTitle")}
          subtitle={t("hubSubtitle")}
          hint={t("scrollHint")}
        />
      )}
    >
      {featured && catalogModules.length > 0 ? (
        <section className="border-b border-zinc-200/80 bg-white px-4 py-8 sm:px-8 sm:py-10">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm leading-relaxed text-zinc-500 sm:text-base">
              {t("modulesHint")}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700">
                <PlayCircle className="h-4 w-4" />
                {t("courseModules")}
              </span>
              <span className="text-xs text-zinc-500">
                {catalogModules.filter((m) => m.completed).length}/{catalogModules.length} {t("lessons")}
              </span>
            </div>
            <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {catalogModules.map((mod, index) => (
                  <ModuleGalleryCard
                    key={mod.module_id}
                    module={mod}
                    index={index}
                    active={index === 0}
                    locked={false}
                    onSelect={() => {
                      const courseId = featured.course_id || TRAINING_COURSE_ID;
                      const firstSection = mod.sections?.[0]?.section_id;
                      navigate(trainingModulePath(routeLocale, courseId, mod.module_id, firstSection));
                    }}
                    t={t}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="px-4 py-12 text-center sm:px-8">
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
