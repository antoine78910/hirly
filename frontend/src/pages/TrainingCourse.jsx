import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Play } from "lucide-react";
import { api } from "../lib/api";
import { useTrainingLocale } from "../context/TrainingLocaleContext";
import { TrainingTopBar, useTrainingPageMode } from "../components/training/TrainingShell";
import ModuleDocView from "../components/training/ModuleDocView";
import { fetchTrainingCourseDetail } from "../lib/trainingData";
import {
  parseTrainingLocale,
  trainingHubPath,
  trainingModulePath,
} from "../lib/trainingRoutes";

function VideoPlayer({ url, t }) {
  if (!url) return null;

  const embed = url.includes("youtube.com/embed") || url.includes("youtu.be")
    ? url.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")
    : url;

  if (embed.includes("youtube.com/embed") || embed.includes("player.vimeo.com")) {
    return (
      <div className="overflow-hidden rounded-lg bg-zinc-900 shadow-lg ring-1 ring-zinc-700/50">
        <div className="relative aspect-video">
          <iframe
            title={t("videoTitle")}
            src={embed}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    );
  }

  return (
    <video src={url} controls className="aspect-video w-full rounded-lg bg-black ring-1 ring-zinc-700/50" />
  );
}

export default function TrainingCourse() {
  useTrainingPageMode();
  const { courseId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeLocale = parseTrainingLocale(location.pathname);
  const { lang, t } = useTrainingLocale();
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [data, setData] = useState(null);
  const [activeModuleId, setActiveModuleId] = useState(null);

  const hubPath = trainingHubPath(routeLocale);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await fetchTrainingCourseDetail(courseId, lang);
      if (!payload) {
        toast.error(t("courseNotFound"));
        navigate(hubPath, { replace: true });
        return;
      }
      setData(payload);
      const mods = payload.modules || [];
      const fromUrl = searchParams.get("module");
      const firstIncomplete = mods.find((m) => !m.completed);
      setActiveModuleId((prev) => {
        if (fromUrl && mods.some((m) => m.module_id === fromUrl)) return fromUrl;
        if (prev && mods.some((m) => m.module_id === prev)) return prev;
        return (firstIncomplete || mods[0])?.module_id || null;
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("courseNotFound"));
      navigate(hubPath, { replace: true });
    } finally {
      setLoading(false);
    }
  }, [courseId, hubPath, lang, navigate, searchParams, t]);

  useEffect(() => { load(); }, [load]);

  const modules = data?.modules || [];
  const enrollment = data?.enrollment || { enrolled: false };
  const activeModule = useMemo(
    () => modules.find((m) => m.module_id === activeModuleId) || modules[0],
    [modules, activeModuleId],
  );

  useEffect(() => {
    if (!activeModuleId || enrollment.enrolled || loading) return;
    api.post(`/training/courses/${courseId}/enroll`).then(() => load()).catch(() => {});
  }, [activeModuleId, courseId, enrollment.enrolled, load, loading]);

  useEffect(() => {
    if (!loading && data && !activeModule) {
      navigate(hubPath, { replace: true });
    }
  }, [loading, data, activeModule, hubPath, navigate]);

  const markComplete = async () => {
    if (!activeModule) return;
    setCompleting(true);
    try {
      await api.post(`/training/courses/${courseId}/modules/${activeModule.module_id}/complete`);
      await load();
      const idx = modules.findIndex((m) => m.module_id === activeModule.module_id);
      const next = modules[idx + 1];
      if (next) {
        setActiveModuleId(next.module_id);
        navigate(trainingModulePath(routeLocale, courseId, next.module_id), { replace: true });
      } else {
        toast.success(t("courseCompleted"));
        navigate(hubPath, { replace: true });
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("saveError"));
    } finally {
      setCompleting(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!activeModule) {
    return (
      <div className="grid min-h-dvh place-items-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <TrainingTopBar backTo={hubPath} />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="space-y-6">
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            {activeModule.title}
          </h1>

          <VideoPlayer url={activeModule.video_url} t={t} />

          {activeModule.content?.length ? (
            <ModuleDocView blocks={activeModule.content} />
          ) : activeModule.description ? (
            <p className="leading-relaxed text-zinc-700">{activeModule.description}</p>
          ) : null}

          <div className="border-t border-zinc-100 pt-6">
            <button
              type="button"
              onClick={markComplete}
              disabled={completing || activeModule.completed}
              className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {completing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : activeModule.completed ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  {t("completed")}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {t("markComplete")}
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
