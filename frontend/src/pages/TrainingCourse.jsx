import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, CheckCircle2, Circle, Loader2, Play, Lock,
} from "lucide-react";
import { api } from "../lib/api";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import { Progress } from "../components/ui/progress";

function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m} min`;
}

function VideoPlayer({ url }) {
  if (!url) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl bg-zinc-900 text-sm text-sprout-muted">
        Video coming soon
      </div>
    );
  }
  const embed = url.includes("youtube.com/embed") || url.includes("youtu.be")
    ? url.replace("watch?v=", "embed/").replace("youtu.be/", "youtube.com/embed/")
    : url;

  if (embed.includes("youtube.com/embed") || embed.includes("player.vimeo.com")) {
    return (
      <div className="overflow-hidden rounded-2xl border border-sprout-border bg-black shadow-[0_12px_40px_-16px_rgba(124,58,237,0.45)]">
        <div className="relative aspect-video">
          <iframe
            title="Course video"
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
      src={url}
      controls
      className="aspect-video w-full rounded-2xl border border-sprout-border bg-black"
    />
  );
}

export default function TrainingCourse() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [data, setData] = useState(null);
  const [activeModuleId, setActiveModuleId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await api.get(`/training/courses/${courseId}`);
      setData(payload);
      const modules = payload.modules || [];
      const firstIncomplete = modules.find((m) => !m.completed);
      setActiveModuleId((firstIncomplete || modules[0])?.module_id || null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Course not found");
      navigate("/training", { replace: true });
    } finally {
      setLoading(false);
    }
  }, [courseId, navigate]);

  useEffect(() => { load(); }, [load]);

  const modules = data?.modules || [];
  const enrollment = data?.enrollment || {};
  const progress = enrollment.progress_percent || 0;
  const activeModule = useMemo(
    () => modules.find((m) => m.module_id === activeModuleId) || modules[0],
    [modules, activeModuleId],
  );

  const ensureEnrolled = async () => {
    if (enrollment.enrolled) return true;
    setEnrolling(true);
    try {
      await api.post(`/training/courses/${courseId}/enroll`);
      await load();
      return true;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not enroll");
      return false;
    } finally {
      setEnrolling(false);
    }
  };

  const selectModule = async (module) => {
    const ok = await ensureEnrolled();
    if (!ok) return;
    setActiveModuleId(module.module_id);
  };

  const markComplete = async () => {
    if (!activeModule) return;
    setCompleting(true);
    try {
      await api.post(`/training/courses/${courseId}/modules/${activeModule.module_id}/complete`);
      await load();
      const idx = modules.findIndex((m) => m.module_id === activeModule.module_id);
      const next = modules[idx + 1];
      if (next) setActiveModuleId(next.module_id);
      else toast.success("Course completed!");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save progress");
    } finally {
      setCompleting(false);
    }
  };

  if (loading || !data) {
    return (
      <AppPage className="sprout grid place-items-center bg-sprout-bg">
        <Loader2 className="h-5 w-5 animate-spin text-sprout-muted" />
      </AppPage>
    );
  }

  const { course, creator } = data;

  return (
    <AppPage className="sprout bg-sprout-bg text-white">
      <header className="mx-auto w-full max-w-md shrink-0 px-5 pt-6">
        <button
          type="button"
          onClick={() => navigate("/training")}
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-full hover:bg-sprout-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-2xl font-bold leading-tight">{course.title}</h1>
        {course.subtitle ? <p className="mt-1 text-sm text-sprout-muted">{course.subtitle}</p> : null}
        {creator?.display_name ? (
          <p className="mt-2 text-xs text-violet-300">By {creator.display_name}</p>
        ) : null}

        <div className="mt-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-sprout-muted">Course progress</span>
            <span className="font-bold text-violet-200">{progress}%</span>
          </div>
          <Progress
            value={progress}
            className="h-2 bg-violet-500/15 [&>div]:bg-gradient-to-r [&>div]:from-violet-500 [&>div]:to-fuchsia-400 [&>div]:transition-all [&>div]:duration-700"
          />
          <p className="mt-2 text-xs text-sprout-muted">
            {modules.filter((m) => m.completed).length} of {modules.length} modules completed
          </p>
        </div>
      </header>

      <AppPageScroll className="mx-auto max-w-md px-5">
        <div className="mt-5 pb-6">
          {activeModule ? (
            <>
              <VideoPlayer url={activeModule.video_url} />
              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold">{activeModule.title}</h2>
                  {activeModule.description ? (
                    <p className="mt-1 text-sm text-sprout-muted">{activeModule.description}</p>
                  ) : null}
                  {activeModule.duration_seconds ? (
                    <p className="mt-2 text-xs text-violet-300/80">
                      {formatDuration(activeModule.duration_seconds)}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={markComplete}
                disabled={completing || activeModule.completed}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-900/30 disabled:opacity-60"
              >
                {completing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : activeModule.completed ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Completed
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Mark as complete
                  </>
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={ensureEnrolled}
              disabled={enrolling}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3.5 font-semibold"
            >
              {enrolling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start course
            </button>
          )}

          <section className="mt-8">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-sprout-muted">Modules</h3>
            <div className="mt-3 space-y-2">
              {modules.map((mod, index) => {
                const active = mod.module_id === activeModuleId;
                const locked = !enrollment.enrolled && index > 0;
                return (
                  <button
                    key={mod.module_id}
                    type="button"
                    onClick={() => !locked && selectModule(mod)}
                    disabled={locked}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                      active
                        ? "border-violet-500/50 bg-violet-500/10"
                        : "border-sprout-border bg-sprout-surface hover:border-violet-500/30"
                    } ${locked ? "opacity-50" : ""}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold">
                      {mod.completed ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : locked ? (
                        <Lock className="h-3.5 w-3.5 text-sprout-muted" />
                      ) : (
                        <Circle className="h-4 w-4 text-violet-400" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{mod.title}</span>
                      <span className="text-xs text-sprout-muted">
                        {formatDuration(mod.duration_seconds) || `Module ${index + 1}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </AppPageScroll>
    </AppPage>
  );
}
