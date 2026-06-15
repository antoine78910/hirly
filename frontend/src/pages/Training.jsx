import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  GraduationCap, PlayCircle, Loader2, Sparkles, ChevronRight, LayoutDashboard,
} from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { AppPage, AppPageScroll } from "../components/app/AppPageShell";
import { Progress } from "../components/ui/progress";

function CourseCard({ course, progress, onClick }) {
  const pct = progress ?? course.progress_percent;
  const enrolled = pct != null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full overflow-hidden rounded-2xl border border-sprout-border bg-sprout-surface text-left transition-all hover:border-violet-500/40 hover:shadow-[0_8px_32px_-12px_rgba(124,58,237,0.35)]"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-violet-950/80 via-zinc-900 to-zinc-950">
        {course.thumbnail_url ? (
          <img
            src={course.thumbnail_url}
            alt=""
            className="h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
            {course.level || "Course"}
          </span>
          <span className="text-xs text-white/80">{course.module_count || 0} modules</span>
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-display text-lg font-bold text-white">{course.title}</h3>
        {course.subtitle ? (
          <p className="mt-1 line-clamp-2 text-sm text-sprout-muted">{course.subtitle}</p>
        ) : null}
        {enrolled ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-sprout-muted">Your progress</span>
              <span className="font-semibold text-violet-300">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5 bg-violet-500/20 [&>div]:bg-gradient-to-r [&>div]:from-violet-500 [&>div]:to-fuchsia-500" />
          </div>
        ) : (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-violet-300">
            <PlayCircle className="h-4 w-4" />
            Start course
          </p>
        )}
      </div>
    </button>
  );
}

export default function Training() {
  const navigate = useNavigate();
  const { isTrainingCreator, setIsTrainingCreator } = useAuth();
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState([]);
  const [myCourses, setMyCourses] = useState([]);
  const [tab, setTab] = useState("explore");
  const [registering, setRegistering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/training/catalog");
      setCatalog(data.courses || []);
      setMyCourses(data.my_courses || []);
      if (data.is_training_creator) setIsTrainingCreator(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load courses");
    } finally {
      setLoading(false);
    }
  }, [setIsTrainingCreator]);

  useEffect(() => { load(); }, [load]);

  const progressMap = Object.fromEntries(
    (myCourses || []).map((c) => [c.course_id, c.progress_percent]),
  );

  const becomeCreator = async () => {
    setRegistering(true);
    try {
      await api.post("/training/creator/register", {});
      setIsTrainingCreator(true);
      toast.success("Creator studio unlocked");
      navigate("/training/creator");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not register as creator");
    } finally {
      setRegistering(false);
    }
  };

  if (loading) {
    return (
      <AppPage className="sprout grid place-items-center bg-sprout-bg">
        <Loader2 className="h-5 w-5 animate-spin text-sprout-muted" />
      </AppPage>
    );
  }

  const exploreList = catalog;
  const learningList = myCourses.length
    ? myCourses
    : catalog.filter((c) => progressMap[c.course_id] != null);

  return (
    <AppPage className="sprout bg-sprout-bg text-white">
      <header className="mx-auto w-full max-w-md shrink-0 px-5 pt-6" data-testid="training-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-7 w-7 text-violet-400" strokeWidth={2} />
            <h1 className="font-display text-3xl font-bold tracking-tight">Academy</h1>
          </div>
          {isTrainingCreator ? (
            <button
              type="button"
              onClick={() => navigate("/training/creator")}
              className="flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Studio
            </button>
          ) : (
            <button
              type="button"
              onClick={becomeCreator}
              disabled={registering}
              className="text-xs font-semibold text-violet-300 disabled:opacity-50"
            >
              {registering ? "…" : "Become a creator"}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-sprout-muted">Video courses to level up your job search.</p>

        <div className="mt-5 flex gap-2 rounded-xl bg-sprout-surface p-1">
          {[
            { id: "explore", label: "Explore" },
            { id: "learning", label: "My learning" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                tab === item.id ? "bg-violet-600 text-white shadow-sm" : "text-sprout-muted hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <AppPageScroll className="mx-auto max-w-md px-5">
        {tab === "explore" ? (
          <div className="mt-5 space-y-4 pb-4">
            {exploreList.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-sprout-border p-8 text-center text-sm text-sprout-muted">
                No courses published yet. Check back soon.
              </div>
            ) : (
              exploreList.map((course) => (
                <CourseCard
                  key={course.course_id}
                  course={course}
                  progress={progressMap[course.course_id]}
                  onClick={() => navigate(`/training/${course.course_id}`)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-4 pb-4">
            {learningList.length === 0 ? (
              <div className="rounded-2xl border border-sprout-border bg-sprout-surface p-6 text-center">
                <Sparkles className="mx-auto h-8 w-8 text-violet-400" />
                <p className="mt-3 font-medium text-white">No courses in progress</p>
                <p className="mt-1 text-sm text-sprout-muted">Pick a course from Explore to start learning.</p>
                <button
                  type="button"
                  onClick={() => setTab("explore")}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-violet-300"
                >
                  Browse courses
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              learningList.map((course) => (
                <CourseCard
                  key={course.course_id}
                  course={course}
                  progress={course.progress_percent ?? progressMap[course.course_id]}
                  onClick={() => navigate(`/training/${course.course_id}`)}
                />
              ))
            )}
          </div>
        )}
      </AppPageScroll>
    </AppPage>
  );
}
