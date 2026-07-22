import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Link2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { createColumnHelper } from "@tanstack/react-table";
import { toast } from "sonner";
import { api } from "../lib/api";
import { adminApiErrorMessage } from "../lib/adminApi";
import { buildInviteUrl } from "../lib/creatorInvite";
import {
  formatInviteClicked,
  formatInviteConnectedAccount,
  formatInviteStatus,
} from "../lib/adminInviteTracking";
import { Button } from "../components/ui/button";
import AdminShell, { AdminAccessDenied } from "../components/admin/AdminShell";
import AdminDataTable from "../components/admin/AdminDataTable";

const COURSE_ID = "course_job_search_mastery";

const columnHelper = createColumnHelper();

function getQuizSummaries(row) {
  return row.quiz_summaries?.length
    ? row.quiz_summaries
    : Object.entries(row.quiz_results || {}).map(([quizId, qres]) => ({
        quiz_id: quizId,
        module_id: qres?.module_id,
        score: qres?.score,
        passed: qres?.passed,
        attempts: qres?.attempts,
        answers: qres?.answers,
        submitted_at: qres?.submitted_at,
      }));
}

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

  const inviteColumns = useMemo(
    () => [
      columnHelper.accessor("code", {
        header: "Code",
        cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.label || row.email_hint || "—", {
        id: "label",
        header: "Label",
      }),
      columnHelper.accessor((row) => (row.created_at ? new Date(row.created_at).getTime() : 0), {
        id: "created_at",
        header: "Created",
        cell: (info) => fmtDate(info.row.original.created_at),
      }),
      columnHelper.accessor((row) => formatInviteClicked(row, fmtDate), {
        id: "clicked",
        header: "Link opened",
        enableSorting: false,
      }),
      columnHelper.accessor((row) => formatInviteConnectedAccount(row), {
        id: "connected_account",
        header: "Connected account",
        enableSorting: false,
      }),
      columnHelper.accessor((row) => formatInviteStatus(row), {
        id: "status",
        header: "Status",
        enableSorting: false,
      }),
    ],
    [],
  );

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-600" />
          <div>
            <h2 className="font-display text-lg font-bold">Training invitations</h2>
            <p className="text-sm text-zinc-500">
              Generate a personal training link. Learners must open it before they can access
              /training. They will see a confidentiality notice — demo access is not included.
            </p>
          </div>
        </div>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Label (optional)
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. March cohort — Lisa"
              className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Email hint (optional)
            </label>
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
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Generate invitation link
          </Button>
        </div>

        {code ? (
          <div className="space-y-3 rounded-lg bg-violet-50/80 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                6-digit code
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono text-2xl font-bold tracking-[0.2em] text-zinc-900">
                  {code}
                </span>
                <Button size="sm" variant="outline" onClick={() => copyText("Code", code)}>
                  <Copy className="h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Invitation link
              </p>
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

        <AdminDataTable
          columns={inviteColumns}
          data={invites}
          loading={loading}
          getRowId={(row) => row.invite_id || row.code}
          searchPlaceholder="Search training invites…"
          emptyMessage="No training invitations yet."
          initialSorting={[{ id: "created_at", desc: true }]}
        />
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

  const moduleTitleById = useMemo(
    () => Object.fromEntries(moduleStats.map((mod) => [mod.module_id, mod.title || mod.module_id])),
    [moduleStats],
  );

  const maxStopped = useMemo(
    () => Math.max(1, ...moduleStats.map((m) => m.stopped_here_count || 0)),
    [moduleStats],
  );

  const moduleColumns = useMemo(
    () => [
      columnHelper.accessor("title", {
        header: "Module",
        cell: (info) => <span className="font-medium text-zinc-800">{info.getValue()}</span>,
      }),
      columnHelper.accessor("completed_count", {
        header: "Completed",
        cell: (info) => {
          const mod = info.row.original;
          return (
            <>
              {mod.completed_count}
              <span className="text-zinc-400"> ({mod.completion_rate_percent}%)</span>
            </>
          );
        },
      }),
      columnHelper.accessor("quiz_pass_count", {
        header: "Quiz pass",
        cell: (info) => {
          const mod = info.row.original;
          return (
            <>
              {mod.quiz_pass_count}
              <span className="text-zinc-400"> ({mod.quiz_pass_rate_percent}%)</span>
            </>
          );
        },
      }),
      columnHelper.accessor((row) => row.stopped_here_count || 0, {
        id: "stopped_here",
        header: "Stopped here",
        cell: (info) => {
          const value = info.getValue();
          return (
            <div className="flex items-center gap-2">
              <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${(value / maxStopped) * 100}%` }}
                />
              </div>
              <span className="text-zinc-600">{value}</span>
            </div>
          );
        },
      }),
    ],
    [maxStopped],
  );

  const learnerColumns = useMemo(
    () => [
      columnHelper.accessor((row) => `${row.name || ""} ${row.email || ""} ${row.user_id || ""}`, {
        id: "user",
        header: "User",
        cell: (info) => {
          const row = info.row.original;
          return (
            <>
              <p className="font-medium text-zinc-800">{row.name || row.email || row.user_id}</p>
              {row.email ? <p className="text-xs text-zinc-500">{row.email}</p> : null}
            </>
          );
        },
      }),
      columnHelper.accessor((row) => row.progress_percent ?? 0, {
        id: "progress",
        header: "Progress",
        cell: (info) => `${info.getValue()}%`,
      }),
      columnHelper.accessor(
        (row) =>
          row.last_module_id ? moduleTitleById[row.last_module_id] || row.last_module_id : "—",
        {
          id: "last_module",
          header: "Last module",
          cell: (info) => {
            const row = info.row.original;
            return (
              <>
                {info.getValue()}
                {row.last_section_id ? (
                  <span className="block text-xs text-zinc-400">{row.last_section_id}</span>
                ) : null}
              </>
            );
          },
        },
      ),
      columnHelper.accessor((row) => getQuizSummaries(row).filter((q) => q.passed).length, {
        id: "quizzes",
        header: "Quizzes",
        cell: (info) => {
          const row = info.row.original;
          const quizSummaries = getQuizSummaries(row);
          const passedQuizzes = info.getValue();
          return (
            <>
              <p className="font-medium">{passedQuizzes} passed</p>
              {quizSummaries.length === 0 ? (
                <p className="text-xs text-zinc-400">No quiz attempts yet</p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs">
                  {quizSummaries.map((quiz) => (
                    <li
                      key={`${row.user_id}-${quiz.quiz_id}`}
                      className="rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1.5"
                    >
                      <p className="font-medium text-zinc-700">
                        {moduleTitleById[quiz.module_id] || quiz.module_id || quiz.quiz_id}
                        {" · "}
                        <span className={quiz.passed ? "text-emerald-700" : "text-amber-700"}>
                          {quiz.passed ? "Passed" : "Not passed"}
                        </span>
                        {typeof quiz.score === "number" ? ` (${quiz.score}%)` : ""}
                      </p>
                      {quiz.answers && Object.keys(quiz.answers).length > 0 ? (
                        <p className="mt-1 text-zinc-500">
                          Answers:{" "}
                          {Object.entries(quiz.answers)
                            .map(([questionId, choiceId]) => `${questionId}=${choiceId}`)
                            .join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        },
      }),
      columnHelper.accessor((row) => (row.updated_at ? new Date(row.updated_at).getTime() : 0), {
        id: "updated_at",
        header: "Updated",
        cell: (info) => fmtDate(info.row.original.updated_at),
      }),
    ],
    [moduleTitleById],
  );

  return (
    <AdminShell
      title="Training"
      subtitle="Training invitations, enrollment, and module completion"
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      }
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
                  <p className="text-sm text-zinc-500">
                    Completion rate and where learners last stopped
                  </p>
                </div>
                <div className="px-5 py-4">
                  <AdminDataTable
                    columns={moduleColumns}
                    data={moduleStats}
                    getRowId={(row) => row.module_id}
                    searchPlaceholder="Search modules…"
                    emptyMessage="No module data yet."
                  />
                </div>
              </section>

              <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
                <div className="border-b border-zinc-100 px-5 py-4">
                  <h2 className="font-display text-lg font-bold">Learners</h2>
                  <p className="text-sm text-zinc-500">Progress, last position, and quiz results</p>
                </div>
                <div className="px-5 py-4">
                  <AdminDataTable
                    columns={learnerColumns}
                    data={learners}
                    getRowId={(row) => row.user_id}
                    searchPlaceholder="Search learners by name, email, or user ID…"
                    emptyMessage="No enrollments yet"
                    initialSorting={[{ id: "updated_at", desc: true }]}
                  />
                </div>
              </section>
            </>
          ) : null}
        </div>
      ) : null}
    </AdminShell>
  );
}
