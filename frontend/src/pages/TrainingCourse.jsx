import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Loader2, Play } from "lucide-react";
import { resolveApiAssetUrl } from "../lib/api";
import { useTrainingLocale } from "../context/TrainingLocaleContext";
import { TrainingTopBar, useTrainingPageMode } from "../components/training/TrainingShell";
import ModuleDocView from "../components/training/ModuleDocView";
import ModuleSectionNav from "../components/training/ModuleSectionNav";
import TrainingSectionBadge from "../components/training/TrainingSectionBadge";
import ModuleQuiz from "../components/training/ModuleQuiz";
import TrainingModuleStepper from "../components/training/TrainingModuleStepper";
import ScrollToContinueHint from "../components/training/ScrollToContinueHint";
import {
  SCORED_MODULE_IDS,
  courseProgressFraction,
  saveProgressEvent,
} from "../lib/trainingProgress";
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

const SECTION_SIDEBAR_MODULE_IDS = new Set(["mod_content_bank"]);

function bunnyEmbedUrl(resolvedUrl) {
  const playMatch = resolvedUrl.match(/mediadelivery\.net\/play\/(\d+)\/([a-f0-9-]+)/i);
  const embedMatch = resolvedUrl.match(/mediadelivery\.net\/embed\/(\d+)\/([a-f0-9-]+)/i);
  const ids = playMatch || embedMatch;
  if (!ids) return null;
  const url = new URL(`https://iframe.mediadelivery.net/embed/${ids[1]}/${ids[2]}`);
  url.searchParams.set("playerjs", "true");
  return url.toString();
}

function BunnyVideoIframe({ embedUrl, title, onVideoEnded }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !onVideoEnded) return undefined;

    let player = null;
    let cancelled = false;

    const attach = () => {
      if (cancelled || !iframeRef.current || !window.playerjs?.Player) return;
      player = new window.playerjs.Player(iframeRef.current);
      player.on("ended", onVideoEnded);
    };

    if (window.playerjs?.Player) {
      attach();
    } else {
      const existing = document.querySelector('script[data-bunny-playerjs="true"]');
      if (existing) {
        existing.addEventListener("load", attach);
      } else {
        const script = document.createElement("script");
        script.src = "https://assets.mediadelivery.net/playerjs/playerjs-latest.min.js";
        script.dataset.bunnyPlayerjs = "true";
        script.onload = attach;
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
    };
  }, [embedUrl, onVideoEnded]);

  return (
    <div className="overflow-hidden rounded-lg bg-zinc-900 shadow-lg ring-1 ring-zinc-700/50">
      <div className="relative aspect-video">
        <iframe
          ref={iframeRef}
          title={title}
          src={embedUrl}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}

function VideoBlock({ url, t, onVideoEnded }) {
  const resolvedUrl = resolveApiAssetUrl(url);
  const handleEnded = () => {
    onVideoEnded?.();
  };

  if (resolvedUrl) {
    const bunnyEmbed = bunnyEmbedUrl(resolvedUrl);
    if (bunnyEmbed) {
      return (
        <BunnyVideoIframe
          embedUrl={bunnyEmbed}
          title={t("videoTitle")}
          onVideoEnded={onVideoEnded}
        />
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
      <video
        src={embed}
        controls
        onEnded={handleEnded}
        className="aspect-video w-full rounded-lg bg-black ring-1 ring-zinc-700/50"
      />
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
  const [progressTick, setProgressTick] = useState(0);
  const [showScrollHint, setShowScrollHint] = useState(false);
  const [celebrateModuleId, setCelebrateModuleId] = useState(null);

  // Refs for progress observation
  const videoContainerRef = useRef(null);
  const scrollSentinelRef = useRef(null);
  const videoTimerRef = useRef(null);

  const hubPath = trainingHubPath(routeLocale);
  const moduleParam = searchParams.get("module");
  const sectionParam = searchParams.get("section");

  const recordEvent = useCallback(
    (moduleId, eventKey) => {
      const isNew = saveProgressEvent(courseId, moduleId, eventKey);
      if (isNew) setProgressTick((n) => n + 1);
    },
    [courseId],
  );

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

  const goToModule = (moduleId) => {
    const mod = modules.find((m) => m.module_id === moduleId);
    if (!mod) return;
    const firstSection = mod.sections?.[0]?.section_id;
    navigate(trainingModulePath(routeLocale, courseId, moduleId, firstSection), { replace: true });
  };

  const handleVideoEnded = useCallback(() => {
    setShowScrollHint(true);
  }, []);

  // Reset scroll hint when changing section/module
  useEffect(() => {
    setShowScrollHint(false);
  }, [activeModuleId, sectionParam]);

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

  // Record "visited" when a module is opened
  useEffect(() => {
    if (!activeModuleId || loading) return;
    recordEvent(activeModuleId, "visited");
  }, [activeModuleId, loading, recordEvent]);

  // Record "section_X" when a section tab is opened
  useEffect(() => {
    if (!activeModuleId || !sectionParam || loading) return;
    recordEvent(activeModuleId, `section_${sectionParam}`);
  }, [activeModuleId, sectionParam, loading, recordEvent]);

  // Reset video timer on section/module change
  useEffect(() => {
    return () => clearTimeout(videoTimerRef.current);
  }, [activeModuleId, sectionParam]);

  // Video watcher: if the video container is visible for 4 s → record "video"
  useEffect(() => {
    const el = videoContainerRef.current;
    if (!el || !activeModuleId || loading) return;

    let timer = null;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => {
            recordEvent(activeModuleId, "video");
          }, 4000);
          videoTimerRef.current = timer;
        } else {
          clearTimeout(timer);
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
      clearTimeout(timer);
    };
  }, [activeModuleId, sectionParam, loading, recordEvent]);

  // Scroll sentinel: record "scrolled" when user reaches the bottom of the content
  useEffect(() => {
    const el = scrollSentinelRef.current;
    if (!el || !activeModuleId || loading) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          recordEvent(activeModuleId, "scrolled");
          setShowScrollHint(false);
          obs.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [activeModuleId, sectionParam, loading, recordEvent]);

  // Re-tick when quiz passes so the progress bar reflects it immediately
  useEffect(() => {
    if (quizPassed) setProgressTick((n) => n + 1);
  }, [quizPassed]);

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
        setProgressTick((n) => n + 1);
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            enrollment: {
              ...prev.enrollment,
              quiz_results: {
                ...(prev.enrollment?.quiz_results || {}),
                [quizId]: {
                  passed: true,
                  score: result.score,
                },
              },
            },
          };
        });
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
    const completedId = activeModule.module_id;
    try {
      await tryCompleteModule(courseId, completedId);
      setCelebrateModuleId(completedId);
      await load();
      const idx = modules.findIndex((m) => m.module_id === completedId);
      const next = modules[idx + 1];
      if (next) {
        setTimeout(() => {
          setCelebrateModuleId(null);
          setActiveModuleId(next.module_id);
          const nextSections = next.sections || [];
          const nextSection = nextSections[0]?.section_id;
          navigate(trainingModulePath(routeLocale, courseId, next.module_id, nextSection), { replace: true });
          setCompleting(false);
        }, 900);
      } else {
        toast.success(t("courseCompleted"));
        setTimeout(() => {
          navigate(hubPath, { replace: true });
          setCompleting(false);
        }, 1200);
      }
    } catch (e) {
      toast.error(e?.message || e?.response?.data?.detail || t("saveError"));
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

  const overallProgressPct = Math.round(
    courseProgressFraction(courseId, modules, data?.enrollment) * 100,
  );

  const scoredModules = modules.filter((m) =>
    SCORED_MODULE_IDS.includes(m.module_id),
  );

  const moduleStepper = scoredModules.length > 0 ? (
    <TrainingModuleStepper
      modules={scoredModules}
      activeModuleId={activeModuleId}
      courseId={courseId}
      enrollment={data?.enrollment}
      lang={lang}
      progressTick={progressTick}
      celebrateModuleId={celebrateModuleId}
      onModuleSelect={goToModule}
    />
  ) : null;

  const hasVideo = Boolean(showPresentationVideoAtTop || displayVideoUrl);
  const useSectionSidebar = SECTION_SIDEBAR_MODULE_IDS.has(activeModule?.module_id);

  const sectionBody = (
    <>
      {hasSections && activeSection ? (
        <div className="relative">
          {activeSection.badge ? (
            <TrainingSectionBadge
              label={activeSection.badge}
              className="absolute right-0 top-0"
            />
          ) : null}
          <h2 className={`text-lg font-semibold text-zinc-800 ${activeSection.badge ? "pr-28" : ""}`}>
            {activeSection.title}
          </h2>
        </div>
      ) : null}

      {!showPresentationVideoAtTop && displayVideoUrl ? (
        <div>
          <div ref={videoContainerRef}>
            <VideoBlock url={displayVideoUrl} t={t} onVideoEnded={handleVideoEnded} />
          </div>
          <ScrollToContinueHint visible={showScrollHint && hasVideo} lang={lang} />
        </div>
      ) : null}

      {displayContent?.length ? (
        <ModuleDocView blocks={displayContent} lang={lang} />
      ) : !hasSections && activeModule?.description ? (
        <p className="leading-relaxed text-zinc-700">{activeModule.description}</p>
      ) : null}

      {activeSection?.resources?.length ? (
        <section className="space-y-4 border-t border-zinc-100 pt-8">
          <h3 className="text-lg font-semibold text-zinc-900">
            Ressources
          </h3>
          <ModuleDocView blocks={activeSection.resources} lang={lang} />
        </section>
      ) : null}

      <div ref={scrollSentinelRef} aria-hidden className="h-px" />

      {atChapterEnd && moduleQuiz ? (
        <ModuleQuiz
          quiz={moduleQuiz}
          lang={lang}
          initialPassed={quizPassed}
          submitting={quizSubmitting}
          continuing={completing}
          onSubmit={handleQuizSubmit}
          onContinue={markComplete}
        />
      ) : null}

      <div className="border-t border-zinc-100 pt-6">
        {!(atChapterEnd && moduleQuiz && quizPassed) ? (
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
            ) : activeModule?.completed ? (
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
        ) : null}
        {atChapterEnd && !quizPassed && !activeModule?.completed ? (
          <p className="mt-2 text-sm text-amber-700">{t("quizRequired")}</p>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      <TrainingTopBar
        backTo={hubPath}
        progressPct={overallProgressPct}
        moduleStepper={moduleStepper}
      />

      <main
        className={`mx-auto px-4 py-8 sm:px-8 sm:py-10 ${
          useSectionSidebar ? "max-w-6xl" : "max-w-3xl"
        }`}
      >
        <div className="space-y-6">
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            {activeModule.title}
          </h1>

          {showPresentationVideoAtTop ? (
            <section className="space-y-2" data-testid="training-presentation-video">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Vidéo de présentation
              </p>
              <div ref={videoContainerRef}>
                <VideoBlock url={activeSection?.video_url || ""} t={t} onVideoEnded={handleVideoEnded} />
              </div>
              <ScrollToContinueHint visible={showScrollHint && hasVideo} lang={lang} />
            </section>
          ) : null}

          {hasSections && useSectionSidebar ? (
            <div className="flex items-start gap-4 sm:gap-6">
              <ModuleSectionNav
                variant="sidebar"
                sections={sections}
                activeSectionId={activeSection?.section_id}
                onSelect={selectSection}
              />
              <div className="min-w-0 flex-1 space-y-6">{sectionBody}</div>
            </div>
          ) : (
            <>
              {hasSections ? (
                <ModuleSectionNav
                  sections={sections}
                  activeSectionId={activeSection?.section_id}
                  onSelect={selectSection}
                />
              ) : null}
              {sectionBody}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
