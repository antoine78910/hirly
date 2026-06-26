import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Link2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { buildInviteUrl } from "../lib/creatorInvite";
import { formatInviteClicked, formatInviteConnectedAccount, formatInviteStatus } from "../lib/adminInviteTracking";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";

const COURSE_ID = "course_job_search_mastery";

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

async function copyText(label, value) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`);
  }
}

function TrainingInvitesPanel() {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [latestInvite, setLatestInvite] = useState(null);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/training/invites");
      const rows = data?.invites || [];
      setInvites(rows);
      if (!latestInvite && rows[0]) setLatestInvite(rows[0]);
    } catch (err) {
      if (err?.response?.status !== 403) {
        toast.error(adminApiErrorMessage(err, "Could not load training invites"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  const createInvite = async () => {
    setCreating(true);
    try {
      const { data } = await api.post("/admin/training/invites", {
        label: label.trim(),
        email_hint: emailHint.trim(),
        course_id: COURSE_ID,
      });
      const invitation = data?.invitation || data;
      setLatestInvite(invitation);
      setLabel("");
      setEmailHint("");
      toast.success("Training invitation created");
      await loadInvites();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not create invitation");
    } finally {
      setCreating(false);
    }
  };

  const code = latestInvite?.code || "";
  const inviteUrl = code ? buildInviteUrl(code) : "";

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-600" />
          <div>
            <h2 className="font-display text-lg font-bold">Training invitations</h2>
            <p className="text-sm text-zinc-500">
              Generate a personal training link. Learners must open it before they can access /training.
              They will see a confidentiality notice — demo access is not included.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Label (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. March cohort — Lisa"
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Email hint (optional)</label>
            <input
              type="email"
              value={emailHint}
              onChange={(e) => setEmailHint(e.target.value)}
              placeholder="creator@email.com"
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={creating} onClick={createInvite}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate invitation link
          </Button>
        </div>

        {code ? (
          <div className="space-y-3 rounded-lg bg-violet-50/80 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">6-digit code</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono text-2xl font-bold tracking-[0.2em] text-zinc-900">{code}</span>
                <Button size="sm" variant="outline" onClick={() => copyText("Code", code)}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Invitation link</p>
              <div className="mt-1 flex items-start gap-2">
                <p className="flex-1 break-all text-sm text-zinc-700">{inviteUrl}</p>
                <Button size="sm" variant="outline" onClick={() => copyText("Link", inviteUrl)}>
                  <Link2 className="h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-zinc-500">Loading recent invitations…</p>
        ) : invites.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <th className="py-2 pr-4">Code</th>
                  <th className="py-2 pr-4">Label</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Link opened</th>
                  <th className="py-2 pr-4">Connected account</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {invites.slice(0, 8).map((row) => (
                  <tr key={row.invite_id || row.code} className="border-b border-zinc-50">
                    <td className="py-2 pr-4 font-mono text-xs">{row.code}</td>
                    <td className="py-2 pr-4 text-zinc-600">{row.label || row.email_hint || "—"}</td>
                    <td className="py-2 pr-4 text-zinc-500">{fmtDate(row.created_at)}</td>
                    <td className="py-2 pr-4 text-zinc-600">{formatInviteClicked(row, fmtDate)}</td>
                    <td className="py-2 pr-4 text-zinc-700">{formatInviteConnectedAccount(row)}</td>
                    <td className="py-2 text-zinc-600">{formatInviteStatus(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function AdminTraining() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsError("");
    try {
      const { data: payload } = await api.get("/admin/training/analytics");
      setData(payload);
    } catch (err) {
      setData(null);
      if (err?.response?.status === 403) {
        setAccessDenied(true);
        setAnalyticsError("Admin access denied");
      } else {
        setAnalyticsError(adminApiErrorMessage(err, "Could not load training analytics"));
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setAccessDenied(false);
    await loadAnalytics();
    setLoading(false);
  }, [loadAnalytics]);

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
      subtitle="Training invitations, enrollment, and module completion"
      actions={(
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      )}
    >
      {accessDenied ? <AdminAccessDenied message={analyticsError} /> : null}

      {!accessDenied && loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading training analytics…
        </div>
      ) : null}

      {!accessDenied && !loading ? (
        <div className="space-y-8">
          <TrainingInvitesPanel />

          {analyticsError ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {analyticsError}
            </p>
          ) : null}

          {data ? (
            <>
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
            </>
          ) : null}
        </div>
      ) : null}
    </AdminShell>
  );
}
