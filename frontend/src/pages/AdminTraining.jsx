import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const fmtDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-zinc-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export default function AdminTraining() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setAccessDenied(false);
    try {
      const { data: payload } = await api.get("/admin/training/analytics");
      setData(payload);
    } catch (err) {
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setError("Admin access denied");
      } else {
        setError(err?.response?.data?.detail || "Could not load training analytics");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const moduleStats = data?.module_stats || [];
  const learners = data?.learners || [];

  const maxStopped = useMemo(
    () => Math.max(1, ...moduleStats.map((m) => m.stopped_here_count || 0)),
    [moduleStats],
  );

  return (
    <AdminShell
      title="Training"
      subtitle="Enrollment funnel, module drop-off, and quiz completion"
      actions={(
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      )}
    >
      {accessDenied ? <AdminAccessDenied message={error} /> : null}

      {!accessDenied && loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading training analytics…
        </div>
      ) : null}

      {!accessDenied && !loading && error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>
      ) : null}

      {!accessDenied && !loading && data ? (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Enrolled" value={summary.enrolled ?? 0} />
            <StatCard
              label="Course completed"
              value={`${summary.completion_rate_percent ?? 0}%`}
              hint={`${summary.completed_course ?? 0} learners at 100%`}
            />
            <StatCard label="Avg progress" value={`${summary.avg_progress_percent ?? 0}%`} />
            <StatCard label="Modules tracked" value={moduleStats.length} />
          </div>

          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <h2 className="font-display text-lg font-bold">Module funnel</h2>
              <p className="text-sm text-zinc-500">Completion rate and where learners last stopped</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3">Module</th>
                    <th className="px-5 py-3">Completed</th>
                    <th className="px-5 py-3">Quiz pass</th>
                    <th className="px-5 py-3">Stopped here</th>
                  </tr>
                </thead>
                <tbody>
                  {moduleStats.map((mod) => (
                    <tr key={mod.module_id} className="border-b border-zinc-50">
                      <td className="px-5 py-3 font-medium text-zinc-800">{mod.title}</td>
                      <td className="px-5 py-3 text-zinc-600">
                        {mod.completed_count}
                        <span className="text-zinc-400"> ({mod.completion_rate_percent}%)</span>
                      </td>
                      <td className="px-5 py-3 text-zinc-600">
                        {mod.quiz_pass_count}
                        <span className="text-zinc-400"> ({mod.quiz_pass_rate_percent}%)</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-100">
                            <div
                              className="h-full rounded-full bg-violet-500"
                              style={{ width: `${((mod.stopped_here_count || 0) / maxStopped) * 100}%` }}
                            />
                          </div>
                          <span className="text-zinc-600">{mod.stopped_here_count ?? 0}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <h2 className="font-display text-lg font-bold">Learners</h2>
              <p className="text-sm text-zinc-500">Progress, last position, and quiz results</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Progress</th>
                    <th className="px-5 py-3">Last module</th>
                    <th className="px-5 py-3">Quizzes passed</th>
                    <th className="px-5 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {learners.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-zinc-500">
                        No enrollments yet
                      </td>
                    </tr>
                  ) : (
                    learners.map((row) => {
                      const passedQuizzes = Object.values(row.quiz_results || {}).filter((q) => q.passed).length;
                      return (
                        <tr key={row.user_id} className="border-b border-zinc-50">
                          <td className="px-5 py-3">
                            <p className="font-medium text-zinc-800">{row.name || row.email || row.user_id}</p>
                            {row.email ? <p className="text-xs text-zinc-500">{row.email}</p> : null}
                          </td>
                          <td className="px-5 py-3 text-zinc-600">{row.progress_percent ?? 0}%</td>
                          <td className="px-5 py-3 text-zinc-600">
                            {row.last_module_id || "—"}
                            {row.last_section_id ? (
                              <span className="block text-xs text-zinc-400">{row.last_section_id}</span>
                            ) : null}
                          </td>
                          <td className="px-5 py-3 text-zinc-600">{passedQuizzes}</td>
                          <td className="px-5 py-3 text-zinc-500">{fmtDate(row.updated_at)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </AdminShell>
  );
}
