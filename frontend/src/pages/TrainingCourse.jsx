import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Loader2, Play } from "lucide-react";
import { resolveApiAssetUrl } from "../lib/api";
import { useTrainingLocale } from "../context/TrainingLocaleContext";
import { TrainingTopBar, useTrainingPageMode } from "../components/training/TrainingShell";
import ModuleDocView from "../components/training/ModuleDocView";
import ModuleSectionNav from "../components/training/ModuleSectionNav";
import ModuleQuiz from "../components/training/ModuleQuiz";
import {
  fetchTrainingCourseDetail,
  isQuizPassed,
  tryCompleteModule,
  tryEnrollCourse,
  trySubmitQuiz,
  tryTrackTrainingActivity,
} from "../lib/trainingData";
import { quizForModule } from "../lib/trainingQuizzes";
import {
  parseTrainingLocale,
  trainingHubPath,
  trainingModulePath,
} from "../lib/trainingRoutes";

function VideoBlock({ url, t }) {
  const resolvedUrl = resolveApiAssetUrl(url);
  if (resolvedUrl) {
    const bunnyMatch = resolvedUrl.match(/mediadelivery\.net\/play\/(\d+)\/([a-f0-9-]+)/i);
    if (bunnyMatch) {
      const embed = `https://iframe.mediadelivery.net/embed/${bunnyMatch[1]}/${bunnyMatch[2]}`;
      return (
        <div className="overflow-hidden rounded-lg bg-zinc-900 shadow-lg ring-1 ring-zinc-700/50">
          <div className="relative aspect-video">
            <iframe
              title={t("videoTitle")}
              src={embed}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      );
    }

    const embed = resolvedUrl.includes("youtube.com/embed") || resolvedUrl.includes("youtu.be")
      ? resolvedUrl.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")
      : resolvedUrl;

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
      <video src={embed} controls className="aspect-video w-full rounded-lg bg-black ring-1 ring-zinc-700/50" />
    );
  }

  return (
    <div className="flex aspect-video items-center justify-center rounded-lg bg-zinc-900 text-sm text-zinc-400">
      {t("videoSoon")}
    </div>
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
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [data, setData] = useState(null);
  const [activeModuleId, setActiveModuleId] = useState(null);
  const [quizPassed, setQuizPassed] = useState(false);

  const hubPath = trainingHubPath(routeLocale);
  const moduleParam = searchParams.get("module");
  const sectionParam = searchParams.get("section");

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
      const firstIncomplete = mods.find((m) => !m.completed);
      setActiveModuleId((prev) => {
        if (moduleParam && mods.some((m) => m.module_id === moduleParam)) return moduleParam;
        if (prev && mods.some((m) => m.module_id === prev)) return prev;
        return (firstIncomplete || mods[0])?.module_id || null;
      });
    } catch (e) {
      toast.error(e?.response?.data?.detail || t("courseNotFound"));
      navigate(hubPath, { replace: true });
    } finally {
      setLoading(false);
    }
  }, [courseId, hubPath, lang, moduleParam, navigate, t]);

  useEffect(() => { load(); }, [load]);

  const modules = data?.modules || [];
  const activeModule = useMemo(
    () => modules.find((m) => m.module_id === activeModuleId) || modules[0],
    [modules, activeModuleId],
  );

  const sections = activeModule?.sections || [];
  const hasSections = sections.length > 0;

  const activeSection = useMemo(() => {
    if (!hasSections) return null;
    if (sectionParam && sections.some((s) => s.section_id === sectionParam)) {
      return sections.find((s) => s.section_id === sectionParam);
    }
    return sections[0];
  }, [hasSections, sectionParam, sections]);

  const moduleQuiz = useMemo(
    () => (activeModule ? quizForModule(activeModule.module_id, lang) : null),
    [activeModule, lang],
  );

  useEffect(() => {
    if (!activeModule?.module_id || !moduleQuiz) {
      setQuizPassed(false);
      return;
    }
    setQuizPassed(isQuizPassed(data?.enrollment, moduleQuiz.quiz_id, courseId));
  }, [activeModule?.module_id, moduleQuiz, data?.enrollment, courseId]);

  useEffect(() => {
    if (!hasSections || !activeModule || !activeSection) return;
    if (sectionParam === activeSection.section_id) return;
    navigate(
      trainingModulePath(routeLocale, courseId, activeModule.module_id, activeSection.section_id),
      { replace: true },
    );
  }, [
    activeModule,
    activeSection,
    courseId,
    hasSections,
    navigate,
    routeLocale,
    sectionParam,
  ]);

  const activeSectionIndex = hasSections
    ? sections.findIndex((s) => s.section_id === activeSection?.section_id)
    : -1;
  const hasNextSection = hasSections && activeSectionIndex >= 0 && activeSectionIndex < sections.length - 1;
  const atChapterEnd = !hasNextSection;

  useEffect(() => {
    if (!activeModuleId || loading) return;
    tryEnrollCourse(courseId);
  }, [activeModuleId, courseId, loading]);

  useEffect(() => {
    if (!activeModuleId || loading) return;
    tryTrackTrainingActivity(
      courseId,
      activeModuleId,
      hasSections ? activeSection?.section_id : null,
    );
  }, [activeModuleId, activeSection?.section_id, courseId, hasSections, loading]);

  useEffect(() => {
    if (!loading && data && !activeModule) {
      navigate(hubPath, { replace: true });
    }
  }, [loading, data, activeModule, hubPath, navigate]);

  const displayVideoUrl = hasSections
    ? activeSection?.video_url
    : activeModule?.video_url;

  const isCreatingContentModule = activeModule?.module_id === "mod_creating_content";
  const showPresentationVideoAtTop = hasSections && isCreatingContentModule;

  const displayContent = hasSections
    ? activeSection?.content
    : activeModule?.content;

  const selectSection = (sectionId) => {
    navigate(trainingModulePath(routeLocale, courseId, activeModule.module_id, sectionId), { replace: true });
  };

  const goToNextSection = () => {
    if (!hasNextSection) return;
    const nextSection = sections[activeSectionIndex + 1];
    navigate(
      trainingModulePath(routeLocale, courseId, activeModule.module_id, nextSection.section_id),
      { replace: true },
    );
  };

  useLayoutEffect(() => {
    if (loading) return;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [loading, activeModuleId, sectionParam]);

  const handleQuizSubmit = async (quizId, answers, scored) => {
    setQuizSubmitting(true);
    try {
      const result = await trySubmitQuiz(courseId, quizId, answers, scored);
      if (result?.passed) {
        setQuizPassed(true);
        await load();
      }
      return result;
    } finally {
      setQuizSubmitting(false);
    }
  };

  const markComplete = async () => {
    if (!activeModule) return;
    if (hasNextSection) {
      goToNextSection();
      return;
    }
    if (!quizPassed) {
      toast.error(t("quizRequired"));
      return;
    }
    setCompleting(true);
    try {
      await tryCompleteModule(courseId, activeModule.module_id);
      await load();
      const idx = modules.findIndex((m) => m.module_id === activeModule.module_id);
      const next = modules[idx + 1];
      if (next) {
        setActiveModuleId(next.module_id);
        const nextSections = next.sections || [];
        const nextSection = nextSections[0]?.section_id;
        navigate(trainingModulePath(routeLocale, courseId, next.module_id, nextSection), { replace: true });
      } else {
        toast.success(t("courseCompleted"));
        navigate(hubPath, { replace: true });
      }
    } catch (e) {
      toast.error(e?.message || e?.response?.data?.detail || t("saveError"));
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

  const canComplete = atChapterEnd && (quizPassed || activeModule.completed);

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <TrainingTopBar backTo={hubPath} />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="space-y-6">
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            {activeModule.title}
          </h1>

          {showPresentationVideoAtTop ? (
            <section className="space-y-2" data-testid="training-presentation-video">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {lang === "fr" ? "Vidéo de présentation" : "Presentation video"}
              </p>
              <VideoBlock url={activeSection?.video_url || ""} t={t} />
            </section>
          ) : null}

          {hasSections ? (
            <ModuleSectionNav
              sections={sections}
              activeSectionId={activeSection?.section_id}
              onSelect={selectSection}
            />
          ) : null}

          {hasSections && activeSection ? (
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-zinc-800">{activeSection.title}</h2>
              {activeSection.badge ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
                  {activeSection.badge}
                </span>
              ) : null}
            </div>
          ) : null}

          {!showPresentationVideoAtTop && displayVideoUrl ? (
            <VideoBlock url={displayVideoUrl} t={t} />
          ) : null}

          {displayContent?.length ? (
            <ModuleDocView blocks={displayContent} lang={lang} />
          ) : !hasSections && activeModule.description ? (
            <p className="leading-relaxed text-zinc-700">{activeModule.description}</p>
          ) : null}

          {activeSection?.resources?.length ? (
            <section className="space-y-4 border-t border-zinc-100 pt-8">
              <h3 className="text-lg font-semibold text-zinc-900">
                {lang === "fr" ? "Ressources" : "Resources"}
              </h3>
              <ModuleDocView blocks={activeSection.resources} lang={lang} />
            </section>
          ) : null}

          {atChapterEnd && moduleQuiz ? (
            <ModuleQuiz
              quiz={moduleQuiz}
              lang={lang}
              initialPassed={quizPassed}
              submitting={quizSubmitting}
              onSubmit={handleQuizSubmit}
            />
          ) : null}

          <div className="border-t border-zinc-100 pt-6">
            <button
              type="button"
              onClick={markComplete}
              disabled={completing || (atChapterEnd && !canComplete && !hasNextSection)}
              className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {completing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : hasNextSection ? (
                <>
                  {t("next")}
                  <ChevronRight className="h-4 w-4" />
                </>
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
            {atChapterEnd && !quizPassed && !activeModule.completed ? (
              <p className="mt-2 text-sm text-amber-700">{t("quizRequired")}</p>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
